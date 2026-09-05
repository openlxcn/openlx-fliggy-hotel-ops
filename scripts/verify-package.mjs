import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const release=JSON.parse(fs.readFileSync('public/release.json'));
const zip=path.resolve('public'+release.download_url),temp=fs.mkdtempSync(path.join(os.tmpdir(),'fliggy-package-'));
const evidence={scope:'REAL_ZIP_INSTALL',started_at:new Date().toISOString(),platform:os.platform(),sha256:crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),runs:[]};
function run(command,args,cwd){const r=spawnSync(command,args,{cwd,encoding:'utf8'});evidence.runs.push({command:[command,...args].join(' ').replaceAll(temp,'TEMP'),exit:r.status,output:(r.stdout+r.stderr).replaceAll(temp,'TEMP')});if(r.status!==0)throw Error(r.stderr||r.stdout);}
try{
  if(evidence.sha256!==release.sha256)throw Error('ZIP_HASH_MISMATCH');
  run('python3',['-m','zipfile','-e',zip,temp]);
  const source=path.join(temp,'openlx-fliggy-hotel-ops'),target=path.join(temp,'installed'),work=path.join(temp,'hotel-work');
  run(process.execPath,['scripts/install.mjs','install','--target',target],source);
  run(process.execPath,['scripts/ops.mjs','init','--workspace',work,'--hotel','demo-hotel','--name','演示酒店'],target);
  run(process.execPath,['scripts/ops.mjs','import','--workspace',work,'--file',path.join(target,'references/example-snapshot.json')],target);
  run(process.execPath,['scripts/ops.mjs','report','--workspace',work],target);evidence.status='PASS';
}finally{
  fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync(`evidence/${os.platform()}-package-install.json`,JSON.stringify(evidence,null,2)+'\n');fs.rmSync(temp,{recursive:true,force:true});
}
console.log(JSON.stringify({status:evidence.status,platform:evidence.platform,sha256:evidence.sha256,steps:evidence.runs.length}));
