import {mkdirSync} from 'node:fs';
import {SYSTEM_RELEASES} from '../src/system-releases.mjs';
const seen=new Set();
if(SYSTEM_RELEASES.length!==8)throw Error('Esperados 8 instaladores das 4 ofertas');
for(const item of SYSTEM_RELEASES){
 if(seen.has(item.id)||seen.has(item.key))throw Error('ID ou chave R2 duplicado');
 seen.add(item.id);seen.add(item.key);
 if(!/^releases\/[a-z0-9A-Z_.-]+$/.test(item.key))throw Error('Chave R2 insegura: '+item.id);
 if(item.active||item.outdated)throw Error('Instalador desatualizado/ativo: '+item.id);
 if(!/^[0-9a-f]{64}$/.test(item.sha256||''))throw Error('SHA-256 ausente: '+item.id);
 if(!Number.isSafeInteger(item.size)||item.size<=0)throw Error('Tamanho inválido: '+item.id);
 if(!item.fileName||!item.key.endsWith(item.fileName))throw Error('Nome inconsistente: '+item.id);
 const allowedRepos={
  'obra-na-mao':'OBRANAMAOCOMERCIAL',
  'pdv-artisys-restaurantes':'PDV-ARTISYS',
  'pdv-nexus':'PDVNexus',
  'artisys-sistema-financeiro':'sistemafinanceiro'
 };
 const repository='nutricionistaalmeidavh-spec/'+allowedRepos[item.offerId];
 if(!allowedRepos[item.offerId]||item.sourceRepo!==repository)throw Error('Repositório incompatível com a oferta: '+item.id);
 const source=item.sourceUrl||'';
 if(item.source==='github-actions'){
  if(!/^https:\/\/github\.com\/nutricionistaalmeidavh-spec\/[A-Za-z0-9_-]+\/actions\/runs\/\d+\/artifacts\/\d+$/.test(source)||!source.startsWith('https://github.com/'+repository+'/'))throw Error('Artefato GitHub inválido');
 }else if(item.source==='github-release'){
  const prefix='https://github.com/'+repository+'/releases/download/';
  if(!source.startsWith(prefix)||!source.endsWith('/'+item.fileName)||!/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/releases\/download\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source))throw Error('Release GitHub inválida');
 }else throw Error('Fonte não permitida, use apenas GitHub');
}
if(new Set(SYSTEM_RELEASES.map(x=>x.offerId)).size!==4)throw Error('Esperados 4 sistemas distintos');
mkdirSync('.release-sync',{recursive:true});
process.stdout.write(JSON.stringify({schema:1,entries:SYSTEM_RELEASES.map(x=>({
 id:x.id,offerId:x.offerId,platform:x.platform,version:x.version,fileName:x.fileName,
 size:x.size,sha256:x.sha256,key:x.key,source:x.source,
 sourceRepo:x.sourceRepo,sourceUrl:x.sourceUrl
}))},null,2));
