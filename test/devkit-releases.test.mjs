import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CATALOG_DRAFTS} from '../src/catalog-drafts.mjs';
import {DEVKIT_ARTIFACT,DEVKIT_RELEASES,DEVKIT_RELEASE_BY_NAME} from '../src/devkit-releases.mjs';
import {devkitReleaseAdmin} from '../src/devkit-release-admin.mjs';

const root='https://artisys-test.example/v1/admin/devkit-releases';
function mockBucket(){
  const existing=new Map();
  return {existing,
    head:async key=>existing.get(key)||null,
    put:async(key,data,opts)=>{
      const content=new Uint8Array(data);
      existing.set(key,{size:content.byteLength,customMetadata:opts.customMetadata});
    }
  };
}
test('71 arquivos canônicos = 63 ofertas + 8 pacotes, sem publicação',()=>{
  assert.equal(DEVKIT_RELEASES.length,71);
  assert.equal(DEVKIT_ARTIFACT.artifactId,11002868547);
  const kitOffers=CATALOG_DRAFTS.filter(x=>x.deliveryMode==='download');
  assert.equal(kitOffers.length,63);
  assert.deepEqual(
    DEVKIT_RELEASES.filter(x=>x.type==='kit').map(x=>x.fileName).sort(),
    kitOffers.map(x=>x.artifactName).sort());
  assert.equal(DEVKIT_RELEASES.filter(x=>x.type==='bundle').length,8);
  assert.equal(new Set(DEVKIT_RELEASES.map(x=>x.key)).size,71);
  assert.ok(DEVKIT_RELEASES.every(x=>x.commercialApproved===false&&x.key==='releases/'+x.fileName));
  assert.equal(DEVKIT_RELEASE_BY_NAME.get('mapas-e-dados-geoespaciais-agro-v0.1.0.zip').outdated,true);
});
test('R2 lista inventário restrito por páginas, sem arquivos inexistentes aprovados',async()=>{
  const bucket=mockBucket(),env={PAGAMENTO_ARTISYS_ARQUIVOS:bucket};
  const a=await devkitReleaseAdmin(new Request(root+'?offset=0'),env);
  const b=await devkitReleaseAdmin(new Request(root+'?offset=60'),env);
  assert.equal(a.status,200);assert.equal(b.status,200);
  const first=await a.json(),last=await b.json();
  assert.equal(first.total,71);assert.equal(first.items.length,20);
  assert.equal(last.items.length,11);
  assert.ok(first.items.every(x=>!x.stored&&!x.verified));
  assert.equal(first.paymentsUntouched,true);
});
test('upload exige OIDC, valida bytes SHA-256 e bloqueia modificações',async()=>{
  const bucket=mockBucket(),env={PAGAMENTO_ARTISYS_ARQUIVOS:bucket};
  const item=DEVKIT_RELEASES[0],payload=Buffer.from('PK\\x03\\x04-valid-zip-test');
  const digest=createHash('sha256').update(payload).digest('hex');
  const request=hash=>new Request(root+'/'+item.fileName+'/upload',{
    method:'PUT',headers:{'content-type':'application/octet-stream','x-artisys-sha256':hash},body:payload
  });
  await assert.rejects(()=>devkitReleaseAdmin(request(digest),env),e=>e.status===403);
  await assert.rejects(()=>devkitReleaseAdmin(request('0'.repeat(64)),env,{githubVerified:true}),e=>e.status===409);
  assert.equal(bucket.existing.size,0);
  const result=await devkitReleaseAdmin(request(digest),env,{githubVerified:true});
  assert.equal(result.status,201);
  const data=await result.json();
  assert.equal(data.verified,true);assert.equal(data.offerStillDraft,true);assert.equal(data.commercialApproved,false);
  const second=await devkitReleaseAdmin(request(digest),env,{githubVerified:true});
  assert.equal(second.status,200);assert.equal((await second.json()).unchanged,true);
  bucket.existing.get(item.key).customMetadata.sha256='0'.repeat(64);
  await assert.rejects(()=>devkitReleaseAdmin(request(digest),env,{githubVerified:true}),e=>e.status===409);
});
