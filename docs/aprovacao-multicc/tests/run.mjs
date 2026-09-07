import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
let db;
let pg;
const native=process.env.MULTICC_LOCAL_PG==='127.0.0.1:55479';
if(native) {
  pg=(await import(pathToFileURL(join(process.env.TEMP,'finances-pf-multicc-native/node_modules/pg/lib/index.js')))).default;
  db=new pg.Client({host:'127.0.0.1',port:55479,user:'postgres',database:'postgres'});
  db.on('error', error => console.error('PG_CONNECTION', error.code));
  await db.connect(); db.exec=sql=>db.query(sql); db.close=()=>db.end();
} else {
  const { PGlite } = await import(pathToFileURL(join(process.env.TEMP, 'finances-pf-multicc-tests/node_modules/@electric-sql/pglite/dist/index.js')));
  db=new PGlite();
}
await db.exec(await readFile(new URL('./fixture.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('./policies.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL(process.argv.includes('--antes') ? './migration-antes-revisao.sql' : '../../../supabase/migrations/20260907111805_aprovacao_requisicoes_todos_ccs.sql', import.meta.url), 'utf8'));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [author,a,b,a2,outsider,admin] = [1,2,3,4,5,6].map(id);
await db.exec(`insert into profiles(user_id,full_name,is_admin) values ${[author,a,b,a2,outsider,admin].map((x,i)=>`('${x}','Teste ${i}',${x===admin})`).join(',')};
 insert into hub_roles values ('${id(10)}','lider_departamento'),('${id(11)}','requisitante');
 insert into hub_permissions values ('${id(20)}','compras.requisicoes.create'),('${id(21)}','compras.requisicoes.aprovar'),('${id(22)}','compras.requisicoes.reenviar_own');
 insert into hub_role_permissions values ('${id(11)}','${id(20)}'),('${id(11)}','${id(22)}'),('${id(10)}','${id(21)}');
 insert into hub_user_roles values ${[author,a,b,a2,outsider,admin].map(x=>`('${x}','${id(11)}',null)`).join(',')},${[a,b,a2].map(x=>`('${x}','${id(10)}',null)`).join(',')};
 insert into compras_lideres_cc(lider_user_id,codigo_centro_ctrl) values ('${a}','A'),('${a2}','A'),('${b}','B'),('${a}','C');
 insert into compras_motivos_rejeicao(codigo,rotulo,exige_observacao) values ('outros','Outros',true),('sem_verba','Sem verba',false);`);
let checks=0;
async function as(user,sql,params=[]) {
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
 try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
}
async function rpc(user,name,args) { return (await as(user,`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result; }
async function eq(actual, expected, name) { assert.deepEqual(await actual,expected,name); checks++; console.log(`PASS ${name}`); }
async function denied(fn,name) { await assert.rejects(fn); checks++; console.log(`PASS ${name}`); }
let next=100;
async function req(owner,header,items,rateio=[],descricao=null) {
 const r=id(next++);
 await as(owner,'insert into compras_requisicoes(id,requisitante_user_id,codigo_centro_ctrl,descricao) values ($1,$2,$3,$4)',[r,owner,header,descricao]);
 for(const cc of items) await as(owner,"insert into compras_requisicoes_itens(requisicao_id,codigo_centro_ctrl,codigo_produto,codigo_prod_unid_med,quantidade,data_necessidade) values ($1,$2,'PROD','UN',1,now())",[r,cc]);
 if(!process.argv.includes('--antes')) await as(owner,`update compras_requisicoes_itens set quantidade_solicitada=quantidade,posicao_prod_unid_med=1,conversao_unidade='{"codigo":"UN","posicao":1,"peso":1,"tipo":"Fator"}' where requisicao_id=$1`,[r]);
 if(rateio.length) await rpc(owner,'salvar_rateio_requisicao',[r,JSON.stringify(rateio)]);
 await rpc(owner,'finalizar_rascunho_requisicao',[r]);
 return r;
}
const rates=ccs=>[{codigo_classe_rec_desp:'CL',percentual:100,ccs:ccs.map((c,i)=>({codigo_centro_ctrl:c,percentual:i===0?1:99}))}];
const r=await req(a,'A',['A','B','A']);
await eq(rpc(a,'submeter_requisicao',[r]),'PENDENTE','autor líder A dispensa somente A');
await eq(db.query('select count(*)::int n from compras_requisicoes_aprovacao_grupos where requisicao_id=$1',[r]).then(x=>x.rows[0].n),2,'CC repetido não duplica grupos');
await eq(rpc(b,'requisicoes_fila_aprovacao',[]).then(()=>true),true,'líder sem admin acessa fila');
await eq(as(b,'select * from requisicoes_fila_aprovacao()').then(x=>x.rows.map(y=>[y.requisicao.id,y.aguardando_voce])),[[r,true]],'fila inclui líder exclusivo do CC do item');
await eq(as(a,'select * from requisicoes_fila_aprovacao()').then(x=>x.rows.map(y=>[y.requisicao.id,y.aguardando_voce])),[[r,false]],'fila distingue dispensa satisfeita de ação pendente');
await eq(as(outsider,'select * from requisicoes_fila_aprovacao()').then(x=>x.rows),[],'fila não expõe requisição a usuário sem aprovação');
await eq(rpc(b,'requisicao_aprovacao_cc',[r]).then(x=>x.map(y=>[y.codigo_centro_ctrl,y.situacao])),[['A','dispensado_autor'],['B','pendente']],'detalhe permite líder do item e informa pendências exatas');
await denied(()=>rpc(outsider,'requisicao_aprovacao_cc',[r]),'detalhe de aprovação recusa usuário alheio');
await eq(rpc(outsider,'aprovar_requisicao',[r]),'SEM_PERMISSAO','sem permissão não aprova');
await denied(()=>rpc(b,'iniciar_envio_requisicao',[r,b]),'authenticated não chama RPC exclusiva do gateway');
await denied(()=>db.query('select iniciar_envio_requisicao($1,$2)',[r,a]),'backend impede envio parcial');
await denied(()=>as(a,"update compras_requisicoes set codigo_centro_ctrl='C' where id=$1",[r]),'cabeçalho congelado');
await denied(()=>as(a,"update compras_requisicoes_itens set codigo_centro_ctrl='C' where requisicao_id=$1",[r]),'item congelado');
await denied(()=>as(a,'delete from compras_requisicoes_itens where requisicao_id=$1',[r]),'remoção de item congelada');
await denied(()=>as(a,"insert into compras_requisicoes_aprovacao_grupos(requisicao_id,codigo_centro_ctrl,sem_lider_na_submissao) values ($1,'X',true)",[r]),'decisão não pode ser forjada por tabela');
await eq(rpc(b,'aprovar_requisicao',[r]),'FINAL','líder B sem admin conclui');
await eq(rpc(a2,'aprovar_requisicao',[r]),'STATUS_INVALIDO:aprovada','segunda decisão não finaliza novamente');
if (process.argv.includes('--antes')) {
 console.log('REPRO eventos CC efetivamente gravados:', (await db.query("select evento from compras_requisicoes_auditoria where requisicao_id=$1 and evento in ('cc_dispensado_autor','cc_pendente','aprovacao_cc_registrada')",[r])).rows);
 for(const login of [null,'LIDER.B']) {
   await db.query('update profiles set alvo_usuario=$1 where user_id=$2',[login,b]);
   await assert.rejects(()=>db.query('select iniciar_envio_requisicao($1,$2)',[r,b]),e=>{console.log('REPRO', e.code, e.constraint, e.detail);return e.code==='23514';});
 }
 await db.close(); throw new Error('REPRODUZIDO: auditoria silenciosamente ausente e duas falhas 23514 no envio.');
}
const claim=(await db.query('select iniciar_envio_requisicao($1,$2) result',[r,b])).rows[0].result;
await eq([claim.itens[0].quantidade_solicitada,claim.itens[0].quantidade,claim.itens[0].posicao_prod_unid_med],[1,1,1],'snapshot preserva solicitada, principal e posição sem consulta ao catálogo legado');
await denied(()=>db.query('select iniciar_envio_requisicao($1,$2)',[r,a]),'segunda tentativa de envio bloqueada');
await eq(db.query('select concluir_envio_requisicao($1,$2,null,$3,false) result',[r,claim.token,'timeout']).then(x=>x.rows[0].result),'ERRO_REGISTRADO','timeout preserva decisão');
await denied(()=>db.query('select iniciar_envio_requisicao($1,$2)',[r,b]),'timeout não libera duplicação');
await eq(db.query("select concluir_envio_requisicao($1,$2,'000TEST',null,false) result",[r,claim.token]).then(x=>x.rows[0].result),'SINCRONIZADA','confirmação tardia fecha envio');
await eq(db.query("select concluir_envio_requisicao($1,$2,'000TEST',null,false) result",[r,claim.token]).then(x=>x.rows[0].result),'SINCRONIZADA','desfecho idempotente');
await eq(as(b,'update compras_requisicoes_itens set quantidade_solicitada=2,quantidade=2 where requisicao_id=$1 returning id',[r]).then(x=>x.rows.length),3,'espelho autenticado pode atualizar tupla de documento já enviado');
const r2=await req(author,'A',['A'],rates(['A','B']));
await eq(rpc(author,'submeter_requisicao',[r2]),'PENDENTE','rateio 1/99 exige ambos');
await eq(rpc(a2,'aprovar_requisicao',[r2]),'PARCIAL','qualquer líder A satisfaz grupo A');
await eq(rpc(a,'aprovar_requisicao',[r2]),'PARCIAL','outro líder A não satisfaz B');
await denied(()=>rpc(author,'salvar_rateio_requisicao',[r2,JSON.stringify([])]),'rateio submetido não pode ser apagado');
await denied(()=>db.query("update compras_requisicoes_rateio_cc set codigo_centro_ctrl='C' where rateio_classe_id in (select id from compras_requisicoes_rateio_classes where requisicao_id=$1)",[r2]),'CC do rateio congelado inclusive para serviço');
await eq(rpc(b,'rejeitar_requisicao',[r2,'outros',null]),'OBSERVACAO_OBRIGATORIA','motivo Outros preserva observação obrigatória');
await eq(rpc(a,'rejeitar_requisicao',[r2,'sem_verba',null]),'OK','líder de CC já satisfeito ainda pode rejeitar');
await eq(rpc(b,'aprovar_requisicao',[r2]),'STATUS_INVALIDO:rejeitada','rejeição terminal');
const r3=await req(author,'A',['C','X']);
await eq(rpc(author,'submeter_requisicao',[r3]),'PENDENTE','sem líder X não bloqueia por si só');
await db.exec(`insert into compras_lideres_cc(lider_user_id,codigo_centro_ctrl) values ('${b}','X');`);
await eq(rpc(a,'aprovar_requisicao',[r3]),'PARCIAL','novo líder X passa a ser exigido enquanto pendente');
await eq(db.query('select count(*)::int n from compras_requisicoes_aprovacao_grupos where requisicao_id=$1 and aprovado_por=$2',[r3,a]).then(x=>x.rows[0].n),2,'uma aprovação satisfaz A e C do mesmo líder');
await eq(rpc(admin,'aprovar_requisicao',[r3]),'FINAL','admin explicitamente aprova restante');
const r4=await req(admin,'B',['B']);
await eq(rpc(admin,'submeter_requisicao',[r4]),'PENDENTE','admin autor não dispensa CC alheio');
const r5=await req(author,'Z',['Z']);
await eq(rpc(author,'submeter_requisicao',[r5]),'SEM_GATE','sem líder libera com snapshot');
await eq(db.query("select count(*)::int n from compras_requisicoes_auditoria where requisicao_id=$1 and evento='cc_sem_lider'",[r5]).then(x=>x.rows[0].n),1,'dispensa sem líder auditada');
await denied(()=>as(author,"update compras_requisicoes set status='sincronizada',numero_alvo='FORJADO' where id=$1",[r5]),'cliente não forja desfecho de envio');
const r6=await req(a,'A',['C']);
await eq(rpc(a,'submeter_requisicao',[r6]),'AUTO_APROVADA','autor lidera todos os CCs multi-CC');
await denied(()=>rpc(author,'registrar_envio_requisicao',[r6,'FORJADO',null]),'RPC legada de desfecho fechada ao navegador');
await db.exec(`insert into compras_lideres_cc(lider_user_id,codigo_centro_ctrl) values ('${b}','Z');`);
await eq(rpc(author,'requisicao_aprovacao_cc',[r5]).then(x=>x[0].situacao),'sem_lider','novo líder após fechamento não reabre dispensa');
await eq(db.query("select iniciar_envio_requisicao($1,$2) result",[r5,author]).then(x=>!!x.rows[0].result.token),true,'envio respeita dispensa já fechada');
await db.exec(`update compras_lideres_cc set ativo=false where codigo_centro_ctrl='Z';`);
const draft=await req(author,'A',['A']);
await eq(rpc(author,'registrar_erro_rascunho_requisicao',[draft,'falha no upload']).then(()=>true),true,'erro parcial de criação pode ser registrado sem upsert');
await denied(()=>as(outsider,"update compras_requisicoes set codigo_centro_ctrl='B' where id=$1",[draft]),'outro requisitante não edita rascunho');
await denied(()=>as(outsider,'update compras_requisicoes_itens set requisicao_id=$1 where requisicao_id=$2',[draft,r6]),'reparenting não remove item de documento aprovado');
await as(author,"insert into compras_requisicoes(id,requisitante_user_id,codigo_centro_ctrl) values ($1,$2,'A')",[id(800),author]);
await eq(rpc(author,'submeter_requisicao',[id(800)]),'SEM_ITENS','backend recusa requisição vazia');
await as(author,"insert into compras_requisicoes_itens(requisicao_id,codigo_centro_ctrl,codigo_produto,codigo_prod_unid_med,quantidade,data_necessidade) values ($1,'A','PROD','UN',1,now())",[id(800)]);
await as(author,`update compras_requisicoes_itens set quantidade_solicitada=quantidade,posicao_prod_unid_med=1,conversao_unidade='{"codigo":"UN","posicao":1,"peso":1,"tipo":"Fator"}' where requisicao_id=$1`,[id(800)]);
await eq(rpc(author,'submeter_requisicao',[id(800)]),'CRIACAO_INCOMPLETA','falha antes de salvar rateio não libera submissão');
await denied(()=>as(author,'update compras_requisicoes set criacao_concluida=true where id=$1',[id(800)]),'cliente não forja conclusão por tabela');
await denied(()=>rpc(outsider,'finalizar_rascunho_requisicao',[id(800)]),'outro usuário não finaliza criação');
await as(author,'update compras_requisicoes set total_itens=2 where id=$1',[id(800)]);
await denied(()=>rpc(author,'finalizar_rascunho_requisicao',[id(800)]),'criação com itens faltando não conclui');
await as(author,'update compras_requisicoes set total_itens=1 where id=$1',[id(800)]);
await rpc(author,'finalizar_rascunho_requisicao',[id(800)]);
await eq(rpc(author,'submeter_requisicao',[id(800)]),'PENDENTE','criação completa segue aprovação normal');
await eq(db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('iniciar_envio_requisicao','concluir_envio_requisicao','req_ccs_aprovacao','req_ccs_envolvidos','req_lider_cc','req_cc_tem_lider','req_aprovacao_completa','req_pode_ler_aprovacao','requisicao_aprovacao_cc','requisicoes_fila_aprovacao','salvar_rateio_requisicao','registrar_erro_rascunho_requisicao','finalizar_rascunho_requisicao','req_evento_obrigatorio','req_storage_rascunho','submeter_requisicao','aprovar_requisicao','rejeitar_requisicao') and has_function_privilege('anon',p.oid,'EXECUTE')").then(x=>x.rows[0].n),0,'nenhuma RPC ou helper desta entrega é executável por anon');
const ri=await req(author,'Z',['Z']);
await rpc(author,'submeter_requisicao',[ri]);
await db.query("update profiles set alvo_usuario='ANA.SANCHES' where user_id=$1",[author]);
const ci=(await db.query('select iniciar_envio_requisicao($1,$2) result',[ri,author])).rows[0].result;
await eq(ci.codigo_usuario,'ANA.SANCHES','login pessoal vem do perfil do operador');
await db.query('select concluir_envio_requisicao($1,$2,null,$3,true)',[ri,ci.token,'falha antes HTTP']);
await db.query("update profiles set alvo_usuario='login invalido' where user_id=$1",[author]);
await denied(()=>db.query('select iniciar_envio_requisicao($1,$2)',[ri,author]),'login inválido não usa fallback');
await db.query('update profiles set alvo_usuario=null where user_id=$1',[author]);
const cf=(await db.query('select iniciar_envio_requisicao($1,$2) result',[ri,author])).rows[0].result;
await eq(cf.codigo_usuario,'PEDRO.SCRIGNOLI','fallback provisório preservado no backend');
await eq(db.query("select count(*)::int n from compras_requisicoes_auditoria where requisicao_id=$1 and evento='login_servico_provisorio'",[ri]).then(x=>x.rows[0].n),1,'fallback auditado, sem perda silenciosa de identidade');

// Conversão por cadastro é congelada junto com a tupla; nenhum backfill implícito.
const ru=await req(author,'A',['A','B']);
const unitRows=(await db.query('select id from compras_requisicoes_itens where requisicao_id=$1 order by id',[ru])).rows;
for(let n=0;n<unitRows.length;n++) await as(author,`update compras_requisicoes_itens set codigo_produto='001.013.00382',codigo_prod_unid_med='UNID',quantidade_solicitada=$1,quantidade=$2,posicao_prod_unid_med=2,conversao_unidade='{"codigo":"UNID","posicao":2,"peso":0.1,"tipo":"Fator"}' where id=$3`,[n===0?10:20,n+1,unitRows[n].id]);
await eq(rpc(author,'submeter_requisicao',[ru]),'PENDENTE','tuplas reais 10/1 e 20/2 passam com fator cadastral 0.1');
await denied(()=>as(author,'update compras_requisicoes_itens set quantidade_solicitada=30 where requisicao_id=$1',[ru]),'solicitada congelada após submissão');
await denied(()=>as(author,'update compras_requisicoes_itens set posicao_prod_unid_med=1 where requisicao_id=$1',[ru]),'posição congelada após submissão');
await rpc(a,'aprovar_requisicao',[ru]);await rpc(b,'aprovar_requisicao',[ru]);
const su=(await db.query('select iniciar_envio_requisicao($1,$2) result',[ru,b])).rows[0].result;
await eq(su.itens.map(i=>[i.quantidade_solicitada,i.quantidade,i.codigo_prod_unid_med,i.posicao_prod_unid_med]).sort((x,y)=>x[0]-y[0]),[[10,1,'UNID',2],[20,2,'UNID',2]],'snapshot preserva exatamente as duas tuplas reais');
const rinc=await req(author,'A',['A']);
await as(author,'update compras_requisicoes_itens set quantidade_solicitada=null,posicao_prod_unid_med=null where requisicao_id=$1',[rinc]);
await eq(rpc(author,'submeter_requisicao',[rinc]),'UNIDADE_INCOMPLETA_OU_DIVERGENTE','histórico incompleto não obtém aprovação por suposição');
const rdiv=await req(author,'A',['A']);
await as(author,`update compras_requisicoes_itens set conversao_unidade=jsonb_set(conversao_unidade,'{tipo}','"Divisor"') where requisicao_id=$1`,[rdiv]);
await eq(rpc(author,'submeter_requisicao',[rdiv]),'UNIDADE_INCOMPLETA_OU_DIVERGENTE','Divisor não comprovado também bloqueado no SQL');

// Auditoria: conferir linhas reais, não apenas retorno das RPCs.
for (const evento of ['cc_dispensado_autor','cc_sem_lider','cc_pendente','aprovacao_cc_registrada','cc_sem_lider_fechamento','login_servico_provisorio','envio_reivindicado']) {
 await eq(db.query('select exists(select 1 from compras_requisicoes_auditoria where evento=$1) ok',[evento]).then(x=>x.rows[0].ok),true,`evento ${evento} efetivamente gravado`);
}
const ra=await req(author,'A',['B']);
await db.exec("alter table compras_requisicoes_auditoria add constraint teste_falha_auditoria check (evento<>'cc_pendente') not valid");
await denied(()=>rpc(author,'submeter_requisicao',[ra]),'falha de auditoria aborta submissão em vez de sumir');
await eq(db.query('select status from compras_requisicoes where id=$1',[ra]).then(x=>x.rows[0].status),'rascunho','falha de auditoria reverte status');
await eq(db.query('select count(*)::int n from compras_requisicoes_aprovacao_grupos where requisicao_id=$1',[ra]).then(x=>x.rows[0].n),0,'falha de auditoria reverte grupos');
await db.exec('alter table compras_requisicoes_auditoria drop constraint teste_falha_auditoria');
const antigos=['criada','editada','envio_tentado','envio_sucesso','envio_falha','cancelada_alvo','convertida_pedido','vinculado_pedido','desvinculado_pedido','enviada_aprovacao','aprovada_lider','rejeitada_lider','submetida_sem_gate','envio_pos_aprovacao_sucesso','envio_pos_aprovacao_falha','descoberta_alvo','sync_status'];
for(const evento of antigos) await db.query('insert into compras_requisicoes_auditoria(requisicao_id,evento) values ($1,$2)',[ra,evento]);
await eq(db.query('select count(distinct evento)::int n from compras_requisicoes_auditoria where requisicao_id=$1',[ra]).then(x=>x.rows[0].n),antigos.length,'todos os 17 eventos anteriores continuam aceitos');
await denied(()=>db.query("insert into compras_requisicoes_auditoria(requisicao_id,evento) values ($1,'evento_inventado')",[ra]),'constraint continua recusando eventos desconhecidos');
await denied(()=>rpc(author,'req_evento_obrigatorio',[ra,'cc_pendente','{}',true]),'authenticated não forja evento pelo helper obrigatório');

// Storage: policies executadas em PostgreSQL, nunca DML no storage de produção.
const rs=await req(author,'A',['B']); const path=rs+'/arquivo.pdf';
await eq(as(author,"insert into storage.objects(bucket_id,name) values ('compras-requisicoes',$1) returning name",[path]).then(x=>x.rows.length),1,'autor faz upload em rascunho');
await eq(as(outsider,'delete from storage.objects where name=$1 returning name',[path]).then(x=>x.rows.length),0,'outro usuário não exclui objeto do rascunho');
await denied(()=>as(outsider,"insert into storage.objects(bucket_id,name) values ('compras-requisicoes',$1)",[rs+'/outro.pdf']),'outro usuário não insere no rascunho');
await eq(as(author,'delete from storage.objects where name=$1 returning name',[path]).then(x=>x.rows.length),1,'autor limpa upload do rascunho');
await as(author,"insert into storage.objects(bucket_id,name) values ('compras-requisicoes',$1)",[path]);
await as(author,"insert into compras_requisicoes_arquivos(requisicao_id,upload_identify_guid,nome_original,storage_path,mime_type,tamanho_bytes) values ($1,$2,'arquivo.pdf',$3,'application/pdf',7)",[rs,id(901),path]);
await eq(rpc(author,'submeter_requisicao',[rs]),'ANEXO_SEM_INTEGRIDADE','anexo legado sem hash exige reanexar');
await as(author,'update compras_requisicoes_arquivos set conteudo_sha256=$1 where requisicao_id=$2',['a'.repeat(64),rs]);
await rpc(author,'submeter_requisicao',[rs]);
for(const user of [author,b,admin]) await eq(as(user,'delete from storage.objects where name=$1 returning name',[path]).then(x=>x.rows.length),0,'objeto submetido não pode ser excluído, inclusive admin do app');
await denied(()=>as(author,"insert into storage.objects(bucket_id,name) values ('compras-requisicoes',$1)",[rs+'/novo.pdf']),'submissão bloqueia objeto novo na pasta');
await eq(as(author,"update storage.objects set metadata='{}' where name=$1 returning name",[path]).then(x=>x.rows.length),0,'sem UPDATE permissivo não substitui objeto');
await denied(()=>as(author,"insert into storage.objects(bucket_id,name) values ('compras-requisicoes',$1) on conflict(bucket_id,name) do update set metadata='{}'",[path]),'upsert não substitui objeto submetido');
await denied(()=>as(author,'update compras_requisicoes_arquivos set conteudo_sha256=$1 where requisicao_id=$2',['b'.repeat(64),rs]),'hash submetido congelado');
await db.exec('set role service_role');
await eq(db.query('select name from storage.objects where name=$1',[path]).then(x=>x.rows.length),1,'gateway service_role continua lendo anexo congelado');
await db.exec('reset role');
await rpc(a,'aprovar_requisicao',[rs]);await rpc(b,'aprovar_requisicao',[rs]);
const envioArquivo=(await db.query('select iniciar_envio_requisicao($1,$2) result',[rs,b])).rows[0].result;
await eq(db.query("select concluir_envio_requisicao($1,$2,'ANEXOTEST',null,false) result",[rs,envioArquivo.token]).then(x=>x.rows[0].result),'SINCRONIZADA','gateway conclui envio com anexo congelado');
await eq(db.query('select numero_alvo_ao_enviar from compras_requisicoes_arquivos where requisicao_id=$1',[rs]).then(x=>x.rows[0].numero_alvo_ao_enviar),'ANEXOTEST','gateway marca anexo sem alterar hash e caminho');
await denied(()=>db.query('update compras_requisicoes_arquivos set conteudo_sha256=$1 where requisicao_id=$2',['b'.repeat(64),rs]),'hash continua congelado após envio inclusive para serviço');

if(native) {
 const client=async user=>{const c=new pg.Client({host:'127.0.0.1',port:55479,user:'postgres',database:'postgres'});await c.connect();await c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);return c;};
 const ca=await client(a),cb=await client(b);
 try {
   const rc=await req(author,'A',['B']); await rpc(author,'submeter_requisicao',[rc]);
   await ca.query('begin');
   await eq(ca.query('select aprovar_requisicao($1) result',[rc]).then(x=>x.rows[0].result),'PARCIAL','sessão A aprova antes do commit');
   let terminou=false;
   const segunda=cb.query('select aprovar_requisicao($1) result',[rc]).then(x=>{terminou=true;return x.rows[0].result;});
   await new Promise(r=>setTimeout(r,150));
   await eq(terminou,false,'sessão B aguarda lock real da sessão A');
   await ca.query('commit');
   await eq(segunda,'FINAL','segunda sessão enxerga decisão comprometida e finaliza uma vez');
   const cr=await req(author,'A',['B']); await rpc(author,'submeter_requisicao',[cr]);
   await ca.query('begin');
   await ca.query("select rejeitar_requisicao($1,'sem_verba',null)",[cr]);
   const aprovarDepois=cb.query('select aprovar_requisicao($1) result',[cr]);
   await new Promise(r=>setTimeout(r,100));await ca.query('commit');
   await eq(aprovarDepois.then(x=>x.rows[0].result),'STATUS_INVALIDO:rejeitada','rejeição concorrente impede aprovação e envio');
   const sm=await req(author,'A',['B']);
   await ca.query('reset role; begin');
   await ca.query('select submeter_requisicao($1)',[sm]); // use autor abaixo; não modifica se fora do dono
   await ca.query(`select set_config('request.jwt.claim.sub','${author}',false)`);
   await ca.query('select submeter_requisicao($1)',[sm]);
   await cb.query('reset role');
   const mudar=cb.query("update compras_requisicoes_itens set codigo_centro_ctrl='C' where requisicao_id=$1",[sm]);
   const esperado=assert.rejects(mudar,/CONGELADA/);
   await new Promise(r=>setTimeout(r,100));await ca.query('commit');await esperado;
   checks++;console.log('PASS mutação concorrente aguarda submissão e é recusada');
   const sr=await req(author,'A',['B']);const sp=sr+'/concorrente.pdf';
   await as(author,"insert into storage.objects(bucket_id,name) values ('compras-requisicoes',$1)",[sp]);
   await ca.query(`set role authenticated; select set_config('request.jwt.claim.sub','${author}',false); begin`);
   await ca.query('select submeter_requisicao($1)',[sr]);
   await cb.query(`set role authenticated; select set_config('request.jwt.claim.sub','${author}',false)`);
   let excluiu=false;
   const excluir=cb.query('delete from storage.objects where name=$1 returning name',[sp]).then(x=>{excluiu=true;return x.rows.length;});
   await new Promise(r=>setTimeout(r,150));
   await eq(excluiu,false,'DELETE Storage concorrente aguarda lock da submissão');
   await ca.query('commit');
   await eq(excluir,0,'DELETE Storage concorrente reavalia status e preserva objeto');
 } finally {await ca.end();await cb.end();}
}
await db.exec(await readFile(new URL('../../../supabase/migrations/20260907160220_requisicoes_janela_aceite.sql',import.meta.url),'utf8'));
await denied(()=>req(author,'A',['B']),'janela fechada impede criação autenticada');
await denied(()=>req(admin,'A',['B']),'admin também respeita janela fechada');
await denied(()=>db.query('select iniciar_envio_requisicao($1,$2)',[r,author]),'janela fechada impede envio no backend');
await eq(db.query("select has_function_privilege('service_role','req_iniciar_envio_sem_janela(uuid,uuid)','execute') ok").then(x=>x.rows[0].ok),false,'serviço não contorna janela chamando corpo original');
await denied(()=>as(author,"update compras_requisicoes_janela set modo='aberta'"),'usuário não abre janela por tabela');
await db.query("update compras_requisicoes_janela set modo='aceite',usuarios=$1",[[author,a,b]]);
await denied(()=>req(outsider,'A',['B'],[],'ACEITE-MULTICC-LOCAL'),'não participante não cria durante aceite');
await denied(()=>req(author,'A',['B']),'participante precisa identificar documento do aceite');
const aceite=await req(author,'A',['B'],[],'ACEITE-MULTICC-LOCAL');
await eq(rpc(author,'submeter_requisicao',[aceite]),'PENDENTE','participante não-admin submete no aceite');
await eq(rpc(a,'aprovar_requisicao',[aceite]),'PARCIAL','janela preserva exigência de todos os CCs');
await eq(rpc(b,'aprovar_requisicao',[aceite]),'FINAL','segundo líder conclui no aceite');
await eq(db.query('select iniciar_envio_requisicao($1,$2) result',[aceite,b]).then(x=>!!x.rows[0].result.token),true,'backend permite reserva exclusiva do caso de aceite');
await db.query("update compras_requisicoes_janela set modo='aberta'");
await eq(req(outsider,'A',['B']).then(Boolean),true,'liberação posterior restaura criação sem alterar lideranças');
console.log(`${checks} verificações SQL passaram (${native?'PostgreSQL nativo, duas sessões concorrentes':'PGlite'}). Identidades sintéticas, role authenticated; nenhuma conexão com produção.`);
await db.close();
