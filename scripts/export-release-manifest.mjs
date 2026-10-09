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
 if(item.source==='github-actions'){
  if(!/^https:\/\/github\.com\/nutricionistaalmeidavh-spec\/OBRANAMAOCOMERCIAL\/actions\/runs\/\d+\/artifacts\/\d+$/.test(item.sourceUrl))throw Error('Fonte GitHub não verificada');
 }else if(!/^[A-Za-z0-9_-]{15,}$/.test(item.driveId||''))throw Error('ID do Drive inválido: '+item.id);
}
if(new Set(SYSTEM_RELEASES.map(x=>x.offerId)).size!==4)throw Error('Esperados 4 sistemas distintos');
mkdirSync('.release-sync',{recursive:true});
process.stdout.write(JSON.stringify({schema:1,entries:SYSTEM_RELEASES.map(x=>({
 id:x.id,offerId:x.offerId,platform:x.platform,version:x.version,fileName:x.fileName,
 size:x.size,sha256:x.sha256,key:x.key,source:x.source||'google-drive',
 sourceUrl:x.sourceUrl||null,driveId:x.driveId||null
}))},null,2));
