const el=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(x)||0)/100);
const p=new URLSearchParams(location.search),selected=p.get('oferta'),id=p.get('id'),buyerBinding=p.get('buyer');
function bindingEmail(ticket){
 try{
  if(!ticket||!/^[A-Za-z0-9_-]{40,1200}\.[0-9a-f]{64}$/.test(ticket))return '';
  const base=ticket.split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
  const data=JSON.parse(atob(base.padEnd(Math.ceil(base.length/4)*4,'=')));
  return typeof data.e==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.e)?data.e:'';
 }catch{return '';}
}
const errorMessages={
 asaas_pix_key_required:'O Pix está temporariamente indisponível porque a loja ainda precisa cadastrar sua chave no Asaas. Você pode continuar com cartão de crédito.',
 asaas_checkout_rejected:'O provedor recusou os dados desta tentativa. Tente pagar com cartão ou entre em contato com o suporte.',
 checkout_requires_reconciliation:'Estamos verificando a tentativa anterior com o provedor. Por segurança, não criaremos outra cobrança até a conferência.',
 checkout_in_progress:'O checkout está sendo preparado. Aguarde antes de tentar novamente.',
 asaas_not_configured:'Pagamento temporariamente indisponível. Entre em contato com o suporte.',
 internal_error:'Não foi possível concluir agora. Confira a situação do pedido antes de tentar novamente.'
};
const friendlyError=e=>errorMessages[String(e?.message||e)]||'Não foi possível concluir a solicitação. Consulte a situação do seu pedido.';
const notify=e=>{el('alert').textContent=friendlyError(e);};
async function retryCreditCard(orderId,code){
 const button=el('retry-card');if(button)button.disabled=true;
 try{
  const checkout=await api('/v1/orders/'+orderId+'/checkout','POST',{provider:'asaas',paymentMethod:'credit_card'},code);
  if(checkout.checkoutUrl){location.assign(checkout.checkoutUrl);return;}
  await showOrder(orderId,code);
 }catch(e){notify(e);const button=el('retry-card');if(button)button.disabled=false;}
}
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
  const hub=offer.productId==='hubestudos-subscription'||offer.productId.startsWith('hubestudos-course-');
  const buyerEmail=hub?bindingEmail(buyerBinding):'';
  if(hub&&!buyerEmail){
   el('content').innerHTML='<h2>Compra vinculada à sua conta</h2><p>Para comprar este curso, entre no HubEstudos e escolha a oferta pelo catálogo da sua conta. Assim, o acesso será liberado na conta correta.</p>';
   return;
  }
  const available=health.paymentsEnabled===true;
  const variants=offer.variants||[];
  const variantField=variants.length?'<label>Versão para seu sistema operacional<select name="variantId" required>'+variants.map(x=>
   '<option value="'+esc(x.id)+'">'+esc(x.platform)+' · versão '+esc(x.version)+'</option>').join('')+'</select></label>':'';
  const paymentTypes=[
   ...(health.gatewayConfigured?['<option value="asaas">'+(health.asaasPixEnabled?'Pix ou cartão':'Cartão de crédito')+' — Asaas</option>']:[]),
   ...(health.manualPixConfigured?['<option value="manual_pix">Pix manual (conferência administrativa)</option>']:[])
  ];
  el('content').innerHTML='<h2>'+esc(offer.name)+'</h2><p class="muted">'+esc(offer.description)+'</p><p class="price">'+money(offer.priceCents)+'</p>'+
   '<p>'+esc(offer.saleType==='one_time'?'Pagamento único':'Assinatura '+offer.saleType)+'</p>'+
   (!available?'<p class="muted">Checkout temporariamente indisponível.</p>':
    '<form id="buy-form" class="stack"><label>Nome<input name="name" required maxlength="120"></label>'+
    '<label>E-mail<input name="email" type="email" required '+(hub?'readonly value="'+esc(buyerEmail)+'"':'')+'></label>'+variantField+
    '<label>Cupom (opcional)<input name="couponCode"></label>'+
    '<label>Forma de pagamento<select name="provider" required>'+paymentTypes.join('')+'</select></label>'+
    '<button class="primary" '+(!paymentTypes.length?'disabled':'')+'>Continuar</button></form>');
  const form=el('buy-form');if(!form)return;
  form.addEventListener('submit',async event=>{
   event.preventDefault();const button=form.querySelector('button'),f=new FormData(form);button.disabled=true;
   try{
    const created=await api('/v1/orders','POST',{
     offerId:offer.id,email:f.get('email'),name:f.get('name'),couponCode:f.get('couponCode'),
     ...(hub?{buyerBinding}:{}),
     variantId:f.get('variantId')||undefined,idempotencyKey:crypto.randomUUID()+'-'+crypto.randomUUID()
    });
    const orderId=created.order.id,code=created.orderAccessToken;
    store(orderId,code);
    history.replaceState(null,'','/pedido?id='+encodeURIComponent(orderId));
    el('content').innerHTML='<h2>Pedido criado</h2><p>Pedido: <strong>'+esc(orderId)+'</strong></p>'+
      accessPanel(orderId,code)+'<div id="checkout-result"><p>Preparando checkout…</p></div>'+
      '<p><button class="secondary" id="show-order" type="button">Consultar pedido</button></p>';
    copyAccess(code);
    el('show-order').addEventListener('click',()=>showOrder(orderId,code));
    const checkout=await api('/v1/orders/'+orderId+'/checkout','POST',{provider:f.get('provider'),paymentMethod:'default'},code);
    const result=el('checkout-result');
    if(checkout.checkoutUrl){
      // O checkout válido foi persistido no servidor. Mantém o link como fallback
      // para navegadores que impedem a troca automática de domínio.
      if(result)result.innerHTML='<p>Redirecionando para o pagamento seguro do Asaas…</p>'+
        '<p><a class="primary" href="'+esc(checkout.checkoutUrl)+'" rel="noreferrer">Abrir pagamento no Asaas</a></p>';
      location.assign(checkout.checkoutUrl);
      return;
    }
    if(result)result.innerHTML='<p>Pix manual: liberação somente após confirmação administrativa.</p>'+
      '<p>Chave Pix: <strong>'+esc(checkout.manualPixKey||'')+'</strong></p>';
   }catch(e){
    notify(e);
    const orderId=new URLSearchParams(location.search).get('id'),code=orderId?saved(orderId):'';
    const result=el('checkout-result');
    if(result&&orderId&&code){
     const retry=['asaas_pix_key_required','asaas_checkout_rejected'].includes(String(e?.message||''));
     result.innerHTML='<p>'+esc(friendlyError(e))+'</p>'+(retry?'<button class="secondary" id="retry-card" type="button">Continuar com cartão de crédito</button>':'');
     if(retry)el('retry-card').addEventListener('click',()=>retryCreditCard(orderId,code));
    }
   }finally{button.disabled=false;}
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
    '<p class="muted">'+esc(o.status==='paid'?'Pagamento confirmado. Preparando entrega.':o.checkoutState==='verifying'?'Aguardando verificação segura da tentativa anterior.':o.checkoutState==='not_started'?'Aguardando escolha da forma de pagamento.':'Aguardando confirmação do pagamento.')+'</p>'+
    (pixKey?'<div class="card"><b>Chave Pix manual</b><p>'+esc(pixKey)+'</p></div>':'')+
    accessPanel(orderId,code)+
    (o.checkoutUrl&&o.status==='pending'?'<p><a href="'+esc(o.checkoutUrl)+'" rel="noreferrer">Retomar checkout</a></p>':'')+
    (o.status==='pending'&&o.checkoutState==='not_started'?'<p><button id="retry-card" class="primary" type="button">Continuar com cartão de crédito</button></p>':'')+
    (ready?'<p>Arquivo: '+esc(o.downloadName)+'</p><button class="primary" id="download" type="button">Baixar arquivo</button>':'')+
    '<p><button class="secondary" id="refresh" type="button">Atualizar situação</button></p>';
  copyAccess(code);
  el('refresh').addEventListener('click',()=>showOrder(orderId,code));
  if(el('retry-card'))el('retry-card').addEventListener('click',()=>retryCreditCard(orderId,code));
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
