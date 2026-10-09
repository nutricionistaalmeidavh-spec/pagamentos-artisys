import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
const admin='a'.repeat(40),hook='w'.repeat(40);
async function setup(extra={}) {
  const mocked = [];
  const app=createApp({dbPath:':memory:',autoprocess:false,env:{ADMIN_TOKEN:admin,ASAAS_WEBHOOK_TOKEN:hook,ASAAS_API_KEY:'sandbox-key',ASAAS_API_BASE_URL:'https://api-sandbox.asaas.com/v3',PUBLIC_BASE_URL:'https://pay.example.test',MANUAL_PIX_KEY:'chave-pix-exemplo',...extra},fetchImpl:async(url,opts)=>{
    mocked.push({url,opts});
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
