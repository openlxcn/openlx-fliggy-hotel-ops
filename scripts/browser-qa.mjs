import {chromium} from 'playwright';
import fs from 'node:fs';
const origin=process.env.QA_ORIGIN||'http://127.0.0.1:1999';
const browser=await chromium.launch({channel:'chrome',headless:true}),evidence=[];
try{
  for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin,{waitUntil:'networkidle'});
    if(await page.locator('.feature-card').count()!==12)throw Error('FEATURE_COUNT');
    await page.getByRole('button',{name:'年付',exact:true}).click();if(await page.locator('#standard-price').textContent()!=='79.9')throw Error('ANNUAL_PRICE');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(name+'_OVERFLOW');
    await page.screenshot({path:`evidence/home-${name}.png`,fullPage:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`evidence/home-${name}-top.png`});
    await page.goto(origin+'/account',{waitUntil:'networkidle'});
    if(!await page.locator('#login').isVisible())throw Error('LOGIN_FORM');if(!await page.locator('#buy').isDisabled())throw Error('PREMATURE_SALES');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('ACCOUNT_OVERFLOW');
    await page.screenshot({path:`evidence/account-${name}.png`,fullPage:true});
    await page.goto(origin+'/reports',{waitUntil:'networkidle'});if(!await page.getByText('演示数据：',{exact:false}).count())throw Error('MOCK_LABEL');
    if(errors.length)throw Error(errors.join(';'));
    evidence.push({viewport:name,feature_count:12,annual_price:79.9,overflow:false,login_form:true,sales_disabled:true,page_errors:errors});await page.close();
  }
}finally{await browser.close();}
fs.writeFileSync('evidence/browser-qa.json',JSON.stringify({scope:'BROWSER',origin,tested_at:new Date().toISOString(),checks:evidence},null,2)+'\n');console.log(JSON.stringify(evidence));
