#!/usr/bin/env node
// Operator-only server CLI. Never exposed as an unauthenticated HTTP route.
import fs from 'node:fs';
import path from 'node:path';
import {openStore} from '../src/store.mjs';
import {args} from '../skills/openlx-fliggy-hotel-ops/scripts/ops.mjs';
import {now} from '../skills/openlx-fliggy-hotel-ops/scripts/core.mjs';
const a=args(process.argv.slice(2)),s=openStore(process.env.DATA_DIR||path.resolve('data'));
try{
  if(a._[0]==='ticket-deliver'){
    const t=s.db.prepare('SELECT * FROM tickets WHERE id=?').get(a.id);if(!t)throw Error('TICKET_NOT_FOUND');const receipt=JSON.parse(fs.readFileSync(a.receipt));
    if(!receipt.delivered_at||!receipt.operator||!receipt.artifact_reference||!receipt.customer_acknowledgement)throw Error('DELIVERY_EVIDENCE_REQUIRED');
    s.db.prepare("UPDATE tickets SET status='DELIVERED',delivery=?,updated_at=? WHERE id=?").run(JSON.stringify(receipt),now(),t.id);s.audit('HUMAN_DELIVERY_RECORDED',t.id,receipt);console.log('交付证据已记录；本命令不代替真人履约。');
  }else if(a._[0]==='refund-record'){
    const o=s.db.prepare('SELECT * FROM orders WHERE id=?').get(a.id),r=JSON.parse(fs.readFileSync(a.receipt));
    if(!o||o.status!=='PAID'||r.provider!==o.provider||r.order_id!==o.id||r.original_transaction_id!==o.transaction_id||r.refund_fen!==o.amount_fen||r.status!=='REFUND_VERIFIED'||!r.provider_reference)throw Error('VERIFIED_FULL_REFUND_REQUIRED');
    s.db.exec('BEGIN IMMEDIATE');try{s.db.prepare("UPDATE orders SET status='REFUNDED' WHERE id=?").run(o.id);s.db.prepare("UPDATE entitlements SET status='REVOKED' WHERE order_id=?").run(o.id);s.audit('VERIFIED_REFUND_RECORDED',o.id,r);s.db.exec('COMMIT');}catch(e){s.db.exec('ROLLBACK');throw e;}
    console.log('已记录经支付平台核验的全额退款并停止续发该订单许可证；离线许可最长24小时到期。本命令不发起退款。');
  }else throw Error('使用 ticket-deliver 或 refund-record --id ID --receipt /private/evidence.json');
}finally{s.db.close();}
