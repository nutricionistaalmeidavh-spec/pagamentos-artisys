import {spawn} from 'node:child_process';
import {writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const port=18782,base='http://127.0.0.1:'+port;
const admin='qa-admin-token-0123456789-abcdefabcdefabcdef';
writeFileSync('.dev.vars','ADMIN_TOKEN='+admin+'\nASAAS_WEBHOOK_TOKEN=qa-hook-0123456789-abcdefabcdefabcdef\nPUBLIC_ORIGINS=http://localhost:3000\n');
mkdirSync('qa-shots',{recursive:true});
const cmd=process.platform==='win32'?'node_modules/.bin/wrangler.cmd':'node_modules/.bin/wrangler';
const child=spawn(cmd,['dev','--local','--ip','127.0.0.1','--port',String(port)],{stdio:['ignore','pipe','pipe']});
let logs='',browser;
child.stdout.on('data',x=>logs+=String(x));child.stderr.on('data',x=>logs+=String(x));
try{
 let ready=false;
 for(let i=0;i<90;i++){
  if(child.exitCode!==null)break;
  try{const r=await fetch(base+'/healthz');if(r.ok){ready=true;break;}}catch{}
  await sleep(350);
 }
 assert.ok(ready,'Worker local falhou: '+logs.slice(-1700));
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const page=await context.newPage(),issues=[];
 page.on('pageerror',e=>issues.push('pageerror: '+e.message));
 page.on('response',r=>{if(r.status()>=500)issues.push('HTTP '+r.status()+' '+r.url());});
 await page.goto(base+'/admin',{waitUntil:'networkidle'});
 await page.locator('#admin-token').fill(admin);
 await page.locator('#login-button').click();
 await page.getByRole('heading',{name:'O que precisa da sua atenção?'}).waitFor();
 await page.screenshot({path:'qa-shots/01-inicio-iphone.png',fullPage:true});
 await page.locator('[data-screen=pedidos]').click();
 await page.getByRole('heading',{name:'Pedidos'}).waitFor();
 await page.locator('#orders-count').waitFor();
 await page.locator('#order-search').fill('busca-inexistente-qa-123456789');
 await page.getByText('Nenhum pedido encontrado').waitFor();
 await page.locator('#order-search').fill('');
 await page.screenshot({path:'qa-shots/02-pedidos-iphone.png',fullPage:true});
 await page.locator('[data-screen=ofertas]').click();
 await page.getByRole('heading',{name:'Ofertas'}).waitFor();
 await page.locator('#new-offer').click();
 await page.locator('#field-id').fill('qa-offer-iphone');
 await page.locator('#field-productId').fill('qa-product');
 await page.locator('#field-name').fill('Oferta de teste');
 await page.locator('#field-price').fill('42.50');
 await page.locator('#wizard-form button[type=submit]').click();
 const reachedStep2=await page.locator('#field-deliveryMode').count();
 if(!reachedStep2){
  const problems=await page.locator('#wizard-form :invalid').evaluateAll(xs=>xs.map(x=>({id:x.id,value:x.value,reason:x.validationMessage})));
  const stage=await page.locator('#modal-content').innerText();
  const debug=await page.evaluate(()=>({url:location.href,modalHidden:document.getElementById('modal-backdrop')?.hidden,html:document.getElementById('modal-content')?.innerHTML.slice(0,850),activeForm:document.querySelector('form:focus-within')?.id}));
  throw Error('Não avançou para etapa de entrega: '+JSON.stringify({problems,stage:stage.slice(0,650),debug,issues}));
 }
 await page.locator('#field-deliveryMode').selectOption('manual');
 await page.locator('#wizard-form button[type=submit]').click();
 await page.getByRole('button',{name:'Revisar e salvar'}).click();
 const offer=page.locator('[data-offer="qa-offer-iphone"]');
 await offer.waitFor();
 await page.screenshot({path:'qa-shots/03-ofertas-iphone.png',fullPage:true});
 await offer.click();
 assert.match(await page.locator('#modal-content').innerText(),/Publicação requer|publicação requer|A publicação requer/);
 assert.equal(await page.locator('[data-publish]').isDisabled(),true);
 await page.locator('#close-modal').click();
 const data=await page.evaluate(async token=>{
  const r=await fetch('/v1/admin/offers',{headers:{authorization:'Bearer '+token}});
  return r.json();
 },admin);
 const created=data.offers.find(x=>x.id==='qa-offer-iphone');
 assert.ok(created,'Oferta não foi persistida no D1');
 assert.equal(created.active,0,'Novo cadastro deve permanecer rascunho');
 assert.equal(created.price_cents,4250);
 await page.locator('[data-screen=mais]').click();
 await page.getByRole('heading',{name:'Mais'}).waitFor();
 await page.getByRole('button',{name:'Verificar agora'}).click();
 await page.locator('#asaas-diagnostic').getByText('Chave ausente (', {exact:false}).count().catch(()=>0);
 await page.locator('#asaas-diagnostic').getByText('Chave ausente', {exact:false}).waitFor();
 assert.match(await page.locator('#asaas-diagnostic').innerText(),/não homologados|não homologado/i);
 await page.screenshot({path:'qa-shots/04-mais-iphone.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Rolagem horizontal no celular');
 await page.setViewportSize({width:1280,height:800});
 await page.locator('[data-screen=inicio]').click();
 await page.getByRole('heading',{name:'O que precisa da sua atenção?'}).waitFor();
 await page.screenshot({path:'qa-shots/05-inicio-desktop.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Rolagem horizontal no desktop');
 assert.deepEqual(issues,[],'Console/HTTP falhou');
 console.log('Playwright admin mobile + desktop: login, pedidos, rascunho D1, bloqueio de publicação, navegação OK.');
}finally{
 if(browser)await browser.close();
 child.kill('SIGTERM');
 await sleep(250);
 rmSync('.dev.vars',{force:true});
}
