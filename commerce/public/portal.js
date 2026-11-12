const $=(id)=>document.getElementById(id);
const status=$('login-message');
const loginPanel=$('login-panel'),licencesPanel=$('licences-panel');
const safeLink=(value)=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:null}catch{return null}};
const label=(tag,text,cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e};
async function showLicences(){
  const response=await fetch('/v1/portal/licenses',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok){loginPanel.classList.remove('hidden');licencesPanel.classList.add('hidden');return}
  const data=await response.json();
  loginPanel.classList.add('hidden');licencesPanel.classList.remove('hidden');
  $('buyer-identity').textContent=data.email;
  const list=$('licences-list');list.replaceChildren();
  if(!data.licenses?.length){list.append(label('p','Nenhuma licença encontrada neste acesso.','muted'));return}
  for(const lic of data.licenses){
    const item=document.createElement('article');item.className='licence';
    const header=document.createElement('div');header.className='licence-head';
    header.append(label('h3',lic.sku),label('span',lic.status==='active'?'Licença registrada':'Revogada','state '+(lic.status==='active'?'active':'revoked')));
    item.append(header);
    const description=lic.activationStatus==='provisioned'?'Ativação confirmada no sistema original':
      lic.activationStatus==='awaiting_connector'?'Aguardando integração com o ativador do produto':
      lic.activationStatus==='revocation_pending'?'Revogação solicitada ao sistema original':lic.activationStatus;
    item.append(label('p',description,'muted'));
    const codeRow=document.createElement('div');codeRow.className='code-row';
    const ready=lic.activationStatus==='provisioned';
    const code=label('code',ready?(lic.activationCode||lic.code):'Aguardando ativação');codeRow.append(code);
    const copy=label('button','Copiar código','secondary');copy.type='button';
    copy.disabled=!ready;
    copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(lic.activationCode||lic.code);copy.textContent='Copiado'});
    codeRow.append(copy);item.append(codeRow);
    item.append(label('p','Canal: '+lic.source+' · Dispositivos previstos: '+lic.maxDevices,'muted compact'));
    const href=safeLink(lic.downloadUrl);
    if(href&&lic.status==='active'){const download=label('a','Baixar instalador','download');download.href=href;download.target='_blank';download.rel='noopener noreferrer';item.append(download)}
    list.append(item);
  }
}
$('login-form').addEventListener('submit',async(e)=>{
  e.preventDefault();status.textContent='Processando solicitação...';$('send-link').disabled=true;
  try{
    const response=await fetch('/v1/portal/request-access',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({email:$('buyer-email').value.trim()}),credentials:'same-origin'});
    const body=await response.json();
    status.textContent=response.ok?body.message:'Não foi possível concluir a solicitação.';
  }catch{status.textContent='Falha de conexão. Tente novamente.'}
  finally{$('send-link').disabled=false}
});
$('logout').addEventListener('click',async()=>{await fetch('/v1/portal/logout',{method:'POST',credentials:'same-origin'});window.location.href='/portal'});
if(new URLSearchParams(location.search).has('invalid'))status.textContent='Link inválido ou expirado. Solicite um novo acesso.';
showLicences().catch(()=>{status.textContent='Não foi possível consultar suas licenças.'});