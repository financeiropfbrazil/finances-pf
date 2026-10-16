-- =====================================================================
-- PROJ-L13b — Permissão "Gerenciar todos os projetos" (projetos.manage_all)
-- Projeto Supabase: hbtggrbauguukewiknew
-- Pedido do Pedro em 16/10/2026: o Diego deve ver E mexer em todos os
-- projetos. Escolha: permissão nova (não admin do Hub, não trocar responsável).
--
-- ESTADO: PENDENTE de aplicação (aguarda OK do Pedro).
-- Sem DROP/DELETE — pode ir pelo MCP. Rollback em PROJ-L13b-rollback.sql.
--
-- REGRA NOVA: onde o banco exigia "ser o responsável do projeto", passa a
-- aceitar "ser o responsável OU ter projetos.manage_all". Todo o resto de
-- cada regra fica igual: as permissões específicas (criar pedido, reenviar,
-- editar/excluir projeto), as travas de fase (Budget em aprovação, pedido já
-- enviado, Budget aprovado = histórico), o teto orçamentário.
-- NÃO muda: aprovar Budget (continua só o aprovador designado ou admin).
--
-- COMO: cada função recebe a troca de UM trecho exato. O bloco 2 confere que
-- o trecho aparece exatamente 1 vez antes de trocar — se não, para tudo (a
-- migration inteira desfaz). Funções tocadas e md5 do corpo ANTES (16/10/2026):
--   enviar_budget_para_aprovacao             c154a10f4985bce1708646aef37d005b
--   projeto_marcar_email_aprovacao           fe8f86c093b0e18b90b947757178e154
--   projeto_pedido_arquivos_marcar_enviados  a988e4e01fc76486be0e0a8208df75ba
--   projeto_pedido_excluir                   7391124f6f0356e80e1ffa4e417869a8
--   projeto_pedido_marcar_enviado            331a3b6b94032569ac1241a98376f4a6
--   projeto_pedido_registrar_aprovacao       68b9d5a907eaa7b9ec998ae65f2e8fc3
--   projeto_pedido_salvar                    ac3f6efcd4589382c9d965bd5c6b6b54
--   projeto_pode_gerir_anexos                b443339a784160ee8bba723d5efd6524
--   projeto_storage_pode_apagar              94e02b7468968b699ea042c95555bd5e
--   (projeto_pedido_sync_alvo já aceita projetos.view_all — não muda)
-- Policies: projetos_update e projetos_delete (ALTER POLICY, sem recriar).
-- =====================================================================

set local lock_timeout = '10s';

-- =====================================================================
-- 1) Permissão, papel "Gestor de Projetos" e atribuição ao Diego
-- =====================================================================
insert into public.hub_permissions (codigo, nome, descricao, modulo)
select 'projetos.manage_all',
       'Gerenciar todos os projetos',
       'Cria, edita, exclui e envia pedidos (e edita o projeto) em qualquer projeto, como se fosse o responsável. Não aprova Budget.',
       'projetos'
 where not exists (select 1 from public.hub_permissions where codigo = 'projetos.manage_all');

insert into public.hub_roles (codigo, nome, descricao, modulo, is_system)
select 'gestor_projetos',
       'Gestor de Projetos',
       'Vê e gerencia todos os projetos: pedidos, anexos, envio ao ERP e envio para aprovação, em qualquer projeto. Não aprova Budget.',
       'projetos',
       false
 where not exists (select 1 from public.hub_roles where codigo = 'gestor_projetos');

insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id
  from public.hub_roles r
  join public.hub_permissions p on p.codigo in (
         'projetos.access', 'projetos.view_all', 'projetos.manage_all',
         'projetos.create', 'projetos.edit_own', 'projetos.delete_own',
         'projetos.pedidos.create', 'projetos.pedidos.reenviar')
 where r.codigo = 'gestor_projetos'
   and not exists (select 1 from public.hub_role_permissions x
                    where x.role_id = r.id and x.permission_id = p.id);

insert into public.hub_user_roles (user_id, role_id, atribuido_por, motivo)
select 'f60a4fbe-07d5-457b-8538-7c3f34db3bed',            -- diego.amancio
       r.id,
       '0b52e262-2fd2-4e84-b414-456b8eb6df65',            -- pedro.scrignoli
       'Pedido do Pedro em 16/10/2026: ver e mexer em todos os projetos'
  from public.hub_roles r
 where r.codigo = 'gestor_projetos'
   and not exists (select 1 from public.hub_user_roles ur
                    where ur.user_id = 'f60a4fbe-07d5-457b-8538-7c3f34db3bed'
                      and ur.role_id = r.id and ur.revogado_em is null);

