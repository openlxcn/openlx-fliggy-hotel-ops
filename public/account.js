const $=s=>document.querySelector(s);let csrf,config,currentOrder;
const message=text=>{$('#feedback').textContent=text;};
async function api(url,body){if(body&&!csrf)csrf=(await fetch('/api/session').then(r=>r.json())).csrf;const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json','x-csrf-token':csrf}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!data.success)throw Error(data.error||'请求失败');return data.data??data;}
const formData=f=>Object.fromEntries(new FormData(f));
const textNode=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
function handler(form,fn){form.addEventListener('submit',async e=>{e.preventDefault();const b=form.querySelector('button[type=submit],button:not([type])');if(b)b.disabled=true;try{await fn(formData(form));}catch(err){message(err.message);}finally{if(b)b.disabled=false;}});}
async function refreshSeries(){
 const host=$('#series-overview');host.replaceChildren(textNode('p','正在读取系列账户…'));
 try{const data=await api('/api/series');host.replaceChildren();
  for(const [id,p]of Object.entries(data.products)){const rows=data.records.filter(r=>r.product_id===id);const orders=id==='openlx-weixin-baimindan'?data.wechat.orders:rows.filter(r=>r.entity_type==='orders').map(r=>r.data);const grants=id==='openlx-weixin-baimindan'?data.wechat.entitlements:rows.filter(r=>r.entity_type==='entitlements').map(r=>r.data);const row=textNode('div',`${p.name} · ${orders.length} 条订单 · ${grants.length} 条权益记录`);row.className='account-row';const a=textNode('a','查看产品 ↗');a.href=p.origin;a.target='_blank';a.rel='noopener';row.append(a);host.append(row);for(const o of orders.slice(0,10))host.append(textNode('p',`${o.id||o.order_no} · ${o.plan||o.package_name||o.package_type} · ¥${Number(o.amount_fen)/100} · ${o.status??o.pay_status}`));for(const g of grants.slice(0,10))host.append(textNode('p',`权益 ${g.plan||g.package_name||g.package_type} · ${g.status} · 到期 ${String(g.expires_at||g.expire_at).slice(0,10)}`));}
  host.append(textNode('p',`同步状态：${data.local_sync.status}；待同步 ${data.local_sync.pending} 条。账号同步不自动增加产品付费权限。`));
  if(data.truncated)host.append(textNode('p','记录较多，此页展示部分记录，请进入对应产品查询完整记录。'));
 }catch(e){host.replaceChildren(textNode('p',e.message));}
}
async function refresh(){
 try{const data=await api('/api/account');$('#auth-area').hidden=true;$('#dashboard').hidden=false;$('#welcome').textContent=`${data.user.nickname||data.user.email}，欢迎回来。`;refreshSeries();
  $('#hotels').replaceChildren();document.querySelectorAll('.hotel-picker').forEach(s=>s.replaceChildren());
  for(const h of data.hotels){const row=textNode('div',`${h.name} · ${h.id} · ${h.entitlement?.plan||'FREE'}${h.entitlement?' · 到期 '+h.entitlement.expires_at.slice(0,10):''}`);row.className='account-row';$('#hotels').append(row);document.querySelectorAll('.hotel-picker').forEach(s=>{const o=textNode('option',h.name);o.value=h.id;s.append(o);});}
  if(!data.hotels.length)$('#hotels').append(textNode('p','先登记酒店，免费功能可直接下载安装使用。'));
  $('#orders').replaceChildren();for(const o of data.orders){const row=textNode('div',`${o.id} · ¥${o.amount_fen/100} · ${o.status}`);row.className='account-row';const b=textNode('button','查询结果');b.className='small-link';b.type='button';b.onclick=async()=>{try{const r=await api('/api/orders/'+o.id);message(`订单状态：${r.status}`);}catch(e){message(e.message);}};row.append(b);$('#orders').append(row);}
  $('#devices').replaceChildren();for(const d of data.devices.filter(d=>d.active)){const row=textNode('div',`${d.label} · ${d.hotel_id}`);row.className='account-row';const stop=textNode('button','停用');stop.className='small-link';stop.onclick=async()=>{try{await api('/api/devices/'+d.id+'/deactivate',{});await refresh();}catch(e){message(e.message);}};const download=textNode('button','下载许可证');download.className='small-link';download.onclick=async()=>{try{const license=await api('/api/license',{hotel_id:d.hotel_id,device_id:d.id});const u=URL.createObjectURL(new Blob([JSON.stringify(license,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='license.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch(e){message(e.message);}};row.append(stop,download);$('#devices').append(row);}
  $('#tickets').replaceChildren();for(const t of data.tickets){const row=textNode('div',`${t.type} · ${t.status} · ${t.request}`);row.className='account-row';if(t.delivery)row.append(textNode('p',t.delivery));$('#tickets').append(row);}
 }catch(e){if(e.message==='请先登录'){$('#auth-area').hidden=false;$('#dashboard').hidden=true;}else message(e.message);}
}
handler($('#login'),async d=>{await api('/api/auth/login',d);message('登录成功。');await refresh();});
handler($('#register'),async d=>{const r=await api('/api/auth/register',d);message(r.message||'请查收邮箱，在24小时内打开验证链接后登录。');});
$('#resend').onclick=async()=>{try{await api('/api/auth/resend',{email:$('#register [name=email]').value});message('验证邮件已提交发送，请查收；60秒内不要重复发送。');}catch(e){message(e.message);}};
$('#forgot').onclick=async()=>{try{const email=$('#login [name=account]').value;if(!email.includes('@'))throw Error('请先在登录框填写注册邮箱');await api('/api/auth/forgot',{email});message('密码重置申请已提交，请查收邮箱。');}catch(e){message(e.message);}};
$('#logout').onclick=async()=>{try{await api('/api/auth/logout',{});await refresh();message('已退出登录。');}catch(e){message(e.message);}};
handler($('#bind-hotel'),async d=>{await api('/api/hotels',d);message('酒店已登记。');await refresh();});
handler($('#device'),async d=>{await api('/api/devices',d);message('设备已登记。');await refresh();});
handler($('#ticket'),async d=>{await api('/api/tickets',d);message('需求已记录，可通过联系二维码安排服务；提交不等于已交付。');await refresh();});
handler($('#checkout'),async d=>{const o=await api('/api/orders',d);currentOrder=o.id;const r=await api('/api/orders/'+o.id+'/prepay',{});const img=document.createElement('img');img.src=r.qr;img.alt='订单支付二维码';img.className='checkout-qr';const b=textNode('button','已完成支付，查询结果');b.className='button outline';b.type='button';b.onclick=async()=>{try{const result=await api('/api/orders/'+currentOrder+'/recheck',{});message(`订单状态：${result.status}。以支付平台核验结果为准。`);await refresh();}catch(e){message(e.message);}};$('#payment-result').replaceChildren(img,b);});
function showPrice(){if(!config)return;const f=formData($('#checkout'));$('#checkout-price').textContent=`应付 ¥${config.plans[f.plan][f.cycle+'_fen']/100}，服务${{monthly:'1个月',quarterly:'3个月',annual:'12个月'}[f.cycle]}`;}
$('#checkout').addEventListener('change',showPrice);
(async()=>{try{const session=await api('/api/session');csrf=session.csrf;config=await api('/api/public/config');$('#buy').disabled=!config.sales_enabled;for(const[k,v]of Object.entries(config.payment))if(v){const opt=textNode('option',k==='alipay'?'支付宝':'微信支付');opt.value=k;$('#providers').append(opt);}if(config.sales_enabled)$('#sale-notice').textContent='免费功能长期可用。收费含标准和至尊，按月、季、年直接购买，默认不自动续费。';const target=new URLSearchParams(location.search).get('plan');if(['STANDARD','SUPREME'].includes(target))$('#checkout [name=plan]').value=target;showPrice();if(session.has_session)await refresh();}catch(e){message(e.message);}})();
