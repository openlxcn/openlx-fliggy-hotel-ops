import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../skills/openlx-fliggy-hotel-ops/scripts/core.mjs';
import {assertEnrollmentBinding,leaseController} from '../skills/openlx-fliggy-hotel-ops/scripts/licensing.mjs';
const payload={hotel_id:'hotel-a',device_id:'device-a',user_id:'user-a',refresh_origin:'https://feizhu.openlx.cn',device_token_hash:hash('token-a')};
const lease=()=>({hotel_id:'hotel-a',device_id:'device-a',user_id:'user-a',lease_id:'lease-a',expires_at:Date.now()+120000});
test('signed device enrollment rejects swapping another valid token',()=>{
  assertEnrollmentBinding({enrollment:{token:'token-a',device_id:'device-a'}},payload,'device-a');
  assert.throws(()=>assertEnrollmentBinding({enrollment:{token:'token-b',device_id:'device-a'}},payload,'device-a'),/IDENTITY_MISMATCH/);
  assert.throws(()=>leaseController({payload},{...lease(),hotel_id:'hotel-b'},async()=>{}),/IDENTITY_OR_EXPIRY_MISMATCH/);
});
test('heartbeat and explicit assertion share one renewal and cannot mask its failure',async()=>{
  let calls=0,rejectRequest;
  const controller=leaseController({payload},lease(),async(_e,_route,body)=>{
    if(body.operation==='release')return {};calls++;return new Promise((_resolve,reject)=>{rejectRequest=reject;});
  });
  try{
    const a=controller.assert(),b=controller.assert();assert.equal(calls,1);rejectRequest(Error('WRITER_LEASE_LOST'));
    const results=await Promise.allSettled([a,b]);assert.ok(results.every(x=>x.status==='rejected'));
    await assert.rejects(()=>controller.assert(),/WRITER_LEASE_LOST/);assert.equal(calls,1);
  }finally{await controller.release();}
});
test('a renewal response for another hotel invalidates the lease before the caller can write',async()=>{
 const controller=leaseController({payload},lease(),async(_e,_route,body)=>body.operation==='release'?{}:{...lease(),hotel_id:'hotel-b'});
 try{let writes=0;await assert.rejects(async()=>{await controller.assert();writes++;},/IDENTITY_OR_EXPIRY_MISMATCH/);assert.equal(writes,0);}finally{await controller.release();}
});
