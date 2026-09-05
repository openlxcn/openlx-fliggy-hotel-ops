import fs from 'node:fs';
import path from 'node:path';
import {hash,now,writeJson,priceProposal,revenueSuggestion,enqueue,approve,scanAssets,createContent} from './core.mjs';
import {executeAction} from './browser.mjs';
import {modelDraft} from './model.mjs';

export async function runPricing(w,s,settings,license,execute=executeAction){
  if(license.plan==='FREE')return {module:'pricing',status:'FREE_ADVISORY_ONLY'};
  const policyFile=path.join(w.base,'pricing-policy.json');if(!fs.existsSync(policyFile))return {module:'pricing',status:'NOT_CONFIGURED'};
  const original=JSON.parse(fs.readFileSync(policyFile));
  if(original.mode!=='AUTOMATIC'||original.hotel_id!==s.hotel.id||settings.pricing_policy_hash!==hash(original))return {module:'pricing',status:'POLICY_AUTHORIZATION_REQUIRED'};
  if(s.source.type!=='LIVE')return {module:'pricing',status:'LIVE_SOURCE_REQUIRED'};
  const results=[];
  for(const rate of s.rates||[]){
    if(!original.dates?.includes(rate.date)||!original.room_ids?.includes(rate.room_id))continue;
    try{
      let policy={...original};if(policy.strategy==='MULTI_SIGNAL')policy={...policy,...revenueSuggestion(s,rate,policy)};
      if(policy.target_fen===rate.price_fen)continue;
      const prior=w.db.prepare('SELECT * FROM actions WHERE hotel_id=?').all(s.hotel.id),p=priceProposal(s,rate,policy,prior,license),a=enqueue(w,p);
      if(!p.eligible){results.push({id:a.id,status:'BLOCKED',errors:p.errors});continue;}
      if(a.status==='AWAITING_APPROVAL')approve(w,a.id,a.content_hash);
      if(['AWAITING_APPROVAL','APPROVED','BLOCKED_RETRYABLE'].includes(a.status))results.push(await execute(w,a.id));
    }catch(e){results.push({object_id:rate.room_id,status:'FAILED',reason:e.message});}
  }
  return {module:'pricing',status:'RUN_COMPLETE',results};
}

export async function runContent(){return {module:'store_materials',status:'ON_DEMAND',next:'Use assets and content commands for a fact-checked product/FAQ draft. Publishing requires the actual merchant page mapping.'};}
