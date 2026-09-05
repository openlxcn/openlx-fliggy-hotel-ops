import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore,addMonths} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
const fixture=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fliggy-store-'));const s=openStore(dir);s.db.prepare('INSERT INTO hotels VALUES(?,?,?,?)').run('hotel1','1','测试酒店',new Date().toISOString());return {s,dir,close(){s.db.close();fs.rmSync(dir,{recursive:true,force:true});}};};
test('all prices are exact and no trial or voucher package can create order',()=>{const f=fixture();try{for(const [p,amounts]of [['STANDARD',[1490,2990,7990]],['SUPREME',[4990,9990,29990]]])for(const [i,c]of ['monthly','quarterly','annual'].entries())assert.equal(f.s.createOrder('1','hotel1',p,c,'alipay').amount_fen,amounts[i]);for(const p of ['FREE','TRIAL','COUPON'])assert.throws(()=>f.s.createOrder('1','hotel1',p,'monthly','alipay'),/INVALID_ORDER/);assert.throws(()=>f.s.createOrder('other','hotel1','STANDARD','monthly','alipay'),/HOTEL_NOT_FOUND/);}finally{f.close();}});
test('calendar months clamp correctly at month end',()=>{assert.equal(addMonths('2026-01-31T12:00:00Z',1),'2026-02-28T12:00:00.000Z');assert.equal(addMonths('2026-01-31T12:00:00Z',3),'2026-04-30T12:00:00.000Z');});
test('payment exact amount, merchant method, idempotency and renewal preserve entitlement',()=>{const f=fixture();try{const a=f.s.createOrder('1','hotel1','STANDARD','monthly','alipay');assert.throws(()=>f.s.fulfill(a.id,'tx1',1,'alipay'),/PAYMENT_MISMATCH/);assert.throws(()=>f.s.fulfill(a.id,'tx1',a.amount_fen,'wechat'),/PAYMENT_MISMATCH/);const paid=f.s.fulfill(a.id,'tx1',a.amount_fen,'alipay');assert.equal(f.s.fulfill(a.id,'tx1',a.amount_fen,'alipay').duplicate,true);assert.equal(f.s.db.prepare('SELECT count(*) n FROM entitlements').get().n,1);const b=f.s.createOrder('1','hotel1','STANDARD','monthly','alipay');const next=f.s.fulfill(b.id,'tx2',b.amount_fen,'alipay');assert.ok(Date.parse(next.expires_at)>Date.parse(paid.expires_at));assert.throws(()=>f.s.fulfill(b.id,'different',b.amount_fen,'alipay'),/TRANSACTION_MISMATCH/);}finally{f.close();}});
test('service ticket is not delivered and annual persona requires annual plan',()=>{const f=fixture();try{const o=f.s.createOrder('1','hotel1','SUPREME','monthly','alipay');f.s.fulfill(o.id,'tx',o.amount_fen,'alipay');const t=f.s.ticket('1','hotel1','CUSTOM_SERVICE','预约');assert.equal(t.status,'REQUESTED');assert.throws(()=>f.s.ticket('1','hotel1','CUSTOM_SERVICE','重复'));assert.throws(()=>f.s.ticket('1','hotel1','PERSONA','申请'),/ANNUAL_REQUIRED/);}finally{f.close();}});
test('HTTP website isolates session, requires CSRF and exposes no test-payment bypass',async()=>{const f=fixture();let server;try{
 const fakeIdentity=async(route,body,token)=>route==='/api/user/info'?token==='valid'?{success:true,data:{id:1,nickname:'测试用户'}}:{success:false}:{success:true,data:{token:'valid'}};
 const {app}=createApp({store:f.s,dataDir:f.dir,origin:'http://localhost',identity:fakeIdentity,bridge:{options:{alipay:false,wechat:false}}});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/account')).status,401);
 assert.equal((await fetch(base+'/api/hotels',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
 const init=await fetch(base+'/api/session'),csrf=(await init.json()).csrf,cookie=init.headers.get('set-cookie').split(';')[0];
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost','content-type':'application/json','x-csrf-token':csrf,Cookie:cookie},body:JSON.stringify({account:'fixture@example.invalid',password:'fixture-only'})});assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));assert.ok(!(await r.text()).includes('valid'));
 const acct=await fetch(base+'/api/account',{headers:{Cookie:'fliggy_session=valid'}});assert.equal(acct.status,200);
 const forbidden=await fetch(base+'/api/payment/mock-callback',{method:'POST',headers:{Origin:'http://localhost','content-type':'application/json','x-csrf-token':csrf,Cookie:cookie},body:'{}'});assert.equal(forbidden.status,404);
 }finally{if(server)await new Promise(r=>server.close(r));f.close();}});

test('registered device refresh is revocable and concurrent writers cannot both hold a lease',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fliggy-device-')),s=openStore(dir);
 try{
  s.db.prepare('INSERT INTO hotels VALUES(?,?,?,?)').run('hotel1','user1','测试酒店',new Date().toISOString());
  const o=s.createOrder('user1','hotel1','STANDARD','monthly','alipay');s.fulfill(o.id,'MOCK-TX-DEVICE',1490,'alipay');
  for(const id of ['d1','d2'])s.db.prepare('INSERT INTO devices VALUES(?,?,?,?,1,?)').run(id,'user1','hotel1',id,new Date().toISOString());
  const a=s.enroll('user1','hotel1','d1'),b=s.enroll('user1','hotel1','d2');
  assert.ok(s.refreshLicense(a.enrollment.token).signature);
  const first=s.writerLease(a.enrollment.token,'acquire');
  assert.throws(()=>s.writerLease(b.enrollment.token,'acquire'),/HOTEL_WRITER_BUSY/);
  assert.throws(()=>s.writerLease(b.enrollment.token,'renew',first.lease_id),/WRITER_LEASE_LOST/);
  s.writerLease(a.enrollment.token,'release',first.lease_id);
  assert.ok(s.writerLease(b.enrollment.token,'acquire').lease_id);
  s.db.prepare('UPDATE devices SET active=0 WHERE id=?').run('d1');
  assert.throws(()=>s.refreshLicense(a.enrollment.token),/DEVICE_OR_ENTITLEMENT_INACTIVE/);
  s.db.prepare("UPDATE entitlements SET status='REVOKED'").run();
  assert.throws(()=>s.refreshLicense(b.enrollment.token),/DEVICE_OR_ENTITLEMENT_INACTIVE/);
 }finally{s.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('series overview is session protected and rejects mismatched central user identity',async()=>{
 const f=fixture();let server,centralUser='other';try{
  const identity=async(route,_body,token)=>route==='/api/user/info'?{success:token==='valid',data:token==='valid'?{id:'1'}:undefined}:{success:true,data:{user_id:centralUser,products:{},records:[],wechat:{orders:[],entitlements:[]}}};
  const {app}=createApp({store:f.s,dataDir:f.dir,origin:'http://localhost',identity,bridge:{options:{alipay:false,wechat:false}}});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/series')).status,401);
  const denied=await fetch(base+'/api/series',{headers:{Cookie:'fliggy_session=valid'}});assert.equal(denied.status,503);assert.ok(!(await denied.text()).includes('other'));
  centralUser='1';const allowed=await fetch(base+'/api/series',{headers:{Cookie:'fliggy_session=valid'}});assert.equal(allowed.status,200);assert.equal((await allowed.json()).data.user_id,'1');
 }finally{if(server)await new Promise(r=>server.close(r));f.close();}
});
