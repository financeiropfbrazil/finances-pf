// Real Auth, PostgREST and Storage HTTP; real gateway handler; local ERP simulator.
// No .env from the application/gateway is read. All outbound HTTP is loopback-only.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { jwt } from './prepare.mjs';
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.hostname,'127.0.0.1','OUTBOUND NON-LOCAL BLOCKED');
  return nativeFetch(input,init);
};
const { default: pg } = await import(pathToFileURL(join(process.env.TEMP,'finances-pf-multicc-native/node_modules/pg/lib/index.js')));
const dbConfig={host:'127.0.0.1',port:55432,user:'postgres',password:'local-test-only',database:'postgres'};
const db=new pg.Client(dbConfig); await db.connect();
const dir=new URL('./',import.meta.url);
const results=[]; let erpCalls=0; let erpPayload; let erpFile;
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=Buffer.from('Anexo real de integração multi-CC\n');
const captured=JSON.parse(readFileSync(new URL('../../load-gpt6-1.txt',dir),'utf8'));
const handlers=new Map();
const anon=jwt('anon'),service=jwt('service_role');
const base='http://127.0.0.1:55480';
const local=createClient(base,service,{auth:{persistSession:false,autoRefreshToken:false}});
async function body(req) {const chunks=[];for await(const b of req)chunks.push(b);return Buffer.concat(chunks);}
function compile(file,deps={}) {
  const text=readFileSync(new URL(`../../gateway/${file}.ts`,dir),'utf8').replace(/^import .*;\r?\n/gm,'');
  const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('exports',...Object.keys(deps),js)(exports,...Object.values(deps));return exports;
}
const units=compile('req-unidades');
const mapper=compile('req-aprovada-payload',units);
// Dependency injection only: do not weaken or edit the production URL guard.
// SUPABASE_URL satisfies that guard, but the injected client and fetch deny remote I/O.
process.env.SUPABASE_URL='https://hbtggrbauguukewiknew.supabase.co';
process.env.ALVO_BASE_URL=base+'/erp';
compile('req-aprovada',{
  Router:()=>({post:(paths,fn)=>(Array.isArray(paths)?paths:[paths]).forEach(p=>handlers.set(p,fn))}),
  getSupabaseAdmin:()=>local,getAlvoToken:async()=>'synthetic-erp-token',createHash,...units,...mapper,
  callAlvo:async(path,method)=>{const r=await fetch(base+'/erp/'+path,{method});return {ok:r.ok,data:await r.json()};},
});
const server=createServer(async(req,res)=>{
  try {
    const path=req.url;
    if(path.startsWith('/erp/Produto/Load')) {res.setHeader('content-type','application/json');res.end(JSON.stringify(captured));return;}
    if(path.startsWith('/erp/ReqComp/Save')) {
      erpCalls++;
      const request=new Request(base+path,{method:'POST',headers:req.headers,body:await body(req)});
      const form=await request.formData();erpPayload=JSON.parse(form.get('obj'));
      erpFile=Buffer.from(await [...form.values()].find(x=>typeof x!=='string').arrayBuffer());
      res.setHeader('content-type','application/json');res.end(JSON.stringify({Numero:'LOCAL-0001'}));return;
    }
    if(path.startsWith('/req-comp/')) {
      const {data,error}=await local.auth.getUser((req.headers.authorization||'').replace(/^Bearer /,''));
      if(error||!data.user) {res.writeHead(401);res.end();return;}
      const handler=handlers.get(path.slice('/req-comp'.length));
      if(!handler) {res.writeHead(404);res.end();return;}
      const response={status:(s)=>{res.statusCode=s;return response;},json:(x)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));return response;}};
      await handler({user:{id:data.user.id,source:'financial_hub'},body:JSON.parse((await body(req)).toString())},response);return;
    }
    const mapping=[['/auth/v1',55439],['/storage/v1',55450],['/rest/v1',55430]].find(([p])=>path.startsWith(p));
    if(!mapping) {res.writeHead(404);res.end();return;}
    const data=await body(req);const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
    const upstream=await fetch(`http://127.0.0.1:${mapping[1]}${path.slice(mapping[0].length)||'/'}`,{method:req.method,headers,...(data.length?{body:data}:{})});
    res.statusCode=upstream.status;res.setHeader('content-type',upstream.headers.get('content-type')||'application/json');res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch(e) {res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
});
await new Promise(r=>server.listen(55480,'127.0.0.1',r));
function check(name,actual,expected) {assert.deepEqual(actual,expected,name);results.push({name,pass:true});console.log('PASS',name);}
async function request(path,token,method='GET',data,headers={}) {
  const r=await fetch(base+path,{method,headers:{apikey:anon,Authorization:`Bearer ${token}`,...(data && !Buffer.isBuffer(data)?{'Content-Type':'application/json'}:{}),...headers},...(data?{body:Buffer.isBuffer(data)?data:JSON.stringify(data)}:{})});
  const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}
  return {status:r.status,value};
}
async function rpc(user,name,args) {const r=await request('/rest/v1/rpc/'+name,user.token,'POST',args);assert.ok(r.status<300,JSON.stringify(r));return r.value;}
async function upload(user,path,data=bytes,method='POST',extra={}) {return request('/storage/v1/object/compras-requisicoes/'+path,user.token,method,data,{'Content-Type':'application/octet-stream',...extra});}
async function remove(user,path) {return request('/storage/v1/object/compras-requisicoes',user.token,'DELETE',{prefixes:[path]});}
async function physical(path) {
  const r=await fetch(base+'/storage/v1/object/authenticated/compras-requisicoes/'+path,{headers:{Authorization:`Bearer ${service}`}});
  return {status:r.status,hash:hash(Buffer.from(await r.arrayBuffer()))};
}
let failure;
try {
  const exists=await db.query("select to_regclass('public.compras_requisicoes') as present");
  assert.equal(exists.rows[0].present,null,'Use a fresh compose DB: never overlay existing data');
  let fixture=readFileSync(new URL('../fixture.sql',dir),'utf8');
  fixture=fixture.slice(fixture.indexOf('create table profiles'),fixture.indexOf('-- Estrutura mínima'));
  await db.query(fixture);
  await db.query(readFileSync(new URL('../policies.sql',dir),'utf8'));
  await db.query(`create policy compras_req_storage_insert on storage.objects for insert to authenticated with check(bucket_id='compras-requisicoes');
    create policy compras_req_storage_select on storage.objects for select to authenticated using(bucket_id='compras-requisicoes');
    create policy compras_req_storage_delete on storage.objects for delete to authenticated using(bucket_id='compras-requisicoes');`);
  await db.query(readFileSync(new URL('../../../../supabase/migrations/20260907111805_aprovacao_requisicoes_todos_ccs.sql',dir),'utf8'));
  await db.query("notify pgrst, 'reload schema'");
  const users=[];
  for(const label of ['autor','terceiro','lider-b']) {
    const password='Local-only-Test-123!';const email=`${label}-${randomUUID()}@example.test`;
    const signup=await request('/auth/v1/signup',anon,'POST',{email,password});
    assert.ok(signup.value.access_token,JSON.stringify(signup));users.push({id:signup.value.user.id,token:signup.value.access_token});
  }
  const [author,other,leader]=users;
  const role=randomUUID(),leaderRole=randomUUID(),create=randomUUID(),approve=randomUUID(),retry=randomUUID();
  for(const user of users) await db.query("insert into profiles(user_id,full_name,is_admin,alvo_usuario) values ($1,'Sintético local',false,'LOCAL.TEST')",[user.id]);
  await db.query("insert into hub_roles values ($1,'requisitante'),($2,'lider_departamento')",[role,leaderRole]);
  await db.query("insert into hub_permissions values ($1,'compras.requisicoes.create'),($2,'compras.requisicoes.aprovar'),($3,'compras.requisicoes.reenviar_own')",[create,approve,retry]);
  await db.query('insert into hub_role_permissions values ($1,$2),($1,$3),($4,$5)',[role,create,retry,leaderRole,approve]);
  for(const user of users)await db.query('insert into hub_user_roles values ($1,$2,null)',[user.id,role]);
  for(const user of [author,leader])await db.query('insert into hub_user_roles values ($1,$2,null)',[user.id,leaderRole]);
  await db.query("insert into compras_lideres_cc(lider_user_id,codigo_centro_ctrl) values ($1,'A'),($2,'B')",[author.id,leader.id]);
  check('Todos os usuários HTTP são não-admin',(await db.query('select bool_and(not is_admin) as ok from profiles')).rows[0].ok,true);
  const bucket=await request('/storage/v1/bucket',service,'POST',{id:'compras-requisicoes',name:'compras-requisicoes',public:false});assert.ok(bucket.status<300,JSON.stringify(bucket));
  async function draft() {
    const id=randomUUID();
    const r=await request('/rest/v1/compras_requisicoes',author.token,'POST',{id,requisitante_user_id:author.id,codigo_centro_ctrl:'A',codigo_funcionario:'LOCAL',data_necessidade:'2026-09-10',codigo_finalidade_compra:'1'});assert.ok(r.status<300,JSON.stringify(r));
    for(const n of [1,2]) {
      const i=await request('/rest/v1/compras_requisicoes_itens',author.token,'POST',{requisicao_id:id,sequencia:n,codigo_centro_ctrl:'B',codigo_produto:'001.013.00382',codigo_prod_unid_med:'UNID',quantidade:n,quantidade_solicitada:n*10,posicao_prod_unid_med:2,conversao_unidade:{codigo:'UNID',posicao:2,peso:0.1,tipo:'Fator'},data_necessidade:'2026-09-10'});assert.ok(i.status<300,JSON.stringify(i));
    }
    await rpc(author,'finalizar_rascunho_requisicao',{p_req_id:id});return id;
  }
  async function attach(id) {
    const guid=randomUUID(),path=`${id}/${guid}.bin`;
    assert.ok((await upload(author,path)).status<300);
    const meta=await request('/rest/v1/compras_requisicoes_arquivos',author.token,'POST',{requisicao_id:id,upload_identify_guid:guid,nome_original:'teste.bin',storage_path:path,mime_type:'application/octet-stream',tamanho_bytes:bytes.length,uploaded_by_user_id:author.id,conteudo_sha256:hash(bytes)});assert.ok(meta.status<300,JSON.stringify(meta));return path;
  }
  const id=await draft(),path=await attach(id);
  check('Upload rascunho preserva bytes físicos',(await physical(path)).hash,hash(bytes));
  const temp=`${id}/remover.bin`;check('Upload adicional em rascunho',(await upload(author,temp)).status<300,true);
  await remove(author,temp);check('DELETE do autor remove objeto de rascunho',(await physical(temp)).status,400);
  await remove(other,path);check('DELETE por terceiro não remove bytes',(await physical(path)).hash,hash(bytes));
  check('Terceiro não cria objeto em pasta alheia',(await upload(other,`${id}/intruso.bin`)).status>=400,true);
  check('Submissão mantém B pendente',await rpc(author,'submeter_requisicao',{p_req_id:id}),'PENDENTE');
  const send=()=>request('/req-comp/enviar-aprovada',author.token,'POST',{requisicao_id:id});
  check('Gateway HTTP bloqueia envio parcial',(await send()).status,409);check('Nenhum Insert prematuro',erpCalls,0);
  await remove(author,path);check('DELETE após submissão mantém bytes',(await physical(path)).hash,hash(bytes));
  check('Upsert após submissão recusado',(await upload(author,path,Buffer.from('substituido'),'POST',{'x-upsert':'true'})).status>=400,true);
  check('PUT após submissão recusado',(await upload(author,path,Buffer.from('substituido'),'PUT')).status>=400,true);
  check('Novo objeto após submissão recusado',(await upload(author,`${id}/novo.bin`)).status>=400,true);
  check('Service role lê bytes congelados',(await physical(path)).hash,hash(bytes));
  check('Líder B não-admin fecha aprovação',await rpc(leader,'aprovar_requisicao',{p_req_id:id}),'FINAL');
  check('Gateway envia multipart pelo HTTP',(await send()).status,200);
  check('Um único Insert no ERP simulado',erpCalls,1);check('ERP recebeu bytes exatos',hash(erpFile),hash(bytes));
  check('ERP recebeu tuplas reais 10/1 e 20/2',erpPayload.ItemReqCompChildList.map(i=>[i.CodigoProdUnidMed,i.PosicaoProdUnidMed,i.Quantidade2,i.QuantidadeProdUnidMedPrincipal]),[['UNID',2,10,1],['UNID',2,20,2]]);
  check('Reenvio não duplica Insert',(await send()).status,409);check('Insert continua único',erpCalls,1);
  const race=await draft(),racePath=await attach(race);
  const concurrent=new pg.Client(dbConfig);await concurrent.connect();
  try {
    await concurrent.query('begin');await concurrent.query('set local role authenticated');
    await concurrent.query("select set_config('request.jwt.claim.sub',$1,true)",[author.id]);
    await concurrent.query('select submeter_requisicao($1)',[race]);
    let settled=false;const deletion=remove(author,racePath).then(x=>{settled=true;return x;});
    await new Promise(r=>setTimeout(r,350));check('DELETE HTTP aguarda transação da submissão',settled,false);
    await concurrent.query('commit');await deletion;
    check('Corrida HTTP não remove objeto submetido',(await physical(racePath)).hash,hash(bytes));
  } finally {await concurrent.query('rollback').catch(()=>{});await concurrent.end();}
  await rpc(leader,'aprovar_requisicao',{p_req_id:race});
  const tamper=await upload({token:service},racePath,Buffer.from('trusted-service-tamper'),'PUT');assert.ok(tamper.status<300,JSON.stringify(tamper));
  const rejected=await request('/req-comp/enviar-aprovada',author.token,'POST',{requisicao_id:race});
  check('Gateway recusa bytes alterados por serviço',rejected.status,502);check('Hash divergente não chega ao ERP',erpCalls,1);
  check('Auditoria efetiva do envio',(await db.query("select count(*)::int n from compras_requisicoes_auditoria where requisicao_id=$1 and evento in ('envio_reivindicado','envio_pos_aprovacao_sucesso')",[id])).rows[0].n,2);
} catch(error) {failure={message:error.message,stack:error.stack};console.error(error);process.exitCode=1;}
finally {
  const s3=process.argv.includes('--s3');
  writeFileSync(new URL(s3?'./resultados-http-s3.json':'./resultados-http.json',dir),JSON.stringify({date:new Date().toISOString(),storageBackend:s3?'S3 MinIO (volume Docker real)':'file (volume Docker real)',auth:'GoTrue real, JWT sintético',erp:'HTTP simulado; nenhum Alvo real',results,failure},null,2)+'\n');
  await db.end();await new Promise(r=>server.close(r));
}