-- O "Visualizador" do Diego (L13a) fica redundante: revogado, com motivo.
update public.hub_user_roles
   set revogado_em  = now(),
       revogado_por = '0b52e262-2fd2-4e84-b414-456b8eb6df65',
       motivo       = coalesce(motivo, '') || ' | substituído por Gestor de Projetos (L13b)'
 where user_id = 'f60a4fbe-07d5-457b-8538-7c3f34db3bed'
   and role_id = (select id from public.hub_roles where codigo = 'visualizador_projetos')
   and revogado_em is null;

-- =====================================================================
-- 2) Funções: "responsável" → "responsável OU projetos.manage_all"
-- =====================================================================
do $$
declare
  t      record;
  v_def  text;
  v_qtd  int;
begin
  for t in
    select * from (values
      ('public.enviar_budget_para_aprovacao(uuid)',
       'if not v_is_admin and v_projeto.responsavel_id is distinct from v_uid then',
       'if not v_is_admin and v_projeto.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then'),
      ('public.projeto_marcar_email_aprovacao(uuid)',
       'if not v_is_admin and v_proj.responsavel_id is distinct from v_uid then',
       'if not v_is_admin and v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then'),
      ('public.projeto_pedido_arquivos_marcar_enviados(uuid,text)',
       'and v_req.responsavel_id = auth.uid())) then',
       'and (v_req.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all'')))) then'),
      ('public.projeto_pedido_excluir(uuid)',
       'if v_proj.responsavel_id is distinct from v_uid then',
       'if v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then'),
      ('public.projeto_pedido_marcar_enviado(uuid,text,boolean,text)',
       'if v_proj.responsavel_id is distinct from v_uid then',
       'if v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then'),
      ('public.projeto_pedido_registrar_aprovacao(uuid,boolean,jsonb)',
       'and v_req.responsavel_id = auth.uid())) then',
       'and (v_req.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all'')))) then'),
      ('public.projeto_pedido_salvar(uuid,uuid,jsonb)',
       'if v_proj.responsavel_id is distinct from v_uid then',
       'if v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then'),
      ('public.projeto_pode_gerir_anexos(uuid)',
       'and pr.responsavel_id = auth.uid()))',
       'and (pr.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all''))))'),
      ('public.projeto_storage_pode_apagar(text)',
       'and pr.responsavel_id = auth.uid()',
       'and (pr.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all''))')
    ) as x(fn, antes, depois)
  loop
    v_def := pg_get_functiondef(t.fn::regprocedure);
    v_qtd := (length(v_def) - length(replace(v_def, t.antes, ''))) / length(t.antes);
    if v_qtd <> 1 then
      raise exception 'L13b: trecho esperado 1 vez em %, achado % — nada foi alterado', t.fn, v_qtd;
    end if;
    execute replace(v_def, t.antes, t.depois);   -- CREATE OR REPLACE: mantém o ACL
  end loop;
end $$;

-- =====================================================================
-- 3) Policies de edição/exclusão do PROJETO (a trava de fase 'budget' fica)
-- =====================================================================
alter policy projetos_update on public.projetos
  using (_is_admin() or (_user_has_perm('projetos.edit_own')
                         and (responsavel_id = auth.uid() or _user_has_perm('projetos.manage_all'))
                         and fase_atual = 'budget'))
  with check (_is_admin() or (_user_has_perm('projetos.edit_own')
                              and (responsavel_id = auth.uid() or _user_has_perm('projetos.manage_all'))));

alter policy projetos_delete on public.projetos
  using (_is_admin() or (_user_has_perm('projetos.delete_own')
                         and (responsavel_id = auth.uid() or _user_has_perm('projetos.manage_all'))
                         and fase_atual = 'budget'));

notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICAÇÃO (rodar separado)
-- select public.user_has_permission('f60a4fbe-07d5-457b-8538-7c3f34db3bed', 'projetos.manage_all');   -- true
-- select count(*) from pg_proc where prosrc like '%projetos.manage_all%';                           -- 9
-- =====================================================================
