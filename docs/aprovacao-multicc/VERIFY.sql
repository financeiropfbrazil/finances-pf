-- SOMENTE LEITURA. Não executa RPCs de escrita.
-- PREVIEW antes da futura aplicação: três tabelas do módulo e zero em andamento.
select (select count(*) from information_schema.tables where table_schema='public'
  and table_name in ('compras_pedidos','compras_requisicoes','compras_pedidos_emails_log')) tabelas_modulo,
  (select count(*) from public.compras_pedidos) total_pedidos;
select status,count(*) from public.compras_requisicoes where numero_alvo is null group by status;
select id,status from public.compras_requisicoes where numero_alvo is null
  and status in ('pendente_aprovacao','aprovada','pendente_envio');

-- VERIFY depois da aplicação futura. Esperado: todos false em anon_executa.
select p.oid::regprocedure assinatura,p.prosecdef security_definer,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') anon_executa,
  has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_executa,
  has_function_privilege('service_role',p.oid,'EXECUTE') service_executa
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in ('submeter_requisicao','aprovar_requisicao','rejeitar_requisicao',
  'req_ccs_envolvidos','req_ccs_aprovacao','req_lider_cc','req_cc_tem_lider','req_aprovacao_completa',
  'req_pode_ler_aprovacao','requisicao_aprovacao_cc','requisicoes_fila_aprovacao','salvar_rateio_requisicao',
  'registrar_erro_rascunho_requisicao','finalizar_rascunho_requisicao','iniciar_envio_requisicao','concluir_envio_requisicao',
  'registrar_envio_requisicao','req_evento_obrigatorio','req_storage_rascunho');
-- authenticated: somente submissão/decisão/leitura/salvar_rateio/erro de rascunho.
-- iniciar/concluir envio: somente service_role (além do proprietário postgres).

select relname,relrowsecurity,relacl from pg_class
where oid='public.compras_requisicoes_aprovacao_grupos'::regclass;
-- Esperado: RLS true, sem escrita ou leitura direta para authenticated/anon.
select event_object_table,trigger_name,event_manipulation from information_schema.triggers
where trigger_name in ('trg_req_congelar','trg_req_protege_aprovacao')
order by event_object_table,trigger_name,event_manipulation;

-- Esperado: zero documentos novos liberados sem todos os grupos satisfeitos.
select r.id,g.codigo_centro_ctrl from public.compras_requisicoes r
left join public.compras_requisicoes_aprovacao_grupos g on g.requisicao_id=r.id
where r.aprovacao_submetida_em is not null and r.status='aprovada'
and (g.requisicao_id is null or (g.aprovado_em is null and g.dispensa_sem_lider_em is null));

-- Tentativas que exigem reconciliação. Nunca liberar token por idade automaticamente.
select id,status,tentativa_envio_em,erro_ultimo_envio from public.compras_requisicoes
where envio_token is not null and numero_alvo is null;

-- Auditoria e Storage: leituras válidas antes/depois para comparar com revisão.
select pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.compras_requisicoes_auditoria'::regclass
 and conname='compras_requisicoes_auditoria_evento_check';
select policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='storage' and tablename='objects' order by policyname;
select id,public from storage.buckets where id='compras-requisicoes';
-- Pós-migração: rascunhos legados que precisam de reanexo antes de submeter.
select a.requisicao_id,a.id from compras_requisicoes_arquivos a
join compras_requisicoes r on r.id=a.requisicao_id
where r.status='rascunho' and a.conteudo_sha256 is null;
-- Pós-aceite: cada decisão deve ter sua evidência, não basta retornar sucesso.
select evento,count(*) from compras_requisicoes_auditoria
where evento in ('cc_dispensado_autor','cc_sem_lider','cc_pendente','aprovacao_cc_registrada',
 'cc_sem_lider_fechamento','login_servico_provisorio','envio_reivindicado') group by evento;
-- Tuplas incompletas ou não suportadas em documentos ainda não enviados.
-- Conferência do cadastro atual é feita pelo gateway via Produto/Load, não por suposição SQL.
select r.id,i.codigo_produto,i.codigo_prod_unid_med,i.posicao_prod_unid_med,
 i.quantidade_solicitada,i.quantidade,i.conversao_unidade
from compras_requisicoes r join compras_requisicoes_itens i on i.requisicao_id=r.id
where r.numero_alvo is null and (i.quantidade_solicitada is null or i.posicao_prod_unid_med is null
 or i.conversao_unidade is null or i.conversao_unidade->>'tipo' is distinct from 'Fator');
