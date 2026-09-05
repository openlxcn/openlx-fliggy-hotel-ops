import {createSync} from './series-sync.mjs';
import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {catalog,safeId,now} from '../skills/openlx-fliggy-hotel-ops/scripts/core.mjs';
import {openStore} from './store.mjs';
import {commerceBridge,identityRequest} from './bridge.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createApp(options={}){
  const origin=options.origin||process.env.PUBLIC_ORIGIN||'http://127.0.0.1:1989';
  const dataDir=options.dataDir||process.env.DATA_DIR||path.join(root,'data');
  const identityOrigin=process.env.OPENLX_IDENTITY_ORIGIN||'https://wx.openlx.cn';
  const store=options.store||openStore(dataDir);
  const series=options.series||createSync(store.db,{product:catalog.id,origin:identityOrigin,keyFile:process.env.OPENLX_SERIES_KEY_FILE});
  const bridge=options.bridge||commerceBridge(process.env.OPENLX_SHARED_ROOT,origin);
  const identity=options.identity||((route,body,token)=>identityRequest(identityOrigin,route,body,token));
  const sales=process.env.SALES_ENABLED==='true'&&catalog.pricing_status==='CONFIRMED';const secure=origin.startsWith('https:');
  const app=express();app.disable('x-powered-by');app.set('trust proxy','loopback');
  const cookie=(name,value,age)=>`${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure?'; Secure':''}`;
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});
    req.cookies={};for(const item of String(req.headers.cookie||'').split(';')){const i=item.indexOf('=');if(i>0){try{req.cookies[item.slice(0,i).trim()]=decodeURIComponent(item.slice(i+1));}catch{}}}next();
  });
  app.post('/api/payment/wechat-notify',express.text({type:'*/*',limit:'100kb'}),async(req,res)=>{try{const r=await bridge.verifyWechat(req.body);if(r.paid)store.fulfill(r.order,r.transaction,r.amount,r.provider);res.type('application/xml').send('<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>');}catch{res.type('application/xml').send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>');}});
  app.post('/api/payment/alipay-notify',express.urlencoded({extended:false,limit:'100kb'}),(req,res)=>{try{const r=bridge.verifyAlipay(req.body);if(r.paid)store.fulfill(r.order,r.transaction,r.amount,r.provider);res.send('success');}catch{res.send('fail');}});
  app.use(express.json({limit:'64kb'}));
  // Device credential is explicit Bearer authentication; cookies cannot authorize it.
  app.post('/api/device/:operation',(req,res)=>{try{
    if(req.headers.origin&&req.headers.origin!==origin)throw Error('INVALID_ORIGIN');
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    res.set('Cache-Control','no-store');
    if(req.params.operation==='refresh')return res.json({success:true,data:store.refreshLicense(token)});
    if(req.params.operation==='lease')return res.json({success:true,data:store.writerLease(token,req.body.operation,req.body.lease_id)});
    return res.status(404).json({success:false,error:'UNKNOWN_DEVICE_OPERATION'});
  }catch(e){return res.status(403).json({success:false,error:e.message});}});
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
    const csrf=req.headers['x-csrf-token'];if(req.headers.origin!==origin||!csrf||csrf!==req.cookies.fliggy_csrf)return res.status(403).json({success:false,error:'请求来源或会话校验失败，请刷新页面'});
  }next();});
  const windows=new Map();
  app.use('/api/auth',(req,res,next)=>{const key=req.ip,t=Date.now(),r=windows.get(key)||{count:0,until:t+60000};if(r.until<t){r.count=0;r.until=t+60000;}r.count++;windows.set(key,r);if(windows.size>10000)for(const[k,v]of windows)if(v.until<t)windows.delete(k);if(r.count>15)return res.status(429).json({success:false,error:'操作频繁，请稍后再试'});next();});
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const session=async(req,res,next)=>{try{const r=await identity('/api/user/info',undefined,req.cookies.fliggy_session||'');if(!r.success||!r.data?.id)return res.status(401).json({success:false,error:'请先登录'});req.user=r.data;next();}catch{res.status(503).json({success:false,error:'账号服务暂不可用，请稍后重试'});}};
  app.get('/health',(_req,res)=>res.json({service:catalog.id,version:catalog.version,status:'ok'}));
  app.get('/api/session',(req,res)=>{const csrf=crypto.randomBytes(24).toString('hex');res.set('Set-Cookie',cookie('fliggy_csrf',csrf,3600));res.json({success:true,csrf,has_session:!!req.cookies.fliggy_session});});
  app.get('/api/public/config',(_req,res)=>{
    const statusFile=path.join(root,'public/status.json');const state=fs.existsSync(statusFile)?JSON.parse(fs.readFileSync(statusFile)):{};
    res.json({success:true,data:{...catalog,sales_enabled:sales,payment:bridge.options,identity:'OPENLX_SHARED',status:state,release:fs.existsSync(path.join(root,'public/release.json'))?JSON.parse(fs.readFileSync(path.join(root,'public/release.json'))):null}});
  });
  const authRoutes={login:'/api/user/login',register:'/api/user/register/email',resend:'/api/user/email/resend-verification',forgot:'/api/user/password/forgot-email'};
  for(const [route,target]of Object.entries(authRoutes))app.post('/api/auth/'+route,wrap(async(req,res)=>{
    const {email,password,nickname,account}=req.body||{};const data=route==='login'?{account,password}:route==='register'?{email,password,nickname}:{email};
    const r=await identity(target,data);if(r.data?.token){res.set('Set-Cookie',cookie('fliggy_session',r.data.token,30*86400));delete r.data.token;}
    delete r.httpStatus;res.status(r.success?200:400).json(r);
  }));
  app.post('/api/auth/logout',wrap(async(req,res)=>{if(req.cookies.fliggy_session)await identity('/api/user/logout',{},req.cookies.fliggy_session);res.set('Set-Cookie',cookie('fliggy_session','',0));res.json({success:true});}));
  app.get('/api/series',session,wrap(async(req,res)=>{
    const result=await identity('/api/user/series',undefined,req.cookies.fliggy_session);
    if(!result.success||String(result.data?.user_id)!==String(req.user.id))return res.status(503).json({success:false,error:'系列账户数据暂不可用，酒店本地记录仍可使用'});
    res.json({success:true,data:{...result.data,local_sync:series.status()}});
  }));
  app.get('/api/account',session,(req,res)=>{
    const uid=String(req.user.id),hotels=store.db.prepare('SELECT * FROM hotels WHERE user_id=?').all(uid).map(h=>({...h,entitlement:store.active(uid,h.id)}));
    res.json({success:true,data:{user:{id:uid,nickname:req.user.nickname,email:req.user.email,email_verified:req.user.email_verified},hotels,orders:store.db.prepare('SELECT id,hotel_id,plan,cycle,amount_fen,status,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(uid),tickets:store.db.prepare('SELECT * FROM tickets WHERE user_id=? ORDER BY created_at DESC').all(uid),devices:store.db.prepare('SELECT * FROM devices WHERE user_id=?').all(uid)}});
  });
  app.post('/api/hotels',session,wrap(async(req,res)=>{const id=safeId(req.body.hotel_id),name=String(req.body.name||'').trim();if(!name||name.length>100)throw Error('请填写正确酒店名称');store.db.prepare('INSERT INTO hotels VALUES(?,?,?,?)').run(id,String(req.user.id),name,now());res.json({success:true,data:{id,name}});}));
  app.post('/api/orders',session,wrap(async(req,res)=>{
    if(!sales)return res.status(503).json({success:false,error:'收费套餐尚未开放购买，功能及账号适配正在逐项验证；免费功能可以使用。'});
    const {hotel_id,plan,cycle,provider}=req.body;if(!bridge.options[provider])throw Error('支付方式尚未配置');
    const o=store.createOrder(req.user.id,hotel_id,plan,cycle,provider);res.json({success:true,data:{id:o.id,amount_fen:o.amount_fen,plan:o.plan,cycle:o.cycle}});
  }));
  app.post('/api/orders/:id/prepay',session,wrap(async(req,res)=>{
    if(!sales)throw Error('尚未开放购买');const o=store.db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id,String(req.user.id));if(!o||o.status!=='PENDING')throw Error('订单不存在或不可支付');
    const code=await bridge.prepay(o);res.json({success:true,data:{order_id:o.id,qr:await QRCode.toDataURL(code),amount_fen:o.amount_fen}});
  }));
  app.get('/api/orders/:id',session,wrap(async(req,res)=>{
    const o=store.db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id,String(req.user.id));if(!o)return res.status(404).json({success:false,error:'订单不存在'});
    res.json({success:true,data:{id:o.id,status:o.status,amount_fen:o.amount_fen,plan:o.plan,cycle:o.cycle}});
  }));
  app.post('/api/orders/:id/recheck',session,wrap(async(req,res)=>{
    const o=store.db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id,String(req.user.id));if(!o)throw Error('ORDER_NOT_FOUND');
    const result=await bridge.query(o);if(result?.paid)store.fulfill(result.order,result.transaction,result.amount,result.provider);res.json({success:true,data:{status:store.db.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status}});
  }));
  app.post('/api/devices',session,wrap(async(req,res)=>{
    const uid=String(req.user.id),hotel=safeId(req.body.hotel_id),id=safeId(req.body.device_id),label=String(req.body.label||'我的电脑').slice(0,80);
    if(!store.db.prepare('SELECT id FROM hotels WHERE id=? AND user_id=?').get(hotel,uid))throw Error('HOTEL_NOT_FOUND');
    const prev=store.db.prepare('SELECT * FROM devices WHERE id=?').get(id);if(prev&&(prev.user_id!==uid||prev.hotel_id!==hotel))throw Error('DEVICE_OWNER_MISMATCH');
    if(!prev?.active&&store.db.prepare('SELECT count(*) n FROM devices WHERE hotel_id=? AND user_id=? AND active=1').get(hotel,uid).n>=2)throw Error('已登记两台设备，请先停用旧设备');
    store.db.prepare('INSERT INTO devices VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET active=1,label=excluded.label,updated_at=excluded.updated_at').run(id,uid,hotel,label,now());res.json({success:true});
  }));
  app.post('/api/devices/:id/deactivate',session,(req,res)=>{store.db.prepare('UPDATE devices SET active=0,updated_at=? WHERE id=? AND user_id=?').run(now(),req.params.id,String(req.user.id));res.json({success:true});});
  app.post('/api/license',session,wrap(async(req,res)=>res.json({success:true,data:store.enroll(req.user.id,req.body.hotel_id,req.body.device_id)})));
  app.get('/api/license/public-key',(_req,res)=>res.type('text/plain').send(store.publicKey()));
  app.post('/api/tickets',session,wrap(async(req,res)=>res.json({success:true,data:store.ticket(req.user.id,req.body.hotel_id,req.body.type,req.body.request||'申请预约')})));
  app.get('/api/export',session,(req,res)=>{const uid=String(req.user.id);res.attachment('fliggy-account-export.json').json({hotels:store.db.prepare('SELECT * FROM hotels WHERE user_id=?').all(uid),orders:store.db.prepare('SELECT * FROM orders WHERE user_id=?').all(uid),tickets:store.db.prepare('SELECT * FROM tickets WHERE user_id=?').all(uid)});});
  app.get(['/reports','/report-demo.html'],(_req,res)=>{res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'");res.sendFile(path.join(root,'public/report-demo.html'));});
  app.use(express.static(path.join(root,'public'),{dotfiles:'deny',index:false}));
  app.get(['/','/features','/pricing','/install','/skills','/changelog'],(_req,res)=>res.sendFile(path.join(root,'public/index.html')));
  app.get('/account',(_req,res)=>res.sendFile(path.join(root,'public/account.html')));
  app.get('/docs',(_req,res)=>res.sendFile(path.join(root,'public/docs.html')));
  app.get('/reports',(_req,res)=>res.sendFile(path.join(root,'public/report-demo.html')));
  app.use((err,req,res,_next)=>{const safe=err.code==='SQLITE_CONSTRAINT_UNIQUE'?'该记录已存在，请查看现有记录':err.message||'请求失败';res.status(400).json({success:false,error:safe.replace(/\/www\/[^\s]*/g,'[服务器路径]')});});
  return {app,store,series};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {app,series}=createApp();series.start();const port=Number(process.env.PORT||1989);app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`openlx-fliggy-hotel-ops listening on ${port}`));}
