const el=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(x)||0)/100);
const date=x=>x?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(x)):'—';
const icons={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',receipt:'<path d="M4 3h16v19l-3-2-3 2-3 2-3-2-4-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',package:'<path d="m3 7 9-4 9 4v10l-9 4-9-4Z"/><path d="m3 7 9 5 9-5M12 12v9"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="m9 18 6-6-6-6"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'};
const icon=name=>'<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[name]||icons.shield)+'</svg>';
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const key='artisys-payment-admin';
let token=sessionStorage.getItem(key)||'',screen='inicio',filter='todos',orders=[],offers=[],coupons=[],summary=null,fulfillments=[],events=[],integrations=[],health=null,catalogStatus=null,offerReadiness=null,offerDraft=null,lastFocus=null,modalMode='',busy=false;
const validScreens=['inicio','pedidos','ofertas','mais'];
const paymentsOnline=()=>health?.paymentsEnabled===true;
const paymentLabel=status=>{
 const labels={pending:['Aguardando pagamento','warn'],paid:['Pagamento confirmado','ok'],refunded:['Reembolsado','error'],canceled:['Cancelado','error'],expired:['Expirado','warn']};
 return labels[status]||[String(status||'Indefinido'),''];
};
const deliveryLabel=status=>{
 const labels={not_started:['Não iniciado',''],pending:['Em processamento','info'],delivered:['Entregue','ok'],awaiting_manual:['Entrega manual pendente','warn'],waiting_configuration:['Configuração pendente','warn'],failed:['Falha na entrega','error']};
 return labels[status]||[String(status||'Indefinido'),''];
};
const label=(pair)=>'<span class="label '+esc(pair[1])+'">'+esc(pair[0])+'</span>';
const empty=(title,description,button='')=>'<div class="empty"><strong>'+esc(title)+'</strong><p>'+esc(description)+'</p>'+button+'</div>';
const task=(title,desc,target,kind='shield')=>'<button class="task" type="button" data-go="'+target+'"><span class="task-icon">'+icon(kind)+'</span><span class="task-body"><strong>'+esc(title)+'</strong><small>'+esc(desc)+'</small></span><span class="arrow">›</span></button>';
const api=async(path,method='GET',body=null)=>{
 const response=await fetch('/v1/admin/'+path,{method,headers:{authorization:'Bearer '+token,...(body!==null?{'content-type':'application/json'}:{})},...(body!==null?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const e=new Error(data.error||'request_failed');e.status=response.status;throw e;}
 return data;
};
const publicStatus=async()=>{const r=await fetch('/healthz',{cache:'no-store'});if(!r.ok)throw Error('connection_unavailable');return r.json();};
function translateError(e){
 const m={unauthorized:'Acesso negado. Entre novamente.',admin_not_configured:'Token administrativo não configurado no servidor.',invalid_offer:'Verifique os campos da oferta.',invalid_coupon:'Confira código e percentual do cupom.',invalid_payment_transition:'Este pedido mudou de situação. Atualize a lista.',order_not_found:'Pedido não encontrado.',checkout_missing:'Este pedido ainda não tem checkout Asaas.',asaas_http_401:'Asaas recusou a autenticação.',request_failed:'Não foi possível concluir a operação.',connection_unavailable:'Não foi possível consultar o servidor.',invalid_transition:'Este pedido não pode mudar para este estado.',manual_payment_not_pending:'O pedido não está aguardando confirmação manual.',manual_delivery_denied:'A entrega manual só pode ser confirmada após o pagamento.',internal_error:'Erro inesperado. Atualize e tente novamente.'};
 return m[e.message]||(/Failed to fetch|NetworkError|fetch failed/i.test(e.message)?'Sem conexão. Verifique a internet e tente novamente.':e.message||'Erro inesperado');
}
function showError(e,context=''){
 const target=el('feedback');
 target.textContent=(context?context+': ':'')+translateError(e);
 target.hidden=false;
 target.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function clearError(){el('feedback').hidden=true;el('feedback').textContent='';}
function toast(message){const n=el('toast');n.textContent=message;n.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.classList.remove('show'),3600);}
function signedIn(ok){el('signin').hidden=ok;el('workspace').hidden=!ok;el('logout').hidden=!ok;}
function navigate(name,replace=false){
 if(!validScreens.includes(name))return;
 screen=name;
 for(const n of document.querySelectorAll('.screen')){n.hidden=n.id!==name;n.classList.toggle('is-active',n.id===name);}
 for(const b of document.querySelectorAll('[data-screen]')){const active=b.dataset.screen===name;b.classList.toggle('is-active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
 const u=new URL(location.href);u.searchParams.set('screen',name);history[replace?'replaceState':'pushState'](null,'',u);
 clearError();window.scrollTo({top:0,behavior:'instant'});load(name);
}
async function load(name=screen){
 if(!token)return;
 try{
  clearError();
  if(name==='inicio'){
   el('home-content').innerHTML='<div class="loading">Atualizando visão geral…</div>';
   const [s,f,h]=await Promise.all([api('summary'),api('fulfillments'),publicStatus()]);
   summary=s.summary;integrations=s.integrations||[];fulfillments=f.fulfillments||[];health=h;renderHome();
  }else if(name==='pedidos'){
   el('orders-list').innerHTML='<div class="loading">Atualizando pedidos…</div>';
   orders=(await api('orders')).orders||[];renderOrders();
  }else if(name==='ofertas'){
   el('offers-list').innerHTML='<div class="loading">Atualizando ofertas…</div>';
   const [a,c,h,s,cat,r]=await Promise.all([api('offers'),api('coupons'),publicStatus(),api('summary'),api('catalog-drafts/status'),api('offer-readiness')]);
   offers=a.offers||[];coupons=c.coupons||[];health=h;integrations=s.integrations||[];catalogStatus=cat;offerReadiness=r;renderOffers();
  }else if(name==='mais'){
   for(const id of ['integrations-content','events-content','fulfillments-content'])el(id).innerHTML='<div class="loading">Atualizando…</div>';
   const [s,h,e,f,releases]=await Promise.all([api('summary'),publicStatus(),api('events'),api('fulfillments'),api('system-releases')]);
   summary=s.summary;integrations=s.integrations||[];health=h;events=e.events||[];fulfillments=f.fulfillments||[];renderMore();renderReleases(releases);
  }
  el('runtime-indicator').textContent=paymentsOnline()?'Cobranças habilitadas':'Cobranças desativadas';el('runtime-indicator').hidden=false;
 }catch(e){if(e.status===401){sessionStorage.removeItem(key);token='';signedIn(false);el('login-error').textContent='Sua sessão expirou. Entre novamente.';}else{showError(e,'Falha ao carregar');const id={inicio:'home-content',pedidos:'orders-list',ofertas:'offers-list',mais:'integrations-content'}[name];if(id)el(id).innerHTML=empty('Não foi possível carregar','Tente novamente usando Atualizar.');}}
}
function renderHome(){
 const s=summary||{},pending=fulfillments.filter(x=>x.status!=='delivered'),issues=fulfillments.filter(x=>['failed','waiting_configuration'].includes(x.status));
 let highlight='';
 if(!paymentsOnline())highlight='<div class="spotlight"><small>Preparação da operação</small><h2>As cobranças reais continuam desativadas.</h2><p>A chave pode estar cadastrada, mas isso não confirma autenticação nem um pagamento de ponta a ponta. Prepare ofertas em rascunho antes de liberar vendas.</p><button class="primary" type="button" data-go="mais">Ver integrações →</button></div>';
 else if(issues.length)highlight='<div class="spotlight"><small>Entregas com atenção</small><h2>'+issues.length+' entrega(s) precisam de revisão.</h2><p>O pagamento confirmado não garante que a licença ou o arquivo foi entregue. Verifique o motivo e a fila.</p><button class="primary" type="button" data-go="mais">Examinar entregas →</button></div>';
 const metrics=[['Recebido',money(s.receivedCents),'Pedidos pagos registrados'],['Pedidos',String(s.orders??0),'Últimos registros do sistema'],['Para entregar',String(pending.length),'Fila não concluída'],['Falhas',String((s.failedEvents||0)+issues.length),'Eventos e entregas com falha']];
 const metricHtml=metrics.map(([name,value,detail])=>'<div class="metric surface"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></div>').join('');
 el('home-content').innerHTML=highlight+'<div class="section-heading"><h2>Visão financeira</h2></div><div class="metrics">'+metricHtml+'</div><div class="section-heading"><h2>Próximas ações</h2></div>'+
 (issues.length?task('Revisar entregas com falha',issues.length+' ocorrência(s) aguardando resolução.','mais','shield'):'')+
 (s.pending?task('Acompanhar pagamentos',s.pending+' pedido(s) aguardando confirmação.','pedidos','receipt'):'')+
 task('Preparar uma oferta','Cadastre produto, preço e entrega; comece como rascunho.','ofertas','plus')+
 task('Conferir integrações','Credenciais, webhooks e fila de entregas.','mais','shield');
}
function matchesOrder(o,q){return [o.id,o.customerName,o.customerEmail,o.productId].join(' ').toLocaleLowerCase('pt-BR').includes(q.toLocaleLowerCase('pt-BR'));}
function needsAttention(o){return ['waiting_configuration','failed','awaiting_manual'].includes(o.fulfillmentStatus)||(o.checkoutState==='verifying');}
function renderOrders(){
 const q=el('order-search').value.trim();
 const view=orders.filter(o=>(filter==='todos'||filter==='pendentes'&&o.status==='pending'||filter==='pagos'&&o.status==='paid'||filter==='atencao'&&needsAttention(o))&&matchesOrder(o,q));
 el('orders-count').textContent=view.length+' de '+orders.length+' pedidos recentes (até 200)';
 el('orders-list').innerHTML=view.length?'<div class="cards">'+view.map(o=>'<article class="surface order-card"><div class="card-top"><div><strong>'+esc(o.customerName||o.customerEmail||'Cliente')+'</strong><div class="small">'+esc(o.customerEmail||'')+'</div><div class="small">'+esc(o.productId)+' · '+esc(o.id.slice(0,8))+'</div></div><span class="amount">'+money(o.amountCents)+'</span></div><div class="labels">'+label(paymentLabel(o.status))+label(deliveryLabel(o.fulfillmentStatus))+'</div><div class="card-bottom"><span class="small">'+esc(date(o.createdAt))+'</span><button class="secondary" type="button" data-order="'+esc(o.id)+'">Ver pedido →</button></div></article>').join('')+'</div>':empty(q||filter!=='todos'?'Nenhum pedido encontrado':'Ainda não há pedidos',q||filter!=='todos'?'Ajuste a busca ou selecione outro filtro.':'Quando houver uma venda, você poderá acompanhar pagamento e entrega separadamente.');
}
const saleName=s=>({one_time:'Pagamento único',monthly:'Assinatura mensal',yearly:'Assinatura anual'}[s]||s);
const deliveryName=s=>({manual:'Manual',download:'Download protegido',webhook:'Conector automático'}[s]||s);

const releaseNames={
 'obra-na-mao':'Obra na Mão',
 'pdv-artisys-restaurantes':'PDV ArtiSys (Bares e Restaurantes)',
 'pdv-nexus':'PDV Nexus',
 'artisys-sistema-financeiro':'ArtiSys Sistema Financeiro'
};
let availableReleases=[],uploadingRelease=false,selectedRelease=null;
function renderReleases(data){
 availableReleases=data.items||[];
 const grouped=Object.entries(releaseNames).map(([offerId,title])=>{
  const items=availableReleases.filter(x=>x.offerId===offerId);
  const cards=items.map(x=>{
   const status=x.outdated?label(['Versão antiga','warn']):x.verified?label(['R2 · SHA conferido','ok']):x.stored?label(['No R2 · SHA pendente','warn']):x.error?label(['Verificação falhou','error']):label(['Pendente','warn']);
   const size=(x.expectedSize/1024/1024).toFixed(1).replace('.',',')+' MB';
   const link='<a href="'+esc(x.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+(x.source==='github-actions'?'Ver build aprovado no GitHub':'Ver release no GitHub')+'</a>';
   const action=!x.outdated&&!x.stored?'<button type="button" class="secondary" data-release-upload="'+esc(x.id)+'">Selecionar arquivo e enviar ao R2</button>':'';
   const reason=x.outdated?'<p class="muted">Esta versão está desatualizada e bloqueada para entrega.</p>':x.source==='github-actions'?'<p class="muted">Instalador extraído do GitHub Actions aprovado, commit '+esc(x.sourceCommit||'ver link')+'. Selecione o executável extraído do ZIP, não o arquivo ZIP do Actions.</p>':'';
   return '<div class="release-row"><div class="card-top"><div><strong>'+esc(x.platform)+'</strong><div class="small">'+esc(x.version)+' · '+size+'</div></div>'+status+'</div><div class="small">'+esc(x.expectedName)+'</div>'+reason+'<div class="card-bottom"><span class="small">'+link+'</span>'+action+'</div></div>';
  }).join('');
  return '<section class="surface ops-card"><h3>'+esc(title)+'</h3>'+cards+'</section>';
 });
 const elContent=el('releases-content');
 if(elContent)elContent.innerHTML='<div class="notice"><span>'+icon('shield')+'</span><div><strong>Transferência privada</strong><p>'+esc(data.approvedCount)+' de '+esc(data.total)+' variantes verificadas no R2. Selecionar arquivo não publica ofertas nem ativa checkout.</p></div></div>'+grouped.join('');
}
async function uploadRelease(file,item){
 const partSize=8*1024*1024,status=el('releases-status');
 if(item.outdated)throw Error('Instalador antigo bloqueado para venda.');
 if(file.size!==item.expectedSize)throw Error('Arquivo com tamanho diferente do Drive ('+item.expectedSize+' bytes). Verifique se escolheu o instalador correto.');
 if(uploadingRelease)return;
 uploadingRelease=true;
 const controls=el('releases-content').querySelectorAll('button');controls.forEach(n=>n.disabled=true);
 let uploadId=null;
 try{
  status.textContent='Iniciando envio protegido ao R2: '+item.platform+'…';
  const started=await api('system-releases/'+encodeURIComponent(item.id)+'/start','POST',{expectedSize:file.size});
  uploadId=started.uploadId;
  if(started.partSize!==partSize)throw Error('Tamanho de bloco inesperado');
  const parts=[];
  for(let n=1;n<=started.partCount;n++){
   const start=(n-1)*partSize,end=Math.min(start+partSize,file.size);
   status.textContent='Enviando '+item.platform+' — '+Math.floor(start/file.size*100)+'% ('+n+'/'+started.partCount+')';
   const response=await fetch('/v1/admin/system-releases/'+encodeURIComponent(item.id)+'/part/'+n+'?uploadId='+encodeURIComponent(uploadId),{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/octet-stream'},body:file.slice(start,end)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Falha ao enviar parte '+n);
   parts.push({partNumber:data.partNumber,etag:data.etag});
  }
  status.textContent='Concluindo upload e verificando integridade…';
  const complete=await api('system-releases/'+encodeURIComponent(item.id)+'/complete','POST',{uploadId,parts});
  if(!complete.stored)throw Error('Upload não confirmado pelo R2');
  toast('Arquivo transferido ao R2 privado. Oferta continua rascunho.');
  status.textContent='R2 confirmou '+item.platform+' ('+file.size+' bytes).';
  uploadId=null;
 }catch(e){
  if(uploadId){try{await api('system-releases/'+encodeURIComponent(item.id)+'/abort','POST',{uploadId});}catch{}}
  status.textContent='Envio interrompido: '+translateError(e);
  showError(e,'Instalador');
 }finally{
  uploadingRelease=false;controls.forEach(n=>n.disabled=false);
  try{const r=await api('system-releases');renderReleases(r);}catch{}
 }
}


function importCatalog(){
 const status=catalogStatus||{},missing=Number(status.missing||0);
 if(missing===0){toast('As 67 ofertas já estão cadastradas.');return;}
 openModal('Importar catálogo da planilha','<p>Serão cadastrados '+missing+' itens faltantes do catálogo de 63 Dev Kits e 4 sistemas ArtiSys. Os nomes, IDs e preços vêm da planilha consolidada. Todos entram como rascunho, sem liberar vendas.</p><div class="warning-note">As ofertas já existentes não serão alteradas. Downloads precisam de arquivos no R2; sistemas permanecem em entrega manual até configurar conectores.</div><div class="form-actions"><button class="secondary" type="button" data-close>Cancelar</button><button id="confirm-catalog-import" class="primary" type="button">Cadastrar rascunhos</button></div>');
 el('confirm-catalog-import').addEventListener('click',async e=>withBusy(e.currentTarget,async()=>{
  const outcome=await api('catalog-drafts/import','POST',{});
  closeModal();toast(outcome.created+' ofertas cadastradas. '+outcome.alreadyExisting+' já existiam.');
  await load('ofertas');
 }));
}
function renderOffers(){
 el('offers-info').innerHTML=!paymentsOnline()?'<div class="notice"><span>'+icon('shield')+'</span><div><strong>Publicação suspensa</strong><p>Cobranças estão desativadas. Crie e edite ofertas como rascunho; a publicação será liberada após verificação da operação.</p></div></div>':'';
 const pending=Number(catalogStatus?.missing||0);
 el('offers-info').innerHTML+=(pending>0?'<div class="surface ops-card"><div class="card-top"><strong>Catálogo da planilha</strong>'+label(['Faltam '+pending+' de 67','warn'])+'</div><p class="muted">63 Dev Kits e 4 sistemas ArtiSys. Importação preserva ofertas anteriores e mantém todas as novas como rascunho.</p><button class="secondary" type="button" id="import-catalog">Cadastrar ofertas faltantes</button></div>':'<div class="notice"><span>'+icon('package')+'</span><div><strong>Catálogo consolidado</strong><p>Os 67 itens da planilha constam no painel. Confira os dados e prepare as entregas antes de publicar.</p></div></div>');
 const ready=offerReadiness?.offers?.filter(x=>x.ready)||[];
 const draftSystems=offers.filter(x=>['obra-na-mao','pdv-artisys-restaurantes','pdv-nexus','artisys-sistema-financeiro'].includes(x.id));
 el('offers-info').innerHTML+='<section class="surface ops-card"><div class="card-top"><strong>Arquivos para entrega</strong>'+
  label([ready.length+' de '+offers.filter(x=>x.delivery_mode==='download').length+' downloads aprovados',ready.length?'info':'warn'])+'</div>'+
  '<p>Arquivos no R2 são verificados por SHA-256. Dev Kits também exigem conferência de licenças e documentação antes da venda.</p>'+
  (draftSystems.some(x=>!x.active&&x.delivery_mode==='manual')?'<button class="secondary" type="button" id="prepare-systems">Preparar downloads dos quatro sistemas</button>':'')+
  '</section>';
 el('offers-list').innerHTML=offers.length?'<div class="cards">'+offers.map(o=>'<article class="surface offer-card"><div class="card-top"><div class="offer-heading"><span class="offer-icon">'+icon('package')+'</span><div><strong>'+esc(o.name)+'</strong><div class="small">'+esc(saleName(o.sale_type))+' · '+esc(deliveryName(o.delivery_mode))+'</div></div></div>'+label(o.active?['Publicada','ok']:offerReadiness?.offers?.find(x=>x.id===o.id)?.ready?['Arquivo validado','ok']:['Rascunho',''])+'</div><div class="card-bottom"><span class="amount">'+money(o.price_cents)+'</span><button class="secondary" data-offer="'+esc(o.id)+'" type="button">Revisar →</button></div></article>').join('')+'</div>':empty('Seu catálogo começa aqui','Crie a primeira oferta. Ela ficará em rascunho até você revisar e publicar.','<button class="primary" type="button" data-new-offer>+ Nova oferta</button>');
 el('coupons-list').innerHTML=coupons.length?'<div class="surface ops-card">'+coupons.map(c=>'<div class="card-bottom" style="margin:0;padding:10px 0"><span><strong>'+esc(c.code)+'</strong><span class="small"> · '+esc(c.percent_off)+'% de desconto</span></span>'+label(c.active?['Ativo','ok']:['Inativo',''])+'</div>').join('')+'</div>':empty('Nenhum cupom cadastrado','Se precisar de uma promoção, crie um cupom para calcular o desconto no servidor.');
}
function renderMore(){
 const h=health||{};
 el('integrations-content').innerHTML='<div class="notice"><span>'+icon('shield')+'</span><div><strong>Asaas: '+(h.gatewayConfigured?'Chave cadastrada':'Chave ausente')+'</strong><p>'+ (h.gatewayConfigured?'A presença da chave não confirma autenticação. Ainda é necessário testar a integração financeira.':'Cadastre ASAAS_API_KEY como segredo no Worker.')+'</p></div></div>'+
 '<div class="surface ops-card"><div class="card-top"><strong>Condições para venda</strong>'+label(paymentsOnline()?['Checkout habilitado','ok']:['Checkout desativado','warn'])+'</div><div class="data-list"><div><dt>Worker e D1</dt><dd>Conectados</dd></div><div><dt>Credencial do Asaas</dt><dd>'+esc(h.gatewayConfigured?'Cadastrada':'Não configurada')+'</dd></div><div><dt>Autenticação no Asaas</dt><dd>Não verificada pelo painel</dd></div><div><dt>Recebimento do webhook</dt><dd>Verifique os eventos abaixo</dd></div></div><p class="muted">Para alterar secrets ou liberar pagamentos, use as configurações do Cloudflare. O painel não exibe credenciais privadas.</p></div>'+
 '<div class="surface ops-card"><div class="card-top"><strong>Diagnóstico da integração Asaas</strong><button type="button" id="diagnose-asaas" class="secondary">Verificar agora</button></div><p class="muted">Consulta apenas dados de leitura no Asaas. Nenhuma cobrança será criada e nenhuma chave aparecerá nesta página.</p><div id="asaas-diagnostic" aria-live="polite">'+empty('Ainda não verificado','Toque em Verificar agora para autenticar a API e conferir o webhook ativo.')+'</div></div>'+
 '<div class="surface ops-card"><strong>Conectores de produtos</strong>'+ (integrations.length?integrations.map(x=>'<div class="card-bottom"><span class="small">'+esc(x.productId)+'</span>'+label(x.configured?['Configurado','ok']:['Incompleto','warn'])+'</div>').join(''):'<p class="muted">Nenhum conector cadastrado. Entrega manual continua disponível.</p>')+'</div>';
 el('events-content').innerHTML=events.length?events.map(x=>'<div class="surface ops-card"><div class="card-top"><strong>'+esc(x.event_type)+'</strong>'+label(x.status==='processed'?['Processado','ok']:x.status==='failed'?['Falhou','error']:['Pendente','warn'])+'</div><div class="small">'+esc(x.id)+'</div>'+ (x.last_error?'<p class="muted">Motivo técnico: '+esc(x.last_error)+'</p>':'')+'<div class="card-bottom"><span class="small">'+esc(date(x.received_at))+'</span>'+(x.status==='failed'?'<button class="secondary" type="button" data-replay="events" data-id="'+esc(x.id)+'">Reprocessar</button>':'')+'</div></div>').join(''):empty('Nenhum evento registrado','Quando o Asaas enviar um evento autenticado, ele aparecerá aqui. Não faça compras reais apenas para preencher esta lista.');
 el('fulfillments-content').innerHTML=fulfillments.length?fulfillments.map(x=>'<div class="surface ops-card"><div class="card-top"><strong>Pedido '+esc(x.order_id.slice(0,8))+'</strong>'+label(x.status==='delivered'?['Concluída','ok']:x.status==='failed'?['Falhou','error']:['Pendente','warn'])+'</div><div class="small">Ação: '+esc(x.action)+'</div>'+(x.last_error?'<p class="muted">'+esc(x.last_error)+'</p>':'')+'<div class="card-bottom"><span class="small">'+esc(date(x.updated_at))+'</span>'+(x.status==='failed'?'<button class="secondary" type="button" data-replay="fulfillments" data-id="'+esc(x.id)+'">Reprocessar</button>':'')+'</div></div>').join(''):empty('Fila de entregas vazia','Os pedidos pagos que precisam de entrega aparecerão aqui.');
}

const diagnosticCodes={
 authenticated:'Autenticada',unauthorized:'Chave recusada (401)',forbidden:'Sem permissão (403)',
 bad_request:'Requisição inválida (400)',not_found:'Endpoint não encontrado (404)',unprocessable:'Dados rejeitados (422)',
 provider_unavailable:'Asaas indisponível',provider_http_error:'Erro HTTP do Asaas',
 rate_limited:'Limite de consultas (429)',key_missing:'Chave ausente',invalid_api_host:'Host de API inválido',
 invalid_public_base_url:'PUBLIC_BASE_URL inválida',not_checked:'Não verificado',
 duplicate:'Mais de um webhook com a mesma URL',found:'Webhook localizado'
};
const diagnosticState=(ok,yes,no)=>label(ok?[yes,'ok']:[no,'warn']);
function renderAsaasDiagnostic(d){
 const hook=d.webhook||{},events=(hook.missingEvents||[]);
 const apiReason=diagnosticCodes[d.apiStatus]||(d.apiHttpCode?'Erro HTTP '+d.apiHttpCode:'Não confirmada');
 const webhookReason=hook.status==='not_found'?'Webhook não encontrado':diagnosticCodes[hook.status]||'Não verificado';
 const rows=[
  ['Ambiente',diagnosticState(d.environment==='production','Produção','Não é produção')],
  ['Autenticação na API',diagnosticState(d.apiAuthenticated,'Autenticada',apiReason)],
  ['Webhook com URL correta',diagnosticState(hook.urlMatches,'Confirmada',webhookReason)],
  ['Webhook ativo',diagnosticState(hook.enabled===true,'Ativo',hook.found?'Inativo':'Não verificado')],
  ['Fila de envio',diagnosticState(hook.interrupted===false&&hook.found,'Sem interrupção',hook.found?'Interrompida':'Não verificada')],
  ['Eventos do checkout',diagnosticState(hook.eventsConfigured,'Configurados',hook.found ? 'Faltando: '+events.length+' evento(s)' : 'Não verificados')],
  ['Token local de webhook',diagnosticState(d.webhookTokenConfigured,'Cadastrado','Ausente ou inválido')]
 ];
 const detail=rows.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+v+'</dd></div>').join('');
 const overall=d.configurationReady
  ?'<p class="notice" style="margin-top:12px"><strong>Configuração consistente nas consultas de leitura.</strong> Ainda é necessário provar a chegada de um evento autenticado, a conciliação de pagamento e a entrega antes de liberar vendas.</p>'
  :'<div class="warning-note">Há pendências de configuração ou de permissão. Confira as linhas acima antes de liberar cobranças.</div>';
 const missingDetails=hook.found&&events.length?'<p class="muted" style="overflow-wrap:anywhere">Eventos faltantes: '+esc(events.join(', '))+'</p>':'';
 el('asaas-diagnostic').innerHTML='<dl class="data-list">'+detail+'</dl>'+missingDetails+overall+'<p class="muted">O token do Asaas ainda não foi comparado ao token local. Pagamento e entrega não homologados. PAYMENTS_ENABLED não foi alterado.</p>';
}
async function checkAsaas(button){
 if(button.disabled)return;
 button.disabled=true;const text=button.textContent;button.textContent='Verificando…';
 const area=el('asaas-diagnostic');area.innerHTML='<div class="loading">Consultando endpoints de leitura no Asaas…</div>';
 try{renderAsaasDiagnostic(await api('asaas/diagnostic'));}
 catch(e){area.innerHTML=empty('Diagnóstico indisponível',translateError(e));showError(e,'Asaas');}
 finally{button.disabled=false;button.textContent=text;}
}

function openModal(title,body){
 if(el('modal-backdrop').hidden)lastFocus=document.activeElement;
 modalMode=title;el('modal-title').textContent=title;el('modal-content').innerHTML=body;
 el('modal-backdrop').hidden=false;document.body.classList.add('modal-open');
 el('close-modal').focus();
}
function closeModal(){el('modal-backdrop').hidden=true;document.body.classList.remove('modal-open');busy=false;lastFocus?.focus();}
function orderActions(o){
 const out=[];
 if(o.paymentProvider==='manual_pix'&&o.status==='pending')out.push('<button class="primary full" data-op="confirm-manual" data-id="'+esc(o.id)+'" type="button">Confirmar recebimento do Pix manual</button>');
 if(o.fulfillmentStatus==='awaiting_manual'&&o.status==='paid')out.push('<button class="primary full" data-op="deliver-manual" data-id="'+esc(o.id)+'" type="button">Confirmar entrega manual</button>');
 if(o.paymentProvider==='asaas'&&o.checkoutState==='verifying')out.push('<button class="secondary full" data-op="reconcile" data-id="'+esc(o.id)+'" type="button">Consultar pagamento no Asaas</button>');
 if(o.status==='paid')out.push('<button class="secondary full" data-rotate-access="'+esc(o.id)+'" type="button">Reemitir código de acesso ao comprador</button>');
 return out.join('<div class="section-divider"></div>');
}
function openOrder(id){
 const o=orders.find(x=>x.id===id);if(!o)return;
 openModal('Detalhes do pedido','<span class="eyebrow">Pedido '+esc(o.id.slice(0,8))+'</span><h2>'+esc(o.customerName||o.customerEmail||'Cliente')+'</h2><p>'+esc(o.customerEmail||'')+'</p>'+
 '<dl class="data-list"><div><dt>Produto</dt><dd>'+esc(o.productId)+'</dd></div><div><dt>Valor</dt><dd>'+money(o.amountCents)+'</dd></div><div><dt>Pagamento</dt><dd>'+label(paymentLabel(o.status))+'</dd></div><div><dt>Entrega</dt><dd>'+label(deliveryLabel(o.fulfillmentStatus))+'</dd></div><div><dt>Provedor</dt><dd>'+esc(o.paymentProvider||'Não selecionado')+'</dd></div><div><dt>Criado em</dt><dd>'+esc(date(o.createdAt))+'</dd></div></dl>'+
 (o.status==='paid'&&o.fulfillmentStatus!=='delivered'?'<div class="warning-note">Pagamento confirmado, mas entrega ainda não concluída. Não informe ao cliente que recebeu o produto.</div>':'')+orderActions(o));
}
async function withBusy(button,job){
 if(busy)return;
 busy=true;button.disabled=true;
 try{await job();}catch(e){showError(e,'Operação não concluída');}
 finally{busy=false;button.disabled=false;}
}
function confirmAction(title,text,action,kind='orders'){
 const html='<p>'+esc(text)+'</p><div class="warning-note">Esta ação altera o registro do pedido. Confirme somente após conferir os dados.</div><div class="form-actions"><button class="secondary" type="button" data-close>Voltar</button><button class="primary" type="button" data-confirm-action>Confirmar ação</button></div>';
 openModal(title,html);
 el('modal-content').querySelector('[data-confirm-action]').addEventListener('click',async e=>withBusy(e.currentTarget,async()=>{
  await api(kind+'/'+encodeURIComponent(action.id)+'/'+action.type,'POST',{});
  closeModal();toast('Operação confirmada no servidor.');await load(action.after||'pedidos');
 }));
}
function prepareSystems(){
 openModal('Preparar downloads','<p>Configurar os quatro sistemas como downloads protegidos, preservando preços, pedidos e status de rascunho.</p>'+
  '<p>Nenhuma cobrança ou oferta será ativada.</p><div class="form-actions"><button class="secondary" data-close>Cancelar</button>'+
  '<button id="confirm-prepare" class="primary" type="button">Preparar quatro sistemas</button></div>');
 el('confirm-prepare').addEventListener('click',async e=>withBusy(e.currentTarget,async()=>{
  const r=await api('prepare-download-offers','POST',{});
  closeModal();toast('Preparação concluída: '+r.results.filter(x=>x.updated).length+' oferta(s) ajustada(s).');
  await load('ofertas');
 }));
}
function licenseReview(file){
 const slug=file.replace(/-v[0-9]+\\.[0-9]+\\.[0-9]+\\.zip$/,'');
 const href='https://github.com/nutricionistaalmeidavh-spec/DevKitTools/tree/main/kits/'+encodeURIComponent(slug);
 openModal('Conferência comercial do Dev Kit','<p><strong>'+esc(file)+'</strong></p>'+
  '<p>Antes de homologar, confira titularidade do código, dependências de terceiros, atribuições, termos comerciais e documentação.</p>'+
  '<p><a href="'+href+'" target="_blank" rel="noopener noreferrer">Abrir documentação e licenças deste kit no GitHub</a></p>'+
  '<form id="license-form" class="form-stack"><label><input type="checkbox" name="licenses" required> Conferi licenças, direitos de distribuição e NOTICEs</label>'+
  '<label><input type="checkbox" name="documentation" required> Conferi documentação e conteúdo entregue</label>'+
  '<label>Digite a confirmação <strong>CONFIRMO LICENCAS E DOCUMENTACAO</strong><input name="confirm" required autocomplete="off"></label>'+
  '<div class="form-actions"><button class="secondary" data-close type="button">Cancelar</button>'+
  '<button class="primary" type="submit">Registrar revisão (sem publicar)</button></div></form>');
 el('license-form').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  await withBusy(form.querySelector('[type="submit"]'),async()=>{
   await api('review-devkit-license','POST',{artifactName:file,approved:true,licensesChecked:d.has('licenses'),
    documentationChecked:d.has('documentation'),confirm:String(d.get('confirm')||'')});
   closeModal();toast('Revisão registrada. Oferta continua como rascunho.');await load('ofertas');
  });
 });
}
function rotateAccess(orderId){
 const order=orders.find(x=>x.id===orderId);if(!order||order.status!=='paid')return;
 openModal('Reemitir código de acesso','<p>Esta operação invalida o código anterior e gera um novo. Verifique a identidade do comprador por um canal confiável antes de enviá-lo.</p>'+
 '<div class="form-actions"><button class="secondary" data-close type="button">Cancelar</button>'+
 '<button id="confirm-rotate" class="primary" type="button">Gerar novo código</button></div>');
 el('confirm-rotate').addEventListener('click',async e=>withBusy(e.currentTarget,async()=>{
  const r=await api('orders/'+encodeURIComponent(orderId)+'/rotate-access','POST',{});
  openModal('Novo código — exibido uma única vez','<p>Pedido: '+esc(r.orderId)+'</p>'+
   '<p>Envie somente após confirmar a identidade do comprador. Código anterior invalidado.</p>'+
   '<code style="overflow-wrap:anywhere">'+esc(r.orderAccessToken)+'</code>'+
   '<div class="form-actions"><button id="copy-rotated" class="secondary" type="button">Copiar código</button>'+
   '<button data-close class="primary" type="button">Concluir</button></div>');
  el('copy-rotated').addEventListener('click',async e=>{
   try{await navigator.clipboard.writeText(r.orderAccessToken);e.currentTarget.textContent='Copiado';}
   catch{showError(Error('Copie o código exibido manualmente.'));}
  });
 }));
}
function openOffer(id){
 const o=offers.find(x=>x.id===id);if(!o)return;
 const block=publicationBlock(o);
 openModal('Revisar oferta','<span class="eyebrow">'+(o.active?'Publicada':'Rascunho')+'</span><h2>'+esc(o.name)+'</h2><dl class="data-list"><div><dt>Produto</dt><dd>'+esc(o.product_id)+'</dd></div><div><dt>Preço</dt><dd>'+money(o.price_cents)+'</dd></div><div><dt>Modalidade</dt><dd>'+esc(saleName(o.sale_type))+'</dd></div><div><dt>Entrega</dt><dd>'+esc(deliveryName(o.delivery_mode))+'</dd></div></dl>'+
 (offerReadiness?.offers?.find(x=>x.id===o.id)?.variants?.length?'<div class="surface ops-card">'+
   offerReadiness.offers.find(x=>x.id===o.id).variants.map(x=>'<p><strong>'+esc(x.platform)+'</strong> · '+esc(x.artifactName)+' · '+
    (x.ready?'Validado para entrega':x.verified?(x.outdated?'Versão desatualizada':x.legalApproved?'Aguardando':'Licenciamento pendente'):'Arquivo não verificado')+'</p>').join('')+'</div>':'')+
 (!o.active?(block?'<div class="warning-note">'+esc(block)+'</div>':'<p class="muted">Revise preço e entrega antes de publicar.</p>'):'<p class="muted">Esta oferta está publicada. Edite com atenção para futuras compras.</p>')+
 ((!o.active&&offerReadiness?.offers?.find(x=>x.id===o.id)?.variants?.length===1&&
     offerReadiness.offers.find(x=>x.id===o.id).variants[0].verified&&
     !offerReadiness.offers.find(x=>x.id===o.id).variants[0].legalApproved&&
     !offerReadiness.offers.find(x=>x.id===o.id).variants[0].outdated)
   ?'<p><button class="secondary" type="button" data-review-license="'+esc(offerReadiness.offers.find(x=>x.id===o.id).variants[0].artifactName)+'">Revisar licenças e documentação</button></p>':'')+
 '<div class="form-actions"><button class="secondary" type="button" data-edit-offer="'+esc(o.id)+'">Editar</button>'+
 (!o.active?'<button class="primary" type="button" data-publish="'+esc(o.id)+'" '+(block?'disabled title="'+esc(block)+'"':'')+'>Publicar oferta</button>':'<button class="secondary" type="button" data-unpublish="'+esc(o.id)+'">Retirar do catálogo</button>')+'</div>');
}
function publicationBlock(o){
 if(!paymentsOnline())return 'A publicação requer que PAYMENTS_ENABLED esteja ativo após a validação financeira.';
 if(!(offerReadiness?.asaasConfigured||offerReadiness?.manualPixConfigured))return 'Configure o Asaas ou o Pix manual antes de publicar.';
 if(o.delivery_mode==='webhook'&&!integrations.some(i=>i.productId===o.product_id&&i.configured))return 'O conector deste produto ainda não está configurado.';
 if(o.delivery_mode==='download'){
  const status=offerReadiness?.offers?.find(x=>x.id===o.id);
  if(!status?.ready)return 'Arquivo ou licenças pendentes: '+(status?.reason||'ainda não verificado')+'.';
 }
 return '';
}
const valuesFromOffer=o=>o?{id:o.id,productId:o.product_id,name:o.name,description:o.description||'',price:(o.price_cents/100).toFixed(2),saleType:o.sale_type,deliveryMode:o.delivery_mode,artifactName:o.artifact_name||'',active:!!o.active}: {id:'',productId:'',name:'',description:'',price:'',saleType:'one_time',deliveryMode:'manual',artifactName:'',active:false};
let step=1;
function offerWizard(id=''){
 offerDraft=valuesFromOffer(offers.find(x=>x.id===id));step=1;renderWizard();
}
const field=(label,name,value,type='text',extra='')=>'<div class="field"><label for="field-'+name+'">'+esc(label)+'</label><input id="field-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></div>';
const option=(x,label,selected)=>'<option value="'+x+'" '+(x===selected?'selected':'')+'>'+label+'</option>';
function renderWizard(){
 const d=offerDraft,edit=!!offers.find(x=>x.id===d.id);let content='<p class="stepper">Etapa '+step+' de 3 · '+(['','Produto e valor','Forma de entrega','Revisar e salvar'][step])+'</p>';
 if(step===1){
  content+='<form id="wizard-form" class="form-stack">'+field('ID da oferta', 'id',d.id,'text','required pattern="[a-z0-9][a-z0-9_.-]{2,79}" '+(edit?'readonly':'')+' placeholder="pdv-padrao"')+field('ID do produto','productId',d.productId,'text','required pattern="[a-z0-9][a-z0-9_.-]{2,79}"')+field('Nome da oferta','name',d.name,'text','required maxlength="140"')+field('Preço (R$)','price',d.price,'number','required min="0.01" max="1000000" step="0.01"')+field('Descrição','description',d.description,'text','maxlength="500"')+
   '<div class="field"><label for="field-saleType">Modalidade de venda</label><select id="field-saleType" name="saleType">'+option('one_time','Pagamento único',d.saleType)+option('monthly','Assinatura mensal',d.saleType)+option('yearly','Assinatura anual',d.saleType)+'</select></div><div class="form-actions"><button type="button" class="secondary" data-close>Cancelar</button><button class="primary" type="submit">Próximo →</button></div></form>';
 }else if(step===2){
  content+='<form id="wizard-form" class="form-stack"><div class="field"><label for="field-deliveryMode">Como o produto será entregue?</label><select name="deliveryMode" id="field-deliveryMode">'+option('manual','Conferência e entrega manual',d.deliveryMode)+option('download','Download protegido no R2',d.deliveryMode)+option('webhook','Ativar pelo conector do sistema',d.deliveryMode)+'</select><small class="field-hint">Pagamento aprovado não significa que a entrega foi concluída.</small></div>'+field('Nome do arquivo (somente download)','artifactName',d.artifactName,'text','placeholder="instalador.exe" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,120}"')+'<div class="form-actions"><button type="button" class="secondary" data-wizard-back>Voltar</button><button class="primary" type="submit">Revisar →</button></div></form>';
 }else{
  content+='<dl class="data-list"><div><dt>Oferta</dt><dd>'+esc(d.name)+'</dd></div><div><dt>Preço</dt><dd>'+money(Math.round(Number(d.price)*100))+'</dd></div><div><dt>Modalidade</dt><dd>'+esc(saleName(d.saleType))+'</dd></div><div><dt>Entrega</dt><dd>'+esc(deliveryName(d.deliveryMode))+'</dd></div><div><dt>Ao salvar</dt><dd>'+esc(d.active?'Mantém status atual':'Rascunho')+'</dd></div></dl><div class="warning-note">'+(d.active?'Editar uma oferta publicada afeta novas compras. Confira valor e modalidade.':'A nova oferta será salva como rascunho, sem liberar vendas automaticamente.')+'</div><div class="form-actions"><button class="secondary" type="button" data-wizard-back>Voltar</button><button class="primary" type="button" data-save-offer>Revisar e salvar</button></div>';
 }
 openModal(edit?'Editar oferta':'Nova oferta',content);
 const form=el('wizard-form');
 if(form)form.addEventListener('submit',e=>{e.preventDefault();wizardNext(form);});
}
function wizardNext(form){
 if(!form.reportValidity())return;
 const data=new FormData(form);
 if(step===1){
  for(const k of ['id','productId','name','price','description','saleType'])offerDraft[k]=String(data.get(k)||'').trim();
  const cents=Math.round(Number(offerDraft.price)*100);
  if(!Number.isSafeInteger(cents)||cents<1||cents>100000000){showError(Error('invalid_offer'));return;}
 }else if(step===2){
  offerDraft.deliveryMode=String(data.get('deliveryMode')||'manual');
  offerDraft.artifactName=String(data.get('artifactName')||'').trim();
  if(offerDraft.deliveryMode==='download'&&!offerDraft.artifactName){showError(Error('Informe o nome do arquivo para download.'));return;}
 }
 step++;clearError();renderWizard();
}
async function saveOffer(button){
 await withBusy(button,async()=>{
  const d=offerDraft;
  await api('offers','POST',{id:d.id,productId:d.productId,name:d.name,description:d.description,priceCents:Math.round(Number(d.price)*100),saleType:d.saleType,deliveryMode:d.deliveryMode,artifactName:d.artifactName||null,active:d.active===true});
  closeModal();toast(d.active?'Alterações salvas no servidor.':'Oferta salva como rascunho.');await load('ofertas');
 });
}
function changePublication(id,active){
 const o=offers.find(x=>x.id===id);if(!o)return;
 if(active){const reason=publicationBlock(o);if(reason){showError(Error(reason));return;}}
 const action=active?'Publicar oferta':'Retirar do catálogo';
 openModal(action,'<h3>'+esc(o.name)+'</h3><p>'+(active?'Após publicar, a oferta ficará visível no catálogo público, e clientes poderão criar pedidos.':'A oferta deixará de aparecer no catálogo público; pedidos existentes permanecem registrados.')+'</p><div class="form-actions"><button class="secondary" type="button" data-close>Voltar</button><button class="primary" id="confirm-publication" type="button">'+action+'</button></div>');
 el('confirm-publication').addEventListener('click',async e=>withBusy(e.currentTarget,async()=>{
  await api('offers','POST',{id:o.id,productId:o.product_id,name:o.name,description:o.description,priceCents:o.price_cents,saleType:o.sale_type,deliveryMode:o.delivery_mode,artifactName:o.artifact_name,active});
  closeModal();toast(active?'Oferta publicada no catálogo.':'Oferta retirada do catálogo.');await load('ofertas');
 }));
}
function openCoupon(){
 openModal('Novo cupom','<p>O desconto será calculado no servidor quando o cliente criar um pedido.</p><form id="coupon-form" class="form-stack">'+field('Código','code','','text','required pattern="[A-Za-z0-9_-]{3,30}"')+field('Desconto (%)','percentOff','','number','required min="1" max="90" step="1"')+'<div class="form-actions"><button class="secondary" type="button" data-close>Cancelar</button><button class="primary" type="submit">Salvar cupom</button></div></form>');
 const form=el('coupon-form');
 if(form)form.addEventListener('submit',e=>{e.preventDefault();saveCoupon(form);});
}

async function saveCoupon(form){
 const d=new FormData(form),button=form.querySelector('button[type="submit"]');
 await withBusy(button,async()=>{
  await api('coupons','POST',{code:String(d.get('code')||'').toUpperCase().trim(),percentOff:Number(d.get('percentOff')),active:true});
  closeModal();toast('Cupom salvo no servidor.');await load('ofertas');
 });
}
el('login-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=el('login-button'),candidate=new FormData(e.currentTarget).get('token');token=String(candidate||'').trim();button.disabled=true;el('login-error').textContent='';
 try{await api('summary');sessionStorage.setItem(key,token);signedIn(true);const param=new URLSearchParams(location.search).get('screen');navigate(validScreens.includes(param)?param:'inicio',true);}
 catch(err){token='';el('login-error').textContent='Não foi possível entrar. Confira o token e a configuração do servidor.';}
 finally{button.disabled=false;}
});
el('logout').addEventListener('click',()=>{sessionStorage.removeItem(key);token='';signedIn(false);closeModal();el('admin-token').value='';el('admin-token').focus();});
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button)return;
 if(button.dataset.screen){navigate(button.dataset.screen);return;}
 if(button.dataset.go){navigate(button.dataset.go);return;}
 if(button.hasAttribute('data-refresh')){load();return;}
 if(button.dataset.filter){filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{const on=b===button;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});renderOrders();return;}
 if(button.dataset.order){openOrder(button.dataset.order);return;}
 if(button.dataset.offer){openOffer(button.dataset.offer);return;}
 if(button.id==='import-catalog'){importCatalog();return;}
 if(button.id==='prepare-systems'){prepareSystems();return;}
 if(button.dataset.reviewLicense){licenseReview(button.dataset.reviewLicense);return;}
 if(button.dataset.rotateAccess){rotateAccess(button.dataset.rotateAccess);return;}
 if(button.id==='new-offer'||button.hasAttribute('data-new-offer')){offerWizard();return;}
 if(button.dataset.editOffer!==undefined){offerWizard(button.dataset.editOffer);return;}
 if(button.dataset.publish!==undefined){changePublication(button.dataset.publish,true);return;}
 if(button.dataset.unpublish!==undefined){changePublication(button.dataset.unpublish,false);return;}
 if(button.id==='diagnose-asaas'){checkAsaas(button);return;}
 if(button.dataset.releaseUpload){const item=availableReleases.find(x=>x.id===button.dataset.releaseUpload);if(item){selectedRelease=item;el('release-file-input').value='';el('release-file-input').click();}return;}
 if(button.id==='new-coupon'){openCoupon();return;}
 if(button.hasAttribute('data-close')){closeModal();return;}
 if(button.hasAttribute('data-wizard-back')){step=Math.max(1,step-1);renderWizard();return;}
 if(button.hasAttribute('data-save-offer')){saveOffer(button);return;}
 if(button.dataset.op){
  const order=orders.find(x=>x.id===button.dataset.id);if(!order)return;
  const op=button.dataset.op;
  const title=op==='confirm-manual'?'Confirmar Pix recebido?':op==='deliver-manual'?'Confirmar entrega realizada?':'Consultar pagamento no Asaas?';
  const text=op==='confirm-manual'?'Só confirme após localizar o crédito na conta bancária. Um comprovante enviado pelo cliente não é confirmação.':op==='deliver-manual'?'Confirme somente se o produto ou a licença foi efetivamente entregue.':'A consulta não cria cobrança. O pedido somente será pago se o provedor confirmar.';
  confirmAction(title,'Pedido '+order.id.slice(0,8)+'. '+text,{id:order.id,type:op,after:'pedidos'});return;
 }
 if(button.dataset.replay){
  confirmAction('Reprocessar evento?','Isso solicitará nova tentativa do item selecionado. Um evento não verificado não confirma pagamentos.',{id:button.dataset.id,type:'replay',after:'mais'},button.dataset.replay);return;
 }
});
el('order-search').addEventListener('input',renderOrders);
el('release-file-input').addEventListener('change',async e=>{const file=e.target.files?.[0],item=selectedRelease;if(file&&item)await uploadRelease(file,item);});
el('modal-backdrop').addEventListener('click',e=>{if(e.target===el('modal-backdrop'))closeModal();});
el('close-modal').addEventListener('click',closeModal);
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!el('modal-backdrop').hidden){closeModal();return;}
 if(e.key==='Tab'&&!el('modal-backdrop').hidden){
  const choices=[...el('modal-backdrop').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(x=>x.offsetParent!==null);
  const first=choices[0],last=choices[choices.length-1];
  if(!first){e.preventDefault();return;}
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
});

window.addEventListener('popstate',()=>{if(token){const param=new URLSearchParams(location.search).get('screen');if(validScreens.includes(param))navigate(param,true);}});
if(token){api('summary').then(()=>{signedIn(true);const param=new URLSearchParams(location.search).get('screen');navigate(validScreens.includes(param)?param:'inicio',true);}).catch(()=>{sessionStorage.removeItem(key);token='';signedIn(false);});}else signedIn(false);
