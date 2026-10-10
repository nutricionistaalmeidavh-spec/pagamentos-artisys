import {DEVKIT_RELEASES,DEVKIT_RELEASE_BY_NAME,DEVKIT_ARTIFACT} from './devkit-releases.mjs';

const MAX_ZIP_BYTES=2*1024*1024;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});

async function readLimited(request,max){
  if(request.headers.has('content-length')&&Number(request.headers.get('content-length'))>max)throw fail('devkit_too_large',413);
  if(!request.body)throw fail('devkit_empty',400);
  const chunks=[];let total=0;
  for await (const part of request.body){
    total+=part.byteLength;
    if(total>max)throw fail('devkit_too_large',413);
    chunks.push(part);
  }
  if(!total)throw fail('devkit_empty',400);
  const data=new Uint8Array(total);let offset=0;
  for(const part of chunks){data.set(part,offset);offset+=part.byteLength;}
  return data;
}
async function sha256(bytes){
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
async function inspect(bucket,item){
  let head;
  try{head=await bucket.head(item.key);}catch{return {...item,stored:false,verified:false,error:'r2_unavailable'};}
  if(!head)return {...item,stored:false,verified:false,error:null};
  const meta=head.customMetadata||{};
  const verified=Number(head.size)>0&&Number(head.size)<=MAX_ZIP_BYTES
    &&/^[0-9a-f]{64}$/.test(meta.sha256||'')
    &&meta.sourceArtifactId===String(DEVKIT_ARTIFACT.artifactId)
    &&meta.sourceCommit===DEVKIT_ARTIFACT.sourceCommit
    &&meta.fileName===item.fileName;
  return {...item,stored:true,verified,bytes:Number(head.size),
    sha256:verified?meta.sha256:null,error:verified?null:'archive_provenance_not_verified',
    deliverable:verified&&!item.outdated&&item.commercialApproved};
}
export async function devkitReleaseAdmin(request,env,{githubVerified=false}={}){
  const method=request.method,path=new URL(request.url).pathname;
  const bucket=env.PAGAMENTO_ARTISYS_ARQUIVOS;
  if(!bucket)throw fail('r2_not_configured',503);
  if(method==='GET'&&path==='/v1/admin/devkit-releases'){
    const offset=Number(new URL(request.url).searchParams.get('offset')||0);
    if(!Number.isInteger(offset)||offset<0||offset>DEVKIT_RELEASES.length)throw fail('invalid_offset');
    const items=await Promise.all(DEVKIT_RELEASES.slice(offset,offset+20).map(item=>inspect(bucket,item)));
    return json({storageConfigured:true,total:DEVKIT_RELEASES.length,offset,items,
      sourceArtifactId:DEVKIT_ARTIFACT.artifactId,paymentsUntouched:true});
  }
  const match=path.match(/^\/v1\/admin\/devkit-releases\/([a-z0-9][a-z0-9.-]{0,145}\.zip)\/upload$/);
  if(method!=='PUT'||!match)throw fail('not_found',404);
  if(!githubVerified)throw fail('github_oidc_required',403);
  const item=DEVKIT_RELEASE_BY_NAME.get(match[1]);
  if(!item)throw fail('devkit_not_in_catalog',404);
  const expectedSha=request.headers.get('x-artisys-sha256')||'';
  if(!/^[0-9a-f]{64}$/.test(expectedSha))throw fail('devkit_hash_missing',400);
  const bytes=await readLimited(request,MAX_ZIP_BYTES);
  const actualSha=await sha256(bytes);
  if(actualSha!==expectedSha)throw fail('devkit_sha256_mismatch',409);
  const existing=await inspect(bucket,item);
  if(existing.stored){
    if(!existing.verified||existing.sha256!==actualSha||existing.bytes!==bytes.byteLength)
      throw fail('existing_devkit_conflict',409);
    return json({stored:true,verified:true,unchanged:true,fileName:item.fileName,bytes:bytes.byteLength});
  }
  if(existing.error)throw fail('r2_unavailable',503);
  await bucket.put(item.key,bytes,{
    httpMetadata:{contentType:'application/zip'},
    customMetadata:{
      sha256:actualSha,
      fileName:item.fileName,
      sourceArtifactId:String(DEVKIT_ARTIFACT.artifactId),
      sourceCommit:DEVKIT_ARTIFACT.sourceCommit,
      verifiedBy:'github-oidc-ci',
      commercialApproved:'false'
    }
  });
  const verified=await inspect(bucket,item);
  if(!verified.verified||verified.sha256!==actualSha||verified.bytes!==bytes.byteLength)
    throw fail('devkit_upload_not_verified',409);
  return json({stored:true,verified:true,private:true,fileName:item.fileName,
    bytes:bytes.byteLength,offerStillDraft:true,commercialApproved:false},201);
}
