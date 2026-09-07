// Express/CORS/body parser + middleware auth/JWKS reais da versão atual do gateway.
// Somente dependências ERP/DB e router legado são duplos; nenhuma chamada externa.
import { createRequire } from 'node:module';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
const require=createRequire(resolve('../erp-proxy/package.json'));
const express=require('express'),cors=require('cors'),jose=require('jose');
const source=readFileSync('../erp-proxy/src/middleware/auth.ts','utf8');
const index=readFileSync('../erp-proxy/src/index.ts','utf8');
const results=[];let claims=0,legacyCalls=0;
const keys=await jose.generateKeyPair('RS256');const jwk=await jose.exportJWK(keys.publicKey);jwk.kid='local-test';jwk.alg='RS256';
const keyApp=express();keyApp.get(['/auth/v1/.well-known/jwks.json','/hubia/auth/v1/.well-known/jwks.json'],(_req,res)=>res.json({keys:[jwk]}));
const keyServer=keyApp.listen(0,'127.0.0.1');await new Promise(r=>keyServer.once('listening',r));
const issuerBase=`http://127.0.0.1:${keyServer.address().port}`;
process.env.SUPABASE_URL=issuerBase;process.env.SUPABASE_URL_HUBIA=issuerBase+'/hubia';process.env.SYSTEM_SECRET='local-only-system';
function compile(text,overrides={}) {const exports={};const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;new Function('exports','require',js)(exports,id=>id in overrides?overrides[id]:require(id));return exports;}
const auth=compile(source);
const read=name=>readFileSync(`docs/aprovacao-multicc/gateway/${name}.ts`,'utf8');
const units=compile(read('req-unidades'));const mapper=compile(read('req-aprovada-payload'),{'./req-unidades':units});
const router=compile(read('req-aprovada'),{'../alvo-client':{callAlvo:()=>{throw new Error('unexpected ERP');}},'./req-unidades':units,'../supabase-client':{getSupabaseAdmin:()=>({rpc:async()=>{claims++;return {error:{message:'APROVACAO_INCOMPLETA'}};}})},'../alvo-auth':{getAlvoToken:()=>{throw new Error('unexpected ERP');}},'./req-aprovada-payload':mapper}).default;
process.env.SUPABASE_URL='https://hbtggrbauguukewiknew.supabase.co';
const mount='app.use("/req-comp", requireSupabaseAuth, reqAprovadaRouter, reqCompRouter);';assert.ok(index.includes(mount));
const prefix=index.slice(index.indexOf('const app = express();'),index.indexOf('app.use("/excel"'));
const js=ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const legacy=express.Router();legacy.use((_req,res)=>{legacyCalls++;res.json({legacy:true});});
const app=new Function('express','cors','requireSupabaseAuth','reqAprovadaRouter','reqCompRouter',js+'\nreturn app;')(express,cors,auth.requireSupabaseAuth,router,legacy);
// Match the real final error handler without printing full exception objects/tokens.
app.use((err,_req,res,_next)=>res.status(500).json({error:err.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function token({issuer=issuerBase+'/auth/v1',sub='00000000-0000-0000-0000-000000000001',expires='5m'}={}) {let t=new jose.SignJWT({role:'authenticated',is_admin:false}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setIssuedAt().setExpirationTime(expires);if(sub)t=t.setSubject(sub);return t.sign(keys.privateKey);}
async function post(path,headers={},payload={requisicao_id:'00000000-0000-0000-0000-000000000100'}) {return fetch(base+'/req-comp/'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)});}
function check(name,actual,expected){assert.deepEqual(actual,expected,name);results.push({name,pass:true});console.log('PASS',name);}
let failure;
try {
 const user=await token();const valid={Authorization:`Bearer ${user}`};
 check('Sem JWT: 401',(await post('enviar-aprovada')).status,401);
 check('JWT inválido: 401',(await post('enviar-aprovada',{Authorization:'Bearer invalid'})).status,401);
 check('JWT expirado: 401',(await post('enviar-aprovada',{Authorization:`Bearer ${await token({expires:'-1h'})}`})).status,401);
 check('Emissor errado: 401',(await post('enviar-aprovada',{Authorization:`Bearer ${await token({issuer:issuerBase+'/wrong'})}`})).status,401);
 check('JWT sem sub: 401',(await post('enviar-aprovada',{Authorization:`Bearer ${await token({sub:null})}`})).status,401);
 check('Hub IA autenticado não envia: 403',(await post('enviar-aprovada',{Authorization:`Bearer ${await token({issuer:issuerBase+'/hubia/auth/v1'})}`})).status,403);
 check('Sistema autenticado não envia: 403',(await post('enviar-aprovada',{'X-System-Secret':'local-only-system'})).status,403);
 check('Secret errado não faz fallback para JWT válido',(await post('enviar-aprovada',{...valid,'X-System-Secret':'wrong'})).status,401);
 check('Nenhuma tentativa não autorizada alcança RPC',claims,0);
 check('Usuário Financial Hub não-admin alcança gate SQL',(await post('enviar-aprovada',valid)).status,409);
 check('RPC recebeu uma tentativa autenticada',claims,1);
 for(const path of ['insert','insert-multipart'])check(`Rota antiga ${path} bloqueada antes do legado`,(await post(path,valid)).status,409);
 check('Nenhum handler legado executado por Insert',legacyCalls,0);
 check('ID inválido: 400',(await post('enviar-aprovada',valid,{requisicao_id:'x'})).status,400);
 check('Origem Lovable passa pelo CORS',(await post('enviar-aprovada',{...valid,Origin:'https://finance-pf.lovable.app'})).headers.get('access-control-allow-origin'),'https://finance-pf.lovable.app');
 check('Origem não permitida recusada',(await post('enviar-aprovada',{...valid,Origin:'https://untrusted.invalid'})).status,500);
 const before=claims;await post('enviar-aprovada',valid,{padding:'x'.repeat(2*1024*1024+10)});check('Body maior que 2MB não alcança RPC',claims,before);
 check('Rota legada de leitura continua alcançável',(await fetch(base+'/req-comp/list',{headers:valid})).status,200);
 check('Somente leitura caiu no router legado',legacyCalls,1);
}catch(e){failure={message:e.message};console.error(e);process.exitCode=1;}
finally {
 await new Promise(r=>server.close(r));await new Promise(r=>keyServer.close(r));
 writeFileSync('docs/aprovacao-multicc/tests/resultados-express.json',JSON.stringify({data:new Date().toISOString(),middleware_sha256:createHash('sha256').update(source).digest('hex'),index_sha256:createHash('sha256').update(index).digest('hex'),express:require('express/package.json').version,jose:require('jose/package.json').version,results,failure,limites:'JWKS local assinado RSA; não equivale a sessão real de produção. ERP/RPC/handler legado substituídos; middleware, Express, CORS e body parser reais.'},null,2)+'\n');
}
