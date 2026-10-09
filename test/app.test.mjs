import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';
const admin='a'.repeat(40),hook='w'.repeat(40);
async function setup(extra={}) {
  const mocked = [];
  const app=createApp({dbPath:':memory:',autoprocess:false,env:{ADMIN_TOKEN:admin,ASAAS_WEBHOOK_TOKEN:hook,ASAAS_API_KEY:'sandbox-key',ASAAS_API_BASE_URL:'https://api-sandbox.asaas.com/v3',PUBLIC_BASE_URL:'https://pay.example.test',MANUAL_PIX_KEY:'chave-pix-exemplo',...extra},fetchImpl:async(url,opts)=>{
    mocked.push({url,opts});
    if(String(url).startsWith('https://licensing.example.test/'))return new Response(JSON.stringify({accepted:true}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({id:'checkout_0123456789',link:'https://sandbox.asaas.com/checkoutSession/show/checkout_0123456789',status:'ACTIVE'}),{status:200,headers:{'content-type':'application/json'}});
  }});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=async(path,method='GET',data=null,bearer='',headers={})=>{
    const response=await fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(bearer?{authorization:'Bearer '+bearer}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
    return {status:response.status,data:await response.json().catch(()=>({}))};
  };
  async function offer(id='pdv-standard',overrides={}) {return call('/v1/admin/offers','POST',{id,productId:'pdv-artisys',name:'PDV ArtiSys',priceCents:18900,deliveryMode:'manual',active:true,...overrides},admin);}
  async function order(idem='idempotency-key-0001',email='buyer@example.test',more={}) {return call('/v1/orders','POST',{offerId:'pdv-standard',email,...more},'',{'idempotency-key':idem});}
  return {app,base,call,offer,order,mocked,async dispose(){await new Promise(resolve=>app.server.close(resolve));app.close();}};
}
test('catálogo só apresenta ofertas publicadas e preço canônico',async()=>{
  const t=await setup();try{
    await t.offer();await t.offer('draft-offer',{active:false,priceCents:900});
    const catalog=await t.call('/v1/catalog');assert.equal(catalog.data.offers.length,1);
    const order=await t.order();assert.equal(order.status,201);
    assert.equal(order.data.order.amountCents,18900);
  }finally{await t.dispose();}
});
test('autorização administrativa e idempotência de pedidos',async()=>{
  const t=await setup();try{
    assert.equal((await t.call('/v1/admin/orders')).status,401);
    await t.offer();const one=await t.order(),two=await t.order();
    assert.equal(one.status,201);assert.equal(two.status,409);
    assert.equal((await t.call('/v1/orders/'+one.data.order.id)).status,404);
    assert.equal((await t.call('/v1/orders/'+one.data.order.id,'GET',null,one.data.orderAccessToken)).status,200);
  }finally{await t.dispose();}
});
test('Pix manual exige confirmação administrativa e não libera sozinho',async()=>{
  const t=await setup();try{
    await t.offer();const created=await t.order();const id=created.data.order.id,key=created.data.orderAccessToken;
    const c=await t.call('/v1/orders/'+id+'/checkout','POST',{provider:'manual_pix'},key);
    assert.equal(c.status,200);assert.equal(c.data.order.status,'pending');
    await t.app.processPending();
    assert.equal((await t.call('/v1/orders/'+id,'GET',null,key)).data.order.status,'pending');
    const confirmed=await t.call('/v1/admin/orders/'+id+'/confirm-manual','POST',{},admin);
    assert.equal(confirmed.data.order.status,'paid');
    await t.app.processPending();
    assert.equal((await t.call('/v1/orders/'+id,'GET',null,key)).data.order.fulfillmentStatus,'awaiting_manual');
    await t.call('/v1/admin/orders/'+id+'/deliver-manual','POST',{},admin);
    assert.equal((await t.call('/v1/orders/'+id,'GET',null,key)).data.order.fulfillmentStatus,'delivered');
  }finally{await t.dispose();}
});
test('Asaas: idempotência, webhook duplicado, valor divergente e autorização',async()=>{
  const t=await setup();try{
    await t.offer();const created=await t.order(),id=created.data.order.id,key=created.data.orderAccessToken;
    assert.equal((await t.call('/v1/orders/'+id+'/checkout','POST',{provider:'asaas'},key)).status,200);
    assert.equal(t.mocked.length,1);
    const checkout=await t.call('/v1/orders/'+id+'/checkout','POST',{provider:'asaas'},key);
    assert.equal(checkout.status,200);assert.equal(t.mocked.length,1);
    const body={id:'evt_paid_bad',event:'CHECKOUT_PAID',checkout:{id:'checkout_0123456789',externalReference:id,items:[{quantity:1,value:1}]}};
    assert.equal((await t.call('/v1/webhooks/asaas','POST',body)).status,401);
    assert.equal((await t.call('/v1/webhooks/asaas','POST',body,'',{'asaas-access-token':hook})).status,200);
    await t.app.processPending();
    assert.equal((await t.call('/v1/orders/'+id,'GET',null,key)).data.order.status,'pending');
    const good={...body,id:'evt_paid_good',checkout:{...body.checkout,items:[{quantity:1,value:189}]}};
    assert.equal((await t.call('/v1/webhooks/asaas','POST',good,'',{'asaas-access-token':hook})).status,200);
    assert.equal((await t.call('/v1/webhooks/asaas','POST',good,'',{'asaas-access-token':hook})).status,200);
    await t.app.processPending();
    assert.equal((await t.call('/v1/orders/'+id,'GET',null,key)).data.order.status,'paid');
    assert.equal((await t.call('/v1/admin/fulfillments','GET',null,admin)).data.fulfillments.length,1);
  }finally{await t.dispose();}
});
test('cupom aplica desconto no servidor; não há checkout sem provedor ativo',async()=>{
  const t=await setup({ASAAS_API_KEY:''});try{
    await t.offer();
    await t.call('/v1/admin/coupons','POST',{code:'BEMVINDO',percentOff:25},admin);
    const created=await t.order('coupon-unique-id-0001','buyer2@example.test',{couponCode:'BEMVINDO'});
    assert.equal(created.data.order.amountCents,14175);
    const result=await t.call('/v1/orders/'+created.data.order.id+'/checkout','POST',{provider:'asaas'},created.data.orderAccessToken);
    assert.equal(result.status,503);
  }finally{await t.dispose();}
});

test('painel e checkout são servidos sem vazar segredos',async()=>{
  const t=await setup();try {
    const adminPage=await fetch(t.base+'/admin');
    const publicPage=await fetch(t.base+'/comprar?oferta=pdv-standard');
    assert.equal(adminPage.status,200);
    assert.equal(publicPage.status,200);
    assert.match(adminPage.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.doesNotMatch(await adminPage.text(),new RegExp(admin));
    assert.match(await publicPage.text(),/Pagamento ArtiSys/);
  }finally{await t.dispose();}
});
test('entrega via conector usa HMAC e não duplica acionamento',async()=>{
  const secret='s'.repeat(48);
  const t=await setup({
    CONNECTOR_ALLOWED_ORIGINS:'https://licensing.example.test',
    PRODUCT_CONNECTORS_JSON:JSON.stringify({'pdv-artisys':{url:'https://licensing.example.test/internal/activate',secret}})
  });try{
    await t.offer('pdv-standard',{deliveryMode:'webhook'});
    const order=await t.order(),id=order.data.order.id,key=order.data.orderAccessToken;
    await t.call('/v1/orders/'+id+'/checkout','POST',{provider:'manual_pix'},key);
    await t.call('/v1/admin/orders/'+id+'/confirm-manual','POST',{},admin);
    await t.app.processPending();
    const delivered=(await t.call('/v1/orders/'+id,'GET',null,key)).data.order;
    assert.equal(delivered.fulfillmentStatus,'delivered');
    const calls=t.mocked.filter(x=>String(x.url).startsWith('https://licensing.example.test/'));
    assert.equal(calls.length,1);
    const req=calls[0].opts,headers=req.headers;
    const expected=createHmac('sha256',secret).update(headers['x-artisys-timestamp']+'.'+req.body).digest('hex');
    assert.equal(headers['x-artisys-signature'],'sha256='+expected);
    await t.app.processPending();
    assert.equal(t.mocked.filter(x=>String(x.url).startsWith('https://licensing.example.test/')).length,1);
  }finally{await t.dispose();}
});
test('download local exige pedido pago e rejeita link simbólico',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pagamento-artisys-'));
  writeFileSync(join(dir,'instalador.exe'),'artefato-integro');
  symlinkSync(join(dir,'instalador.exe'),join(dir,'atalho.exe'));
  const t=await setup({RELEASES_DIR:dir});
  try{
    await t.offer('pdv-standard',{deliveryMode:'download',artifactName:'instalador.exe'});
    const a=await t.order(),id=a.data.order.id,key=a.data.orderAccessToken;
    const before=await fetch(t.base+'/v1/orders/'+id+'/download',{headers:{authorization:'Bearer '+key}});
    assert.equal(before.status,409);
    await t.call('/v1/orders/'+id+'/checkout','POST',{provider:'manual_pix'},key);
    await t.call('/v1/admin/orders/'+id+'/confirm-manual','POST',{},admin);
    await t.app.processPending();
    const after=await fetch(t.base+'/v1/orders/'+id+'/download',{headers:{authorization:'Bearer '+key}});
    assert.equal(after.status,200);assert.equal(await after.text(),'artefato-integro');
    await t.offer('pdv-link',{deliveryMode:'download',artifactName:'atalho.exe'});
    const b=await t.call('/v1/orders','POST',{offerId:'pdv-link',email:'other@example.test'},'',{'idempotency-key':'second-idempotency-00001'});
    const bx=b.data.order.id,bkey=b.data.orderAccessToken;
    await t.call('/v1/orders/'+bx+'/checkout','POST',{provider:'manual_pix'},bkey);
    await t.call('/v1/admin/orders/'+bx+'/confirm-manual','POST',{},admin);
    await t.app.processPending();
    assert.equal((await t.call('/v1/orders/'+bx,'GET',null,bkey)).data.order.fulfillmentStatus,'waiting_configuration');
  }finally{await t.dispose();rmSync(dir,{recursive:true,force:true});}
});

test('token de um pedido não concede acesso aos outros pedidos do mesmo e-mail',async()=>{
  const t=await setup();try{
    await t.offer();
    const first=await t.order('victim-checkout-00001','victim@example.test');
    const second=await t.order('victim-checkout-00002','victim@example.test');
    const results=await t.call('/v1/customer/purchases','GET',null,second.data.orderAccessToken);
    assert.equal(results.status,200);
    assert.equal(results.data.purchases.length,1);
    assert.equal(results.data.purchases[0].id,second.data.order.id);
    assert.notEqual(results.data.purchases[0].id,first.data.order.id);
  }finally{await t.dispose();}
});
