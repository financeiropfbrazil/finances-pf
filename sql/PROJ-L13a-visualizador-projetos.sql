-- =====================================================================
-- PROJ-L13a — Papel "Visualizador de Projetos" + atribuição ao Diego
-- Projeto Supabase: hbtggrbauguukewiknew
-- Pedido do Pedro em 16/10/2026: "preciso liberar os projetos todos ao Diego".
--   Decisão: papel NOVO (não o "Aprovador de Projetos", que colocaria o Diego
--   na lista de aprovadores de get_aprovadores_disponiveis).
--   O "mexer em tudo" NÃO cabe num papel — ver L13b no PLANO-PROJETOS.md.
--
-- ESTADO: aplicado em 16/10/2026 pelo MCP (OK do Pedro na escolha do papel).
--
-- O QUE FAZ (só INSERT, idempotente por NOT EXISTS):
--   1. hub_roles: 'visualizador_projetos' (módulo projetos)
--   2. hub_role_permissions: projetos.access + projetos.view_all
--   3. hub_user_roles: Diego (diego.amancio@pfbrazil.com), atribuído por Pedro
-- EFEITO: projeto_pode_ver / policies de leitura passam a valer para todos os
-- projetos. Escrita continua exigindo ser o responsável do projeto (ou admin).
-- =====================================================================

insert into public.hub_roles (codigo, nome, descricao, modulo, is_system)
select 'visualizador_projetos',
       'Visualizador de Projetos',
       'Vê todos os projetos do sistema (pedidos, anexos, etapa e pagamentos). Não aprova e não edita projetos de outros.',
       'projetos',
       false
 where not exists (select 1 from public.hub_roles where codigo = 'visualizador_projetos');

insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id
  from public.hub_roles r
  join public.hub_permissions p on p.codigo in ('projetos.access', 'projetos.view_all')
 where r.codigo = 'visualizador_projetos'
   and not exists (select 1 from public.hub_role_permissions x
                    where x.role_id = r.id and x.permission_id = p.id);

insert into public.hub_user_roles (user_id, role_id, atribuido_por, motivo)
select 'f60a4fbe-07d5-457b-8538-7c3f34db3bed',            -- diego.amancio
       r.id,
       '0b52e262-2fd2-4e84-b414-456b8eb6df65',            -- pedro.scrignoli
       'Pedido do Pedro em 16/10/2026: ver todos os projetos'
  from public.hub_roles r
 where r.codigo = 'visualizador_projetos'
   and not exists (select 1 from public.hub_user_roles ur
                    where ur.user_id = 'f60a4fbe-07d5-457b-8538-7c3f34db3bed'
                      and ur.role_id = r.id and ur.revogado_em is null);

-- =====================================================================
-- VERIFICAÇÃO
-- select public.user_has_permission('f60a4fbe-07d5-457b-8538-7c3f34db3bed', 'projetos.view_all');  -- true
--
-- ROLLBACK (só tirar do Diego — sem apagar nada, pela tela de Permissões ou):
-- update public.hub_user_roles
--    set revogado_em = now(), revogado_por = '0b52e262-2fd2-4e84-b414-456b8eb6df65',
--        motivo = motivo || ' | revogado a pedido do Pedro'
--  where user_id = 'f60a4fbe-07d5-457b-8538-7c3f34db3bed'
--    and role_id = (select id from public.hub_roles where codigo = 'visualizador_projetos')
--    and revogado_em is null;
-- =====================================================================
