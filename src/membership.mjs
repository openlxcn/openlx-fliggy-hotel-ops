import crypto from 'node:crypto';

export const CONTRACT='OPENLX_SKILL_PASS_V1';
export function verifyPass(envelope, publicKey, time=Date.now(), allowRevoked=false) {
  try {
    if (!publicKey || !envelope?.payload || !envelope.signature) return null;
    const raw=Buffer.from(envelope.payload,'base64url');
    if (!crypto.verify(null,raw,publicKey,Buffer.from(envelope.signature,'base64url'))) return null;
    const p=JSON.parse(raw);
    if(p.schema!==CONTRACT||p.issuer!=='OPENLX_MEMBERSHIP'||!p.grant_id||!p.subject_user_id||!p.order_id||!(p.status==='ACTIVE'||allowRevoked&&p.status==='REVOKED'))return null;
    if(!['quarterly','annual'].includes(p.cycle)||!['all','selected'].includes(p.scope?.mode))return null;
    if(!p.product_catalog_version||!Array.isArray(p.resolved_product_ids)||!p.resolved_product_ids.length||new Set(p.resolved_product_ids).size!==p.resolved_product_ids.length)return null;
    if(p.scope.mode==='selected'&&(!Array.isArray(p.scope.product_ids)||p.resolved_product_ids.some(id=>!p.scope.product_ids.includes(id))))return null;
    const start=Date.parse(p.starts_at),end=Date.parse(p.expires_at),verified=Date.parse(p.status_verified_at),refresh=Date.parse(p.status_valid_until);
    if(![start,end,verified,refresh].every(Number.isFinite)||start>time||end<=time||verified>time+60000||refresh<=time||refresh>verified+86400000||refresh>end)return null;
    if(!Array.isArray(p.property_bindings)||!p.property_scope?.property_ids?.length)return null;
    return p;
  }catch{return null;}
}

export function passEntitlement(envelope,publicKey,{userId,hotelId,productId,time=Date.now()}) {
  const p=verifyPass(envelope,publicKey,time);
  if(!p||String(p.subject_user_id)!==String(userId)||!p.resolved_product_ids.includes(productId))return null;
  const b=p.property_bindings.find(x=>x.product_id===productId&&x.local_hotel_id===hotelId&&String(x.subject_user_id)===String(userId)&&p.property_scope.property_ids.includes(x.property_id));
  if(!b||!['STANDARD','SUPREME'].includes(p.level_by_product?.[productId]))return null;
  return {id:p.grant_id,user_id:String(userId),hotel_id:hotelId,global_property_id:b.property_id,plan:p.level_by_product[productId],cycle:p.cycle,starts_at:p.starts_at,expires_at:new Date(Math.min(Date.parse(p.expires_at),Date.parse(p.status_valid_until))).toISOString(),subscription_expires_at:p.expires_at,status:'ACTIVE',order_id:p.order_id,source:'SHARED_PASS',issuer:p.issuer};
}
