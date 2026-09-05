const $=s=>document.querySelector(s);
async function load(){
  try{
    const response=await fetch('/api/public/config');if(!response.ok)throw Error('CONFIG_UNAVAILABLE');const {data}=await response.json();
    for(const f of data.features){const card=document.createElement('article');card.className='feature-card';const n=document.createElement('span');n.className='feature-number';n.textContent=f.id.replace('ADV-','');const h=document.createElement('h3');h.textContent=f.public_title;const p=document.createElement('p');p.textContent=f.promise;card.append(n,h,p);$('#feature-grid').append(card);}
    const renderPrice=cycle=>{for(const plan of ['STANDARD','SUPREME'])$('#'+plan.toLowerCase()+'-price').textContent=String(data.plans[plan][cycle+'_fen']/100);document.querySelectorAll('.period-label').forEach(x=>x.textContent='/ '+({monthly:'月',quarterly:'季',annual:'年'}[cycle]));};
    document.querySelectorAll('[data-cycle]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-cycle]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderPrice(b.dataset.cycle);}));renderPrice('monthly');
    if(data.release){$('#release-info').textContent=`v${data.release.version} · ${(data.release.bytes/1024).toFixed(0)} KB\nSHA-256\n${data.release.sha256}`;$('#download').href=data.release.download_url;}
    if(data.sales_enabled)$('#sales-status').textContent='收费套餐已开放。请按当前权益与账号适用范围选择，支付结果以核验回执为准。';
  }catch{const p=document.createElement('p');p.textContent='详细配置暂时无法读取，请稍后刷新或查看使用说明。';$('#feature-grid').append(p);}
}
$('#copy-install').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#install-prompt').textContent);$('#copy-status').textContent='已复制';}catch{$('#copy-status').textContent='请选中上方文字复制';}});
load();
