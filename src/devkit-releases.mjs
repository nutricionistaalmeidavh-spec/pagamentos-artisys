import {CATALOG_DRAFTS} from './catalog-drafts.mjs';

// Archive imutável do GitHub Actions: 63 ZIPs individuais + 8 pacotes QA.
// A publicação de ofertas e a homologação comercial são processos separados.
export const DEVKIT_ARTIFACT=Object.freeze({
  repository:'nutricionistaalmeidavh-spec/DevKitTools',
  repositoryId:1390982636,
  workflowRun:36494504837,
  artifactId:11002868547,
  artifactName:'qa-autocontidos-63-kits-8-pacotes',
  sourceCommit:'545fe21b125fc6c39b379437691d1ebf3c2abcfa'
});
const bundles=[
  'ativos-e-manutencao-v1.0.0.zip','base-desktop-v1.0.0.zip',
  'base-empresarial-v1.0.0.zip','base-pdv-v1.0.0.zip',
  'documentos-v1.0.0.zip','engenharia-v1.0.0.zip',
  'operacoes-v1.0.0.zip','saas-v1.0.0.zip'
];
const kitOffers=CATALOG_DRAFTS.filter(x=>x.deliveryMode==='download');
if(CATALOG_DRAFTS.length!==67||kitOffers.length!==63)throw Error('devkit_catalog_count_mismatch');
const entries=[
  ...kitOffers.map(x=>({id:x.artifactName,offerId:x.id,type:'kit'})),
  ...bundles.map(id=>({id,offerId:null,type:'bundle'}))
];
const names=new Set(entries.map(x=>x.id));
if(names.size!==71||entries.some(x=>!/^[a-z0-9][a-z0-9.-]{0,145}\.zip$/.test(x.id)))throw Error('devkit_artifact_names_invalid');
export const DEVKIT_RELEASES=Object.freeze(entries.sort((a,b)=>a.id.localeCompare(b.id)).map(x=>Object.freeze({
  ...x,fileName:x.id,key:'releases/'+x.id,
  outdated:x.id==='mapas-e-dados-geoespaciais-agro-v0.1.0.zip',
  commercialApproved:false,
  sourceArtifactId:DEVKIT_ARTIFACT.artifactId
})));
export const DEVKIT_RELEASE_BY_NAME=new Map(DEVKIT_RELEASES.map(x=>[x.fileName,x]));
