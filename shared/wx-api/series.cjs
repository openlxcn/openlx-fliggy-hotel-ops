const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PRODUCTS = {
  'openlx-ctrip-hotel-ops': {name: '携程酒店运营助手', origin: 'https://ctrip.openlx.cn'},
  'openlx-meituan-hotel-ops': {name: '美团酒店运营助手', origin: 'https://meituan.openlx.cn'},
  'openlx-fliggy-hotel-ops': {name: '飞猪酒店运营助手', origin: 'https://feizhu.openlx.cn'},
  'openlx-weixin-baimindan': {name: '微信公众号免白名单发布', origin: 'https://wx.openlx.cn'}
};
const FIELDS = {
  hotels: ['id','user_id','name','created_at'],
  orders: ['id','user_id','hotel_id','plan','cycle','amount_fen','currency','snapshot','provider','status','transaction_id','created_at','paid_at'],
  entitlements: ['id','user_id','hotel_id','plan','cycle','starts_at','expires_at','status','order_id'],
  devices: ['id','user_id','hotel_id','label','active','updated_at'],
  tickets: ['id','user_id','hotel_id','type','period','status','created_at','updated_at']
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const signature = (secret,timestamp,body) => crypto.createHmac('sha256',secret).update(timestamp+'\nPOST\n/api/internal/series/sync\n'+hash(body)).digest('hex');
function verifyRequest(headers,body,keys,time=Date.now()) {
  const product=headers['x-openlx-product'],timestamp=String(headers['x-openlx-timestamp']||''),given=String(headers['x-openlx-signature']||'');
  if(!PRODUCTS[product]||product==='openlx-weixin-baimindan'||!keys[product]||!/^\d{13}$/.test(timestamp)||Math.abs(time-Number(timestamp))>300000||!/^\w{64}$/.test(given))throw Error('SERIES_AUTH_FAILED');
  const expected=signature(keys[product],timestamp,body);
  if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(given)))throw Error('SERIES_AUTH_FAILED');
  return product;
}
function validateBatch(product,batch) {
  if(batch.product_id!==product||!/^[-a-zA-Z0-9]{16,80}$/.test(batch.stream_id)||!Number.isSafeInteger(batch.from_revision)||!Number.isSafeInteger(batch.revision)||batch.from_revision<0||batch.revision<batch.from_revision||!Array.isArray(batch.records)||batch.records.length>300||batch.records.length>0&&batch.revision===batch.from_revision)throw Error('INVALID_SERIES_BATCH');
  const ids=new Set();
  for(const record of batch.records){
    const {entity_type,entity_id,user_id,deleted,data}=record;
    if(!FIELDS[entity_type]||typeof entity_id!=='string'||!entity_id||entity_id.length>100||!/^\d{1,20}$/.test(String(user_id))||typeof deleted!=='boolean')throw Error('INVALID_SERIES_RECORD');
    const key=entity_type+':'+entity_id;if(ids.has(key))throw Error('DUPLICATE_SERIES_RECORD');ids.add(key);
    if(!deleted){
      if(!data||Array.isArray(data)||typeof data!=='object'||data.id!==entity_id||String(data.user_id)!==String(user_id)||Object.keys(data).some(k=>!FIELDS[entity_type].includes(k))||JSON.stringify(data).length>30000)throw Error('INVALID_SERIES_FIELDS');
      if(entity_type==='orders'&&(!Number.isSafeInteger(data.amount_fen)||data.amount_fen<=0||data.currency!=='CNY'))throw Error('INVALID_SERIES_MONEY');
    }else if(data!==null)throw Error('INVALID_SERIES_TOMBSTONE');
  }
  return batch;
}
async function migrate(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS openlx_series_sources (
    product_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    stream_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0, last_hash CHAR(64) NOT NULL,
    synced_at DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS openlx_series_records (
    product_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entity_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entity_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL, revision BIGINT UNSIGNED NOT NULL,
    deleted TINYINT NOT NULL DEFAULT 0, data_json MEDIUMTEXT NOT NULL,
    synced_at DATETIME(3) NOT NULL,
    PRIMARY KEY(product_id,entity_type,entity_id), KEY by_user(user_id,deleted,entity_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
async function applyBatch(pool,product,batch) {
  validateBatch(product,batch);const digest=hash(JSON.stringify(batch));const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    await c.execute('INSERT IGNORE INTO openlx_series_sources VALUES(?,?,0,?,UTC_TIMESTAMP(3))',[product,batch.stream_id,'']);
    const [[source]]=await c.execute('SELECT * FROM openlx_series_sources WHERE product_id=? FOR UPDATE',[product]);
    if(source.stream_id!==batch.stream_id)throw Error('SERIES_STREAM_CONFLICT');
    if(Number(source.revision)===batch.revision&&source.last_hash===digest){await c.commit();return {revision:batch.revision,duplicate:true,records:batch.records.length};}
    if(Number(source.revision)!==batch.from_revision||batch.revision<=Number(source.revision)&&source.last_hash)throw Error('SERIES_REVISION_CONFLICT');
    for(const r of batch.records){
      const [[user]]=await c.execute('SELECT id FROM users WHERE id=?',[String(r.user_id)]);if(!user)throw Error('SERIES_UNKNOWN_USER');
      const [[old]]=await c.execute('SELECT user_id FROM openlx_series_records WHERE product_id=? AND entity_type=? AND entity_id=?',[product,r.entity_type,r.entity_id]);
      if(old&&String(old.user_id)!==String(r.user_id))throw Error('SERIES_OWNER_CONFLICT');
      await c.execute(`INSERT INTO openlx_series_records VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE revision=VALUES(revision),deleted=VALUES(deleted),data_json=VALUES(data_json),synced_at=VALUES(synced_at)`,
        [product,r.entity_type,r.entity_id,String(r.user_id),batch.revision,Number(r.deleted),JSON.stringify(r.data)]);
    }
    await c.execute('UPDATE openlx_series_sources SET revision=?,last_hash=?,synced_at=UTC_TIMESTAMP(3) WHERE product_id=?',[batch.revision,digest,product]);
    await c.commit();return {revision:batch.revision,duplicate:false,records:batch.records.length};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
async function overview(pool,userId) {
  const uid=String(userId);
  // User identity, WeChat orders and entitlements are read from their authoritative existing tables.
  const [records]=await pool.execute("SELECT product_id,entity_type,data_json,DATE_FORMAT(synced_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS synced_at FROM openlx_series_records WHERE user_id=? AND deleted=0 ORDER BY product_id,entity_type,entity_id LIMIT 2001",[uid]);
  const [orders]=await pool.execute('SELECT order_no,package_type,package_name,amount,pay_type,pay_status,pay_time,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 101',[uid]);
  const [keys]=await pool.execute('SELECT id,package_type,package_name,expire_at,status FROM agent_api_keys WHERE user_id=? ORDER BY id DESC LIMIT 101',[uid]);
  const [sources]=await pool.query("SELECT product_id,revision,DATE_FORMAT(synced_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS synced_at FROM openlx_series_sources");
  return {schema_version:1,user_id:uid,observed_at:new Date().toISOString(),products:PRODUCTS,
    records:records.slice(0,2000).map(r=>({product_id:r.product_id,entity_type:r.entity_type,data:JSON.parse(r.data_json),synced_at:r.synced_at})),
    wechat:{product_id:'openlx-weixin-baimindan',orders:orders.slice(0,100).map(o=>({...o,amount_fen:Math.round(Number(o.amount)*100),amount:undefined})),entitlements:keys.slice(0,100)},
    sources,truncated:records.length>2000||orders.length>100||keys.length>100,
    entitlement_policy:'PRODUCT_SCOPED',passes:'NOT_ON_SALE',replication:'PRODUCT_OUTBOX_TO_WX_MYSQL; WX_LEGACY_LIVE_READ'};
}
function mountSeries(app,db,requireSession,root,options={}) {
  const pool=db.pool;const keyFile=options.keyFile||'/etc/openlx/series-product-keys.json';
  app.post('/api/internal/series/sync',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const raw=JSON.stringify(req.body);if(raw.length>2000000)throw Error('SERIES_BATCH_TOO_LARGE');
      const product=verifyRequest(req.headers,raw,JSON.parse(fs.readFileSync(keyFile,'utf8')));
      res.json({success:true,data:await applyBatch(pool,product,req.body)});
    }catch(e){const known=/^(SERIES_|INVALID_SERIES|DUPLICATE_SERIES)/.test(e.message);res.status(e.message==='SERIES_AUTH_FAILED'?403:409).json({success:false,error:known?e.message:'SERIES_UNAVAILABLE'});}
  });
  app.get('/api/user/series',requireSession,async(req,res)=>{
    res.set('Cache-Control','no-store');try{res.json({success:true,data:await overview(pool,req.userId)});}catch{res.status(503).json({success:false,error:'SERIES_UNAVAILABLE'});}
  });
  for(const [route,file]of [['/series','series.html'],['/series.js','series.js']])app.get(route,(_req,res)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.sendFile(path.join(root,'openlx',file));
  });
}
module.exports={PRODUCTS,FIELDS,signature,verifyRequest,validateBatch,migrate,applyBatch,overview,mountSeries};
