import {createRequire} from 'node:module';
import path from 'node:path';

export function commerceBridge(root,origin){
  if(!root)return {available:false,options:{alipay:false,wechat:false}};
  const require=createRequire(path.join(path.resolve(root),'package.json'));
  const config=require(path.join(root,'config.js'));
  const original=require(path.join(root,'alipay.js'));
  const alipay=new original.constructor();alipay.config={...original.config,notifyUrl:origin+'/api/payment/alipay-notify',returnUrl:origin+'/account?payment=return'};
  const wechat=require(path.join(root,'wechatpay.js'));
  const options={alipay:!!(alipay.config.appId&&alipay.config.privateKey&&alipay.config.alipayPublicKey),wechat:wechat.isWechatPayConfigured(config)};
  return {available:true,options,
    async prepay(o){
      if(o.provider==='alipay'){const result=await alipay.createPrecreatePayment(o.id,o.amount_fen/100,`OpenLX飞猪助手-${o.plan}`,`飞猪运营助手${o.cycle}`);if(!result.success)throw Error(result.error||'PAYMENT_PROVIDER_ERROR');return result.data.qr_code;}
      const r=await wechat.unifiedOrderNative(config.payment.wechatPay,{body:`OpenLX飞猪助手-${o.plan}`,out_trade_no:o.id,total_fee_fen:o.amount_fen,notify_url:origin+'/api/payment/wechat-notify'});return r.code_url;
    },
    verifyAlipay(body){if(body.app_id!==alipay.config.appId||!alipay.verifyCallback(body))throw Error('INVALID_PAYMENT_SIGNATURE');return {paid:['TRADE_SUCCESS','TRADE_FINISHED'].includes(body.trade_status),order:body.out_trade_no,transaction:body.trade_no,amount:Math.round(Number(body.total_amount)*100),provider:'alipay'};},
    async verifyWechat(xml){const b=await wechat.parseXml(xml),c=config.payment.wechatPay;if(!c||b.appid!==c.appId||b.mch_id!==c.mchId||!wechat.verifyNotifySign(b,c.apiKey))throw Error('INVALID_PAYMENT_SIGNATURE');return {paid:b.return_code==='SUCCESS'&&b.result_code==='SUCCESS',order:b.out_trade_no,transaction:b.transaction_id,amount:Number(b.total_fee),provider:'wechat'};},
    async query(o){if(o.provider!=='alipay')return null;const r=await alipay.queryOrder(o.id);if(!r.success)return null;return {paid:['TRADE_SUCCESS','TRADE_FINISHED'].includes(r.data.status),order:r.data.order_no,transaction:r.data.trade_no,amount:Math.round(Number(r.data.amount)*100),provider:'alipay'};}
  };
}

export async function identityRequest(base,route,body,token){
  const headers={'content-type':'application/json'};if(token)headers.authorization='Bearer '+token;
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
  const result=await response.json();return {httpStatus:response.status,...result};
}
