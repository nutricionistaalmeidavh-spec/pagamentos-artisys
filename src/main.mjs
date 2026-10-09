import { createApp } from './app.mjs';
const app=createApp();
const port=Number(process.env.PORT||3080);
app.server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log('Pagamento ArtiSys em http://127.0.0.1:'+port));
const shutdown=()=>app.server.close(()=>{app.close();process.exit(0);});
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
