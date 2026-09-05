import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {FIELDS,signature}=require('../shared/wx-api/series.cjs');

export function setupOutbox(db){
  db.exec(`CREATE TABLE IF NOT EXISTS series_sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS series_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,user_id TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO series_sync_meta VALUES(?,?)').run('stream_id',crypto.randomUUID());
  db.prepare('INSERT OR IGNORE INTO series_sync_meta VALUES(?,?)').run('ack','0');
  for(const table of Object.keys(FIELDS)){
    for(const op of ['INSERT','UPDATE','DELETE']){const row=op==='DELETE'?'OLD':'NEW';db.exec(`CREATE TRIGGER IF NOT EXISTS series_${table}_${op.toLowerCase()} AFTER ${op} ON ${table} BEGIN INSERT INTO series_outbox(entity_type,entity_id,user_id) VALUES('${table}',${row}.id,${row}.user_id); END;`);}
  }
  if(!db.prepare('SELECT 1 FROM series_sync_meta WHERE key=?').get('bootstrap')){
    db.exec('BEGIN IMMEDIATE');try{for(const table of Object.keys(FIELDS))db.exec(`INSERT INTO series_outbox(entity_type,entity_id,user_id) SELECT '${table}',id,user_id FROM ${table}`);db.prepare('INSERT INTO series_sync_meta VALUES(?,?)').run('bootstrap','1');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
}
export function nextBatch(db,product){
  const saved=db.prepare('SELECT value FROM series_sync_meta WHERE key=?').get('pending');if(saved)return JSON.parse(saved.value);
  db.exec('BEGIN IMMEDIATE');try{
    const ack=Number(db.prepare('SELECT value FROM series_sync_meta WHERE key=?').get('ack').value);
    const events=db.prepare('SELECT * FROM series_outbox WHERE seq>? ORDER BY seq LIMIT 300').all(ack),latest=new Map();
    for(const e of events)latest.set(e.entity_type+':'+e.entity_id,e);
    if(!events.length&&db.prepare('SELECT value FROM series_sync_meta WHERE key=?').get('registered')){db.exec('COMMIT');return null;}
    const records=[...latest.values()].map(e=>{const fields=FIELDS[e.entity_type];const row=db.prepare(`SELECT ${fields.join(',')} FROM ${e.entity_type} WHERE id=?`).get(e.entity_id);return {entity_type:e.entity_type,entity_id:e.entity_id,user_id:String(row?.user_id??e.user_id),deleted:!row,data:row?{...row,user_id:String(row.user_id)}:null};});
    const batch={product_id:product,stream_id:db.prepare('SELECT value FROM series_sync_meta WHERE key=?').get('stream_id').value,from_revision:ack,revision:events.at(-1)?.seq??ack,records};
    // Persist exact payload before network I/O: retries cannot silently change an acknowledged revision.
    db.prepare('INSERT OR REPLACE INTO series_sync_meta VALUES(?,?)').run('pending',JSON.stringify(batch));db.exec('COMMIT');return batch;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function createSync(db,{product='openlx-fliggy-hotel-ops',origin='https://wx.openlx.cn',keyFile,fetcher=fetch}={}){
  setupOutbox(db);let busy=false;let state={status:keyFile?'PENDING':'NOT_CONFIGURED',pending:0};
  async function flush(){
    if(busy||!keyFile)return state;busy=true;
    try{
      const secret=fs.readFileSync(keyFile,'utf8').trim(),batch=nextBatch(db,product);
      if(!batch){state={...state,status:'SYNCED',pending:0};return state;}
      const body=JSON.stringify(batch),stamp=String(Date.now());
      const r=await fetcher(origin+'/api/internal/series/sync',{method:'POST',headers:{'content-type':'application/json','x-openlx-product':product,'x-openlx-timestamp':stamp,'x-openlx-signature':signature(secret,stamp,body)},body,redirect:'error',signal:AbortSignal.timeout(10000)});
      const result=await r.json();if(!r.ok||!result.success||result.data?.revision!==batch.revision)throw Error(result.error||'SYNC_READBACK_MISMATCH');
      db.exec('BEGIN IMMEDIATE');try{const currentAck=Number(db.prepare('SELECT value FROM series_sync_meta WHERE key=?').get('ack').value),pending=db.prepare('SELECT value FROM series_sync_meta WHERE key=?').get('pending');if(pending?.value===body&&currentAck===batch.from_revision){db.prepare('UPDATE series_sync_meta SET value=? WHERE key=?').run(String(batch.revision),'ack');db.prepare('INSERT OR REPLACE INTO series_sync_meta VALUES(?,?)').run('registered','1');db.prepare('DELETE FROM series_sync_meta WHERE key=?').run('pending');db.prepare('DELETE FROM series_outbox WHERE seq<=?').run(batch.revision);}else if(currentAck<batch.revision)throw Error('SERIES_LOCAL_ACK_CONFLICT');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      state={status:'SYNCED',revision:Number(db.prepare('SELECT value FROM series_sync_meta WHERE key=?').get('ack').value),last_synced_at:new Date().toISOString(),pending:db.prepare('SELECT count(*) n FROM series_outbox').get().n};
    }catch(e){state={...state,status:'SYNC_PENDING',error:/^SERIES_[A-Z_]+$/.test(e.message)?e.message:'SERIES_CONNECTION_UNAVAILABLE',pending:db.prepare('SELECT count(*) n FROM series_outbox').get().n};}finally{busy=false;}
    return state;
  }
  return {flush,status:()=>({...state,pending:db.prepare('SELECT count(*) n FROM series_outbox').get().n}),start(){flush();const timer=setInterval(flush,15000);timer.unref();return ()=>clearInterval(timer);}};
}
