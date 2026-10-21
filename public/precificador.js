import {PRESETS,quoteDefaults,cleanQuote,calculateQuote,proposalText} from '/assets/precificador-engine.js';

const $=id=>document.getElementById(id);
const STORE='artisys-precificador-quotes-v1';
const TOKEN_STORE='artisys-payment-admin';
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n||0);
const decimal=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n||0);
const text=(id,value)=>{$(id).textContent=value;};
const priceFields=['hourlyCost','extraCosts','riskPct','taxesPct','marginPct','discountPct','monthlySupport','deliveryDays','hoursSavedPerMonth','clientHourValue'];
const textFields=['client','contact','project','scope','notes'];
let quote=quoteDefaults(),currentId=null,dirty=false,lastEstimate=null;
let diagnosis={sources:1,quality:1,update:1,users:1};
let saved=[];

function announce(message){
 const target=$('notice');target.textContent=message;target.hidden=false;
 clearTimeout(announce.timeout);announce.timeout=setTimeout(()=>{target.hidden=true},3500);
}
function clearAlert(){const target=$('alerts');target.replaceChildren()}
function addAlert(message,severity='warning'){
 const item=document.createElement('div');item.className='alert '+(severity==='error'?'error':'');
 item.textContent=message;$('alerts').append(item);
}
function loadSaved(){
 try{
  const data=JSON.parse(localStorage.getItem(STORE)||'[]');
  saved=Array.isArray(data)?data.filter(item=>item&&typeof item==='object'&&typeof item.id==='string').slice(0,30):[];
 }catch{saved=[]}
 text('saved-count',String(saved.length));
}
function persist(){
 try{localStorage.setItem(STORE,JSON.stringify(saved));return true}
 catch{announce('Este navegador não permitiu salvar os orçamentos. Exporte o JSON.');return false}
}
function refreshForm(){
 for(const id of [...textFields,...priceFields])$(id).value=quote[id]??'';
 $('preset').value=quote.preset;
 renderActivities();renderEstimate();
}
function renderActivities(){
 const target=$('activities');target.replaceChildren();
 quote.activities.forEach((activity,index)=>{
  const row=document.createElement('div');row.className='activity';
  const name=document.createElement('input');name.className='activity-name';name.type='text';name.maxLength=90;
  name.value=activity.name;name.placeholder='Nome da etapa';name.setAttribute('aria-label','Nome da etapa '+(index+1));
  name.addEventListener('input',()=>{activity.name=name.value;markDirty();renderEstimate()});
  const hours=document.createElement('input');hours.className='activity-hours';hours.type='number';hours.min='0';hours.max='10000';hours.step='.5';
  hours.value=activity.hours;hours.setAttribute('aria-label','Horas da etapa '+(index+1));
  hours.addEventListener('input',()=>{activity.hours=hours.value===''?0:Number(hours.value);markDirty();renderEstimate()});
  const remove=document.createElement('button');remove.className='remove-activity';remove.type='button';remove.textContent='×';remove.title='Excluir etapa';remove.setAttribute('aria-label','Excluir etapa '+(index+1));
  remove.addEventListener('click',()=>{quote.activities.splice(index,1);markDirty();renderActivities();renderEstimate()});
  row.append(name,hours,remove);target.append(row);
 });
}
function diagnosisScore(){return Object.values(diagnosis).reduce((a,b)=>a+b,0)}
function renderDiagnosis(){
 const score=diagnosisScore(),title=score<=5?'Simples':score<=8?'Intermediário':'Complexo';
 const risk=score<=5?10:score<=8?20:35;
 text('diag-label',title+' · '+score+'/12');
 text('diag-description','Reserva sugerida: '+risk+'%. Confirme riscos de integração e qualidade dos arquivos. A sugestão não altera seu preço automaticamente.');
 $('apply-risk').dataset.risk=String(risk);
}
function markDirty(){dirty=true}
function renderEstimate(){
 text('summary-client',quote.client||quote.project||'Projeto sob medida');
 clearAlert();
 let r;
 try{r=calculateQuote(quote)}
 catch(error){
  lastEstimate=null;
  text('final-price','—');text('profit','—');text('effective-margin','—');
  addAlert(error.message==='margin_sum'?'Tributos + margem devem somar menos de 100%.':'Revise os valores: há um campo inválido.','error');
  return;
 }
 lastEstimate=r;
 text('total-hours',decimal(r.hours));
 text('final-price',r.hasBasis?money(r.finalPrice):'—');
 text('direct-cost',money(r.directCost));text('reserve',money(r.reserve));text('break-even',money(r.breakEven));
 text('suggested-price',money(r.suggestedPrice));text('taxes',money(r.estimatedTaxes));text('profit',money(r.estimatedProfit));
 text('effective-margin',decimal(r.effectiveMargin)+'%');
 text('target-margin','Meta: '+decimal(quote.marginPct)+'% de margem líquida');
 $('margin-fill').style.width=Math.max(0,Math.min(100,r.effectiveMargin))+'%';
 $('margin-fill').style.background=r.effectiveMargin<0?'#cd6257':r.belowTarget?'#dba35f':'#97cc74';
 if(!r.hasBasis)addAlert('Informe horas e custo interno ou despesas para produzir uma estimativa.','error');
 else if(r.belowBreakEven)addAlert('Atenção: preço abaixo do ponto de equilíbrio. Você terá prejuízo estimado.','error');
 else if(r.belowTarget)addAlert('O desconto ou arredondamento deixou a margem abaixo da meta.');
 if(r.hours===0)addAlert('Nenhuma hora de execução foi estimada.');
 if(quote.taxesPct===0)addAlert('Alíquota zerada. Confirme com seu contador antes de fechar.');
 const extras=$('extras');extras.replaceChildren();
 if(r.monthlySupport>0)showExtra('Suporte opcional',money(r.monthlySupport)+'/mês');
 if(r.monthlyValue>0){
  showExtra('Economia de tempo estimada',money(r.monthlyValue)+'/mês');
  if(r.paybackMonths!==null)showExtra('Retorno estimado em',decimal(r.paybackMonths)+' meses');
 }
 function showExtra(label,value){
  const d=document.createElement('div');d.className='extra-row';
  const a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent=value;d.append(a,b);extras.append(d);
 }
}
function setTab(name){
 const editor=name==='editor';
 $('editor-view').hidden=!editor;$('saved-view').hidden=editor;
 $('tab-editor').classList.toggle('active',editor);$('tab-saved').classList.toggle('active',!editor);
 $('tab-editor').setAttribute('aria-selected',String(editor));$('tab-saved').setAttribute('aria-selected',String(!editor));
 if(!editor)renderSaved();
}
function saveQuote(){
 if(!lastEstimate||!lastEstimate.hasBasis){announce('Preencha o esforço e os custos antes de salvar.');return}
 const id=currentId||crypto.randomUUID(),now=new Date().toISOString();
 const record={id,updatedAt:now,quote:cleanQuote(quote),price:lastEstimate.finalPrice};
 saved=[record,...saved.filter(x=>x.id!==id)].slice(0,30);
 if(!persist())return;
 currentId=id;dirty=false;text('saved-count',String(saved.length));announce('Orçamento salvo neste navegador.');
}
function renderSaved(){
 const target=$('saved-list');target.replaceChildren();
 if(!saved.length){
  const item=document.createElement('div');item.className='empty-state';item.textContent='Nenhum orçamento salvo ainda. Monte uma estimativa e clique em Salvar orçamento.';target.append(item);return;
 }
 for(const item of saved){
  const record=document.createElement('div');record.className='saved-record';
  const details=document.createElement('div');
  const title=document.createElement('h3');title.textContent=(item.quote?.client||'Cliente não definido')+' · '+(item.quote?.project||'Projeto');
  const subt=document.createElement('p');
  subt.textContent=money(Number(item.price)||0)+'  ·  '+(Number.isNaN(Date.parse(item.updatedAt))?'':new Date(item.updatedAt).toLocaleDateString('pt-BR'));
  details.append(title,subt);
  const actions=document.createElement('div');actions.className='record-actions';
  const open=document.createElement('button');open.type='button';open.textContent='Abrir';
  open.addEventListener('click',()=>{
   if(dirty&&!confirm('Descartar alterações não salvas do orçamento atual?'))return;
   quote=cleanQuote(item.quote);currentId=item.id;dirty=false;refreshForm();setTab('editor');
   announce('Orçamento carregado.');
  });
  const remove=document.createElement('button');remove.type='button';remove.textContent='Excluir';remove.className='delete';
  remove.addEventListener('click',()=>{
   if(!confirm('Excluir este orçamento salvo?'))return;
   saved=saved.filter(x=>x.id!==item.id);if(currentId===item.id)currentId=null;
   persist();text('saved-count',String(saved.length));renderSaved();
  });
  actions.append(open,remove);record.append(details,actions);target.append(record);
 }
}
async function copyProposal(){
 if(!lastEstimate||!lastEstimate.hasBasis){announce('Preencha uma estimativa antes de copiar.');return}
 try{await navigator.clipboard.writeText(proposalText(quote,lastEstimate));announce('Proposta comercial copiada, sem os custos internos.')}
 catch{announce('Não foi possível copiar. Use Imprimir / PDF ou Exportar JSON.')}
}
function printProposal(){
 if(!lastEstimate||!lastEstimate.hasBasis){announce('Preencha uma estimativa antes de imprimir.');return}
 let printable=$('print-document');
 if(!printable){printable=document.createElement('pre');printable.id='print-document';document.querySelector('main').append(printable);}
 printable.textContent=proposalText(quote,lastEstimate);
 window.print();
}
function exportJson(){
 const payload={format:'artisys-precificador-v1',exportedAt:new Date().toISOString(),quote:cleanQuote(quote),estimate:lastEstimate};
 const filename='orcamento-artisys-'+(quote.client||'cliente').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/g,'-').slice(0,50)+'.json';
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=filename;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),5000);announce('Cópia JSON gerada. Guarde o arquivo com segurança.');
}
function bindUI(){
 [...textFields,...priceFields].forEach(id=>{
  $(id).addEventListener('input',()=>{
   quote[id]=priceFields.includes(id)?($(id).value===''?0:Number($(id).value)):$(id).value;
   markDirty();renderEstimate();
  });
 });
 $('preset').addEventListener('change',()=>{
  const preset=$('preset').value,defaults=quoteDefaults(preset);
  quote.preset=preset;quote.project=defaults.project;quote.activities=defaults.activities;
  $('project').value=quote.project;markDirty();renderActivities();renderEstimate();
 });
 $('add-activity').addEventListener('click',()=>{
  if(quote.activities.length>=24){announce('Limite de 24 etapas por orçamento.');return}
  quote.activities.push({name:'Nova etapa',hours:1});markDirty();renderActivities();renderEstimate();
  $('activities').lastElementChild?.querySelector('input')?.focus();
 });
 for(const [k,id] of Object.entries({sources:'diag-sources',quality:'diag-quality',update:'diag-update',users:'diag-users'})){
  $(id).addEventListener('change',()=>{diagnosis[k]=Number($(id).value);renderDiagnosis()});
 }
 $('apply-risk').addEventListener('click',()=>{
  quote.riskPct=Number($('apply-risk').dataset.risk);$('riskPct').value=quote.riskPct;markDirty();renderEstimate();announce('Reserva de risco aplicada ao cálculo.');
 });
 $('new-quote').addEventListener('click',()=>{
  if(dirty&&!confirm('Descartar alterações não salvas e iniciar novo orçamento?'))return;
  quote=quoteDefaults();currentId=null;dirty=false;
  diagnosis={sources:1,quality:1,update:1,users:1};
  for(const id of ['diag-sources','diag-quality','diag-update','diag-users'])$(id).value='1';
  renderDiagnosis();refreshForm();setTab('editor');announce('Novo orçamento iniciado.');
 });
 $('save-quote').addEventListener('click',saveQuote);
 $('tab-editor').addEventListener('click',()=>setTab('editor'));
 $('tab-saved').addEventListener('click',()=>setTab('saved'));
 $('copy-proposal').addEventListener('click',copyProposal);
 $('print-proposal').addEventListener('click',printProposal);
 $('export-json').addEventListener('click',exportJson);
 $('logout').addEventListener('click',()=>{sessionStorage.removeItem(TOKEN_STORE);location.reload()});
}
async function authorize(token){
 const response=await fetch('/v1/admin/summary',{method:'GET',headers:{authorization:'Bearer '+token,'cache-control':'no-store'},cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'Token administrativo inválido.':response.status===503?'A central ainda não está configurada ou disponível.':'Não foi possível validar o acesso.');
 sessionStorage.setItem(TOKEN_STORE,token);
 $('signin').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;
}
async function boot(){
 loadSaved();bindUI();renderDiagnosis();refreshForm();
 $('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const token=$('token').value.trim();if(!token)return;
  $('login-action').disabled=true;$('login-error').hidden=true;
  try{await authorize(token)}
  catch(e){$('login-error').textContent=e.message;$('login-error').hidden=false}
  finally{$('login-action').disabled=false}
 });
 const token=sessionStorage.getItem(TOKEN_STORE);
 if(token){try{await authorize(token)}catch{sessionStorage.removeItem(TOKEN_STORE)}}
}
boot();
