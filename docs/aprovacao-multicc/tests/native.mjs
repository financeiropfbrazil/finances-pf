import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const pkg=join(process.env.TEMP,'finances-pf-multicc-native/node_modules');
const bin=join(pkg,'@embedded-postgres/windows-x64/native/bin');
const dir=await mkdtemp(join(process.env.TEMP,'multicc-pg-'));
const port=55479;
const { default: pg } = await import(pathToFileURL(join(pkg,'pg/lib/index.js')));
function run(exe,args) { return new Promise((resolve,reject)=>{
 const child=spawn(join(bin,exe),args,{windowsHide:true}); let out='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(out)));
}); }
await run('initdb.exe',['-D',dir,'-U','postgres','--encoding=UTF8','--locale=C','--auth=trust']);
const server=spawn(join(bin,'postgres.exe'),['-D',dir,'-h','127.0.0.1','-p',String(port),'-F'],{windowsHide:true});
let out='';server.stdout.on('data',x=>out+=x);server.stderr.on('data',x=>out+=x);
try {
 let ready=false;
 for(let i=0;i<100;i++) {
   const client=new pg.Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});
   try { await client.connect(); await client.end(); ready=true;break; } catch { await client.end().catch(()=>{}); await new Promise(r=>setTimeout(r,100)); }
 }
 if(!ready) throw new Error(out);
 process.env.MULTICC_LOCAL_PG='127.0.0.1:55479';
 await import('./run.mjs');
} catch (error) { console.error('TEST_FAILURE', error); process.exitCode=1; } finally { await run('pg_ctl.exe',['-D',dir,'-m','fast','-w','stop']); }
