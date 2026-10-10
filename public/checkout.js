const el=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(x)||0)/100);
const p=new URLSearchParams(location.search),selected=p.get('oferta'),id=p.get('id');
const notify=e=>{el('alert').textContent=String(e?.message||e);};
const saved=id=>sessionStorage.getItem('artisys-order-'+id)||'';
const store=(id,code)=>sessionStorage.setItem('artisys-order-'+id,code);
async function api(path,method='GET',body=null,code=''){
 const r=await fetch(path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(code?{authorization:'Bearer '+code}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(data.error||'Falha ao conectar');
 return data;
}
function recoveryForm(orderId){
 el('content').innerHTML='<h2>Recuperar acesso ao pedido</h2><p>Informe o código de acesso entregue na compra. Ele não deve ser compartilhado com terceiros.</p>'+
  '<form id="restore-form" class="stack"><label>Código de acesso<input name="code" type="password" minlength="64" maxlength="64" required autocomplete="off" pattern="[a-f0-9]{64}"></label><button class="primary">Acessar pedido</button></form>'+
  '<p class="muted">Sem o código? Solicite a reemissão ao suporte informando o número do pedido. A identidade será conferida antes da troca.</p>';
 el('restore-form').addEventListener('submit',async e=>{
  e.preventDefault();const code=new FormData(e.target).get('code');
  try{await api('/v1/orders/'+orderId,'GET',null,code);store(orderId,code);showOrder(orderId,code);}
  catch(e){notify(e);}
 });
}
function accessPanel(orderId,code){
 return '<div class="card"><strong>Guarde seu código de recuperação</strong><p class="muted">Para baixar em outro aparelho, use o número do pedido e este código. Não aparece no link nem é enviado ao provedor de pagamentos.</p>'+
  '<code class="access-code" style="overflow-wrap:anywhere">'+esc(code)+'</code><p><button type="button" class="secondary" id="copy-access">Copiar código</button></p></div>';
}
function copyAccess(code){
 const button=el('copy-access');
 if(button)button.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(code);button.textContent='Código copiado';}
  catch{button.textContent='Selecione e copie o código exibido acima';}
 });
}
async function catalog(){
 try{
  const [result,health]=await Promise.all([api('/v1/catalog'),api('/healthz')]);
  const offers=result.offers||[],offer=offers.find(x=>x.id===selected);
  if(!offer){
   el('content').innerHTML='<h2>Produtos disponíveis</h2>'+(offers.length
    ?'<div class="offer-cards">'+offers.map(x=>'<div class="card"><h3>'+esc(x.name)+'</h3><p class="muted">'+esc(x.description)+'</p><div class="price">'+money(x.priceCents)+'</div><a href="/comprar?oferta='+encodeURIComponent(x.id)+'">Comprar</a></div>').join('')+'</div>'
    :'<p>Nenhuma oferta de compra está publicada.</p>');
   return;
  }
  const available=health.paymentsEnabled===true;
  const variants=offer.variants||[];
  const variantField=variants.length?'<label>Versão para seu sistema operacional<select name="variantId" required>'+variants.map(x=>
   '<option value="'+esc(x.id)+'">'+esc(x.platform)+' · versão '+esc(x.version)+'</option>').join('')+'</select></label>':'';
  const paymentTypes=[
   ...(health.gatewayConfigured?['<option value="asaas">Pix ou cartão — Asaas</option>']:[]),
   ...(health.manualPixConfigured?['<option value="manual_pix">Pix manual (conferência administrativa)</option>']:[])
  ];
  el('content').innerHTML='<h2>'+esc(offer.name)+'</h2><p class="muted">'+esc(offer.description)+'</p><p class="price">'+money(offer.priceCents)+'</p>'+
   '<p>'+esc(offer.saleType==='one_time'?'Pagamento único':'Assinatura '+offer.saleType)+'</p>'+
   (!available?'<p class="muted">Checkout temporariamente indisponível.</p>':
    '<form id="buy-form" class="stack"><label>Nome<input name="name" required maxlength="120"></label>'+
    '<label>E-mail<input name="email" type="email" required></label>'+variantField+
    '<label>Cupom (opcional)<input name="couponCode"></label>'+
    '<label>Forma de pagamento<select name="provider" required>'+paymentTypes.join('')+'</select></label>'+
    '<button class="primary" '+(!paymentTypes.length?'disabled':'')+'>Continuar</button></form>');
  const form=el('buy-form');if(!form)return;
  form.addEventListener('submit',async event=>{
   event.preventDefault();const button=form.querySelector('button'),f=new FormData(form);button.disabled=true;
   try{
    const created=await api('/v1/orders','POST',{
     offerId:offer.id,email:f.get('email'),name:f.get('name'),couponCode:f.get('couponCode'),
     variantId:f.get('variantId')||undefined,idempotencyKey:crypto.randomUUID()+'-'+crypto.randomUUID()
    });
    const orderId=created.order.id,code=created.orderAccessToken;
    store(orderId,code);
    const checkout=await api('/v1/orders/'+orderId+'/checkout','POST',{provider:f.get('provider')},code);
    history.replaceState(null,'','/pedido?id='+encodeURIComponent(orderId));
    el('content').innerHTML='<h2>Pedido criado</h2><p>Pedido: <strong>'+esc(orderId)+'</strong></p>'+
      accessPanel(orderId,code)+
      (checkout.checkoutUrl?'<p><a class="primary" href="'+esc(checkout.checkoutUrl)+'" rel="noreferrer">Prosseguir para pagamento</a></p>':
      '<p>Pagamento por Pix manual. A entrega será liberada após confirmação administrativa.</p>'+
      '<p>Chave Pix: <strong>'+esc(checkout.manualPixKey||'')+'</strong></p>')+
      '<p><button class="secondary" id="show-order" type="button">Consultar pedido</button></p>';
    copyAccess(code);
    el('show-order').addEventListener('click',()=>showOrder(orderId,code,checkout.manualPixKey));
   }catch(e){notify(e);}finally{button.disabled=false;}
  });
 }catch(e){notify(e);}
}
async function showOrder(orderId,code,pixKey=''){
 if(!code){recoveryForm(orderId);return;}
 try{
  const o=(await api('/v1/orders/'+orderId,'GET',null,code)).order;
  const labels={pending:'Aguardando pagamento',paid:'Pagamento confirmado',expired:'Checkout expirado',canceled:'Checkout cancelado',refunded:'Pagamento reembolsado'};
  const ready=o.status==='paid'&&o.fulfillmentStatus==='delivered'&&o.downloadName;
  el('content').innerHTML='<p class="kicker">PEDIDO '+esc(orderId.slice(0,8))+'</p><h2>'+esc(labels[o.status]||o.status)+'</h2>'+
    '<p><b>'+esc(o.productId)+'</b> · '+money(o.amountCents)+'</p>'+
    (o.platform?'<p>Plataforma: '+esc(o.platform)+(o.version?' · versão '+esc(o.version):'')+'</p>':'')+
    '<p class="muted">Entrega: '+esc(o.fulfillmentStatus)+' / Cobrança: '+esc(o.checkoutState)+'</p>'+
    (pixKey?'<div class="card"><b>Chave Pix manual</b><p>'+esc(pixKey)+'</p></div>':'')+
    accessPanel(orderId,code)+
    (o.checkoutUrl&&o.status==='pending'?'<p><a href="'+esc(o.checkoutUrl)+'" rel="noreferrer">Retomar checkout</a></p>':'')+
    (ready?'<p>Arquivo: '+esc(o.downloadName)+'</p><button class="primary" id="download" type="button">Baixar arquivo</button>':'')+
    '<p><button class="secondary" id="refresh" type="button">Atualizar situação</button></p>';
  copyAccess(code);
  el('refresh').addEventListener('click',()=>showOrder(orderId,code));
  if(ready)el('download').addEventListener('click',()=>{
   // Form POST: navegador faz streaming sem carregar instaladores de 100+ MB na memória.
   const form=document.createElement('form');
   form.method='POST';form.action='/v1/orders/'+encodeURIComponent(orderId)+'/download';
   form.style.display='none';
   const input=document.createElement('input');input.type='hidden';input.name='accessCode';input.value=code;
   form.append(input);document.body.append(form);form.submit();form.remove();
  });
 }catch(e){notify(e);if(e.message==='order_not_found')recoveryForm(orderId);}
}
if(id)showOrder(id,saved(id));else catalog();
