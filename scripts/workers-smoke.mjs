import {spawn} from 'node:child_process';
import {writeFileSync,rmSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const port=18781,base='http://127.0.0.1:'+port;
const admin='local-admin-test-token-0123456789-abcdefabcdef',hook='local-hook-test-token-0123456789-abcdefabcdef';
writeFileSync('.dev.vars','ADMIN_TOKEN='+admin+'\nASAAS_WEBHOOK_TOKEN='+hook+'\nMANUAL_PIX_KEY=local-pix-test\nPUBLIC_ORIGINS=http://localhost:3000\n');
const cmd=process.platform==='win32'?'node_modules/.bin/wrangler.cmd':'node_modules/.bin/wrangler';
const child=spawn(cmd,['dev','--local','--ip','127.0.0.1','--port',String(port)],{stdio:['ignore','pipe','pipe']});
let output='';
child.stdout.on('data',x=>{output+=String(x);});
child.stderr.on('data',x=>{output+=String(x);});
async function call(path,method='GET',body=null,token='',headers={}){
 const r=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json().catch(()=>({}))};
}
try{
 let started=false;
 for(let i=0;i<90;i++){
  if(child.exitCode!==null)break;
  try{const r=await call('/healthz');if(r.status===200){assert.equal(r.data.storage,'cloudflare-d1');started=true;break;}}catch{}
  await sleep(350);
 }
 assert.ok(started,'Worker não iniciou:\n'+output.slice(-4000));
 const page=await fetch(base+'/admin');
 assert.equal(page.status,200);
 assert.match(await page.text(),/Pagamento ArtiSys/);
 assert.equal((await call('/v1/admin/summary')).status,401);
 const o=await call('/v1/admin/offers','POST',{id:'pdv-test',productId:'pdv-artisys',name:'PDV',priceCents:18900,deliveryMode:'manual',active:true},admin);
 assert.equal(o.status,200,JSON.stringify(o.data));
 const catalog=await call('/v1/catalog');
 assert.equal(catalog.data.offers.find(x=>x.id==='pdv-test').priceCents,18900);
 const c=await call('/v1/orders','POST',{offerId:'pdv-test',email:'test@example.com',idempotencyKey:randomUUID()},'',{origin:'http://localhost:3000'});
 assert.equal(c.status,201,JSON.stringify(c.data));
 const id=c.data.order.id,secret=c.data.orderAccessToken;
 assert.equal((await call('/v1/orders/'+id)).status,404);
 assert.equal((await call('/v1/orders/'+id,'GET',null,secret)).status,200);
 assert.equal((await call('/v1/orders/'+id+'/checkout','POST',{provider:'asaas'},secret)).status,503);
 assert.equal((await call('/v1/webhooks/asaas','POST',{id:'evt_smoke_test',event:'UNKNOWN'},'',{'asaas-access-token':hook})).status,200);
 assert.equal((await call('/v1/webhooks/asaas','POST',{id:'evt_smoke_test',event:'UNKNOWN'},'',{'asaas-access-token':hook})).status,200);
 const ev=await call('/v1/admin/events','GET',null,admin);
 assert.equal(ev.data.events.filter(x=>x.id==='evt_smoke_test').length,1);
 console.log('Worker D1 e assets OK; gateway Asaas não configurado.');
}finally{
 child.kill('SIGTERM');
 await sleep(300);
 rmSync('.dev.vars',{force:true});
}
