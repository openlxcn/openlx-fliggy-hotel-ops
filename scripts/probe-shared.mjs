import {createRequire} from 'node:module';
import path from 'node:path';
import {commerceBridge} from '../src/bridge.mjs';
const root=process.env.OPENLX_SHARED_ROOT;
if(!root)throw Error('OPENLX_SHARED_ROOT_REQUIRED');
const require=createRequire(path.join(root,'package.json')),config=require(path.join(root,'config.js'));
const nodemailer=require('nodemailer'),smtp=config.email.smtp;
const t=nodemailer.createTransport({host:smtp.host,port:smtp.port,secure:smtp.secure,auth:{user:smtp.user,pass:smtp.pass},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
const result={tested_at:new Date().toISOString(),identity_origin:process.env.OPENLX_IDENTITY_ORIGIN||'https://wx.openlx.cn',smtp_connection_auth:'UNKNOWN',smtp_messages_sent:0,payment:commerceBridge(root,'https://feizhu.openlx.cn').options,payment_transactions:0};
try{await t.verify();result.smtp_connection_auth='PASS';}catch(e){result.smtp_connection_auth='FAIL';result.smtp_error_code=e.code||'UNKNOWN';}finally{t.close();}
console.log(JSON.stringify(result,null,2));
