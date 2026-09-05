// Fliggy business semantics. Monetary values are integer CNY fen.
const integer = n => Number.isSafeInteger(n) && n >= 0;
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && new Date(d).toISOString().slice(0,10) === d;
export const rateKey = r => [r.seller_id,r.room_id,r.plan_id,r.date,r.price_type].join(':');

export function validateFliggy(s) {
  for (const key of ['packages','settlements','memberships','rank_observations']) {
    if (s[key] != null && !Array.isArray(s[key])) throw Error(key + '_MUST_BE_ARRAY');
  }
  if (s.identity && (s.identity.hotel_id !== s.hotel.id || !s.identity.account_id || !s.identity.seller_id)) throw Error('IDENTITY_SCOPE_INVALID');
  const keys = new Set();
  for (const r of s.rates || []) {
    if (!r.room_id || !r.plan_id || !r.seller_id || !validDate(r.date) || !['SUPPLY','RETAIL'].includes(r.price_type)) throw Error('RATE_IDENTITY_AND_PRICE_TYPE_REQUIRED');
    if (keys.has(rateKey(r))) throw Error('DUPLICATE_RATE_KEY');
    keys.add(rateKey(r));
    if (!integer(r.price_fen) || r.currency !== 'CNY') throw Error('RATE_CURRENCY_OR_AMOUNT_INVALID');
  }
  for (const p of s.packages || []) if (packageLedger(p).status !== 'KNOWN') throw Error('PACKAGE_LEDGER_INVALID:' + (p.id || 'UNKNOWN'));
  return s;
}

export function packageLedger(p) {
  const required = ['sold_units','nights_per_unit','refunded_rights_nights','confirmed_room_nights','fulfilled_room_nights'];
  if (!required.every(k => integer(p[k])) || p.nights_per_unit <= 0) return {status:'UNKNOWN',reason:'套餐份额、权益房晚、退款及预约字段缺失或无效'};
  const gross = p.sold_units * p.nights_per_unit, valid = gross - p.refunded_rights_nights;
  if (!Number.isSafeInteger(gross) || valid < 0 || p.confirmed_room_nights > valid || p.fulfilled_room_nights > p.confirmed_room_nights) return {status:'UNKNOWN',reason:'权益、退款、预约、履约数量不一致'};
  return {status:'KNOWN',sold_units:p.sold_units,valid_rights_nights:valid,confirmed_room_nights:p.confirmed_room_nights,fulfilled_room_nights:p.fulfilled_room_nights,unreserved_rights_nights:valid-p.confirmed_room_nights,upcoming_reserved_nights:p.confirmed_room_nights-p.fulfilled_room_nights,basis:'已确认预约含已履约部分；未预约权益未分配到具体日期'};
}

export function contribution(x) {
  if (integer(x.net_settlement_fen)) {
    if (!integer(x.variable_cost_fen)) return {status:'PARTIAL',net_settlement_fen:x.net_settlement_fen,contribution_fen:null,reason:'缺少尚未计入结算的履约变动成本'};
    return {status:'KNOWN',net_settlement_fen:x.net_settlement_fen,contribution_fen:x.net_settlement_fen-x.variable_cost_fen,basis:'净结算只扣尚未计入的履约变动成本；不重复扣佣金、商家优惠和平台费用'};
  }
  const fields = ['merchant_revenue_fen','merchant_discount_fen','commission_fen','platform_fee_fen','variable_cost_fen'];
  if (x.rules_verified !== true || !fields.every(k=>integer(x[k]))) return {status:'UNKNOWN',reason:'酒店收入、费用承担和实际适用规则未齐备'};
  const net=x.merchant_revenue_fen-x.merchant_discount_fen-x.commission_fen-x.platform_fee_fen;
  return {status:'KNOWN',net_settlement_fen:net,contribution_fen:net-x.variable_cost_fen,basis:'使用酒店收入字段；客人零售价和平台承担优惠不冒充酒店收入或支出'};
}

export function orderMetrics(s) {
  if (!Array.isArray(s.orders)) return {status:'UNKNOWN',scope:'FLIGGY_CHANNEL',reason:'未提供订单行和有效房晚口径'};
  let booked=0,fulfilled=0,unknown=0;
  for (const o of s.orders) {
    if (['CANCELLED','REFUNDED'].includes(o.status)) continue;
    if (!['BOOKED','CHECKED_IN','CHECKED_OUT','PARTIAL_REFUND'].includes(o.status) || !integer(o.effective_room_nights) || !integer(o.fulfilled_room_nights) || o.fulfilled_room_nights>o.effective_room_nights) {unknown++;continue;}
    if (o.payment_mode === 'CREDIT_STAY' && o.credit_validated !== true) {unknown++;continue;}
    if (!['PREPAID','PAY_AT_HOTEL','CREDIT_STAY'].includes(o.payment_mode)) {unknown++;continue;}
    // A credit-stay booking does not require prepaid=true to be effective.
    booked+=o.effective_room_nights;fulfilled+=o.fulfilled_room_nights;
  }
  return {status:unknown?'PARTIAL':'KNOWN',scope:'FLIGGY_CHANNEL',period:s.period||null,effective_booking_room_nights:booked,fulfilled_room_nights:fulfilled,unknown_order_lines:unknown,property_occupancy:'UNKNOWN',property_adr:'UNKNOWN',property_revpar:'UNKNOWN',basis:'按有效订单行房晚；套餐销量另列；仅飞猪渠道数据，不推算全店入住率'};
}

