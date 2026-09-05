import {verifyPass,passEntitlement} from './membership.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {catalog,now} from '../skills/openlx-fliggy-hotel-ops/scripts/core.mjs';

export function addMonths(date,months){const d=new Date(date),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString();}
export function openStore(dir,options={}){
  const membershipKey=options.membershipKey||(process.env.OPENLX_MEMBERSHIP_PUBLIC_KEY_FILE?fs.readFileSync(process.env.OPENLX_MEMBERSHIP_PUBLIC_KEY_FILE,'utf8'):null);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const db=new DatabaseSync(path.join(dir,'commerce.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS shared_grants(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,envelope TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS hotels(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,hotel_id TEXT NOT NULL,plan TEXT NOT NULL,cycle TEXT NOT NULL,amount_fen INTEGER NOT NULL CHECK(amount_fen>0),currency TEXT NOT NULL,snapshot TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,transaction_id TEXT UNIQUE,created_at TEXT NOT NULL,paid_at TEXT);
   CREATE TABLE IF NOT EXISTS entitlements(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,hotel_id TEXT NOT NULL,plan TEXT NOT NULL,cycle TEXT NOT NULL,starts_at TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL,order_id TEXT UNIQUE NOT NULL);
   CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,hotel_id TEXT NOT NULL,label TEXT NOT NULL,active INTEGER NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS device_tokens(hash TEXT PRIMARY KEY,device_id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,hotel_id TEXT NOT NULL,expires_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS writer_leases(hotel_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,lease_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,hotel_id TEXT NOT NULL,type TEXT NOT NULL,period TEXT NOT NULL,status TEXT NOT NULL,request TEXT NOT NULL,delivery TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(hotel_id,type,period));
   CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,event TEXT NOT NULL,object_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const keyFile=path.join(dir,'license-private.pem');if(!fs.existsSync(keyFile)){const pair=crypto.generateKeyPairSync('ed25519');fs.writeFileSync(keyFile,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});fs.writeFileSync(path.join(dir,'license-public.txt'),pair.publicKey.export({type:'spki',format:'pem'}),{mode:0o644});}
  const audit=(event,id,details)=>db.prepare('INSERT INTO audit(event,object_id,details,created_at) VALUES(?,?,?,?)').run(event,id,JSON.stringify(details),now());
  function localActive(user,hotel,time=now()){return db.prepare("SELECT * FROM entitlements WHERE user_id=? AND hotel_id=? AND status='ACTIVE' AND starts_at<=? AND expires_at>? ORDER BY CASE plan WHEN 'SUPREME' THEN 2 ELSE 1 END DESC, expires_at DESC").get(String(user),hotel,time,time)||null;}
  function active(user,hotel,time=now()){
    const candidates=[localActive(user,hotel,time)];
    if(membershipKey)for(const row of db.prepare('SELECT envelope FROM shared_grants WHERE user_id=?').all(String(user)))candidates.push(passEntitlement(JSON.parse(row.envelope),membershipKey,{userId:user,hotelId:hotel,productId:catalog.id,time:Date.parse(time)}));
    return candidates.filter(Boolean).sort((a,b)=>(b.plan==='SUPREME'?2:1)-(a.plan==='SUPREME'?2:1)||Date.parse(b.expires_at)-Date.parse(a.expires_at))[0]||null;
  }
  function acceptPass(envelope){const p=verifyPass(envelope,membershipKey,Date.now(),true);if(!p)throw Error('INVALID_OR_STALE_CENTRAL_PASS');const old=db.prepare('SELECT envelope FROM shared_grants WHERE id=?').get(p.grant_id);if(old){const prior=JSON.parse(Buffer.from(JSON.parse(old.envelope).payload,'base64url'));if(Date.parse(prior.status_verified_at)>Date.parse(p.status_verified_at)||(prior.status_verified_at===p.status_verified_at&&JSON.parse(old.envelope).payload!==envelope.payload))throw Error('PASS_ROLLBACK_REJECTED');}db.prepare('INSERT INTO shared_grants VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,envelope=excluded.envelope,updated_at=excluded.updated_at').run(p.grant_id,String(p.subject_user_id),JSON.stringify(envelope),now());return {status:'IMPORTED_SIGNED_PASS',grant_id:p.grant_id};}
  function createOrder(user,hotel,plan,cycle,provider){
    if(!db.prepare('SELECT id FROM hotels WHERE id=? AND user_id=?').get(hotel,String(user)))throw Error('HOTEL_NOT_FOUND');
    if(!['STANDARD','SUPREME'].includes(plan)||!['monthly','quarterly','annual'].includes(cycle)||!['alipay','wechat'].includes(provider))throw Error('INVALID_ORDER');
    const amount=catalog.plans[plan][cycle+'_fen'];if(!Number.isInteger(amount)||amount<=0)throw Error('INVALID_AMOUNT');
    const current=active(user,hotel);if(current?.plan==='SUPREME'&&plan==='STANDARD')throw Error('请在至尊到期后购买标准，当前权益不会降低');
    const id='FZ'+Date.now()+crypto.randomBytes(5).toString('hex').toUpperCase();
    const snapshot=JSON.stringify({version:catalog.version,plan,cycle,amount_fen:amount,currency:'CNY',entitlements:catalog.plans[plan],defaults:catalog.defaults[plan],auto_renew:false});
    db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,NULL)').run(id,String(user),hotel,plan,cycle,amount,'CNY',snapshot,provider,'PENDING',now());audit('ORDER_CREATED',id,{amount_fen:amount,plan,cycle});return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  }
  function fulfill(orderId,tx,amount,provider){
    db.exec('BEGIN IMMEDIATE');try{
      const o=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);if(!o||o.provider!==provider||o.amount_fen!==amount||!tx)throw Error('PAYMENT_MISMATCH');
      if(o.status==='PAID'){if(o.transaction_id!==tx)throw Error('TRANSACTION_MISMATCH');db.exec('COMMIT');return {duplicate:true};}
      if(o.status!=='PENDING')throw Error('ORDER_NOT_PAYABLE');
      const last=db.prepare("SELECT expires_at FROM entitlements WHERE user_id=? AND hotel_id=? AND plan=? AND status='ACTIVE' ORDER BY expires_at DESC LIMIT 1").get(o.user_id,o.hotel_id,o.plan);
      const start=last&&Date.parse(last.expires_at)>Date.now()?last.expires_at:now();
      const months={monthly:1,quarterly:3,annual:12}[o.cycle];const end=addMonths(start,months);
      db.prepare('INSERT INTO entitlements VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),o.user_id,o.hotel_id,o.plan,o.cycle,start,end,'ACTIVE',o.id);
      db.prepare("UPDATE orders SET status='PAID',transaction_id=?,paid_at=? WHERE id=?").run(tx,now(),o.id);audit('PAYMENT_VERIFIED',o.id,{provider,transaction_id:tx,amount_fen:amount,expires_at:end});db.exec('COMMIT');return {duplicate:false,expires_at:end};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function license(user,hotel,device){
    const e=active(user,hotel);if(!e)throw Error('NO_PAID_ENTITLEMENT');
    const d=db.prepare('SELECT * FROM devices WHERE id=? AND user_id=? AND hotel_id=? AND active=1').get(device,String(user),hotel);if(!d)throw Error('DEVICE_NOT_REGISTERED');
    const tokenHash=db.prepare('SELECT hash FROM device_tokens WHERE device_id=? AND user_id=? AND hotel_id=?').get(device,String(user),hotel)?.hash||null;
    const p={product:catalog.id,user_id:String(user),hotel_id:hotel,device_id:device,device_token_hash:tokenHash,refresh_origin:'https://feizhu.openlx.cn',plan:e.plan,billing_cycle:e.cycle,expires_at:e.expires_at,issued_at:now(),offline_valid_until:new Date(Math.min(Date.parse(e.expires_at),Date.now()+86400000)).toISOString(),entitlement_id:e.id};
    const raw=Buffer.from(JSON.stringify(p));return {payload:raw.toString('base64url'),signature:crypto.sign(null,raw,fs.readFileSync(keyFile)).toString('base64url')};
  }
  function enroll(user,hotel,device){
    license(user,hotel,device);const token=crypto.randomBytes(32).toString('base64url'),digest=crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO device_tokens VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET hash=excluded.hash,expires_at=excluded.expires_at').run(digest,device,String(user),hotel,new Date(Date.now()+366*86400000).toISOString());
    return {...license(user,hotel,device),enrollment:{token,device_id:device}};
  }
  function deviceAuth(token){
    if(typeof token!=='string'||token.length<40)throw Error('DEVICE_AUTH_REQUIRED');
    const digest=crypto.createHash('sha256').update(token).digest('hex'),t=db.prepare('SELECT t.* FROM device_tokens t JOIN devices d ON t.device_id=d.id AND d.user_id=t.user_id AND d.hotel_id=t.hotel_id WHERE t.hash=? AND t.expires_at>? AND d.active=1').get(digest,now());
    if(!t||!active(t.user_id,t.hotel_id))throw Error('DEVICE_OR_ENTITLEMENT_INACTIVE');return t;
  }
  function refreshLicense(token){const d=deviceAuth(token);return license(d.user_id,d.hotel_id,d.device_id);}
  function writerLease(token,operation,leaseId){
    const d=deviceAuth(token),time=Date.now();db.exec('BEGIN IMMEDIATE');try{
      const old=db.prepare('SELECT * FROM writer_leases WHERE hotel_id=?').get(d.hotel_id);
      if(operation==='release'){if(old?.device_id===d.device_id&&old?.lease_id===leaseId)db.prepare('DELETE FROM writer_leases WHERE hotel_id=?').run(d.hotel_id);db.exec('COMMIT');return {status:'RELEASED'};}
      if(operation==='renew'&&(!old||old.device_id!==d.device_id||old.lease_id!==leaseId||old.expires_at<=time))throw Error('WRITER_LEASE_LOST');
      if(operation==='acquire'&&old&&old.expires_at>time)throw Error('HOTEL_WRITER_BUSY');
      if(!['acquire','renew'].includes(operation))throw Error('INVALID_LEASE_OPERATION');
      const id=operation==='renew'?old.lease_id:crypto.randomUUID(),until=time+120000;
      db.prepare('INSERT INTO writer_leases VALUES(?,?,?,?) ON CONFLICT(hotel_id) DO UPDATE SET device_id=excluded.device_id,lease_id=excluded.lease_id,expires_at=excluded.expires_at').run(d.hotel_id,d.device_id,id,until);db.exec('COMMIT');return {lease_id:id,expires_at:until,hotel_id:d.hotel_id,device_id:d.device_id,user_id:d.user_id};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function ticket(user,hotel,type,request){
    if(!db.prepare('SELECT id FROM hotels WHERE id=? AND user_id=?').get(hotel,String(user)))throw Error('HOTEL_NOT_FOUND');
    const e=active(user,hotel);if(e?.source==='SHARED_PASS'&&type!=='SUPPORT')throw Error('PASS_HUMAN_SERVICE_POLICY_REQUIRED');if(type!=='SUPPORT'&&(!e||e.plan!=='SUPREME'))throw Error('SUPREME_REQUIRED');
    if(!['CUSTOM_SERVICE','PERSONA','SUPPORT'].includes(type))throw Error('INVALID_TICKET');
    if(type==='PERSONA'&&e.cycle!=='annual')throw Error('ANNUAL_REQUIRED');
    let period=type==='CUSTOM_SERVICE'?'FIRST_ACTIVATION':type==='PERSONA'?e.order_id:crypto.randomUUID();
    if(type==='CUSTOM_SERVICE'){
      const first=db.prepare("SELECT starts_at FROM entitlements WHERE hotel_id=? AND plan='SUPREME' ORDER BY starts_at LIMIT 1").get(hotel);if(Date.parse(addMonths(first.starts_at,12))<Date.now())throw Error('INITIAL_SERVICE_PERIOD_EXPIRED');
    }
    const id=crypto.randomUUID();db.prepare('INSERT INTO tickets VALUES(?,?,?,?,?,?,?,NULL,?,?)').run(id,String(user),hotel,type,period,'REQUESTED',String(request).slice(0,3000),now(),now());audit('TICKET_REQUESTED',id,{type,period});return {id,status:'REQUESTED'};
  }
  return {db,active,acceptPass,createOrder,fulfill,license,enroll,refreshLicense,writerLease,ticket,audit,publicKey:()=>fs.readFileSync(path.join(dir,'license-public.txt'),'utf8')};
}
