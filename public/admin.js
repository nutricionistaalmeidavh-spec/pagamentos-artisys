const el=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(n)||0)/100);
const tag=x=>'<span class="tag '+esc(x)+'">'+esc(x)+'</span>';
const table=(heads,rows)=>'<div class="table-scroll"><table><thead><tr>'+heads.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
let token=sessionStorage.getItem('artisys-payment-admin')||'',tab='dashboard',offersCache=[];
async function api(path,method='GET',data=null){
 const response=await fetch('/v1/admin/'+path,{method,headers:{authorization:'Bearer '+token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||'HTTP '+response.status);
 return result;
}
function signedIn(ok){el('signin').hidden=ok;el('workspace').hidden=!ok;}
function showError(e){el('alert').textContent=String(e.message||e);}
async function render(){
 el('alert').textContent='';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 try {
  let html='';
  if(tab==='dashboard'){
   const [d,f]=await Promise.all([api('summary'),api('fulfillments')]),s=d.summary;
   html='<div class="grid">'+[['Recebido',money(s.receivedCents)],['Pedidos',s.orders||0],['Pendentes',s.pending||0],['Eventos com falha',s.failedEvents||0]].map(([name,val])=>'<div class="metric"><span class="label">'+esc(name)+'</span><strong class="value">'+esc(val)+'</strong></div>').join('')+'</div><section class="box"><h2>Controle de pagamentos</h2><p class="muted">Cada pedido é confirmado por evento financeiro autenticado ou pela conciliação. O retorno do navegador não libera acesso.</p><p>Entregas com atenção: <b>'+f.fulfillments.filter(x=>x.status!=='delivered').length+'</b></p></section>';
  } else if(tab==='offers'){
   const [off,discount]=await Promise.all([api('offers'),api('coupons')]);offersCache=off.offers;
   html='<section class="box"><h2>Nova oferta ou edição</h2><form id="offer-form" class="stack"><div class="form-grid"><label>ID oferta<input name="id" required placeholder="pdv-standard"></label><label>ID produto<input name="productId" required placeholder="pdv-artisys"></label><label>Nome<input name="name" required></label><label>Preço (R$)<input name="price" type="number" step="0.01" min="0.01" required></label><label>Venda<select name="saleType"><option value="one_time">Única</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label><label>Entrega<select name="deliveryMode"><option value="manual">Manual</option><option value="download">Download</option><option value="webhook">Conector</option></select></label><label>Arquivo de entrega (opcional)<input name="artifactName" placeholder="setup.exe"></label><label>Descrição<input name="description"></label><label>Visibilidade<select name="active"><option value="true">Publicada</option><option value="false">Rascunho</option></select></label></div><button class="primary">Salvar oferta</button></form></section>';
   html+='<section class="box"><h2>Catálogo de vendas</h2>'+table(['Oferta','Produto','Preço','Entrega','Visibilidade',''],off.offers.map(o=>'<tr><td><b>'+esc(o.name)+'</b><br>'+esc(o.id)+'</td><td>'+esc(o.product_id)+'</td><td>'+money(o.price_cents)+'</td><td>'+esc(o.delivery_mode)+'</td><td>'+tag(o.active?'ativa':'rascunho')+'</td><td><button class="mini" data-edit="'+esc(o.id)+'">Editar</button></td></tr>'))+'</section>';
   html+='<section class="box"><h2>Cupons</h2><form class="form-grid" id="coupon-form"><label>Código<input name="code" required></label><label>Desconto em %<input name="percentOff" type="number" min="1" max="90" required></label><label>Ativo<select name="active"><option value="true">Sim</option><option value="false">Não</option></select></label><button class="primary">Salvar cupom</button></form><p class="muted caption">'+discount.coupons.map(c=>esc(c.code)+' ('+esc(c.percent_off)+'%)').join(' · ')+'</p></section>';
  } else if(tab==='orders'){
   const d=await api('orders');
   html='<section class="box"><h2>Pedidos</h2>'+table(['Pedido / e-mail','Produto','Valor','Status','Entrega','Ações'],d.orders.map(o=>{
    const actions=[];
    if(o.paymentProvider==='manual_pix'&&o.status==='pending')actions.push('<button class="mini" data-order-action="confirm-manual" data-id="'+esc(o.id)+'">Confirmar Pix</button>');
    if(o.fulfillmentStatus==='awaiting_manual'&&o.status==='paid')actions.push('<button class="mini" data-order-action="deliver-manual" data-id="'+esc(o.id)+'">Entregue</button>');
    if(o.checkoutState==='verifying'&&o.paymentProvider==='asaas')actions.push('<button class="mini" data-order-action="reconcile" data-id="'+esc(o.id)+'">Conciliar</button>');
    return '<tr><td><b>'+esc(o.id.slice(0,8))+'</b><br>'+esc(o.customerEmail)+'</td><td>'+esc(o.productId)+'</td><td>'+money(o.amountCents)+'</td><td>'+tag(o.status)+'</td><td>'+tag(o.fulfillmentStatus)+'</td><td><div class="actions">'+actions.join('')+'</div></td></tr>';
   }))+'</section>';
  } else if(tab==='events'){
   const [events,jobs]=await Promise.all([api('events'),api('fulfillments')]);
   html='<section class="box"><h2>Eventos do Asaas</h2>'+table(['ID','Tipo','Status','Erro','Ação'],events.events.map(e=>'<tr><td>'+esc(e.id)+'</td><td>'+esc(e.event_type)+'</td><td>'+tag(e.status)+'</td><td>'+esc(e.last_error||'—')+'</td><td><button class="mini" data-replay="events" data-id="'+esc(e.id)+'">Reprocessar</button></td></tr>'))+'</section>';
   html+='<section class="box"><h2>Fila de entregas</h2>'+table(['Pedido','Ação','Status','Erro','Ação'],jobs.fulfillments.map(j=>'<tr><td>'+esc(j.order_id.slice(0,8))+'</td><td>'+esc(j.action)+'</td><td>'+tag(j.status)+'</td><td>'+esc(j.last_error||'—')+'</td><td><button class="mini" data-replay="fulfillments" data-id="'+esc(j.id)+'">Reprocessar</button></td></tr>'))+'</section>';
  } else if(tab==='integrations'){
   const d=await api('summary');
   html='<section class="box"><h2>Conectores de produtos</h2><p class="muted">Credenciais são configuradas somente no ambiente privado; este painel nunca mostra segredos.</p>'+d.integrations.map(c=>'<div class="card"><b>'+esc(c.productId)+'</b> '+tag(c.configured?'configurado':'pendente')+'</div>').join('')+'<p class="muted caption">Cadastre PRODUCT_CONNECTORS_JSON e CONNECTOR_ALLOWED_ORIGINS conforme docs/INTEGRACAO.md.</p></section><section class="box"><h2>Asaas</h2><p>Gateway opcional: configure credenciais e webhook exclusivos do Pagamento ArtiSys. Endpoint /v1/webhooks/asaas.</p></section>';
  }
  el('content').innerHTML=html;
 }catch(e){showError(e);}
}
el('login-form').addEventListener('submit',async e=>{e.preventDefault();token=new FormData(e.target).get('token');try{await api('summary');sessionStorage.setItem('artisys-payment-admin',token);signedIn(true);render();}catch(e){token='';el('login-error').textContent='Token inválido ou ausente no servidor.';}});
el('logout').addEventListener('click',()=>{sessionStorage.removeItem('artisys-payment-admin');token='';signedIn(false);});
document.addEventListener('click',async e=>{
 const btn=e.target.closest('button');if(!btn)return;
 if(btn.dataset.tab){tab=btn.dataset.tab;return render();}
 if(btn.dataset.edit){
  const o=offersCache.find(x=>x.id===btn.dataset.edit);if(!o)return;
  const f=el('offer-form'),fields={id:o.id,productId:o.product_id,name:o.name,price:(o.price_cents/100).toFixed(2),description:o.description,saleType:o.sale_type,deliveryMode:o.delivery_mode,artifactName:o.artifact_name||'',active:String(!!o.active)};
  for(const [k,v] of Object.entries(fields)){const input=f.elements.namedItem(k);if(input)input.value=v;}f.scrollIntoView({behavior:'smooth'});return;
 }
 if(btn.dataset.orderAction||btn.dataset.replay){
  btn.disabled=true;try{
   if(btn.dataset.orderAction)await api('orders/'+encodeURIComponent(btn.dataset.id)+'/'+btn.dataset.orderAction,'POST',{});
   else await api(btn.dataset.replay+'/'+encodeURIComponent(btn.dataset.id)+'/replay','POST',{});
   render();
  }catch(err){showError(err);}finally{btn.disabled=false;}
 }
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='offer-form'){e.preventDefault();const f=new FormData(e.target);try{await api('offers','POST',{id:f.get('id'),productId:f.get('productId'),name:f.get('name'),priceCents:Math.round(Number(f.get('price'))*100),description:f.get('description'),saleType:f.get('saleType'),deliveryMode:f.get('deliveryMode'),artifactName:f.get('artifactName')||null,active:f.get('active')==='true'});render();}catch(err){showError(err);}}
 if(e.target.id==='coupon-form'){e.preventDefault();const f=new FormData(e.target);try{await api('coupons','POST',{code:f.get('code'),percentOff:Number(f.get('percentOff')),active:f.get('active')==='true'});render();}catch(err){showError(err);}}
});
if(token)api('summary').then(()=>{signedIn(true);render();}).catch(()=>{sessionStorage.removeItem('artisys-payment-admin');signedIn(false);});else signedIn(false);
