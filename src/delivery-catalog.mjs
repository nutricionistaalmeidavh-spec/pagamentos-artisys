import {SYSTEM_RELEASES} from './system-releases.mjs';
import {DEVKIT_RELEASES} from './devkit-releases.mjs';

export const SYSTEMS=new Map();
for(const item of SYSTEM_RELEASES){
 const list=SYSTEMS.get(item.offerId)||[];
 list.push(item);
 SYSTEMS.set(item.offerId,list);
}
export const SYSTEM_BY_ARTIFACT=new Map(SYSTEM_RELEASES.map(x=>[x.key.slice('releases/'.length),x]));
export const KITS_BY_ARTIFACT=new Map(DEVKIT_RELEASES.filter(x=>x.type==='kit').map(x=>[x.fileName,x]));

export const artifactForSystem=release=>release.key.slice('releases/'.length);
export const systemVariants=offerId=>(SYSTEMS.get(offerId)||[]).map(x=>({
 id:x.id,platform:x.platform,version:x.version,
 fileName:x.fileName,artifactName:artifactForSystem(x)
}));
export const defaultSystemVariant=offerId=>(SYSTEMS.get(offerId)||[])[0]||null;

export function resolveOrderArtifact(offer,variantId){
 const systems=SYSTEMS.get(offer.id);
 if(systems){
  if(offer.product_id!==offer.id)throw new Error('product_release_mismatch');
  if(systems.length>1&&!variantId)throw new Error('variant_required');
  const chosen=systems.find(x=>x.id===(variantId||systems[0].id));
  if(!chosen||chosen.outdated)throw new Error('invalid_variant');
  return {artifactName:artifactForSystem(chosen),release:chosen};
 }
 if(variantId)throw new Error('invalid_variant');
 const kit=KITS_BY_ARTIFACT.get(offer.artifact_name);
 if(kit&&kit.offerId===offer.id&&offer.product_id===offer.id)
  return {artifactName:kit.fileName,release:kit};
 throw new Error('unregistered_download');
}
export function artifactForPaidOrder(order){
 const system=SYSTEM_BY_ARTIFACT.get(order.artifact_name);
 if(system&&system.offerId===order.offer_id&&system.offerId===order.product_id)return system;
 const kit=KITS_BY_ARTIFACT.get(order.artifact_name);
 if(kit&&kit.offerId===order.offer_id&&kit.offerId===order.product_id)return kit;
 return null;
}
export function isDevkit(release){return typeof release?.sourceArtifactId==='number';}

export async function verifyStoredRelease(env,release){
 if(!release||!env.PAGAMENTO_ARTISYS_ARQUIVOS)
  return {verified:false,reason:'storage_not_configured'};
 let head=null;
 try{head=await env.PAGAMENTO_ARTISYS_ARQUIVOS.head(release.key);}
 catch{return {verified:false,reason:'storage_unavailable'};}
 if(!head)return {verified:false,reason:'artifact_missing'};
 const meta=head.customMetadata||{};
 if(isDevkit(release)){
  const verified=Number(head.size)>0&&Number(head.size)<=2*1024*1024
    &&/^[a-f0-9]{64}$/.test(meta.sha256||'')
    &&meta.sourceArtifactId===String(release.sourceArtifactId)
    &&meta.sourceCommit==='545fe21b125fc6c39b379437691d1ebf3c2abcfa'
    &&meta.fileName===release.fileName;
  return {verified,reason:verified?null:'devkit_provenance_mismatch',bytes:head.size};
 }
 const verified=Number(head.size)===release.size
   &&meta.sha256===release.sha256&&release.outdated!==true;
 return {verified,reason:verified?null:'system_integrity_mismatch',bytes:head.size};
}
export async function downloadReadiness(env,offer,approvedKits=new Set()){
 if(offer.delivery_mode!=='download')return {ready:false,reason:'delivery_not_download',variants:[]};
 let candidates;
 try{
  const systems=SYSTEMS.get(offer.id);
  candidates=systems?.length
   ? systems.map(release=>({release,artifactName:artifactForSystem(release)}))
   : [resolveOrderArtifact(offer,null)];
 }catch(e){return {ready:false,reason:e.message,variants:[]};}
 const variants=await Promise.all(candidates.map(async ({release,artifactName})=>{
  const result=await verifyStoredRelease(env,release);
  const legalApproved=!isDevkit(release)||approvedKits.has(artifactName);
  const ready=result.verified&&!release.outdated&&legalApproved;
  return {id:release.id||artifactName,platform:release.platform||'Código-fonte',version:release.version||null,
   artifactName,verified:result.verified,legalApproved,outdated:!!release.outdated,
   ready,reason:result.reason||(release.outdated?'release_outdated':!legalApproved?'license_review_pending':null)};
 }));
 return {ready:variants.length>0&&variants.every(x=>x.ready),variants,
   reason:variants.find(x=>!x.ready)?.reason||null};
}
