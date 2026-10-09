import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SYSTEM_RELEASES,RELEASE_PART_SIZE} from '../src/system-releases.mjs';
import {systemReleaseAdmin} from '../src/system-release-admin.mjs';
import worker from '../src/cloudflare-worker.mjs';
const root='https://pagamentos-artisys-central.example';
const item=SYSTEM_RELEASES.find(x=>x.id==='pdv-nexus-win10');
function mockBucket(){
 const calls=[],existing=new Map();
 const self={
  calls,existing,
  head:async key=>{calls.push(['head',key]);return existing.get(key)||null;},
  createMultipartUpload:async key=>{calls.push(['start',key]);return {uploadId:'upload-123456789'};},
  resumeMultipartUpload:(key,uploadId)=>{
   calls.push(['resume',key,uploadId]);
   return {
    uploadPart:async(n,data)=>{calls.push(['part',n,data.byteLength]);return {partNumber:n,etag:'etag012345'+n};},
    complete:async parts=>{calls.push(['complete',parts.length]);existing.set(key,{size:item.size});},
    abort:async()=>{calls.push(['abort']);}
   };
  },
  delete:async key=>{calls.push(['delete',key]);existing.delete(key);}
 };
 return self;
}
const req=(path,method='GET',body=null)=>new Request(root+'/v1/admin/system-releases'+path,{method,...(body!==null?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
test('inventário tem somente oito binários e quatro ofertas',()=>{
 assert.equal(SYSTEM_RELEASES.length,8);
 assert.deepEqual([...new Set(SYSTEM_RELEASES.map(x=>x.offerId))].sort(),['artisys-sistema-financeiro','obra-na-mao','pdv-artisys-restaurantes','pdv-nexus']);
 assert.ok(SYSTEM_RELEASES.every(x=>x.key.startsWith('releases/')&&x.size>50*1024*1024));
 assert.ok(SYSTEM_RELEASES.every(x=>!x.key.includes('..')));
 const obra=SYSTEM_RELEASES.find(x=>x.id==='obra-windows');
 assert.equal(obra.outdated,true);
 assert.equal(obra.version,'1.0.19');
});
test('status preserva links Drive apenas no endpoint autenticado e não aprova ausentes',async()=>{
 const b=mockBucket();
 const r=await systemReleaseAdmin(req(''),{PAGAMENTO_ARTISYS_ARQUIVOS:b});
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.total,8);assert.equal(j.approvedCount,0);
 assert.ok(j.items.every(x=>x.stored===false&&x.sourceUrl.startsWith('https://drive.google.com/file/d/')));
 assert.equal(j.items.find(x=>x.id==='obra-windows').outdated,true);
});
test('versão velha do Obra é bloqueada antes do acesso ao R2',async()=>{
 const b=mockBucket();
 await assert.rejects(()=>systemReleaseAdmin(req('/obra-windows/start','POST',{expectedSize:125560559}),{PAGAMENTO_ARTISYS_ARQUIVOS:b}),e=>e.message==='outdated_release_blocked'&&e.status===409);
 assert.equal(b.calls.length,0);
});
test('não inicia upload com arquivo incompatível nem sobrescreve arquivo existente',async()=>{
 const b=mockBucket(),env={PAGAMENTO_ARTISYS_ARQUIVOS:b};
 await assert.rejects(()=>systemReleaseAdmin(req('/'+item.id+'/start','POST',{expectedSize:5}),env),e=>e.message==='file_size_mismatch');
 const response=await systemReleaseAdmin(req('/'+item.id+'/start','POST',{expectedSize:item.size}),env);
 assert.equal(response.status,201);const o=await response.json();
 assert.equal(o.partSize,RELEASE_PART_SIZE);
 assert.equal(o.expectedSize,item.size);
 b.existing.set(item.key,{size:item.size});
 await assert.rejects(()=>systemReleaseAdmin(req('/'+item.id+'/start','POST',{expectedSize:item.size}),env),e=>e.message==='release_already_present');
});
test('parte aceita exatos 8 MiB e abort é protegido pelo uploadId',async()=>{
 const b=mockBucket(),env={PAGAMENTO_ARTISYS_ARQUIVOS:b};
 const u=root+'/v1/admin/system-releases/'+item.id+'/part/1?uploadId=upload-123456789';
 const r=await systemReleaseAdmin(new Request(u,{method:'PUT',body:new Uint8Array(RELEASE_PART_SIZE)}),env);
 assert.equal(r.status,200);
 assert.equal((await r.json()).partNumber,1);
 assert.ok(b.calls.some(x=>x[0]==='part'&&x[2]===RELEASE_PART_SIZE));
 await assert.rejects(()=>systemReleaseAdmin(new Request(u,{method:'PUT',body:'bad'}),env),e=>e.message==='invalid_part_size');
 const aborted=await systemReleaseAdmin(req('/'+item.id+'/abort','POST',{uploadId:'upload-123456789'}),env);
 assert.equal((await aborted.json()).aborted,true);
});
test('complete exige todos os eTags ordenados e tamanho final fiel',async()=>{
 const b=mockBucket(),env={PAGAMENTO_ARTISYS_ARQUIVOS:b},count=Math.ceil(item.size/RELEASE_PART_SIZE);
 await assert.rejects(()=>systemReleaseAdmin(req('/'+item.id+'/complete','POST',{uploadId:'upload-123456789',parts:[]}),env),e=>e.message==='invalid_parts');
 const parts=Array.from({length:count},(_,i)=>({partNumber:i+1,etag:'etag01234'+i}));
 const res=await systemReleaseAdmin(req('/'+item.id+'/complete','POST',{uploadId:'upload-123456789',parts}),env);
 assert.equal(res.status,200);
 const out=await res.json();
 assert.equal(out.stored,true);
 assert.equal(out.offerStillDraft,true);
 const next=await systemReleaseAdmin(req(''),env);
 assert.equal((await next.json()).approvedCount,1);
});
test('não permite gerenciar releases sem token administrativo',async()=>{
 const fakeD1={batch:async()=>[],prepare(){return{bind(){return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})};}};
 const b=mockBucket(),env={ADMIN_TOKEN:'admin-test-1234567890123456789012',PAGAMENTO_ARTISYS_DB:fakeD1,PAGAMENTO_ARTISYS_ARQUIVOS:b};
 const r=await worker.fetch(new Request(root+'/v1/admin/system-releases'),env,{waitUntil(){}});
 assert.equal(r.status,401);assert.equal(b.calls.length,0);
});
