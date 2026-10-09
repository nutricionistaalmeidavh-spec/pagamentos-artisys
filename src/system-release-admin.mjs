import {SYSTEM_RELEASES,SYSTEM_RELEASE_BY_ID,RELEASE_PART_SIZE} from './system-releases.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const read=async request=>{
 const text=await request.text();
 if(text.length>16384)throw fail('invalid_payload',413);
 try{return JSON.parse(text||'{}');}catch{throw fail('invalid_json');}
};
const variant=id=>{
 const item=SYSTEM_RELEASE_BY_ID.get(id);
 if(!item)throw fail('release_not_found',404);
 return item;
};
const bucket=env=>{
 if(!env.PAGAMENTO_ARTISYS_ARQUIVOS)throw fail('r2_not_configured',503);
 return env.PAGAMENTO_ARTISYS_ARQUIVOS;
};
const partCount=m=>Math.ceil(m.size/RELEASE_PART_SIZE);
const expectedPartSize=(m,n)=>{
 if(!Number.isInteger(n)||n<1||n>partCount(m))throw fail('invalid_part',400);
 return Math.min(RELEASE_PART_SIZE,m.size-(n-1)*RELEASE_PART_SIZE);
};
const uploadId=x=>{
 if(typeof x!=='string'||!/^[A-Za-z0-9._~-]{8,1024}$/.test(x))throw fail('invalid_upload_id');
 return x;
};
async function readExactPart(request,bytes){
 if(Number(request.headers.get('content-length')||0)>bytes)throw fail('invalid_part_size',413);
 if(!request.body)throw fail('missing_part_body',400);
 const reader=request.body.getReader(),data=new Uint8Array(bytes);let offset=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(offset+value.byteLength>bytes)throw fail('invalid_part_size',413);
   data.set(value,offset);offset+=value.byteLength;
  }
 }finally{reader.releaseLock();}
 if(offset!==bytes)throw fail('invalid_part_size',413);
 return data;
}
async function status(env){
 const r2=env.PAGAMENTO_ARTISYS_ARQUIVOS||null;
 const entries=await Promise.all(SYSTEM_RELEASES.map(async item=>{
  let stored=false,verified=false,bytes=null,error=null;
  if(r2){
   try{
    const head=await r2.head(item.key);
    if(head){
     bytes=Number(head.size);
     stored=bytes===item.size;
     verified=stored&&head.customMetadata?.sha256===item.sha256;
     error=!stored?'size_mismatch':!verified?'sha256_not_verified':null;
    }
   }catch{error='r2_check_unavailable';}
  }
  return {id:item.id,offerId:item.offerId,platform:item.platform,version:item.version,
    expectedName:item.fileName,expectedSize:item.size,outdated:item.outdated,stored,verified,
    bytes,error,sourceUrl:item.sourceUrl,sourceRepo:item.sourceRepo,
    source:item.source||'google-drive',sha256:item.sha256||null,sourceCommit:item.sourceCommit||null,
    deliverable:verified&&!item.outdated};
 }));
 return response({storageConfigured:!!r2,items:entries,approvedCount:entries.filter(x=>x.deliverable).length,total:entries.length});
}
export async function systemReleaseAdmin(request,env){
 const method=request.method,path=new URL(request.url).pathname;
 if(method==='GET'&&path==='/v1/admin/system-releases')return status(env);
 const match=/^\/v1\/admin\/system-releases\/([a-z0-9-]+)\/(start|complete|abort|part\/[0-9]+)$/.exec(path);
 if(!match)throw fail('not_found',404);
 const item=variant(match[1]),action=match[2];
 if(item.outdated)throw fail('outdated_release_blocked',409);
 const r2=bucket(env);
 if(method==='POST'&&action==='start'){
  const body=await read(request);
  if(body.expectedSize!==item.size)throw fail('file_size_mismatch',409);
  const existing=await r2.head(item.key);
  if(existing)throw fail('release_already_present',409);
  const upload=await r2.createMultipartUpload(item.key,{
   httpMetadata:{contentType:'application/octet-stream'},
   customMetadata:{offerId:item.offerId,variantId:item.id,origin:item.source||'google-drive'}
  });
  return response({uploadId:upload.uploadId,partSize:RELEASE_PART_SIZE,partCount:partCount(item),expectedSize:item.size},201);
 }
 if(method==='PUT'&&action.startsWith('part/')){
  const number=Number(action.split('/')[1]);
  const identifier=uploadId(new URL(request.url).searchParams.get('uploadId'));
  const data=await readExactPart(request,expectedPartSize(item,number));
  const upload=r2.resumeMultipartUpload(item.key,identifier);
  const part=await upload.uploadPart(number,data);
  return response({partNumber:part.partNumber,etag:part.etag});
 }
 if(method==='POST'&&action==='complete'){
  const body=await read(request),identifier=uploadId(body.uploadId);
  if(!Array.isArray(body.parts)||body.parts.length!==partCount(item))throw fail('invalid_parts',400);
  const parts=body.parts.map((p,i)=>{
   if(p?.partNumber!==i+1||typeof p.etag!=='string'||!/^[A-Za-z0-9"._-]{1,256}$/.test(p.etag))throw fail('invalid_parts',400);
   return {partNumber:p.partNumber,etag:p.etag};
  });
  const upload=r2.resumeMultipartUpload(item.key,identifier);
  await upload.complete(parts);
  const final=await r2.head(item.key);
  if(!final||Number(final.size)!==item.size){
   await r2.delete(item.key);
   throw fail('uploaded_size_mismatch',409);
  }
  return response({stored:true,id:item.id,bytes:Number(final.size),private:true,offerStillDraft:true});
 }
 if(method==='POST'&&action==='abort'){
  const body=await read(request),identifier=uploadId(body.uploadId);
  await r2.resumeMultipartUpload(item.key,identifier).abort();
  return response({aborted:true});
 }
 throw fail('not_found',404);
}
