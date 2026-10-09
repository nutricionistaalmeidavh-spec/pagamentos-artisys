const el=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(x)||0)/100);
const p=new URLSearchParams(location.search),selected=p.get('oferta'),id=p.get('id');
const notify=e=>{el('alert').textContent=String(e?.message||e);};
async function api(path,method='GET',body=null,token=''){
 const response=await fetch(path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Falha ao conectar');
 return data;
}
async function catalog(){
 try{
  const offers=(await api('/v1/catalog')).offers,offer=offers.find(x=>x.id===selected);
  if(!offer){
   el('content').innerHTML='<h2>Produtos disponíveis</h2>'+(offers.length?'<div class="offer-cards">'+offers.map(x=>'<div class="card"><h3>'+esc(x.name)+'</h3><p class="muted">'+esc(x.description)+'</p><div class="price">'+money(x.priceCents)+'</div><a href="/comprar?oferta='+encodeURIComponent(x.id)+'">Comprar</a></div>').join('')+'</div>':'<p>Nenhuma oferta de compra está publicada.</p>');
   return;
  }
  el('content').innerHTML='<h2>'+esc(offer.name)+'</h2><p class="muted">'+esc(offer.description)+'</p><p class="price">'+money(offer.priceCents)+'</p><p>'+esc(offer.saleType==='one_time'?'Pagamento único':'Assinatura '+offer.saleType)+'</p>'
    +'<form id="buy-form" class="stack"><label>Nome<input name="name" required maxlength="120"></label><label>E-mail<input name="email" type="email" required></label><label>Cupom (opcional)<input name="couponCode"></label><label>Forma de pagamento<select name="provider"><option value="asaas">Pix ou cartão — Asaas</option><option value="manual_pix">Pix — conferência manual</option></select></label><button class="primary">Continuar</button></form>';
  el('buy-form').addEventListener('submit',async event=>{
   event.preventDefault();const button=event.target.querySelector('button'),f=new FormData(event.target);button.disabled=true;
   try{
    const created=await api('/v1/orders','POST',{offerId:offer.id,email:f.get('email'),name:f.get('name'),couponCode:f.get('couponCode'),idempotencyKey:crypto.randomUUID()+'-'+crypto.randomUUID()});
    const orderId=created.order.id,secret=created.orderAccessToken;
    sessionStorage.setItem('artisys-order-'+orderId,secret);
    const checkout=await api('/v1/orders/'+orderId+'/checkout','POST',{provider:f.get('provider')},secret);
    if(checkout.checkoutUrl){location.assign(checkout.checkoutUrl);return;}
    history.replaceState(null,'','/pedido?id='+encodeURIComponent(orderId));
    showOrder(orderId,secret,checkout.manualPixKey);
   }catch(e){notify(e);}finally{button.disabled=false;}
  });
 }catch(e){notify(e);}
}
async function showOrder(orderId,token,pixKey=''){
 if(!token){el('content').innerHTML='<h2>Pedido protegido</h2><p>Token do pedido não encontrado neste navegador. Use o navegador original ou entre em contato com o suporte.</p>';return;}
 try{
  const o=(await api('/v1/orders/'+orderId,'GET',null,token)).order;
  const labels={pending:'Aguardando pagamento',paid:'Pagamento confirmado',expired:'Checkout expirado',canceled:'Checkout cancelado',refunded:'Pagamento reembolsado'};
  el('content').innerHTML='<p class="kicker">PEDIDO '+esc(orderId.slice(0,8))+'</p><h2>'+esc(labels[o.status]||o.status)+'</h2><p><b>'+esc(o.productId)+'</b> · '+money(o.amountCents)+'</p><p class="muted">Entrega: '+esc(o.fulfillmentStatus)+' / Cobrança: '+esc(o.checkoutState)+'</p>'
  +(pixKey?'<div class="card"><b>Chave Pix manual</b><p>'+esc(pixKey)+'</p><p class="caption muted">Aguardando confirmação administrativa após o pagamento.</p></div>':'')
  +(o.checkoutUrl&&o.status==='pending'?'<p><a rel="noopener noreferrer" href="'+esc(o.checkoutUrl)+'">Retomar checkout</a></p>':'')
  +(o.status==='paid'&&o.fulfillmentStatus==='delivered'?'<button class="primary" id="download">Baixar, se disponível</button>':'')
  +'<p><button class="secondary" id="refresh">Atualizar situação</button></p>';
  el('refresh').addEventListener('click',()=>showOrder(orderId,token));
  if(el('download'))el('download').addEventListener('click',async()=>{
   try{
    const response=await fetch('/v1/orders/'+orderId+'/download',{headers:{authorization:'Bearer '+token}});
    if(!response.ok)throw new Error('Sem download disponível; consulte o acesso do produto.');
    const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='artisys-download';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
   }catch(e){notify(e);}
  });
 }catch(e){notify(e);}
}
if(id)showOrder(id,sessionStorage.getItem('artisys-order-'+id)||'');else catalog();
