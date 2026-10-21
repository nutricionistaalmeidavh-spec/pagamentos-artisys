import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.mjs';

test('Node self-hosted também entrega interface e módulos de precificação',async t=>{
 const app=createApp({dbPath:':memory:',env:{ADMIN_TOKEN:'p'.repeat(32),PAYMENTS_ENABLED:'false'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.close();});
 const origin='http://127.0.0.1:'+app.server.address().port;
 for(const [route,type] of [['/precificar','text/html'],['/assets/precificador.js','application/javascript'],['/assets/precificador-engine.js','application/javascript'],['/assets/precificador.css','text/css']]){
  const response=await fetch(origin+route);
  assert.equal(response.status,200,route);
  assert.match(response.headers.get('content-type')||'',new RegExp(type.replace('/','\\/')));
 }
 const admin=await fetch(origin+'/v1/admin/summary');
 assert.equal(admin.status,401,'API administrativa segue protegida');
});
