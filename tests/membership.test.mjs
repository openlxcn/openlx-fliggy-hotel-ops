import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {verifyPass,passEntitlement,CONTRACT} from '../src/membership.mjs';
import {openStore} from '../src/store.mjs';
const pair=crypto.generateKeyPairSync('ed25519'),pub=pair.publicKey.export({format:'pem',type:'spki'}),pid='openlx-fliggy-hotel-ops';
const payload=()=>({schema:CONTRACT,issuer:'OPENLX_MEMBERSHIP',grant_id:'g1',subject_user_id:'u1',order_id:'central-order',status:'ACTIVE',cycle:'annual',scope:{mode:'all'},resolved_product_ids:[pid,'openlx-ctrip-hotel-ops'],product_catalog_version:'2026-09-v1',level_by_product:{[pid]:'SUPREME'},property_scope:{property_ids:['global-h1']},property_bindings:[{product_id:pid,local_hotel_id:'local-h1',property_id:'global-h1',subject_user_id:'u1'}],starts_at:new Date(Date.now()-10000).toISOString(),expires_at:new Date(Date.now()+366*86400000).toISOString(),status_verified_at:new Date().toISOString(),status_valid_until:new Date(Date.now()+3600000).toISOString()});
const sign=p=>{const raw=Buffer.from(JSON.stringify(p));return {payload:raw.toString('base64url'),signature:crypto.sign(null,raw,pair.privateKey).toString('base64url')};};
const resolve=(envelope,extra={})=>passEntitlement(envelope,pub,{userId:'u1',hotelId:'local-h1',productId:pid,...extra});
test('central pass scopes user, product and centrally attested property binding',()=>{
  const e=sign(payload());assert.equal(resolve(e).plan,'SUPREME');assert.equal(resolve(e,{userId:'u2'}),null);assert.equal(resolve(e,{hotelId:'same-name-different-hotel'}),null);assert.equal(resolve(e,{productId:'new-skill'}),null);
  const p=payload();p.property_bindings[0].property_id='other';assert.equal(resolve(sign(p)),null);
});
test('forged, stale, revoked, future or unbounded membership grants fail closed',()=>{
  const e=sign(payload());assert.equal(verifyPass({...e,payload:Buffer.from('{}').toString('base64url')},pub),null);assert.equal(verifyPass(e,null),null);
  for(const diff of [{status:'REVOKED'},{starts_at:new Date(Date.now()+3600000).toISOString()},{expires_at:'invalid'},{status_valid_until:new Date(Date.now()-1).toISOString()},{status_valid_until:new Date(Date.now()+2*86400000).toISOString()},{product_catalog_version:''},{scope:{mode:'selected',product_ids:[]}}])assert.equal(resolve(sign({...payload(),...diff})),null);
});
test('signed shared pass is consumed by normal license issuance without creating a purchase',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fliggy-pass-')),s=openStore(dir,{membershipKey:pub});try{
    s.db.prepare('INSERT INTO hotels VALUES(?,?,?,?)').run('local-h1','u1','演示酒店',new Date().toISOString());s.db.prepare('INSERT INTO devices VALUES(?,?,?,?,1,?)').run('device1','u1','local-h1','fixture',new Date().toISOString());
    assert.equal(s.active('u1','local-h1'),null);s.acceptPass(sign(payload()));assert.equal(s.active('u1','local-h1').source,'SHARED_PASS');
    assert.ok(s.enroll('u1','local-h1','device1').signature);assert.equal(s.db.prepare('SELECT count(*) n FROM orders').get().n,0);assert.throws(()=>s.ticket('u1','local-h1','PERSONA','test'),/PASS_HUMAN_SERVICE_POLICY_REQUIRED/);
  }finally{s.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a central signed revocation takes effect and an earlier signed active grant cannot revive it',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fliggy-revoke-')),s=openStore(dir,{membershipKey:pub});try{
    const p=payload(),active=sign(p);s.acceptPass(active);assert.ok(s.active('u1','local-h1'));
    s.acceptPass(sign({...p,status:'REVOKED',status_verified_at:new Date(Date.parse(p.status_verified_at)+1).toISOString()}));assert.equal(s.active('u1','local-h1'),null);
    assert.throws(()=>s.acceptPass(active),/PASS_ROLLBACK_REJECTED/);
  }finally{s.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