export function validatePriceScope(s,r,p) {
  const errors=[];
  if (!s.identity || s.identity.hotel_id!==s.hotel.id || s.identity.account_id!==s.source.account_id || p.hotel_id!==s.hotel.id || p.account_id!==s.identity.account_id || p.seller_id!==s.identity.seller_id || r.seller_id!==s.identity.seller_id) errors.push('HOTEL_ACCOUNT_SELLER_SCOPE');
  if (!p.plan_ids?.includes(r.plan_id) || !p.room_ids?.includes(r.room_id) || !p.dates?.includes(r.date)) errors.push('RATE_PLAN_SCOPE');
  if (!['SUPPLY','RETAIL'].includes(p.price_type) || p.price_type!==r.price_type) errors.push('PRICE_TYPE_MISMATCH');
  if (r.editable !== true) errors.push('PRICE_FIELD_NOT_EDITABLE');
  if (s.price_authority!=='FLIGGY' || r.writer!=='FLIGGY') errors.push('PRICE_WRITER_NOT_AUTHORIZED');
  if (!r.conditions_hash || !p.conditions_hashes?.includes(r.conditions_hash)) errors.push('RATE_CONDITIONS_UNVERIFIED');
  if (p.update_semantics!=='INCREMENTAL') errors.push('FULL_REPLACEMENT_NOT_SUPPORTED');
  for (const k of ['floor_fen','ceiling_fen','max_change_bps','daily_change_bps','daily_count','cooldown_minutes','max_age_minutes']) if (!integer(p[k])) errors.push('INVALID_POLICY_'+k.toUpperCase());
  if (p.floor_fen<=0 || p.ceiling_fen<p.floor_fen || p.daily_count<1 || p.max_age_minutes<1) errors.push('INVALID_POLICY_LIMITS');
  const age=Date.now()-Date.parse(s.observed_at);
  if (!Number.isFinite(age) || age < -60000 || age>p.max_age_minutes*60000) errors.push('STALE_OR_FUTURE_SNAPSHOT');
  if (p.contribution_floor_fen!=null) {
    // Candidate settlement must be linked to the candidate price, not an old actual settlement.
    if (!Number.isInteger(p.contribution_floor_fen) || p.candidate_settlement?.for_price_fen!==p.target_fen || p.candidate_settlement?.price_type!==r.price_type) errors.push('CANDIDATE_SETTLEMENT_REQUIRED');
    else {const c=contribution(p.candidate_settlement);if(c.status!=='KNOWN'||c.contribution_fen<p.contribution_floor_fen)errors.push('CONTRIBUTION_FLOOR');}
  }
  return [...new Set(errors)];
}

export function fliggyIssues(s) {
  const out=[];
  const add=(module,priority,problem,action)=>out.push({module,priority,problem,why:problem,action,evidence:s.source.reference||'用户导入',scope:s.hotel.id,status:'PROPOSED',result:'尚未执行',automatic:false,confirmation:'门店负责人',review_at:new Date(Date.now()+86400000).toISOString()});
  if (!s.identity) add('经营身份','P1','实体酒店、商家账号与销售主体尚未完整绑定','核对酒店名称、地址、账号和当前可操作卖家；补齐身份后再执行');
  for (const r of s.rates||[]) {
    if (s.identity && r.seller_id!==s.identity.seller_id) add('价格模式','P1','观察报价来自其他销售主体','保留比价信息；不能修改其他销售主体的报价');
    if (!r.conditions_hash) add('价格计划','UNKNOWN','价格计划入住条件尚未核验','核对早餐、退改、会员资格、连住及适用日期');
  }
  for (const p of s.packages||[]) {
    const l=packageLedger(p);
    if (l.unreserved_rights_nights>0) add('套餐履约','P1',`${p.name||p.id}尚有${l.unreserved_rights_nights}个待预约权益房晚`,'核对有效期、不可用日期、加价条件及剩余承接能力；不能把待预约权益当作没有责任');
    if (!p.capacity_verified) add('套餐库存','UNKNOWN',`${p.name||p.id}可承接能力未核验`,'结合已预约承诺与未预约压力确认可售份额，不缩减已售权益');
  }
  for (const x of s.settlements||[]) {
    const c=contribution(x);
    if(c.status!=='KNOWN')add('结算贡献','UNKNOWN','结算或履约成本资料不足',c.reason);
    else if(c.contribution_fen<0)add('结算贡献','P1','订单贡献为负','核对供货收入、费用承担和权益成本，制定下一轮策略');
  }
  for (const o of s.orders||[]) if(o.payment_mode==='CREDIT_STAY'&&o.credit_validated!==true)add('信用住','P1','信用订单有效性尚待核验','按当前已开通信用住流程核对入住、离店及结算，不依据未预付直接判无效');
  for (const r of s.rank_observations||[]) if(!r.query||!r.observed_at||!r.checkin||!r.location||!r.sort||!r.channel)add('搜索观察','UNKNOWN','搜索观察条件不全','补齐查询词、定位、日期、人数、排序、账号状态、时间和采样深度；广告位与自然位置分开');
  return out;
}
