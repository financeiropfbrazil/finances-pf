-- =====================================================================
-- PROJ-L5 — Views de report do modulo de Projetos
--   v_projeto_resumo · v_projeto_eventos_report
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L5) · requisitos R-2 e R-3 · decisao D-16
--
-- ESTADO: PENDENTE de aplicacao.
-- PRE-REQUISITOS: L1..L4 aplicados (tabelas, RPCs e RLS no lugar).
-- Idempotente: create or replace view.
--
-- ###################################################################
-- R-3 — POR QUE `security_invoker = on` NAO E OPCIONAL AQUI
--   O item L5.3 do plano dizia que "views herdam das tabelas
--   (security_invoker default)". Isso esta ERRADO: no PostgreSQL o default e
--   security_invoker = OFF — a view roda com os privilegios do OWNER (postgres)
--   e BYPASSA o RLS das tabelas base.
--   Medido neste banco: as rh_vw_* tem {security_invoker=on}; as views de
--   intercompany/compras tem reloptions NULL (rodam como owner).
--   Sem o flag, estas duas views entregariam TODOS os projetos a qualquer
--   authenticated — jogando fora exatamente o escopo que o L3 montou.
--   PG 17.6 neste projeto; suportado desde o 15.
-- ###################################################################
--
-- R-2 — numeric em jsonb NAO normaliza escala: o mesmo valor aparece como
--   110000 em valor_antes e 110000.00 em valor_depois. Toda comparacao de
--   valores vindos de `detalhes` e feita com cast para numeric, NUNCA como
--   texto — senao todo evento de edicao vira falso positivo de "valor alterado".
--
-- D-16 — o teto continua barrando no FRONT. `teto_rejeitado` deixa de ser
--   metrica de rotina e passa a ser ALARME DE ANOMALIA (so grava se alguem
--   contornar a tela e chamar a RPC direto). Por isso:
--     * v_projeto_resumo NAO tem contagem de tentativas de estouro;
--     * v_projeto_eventos_report lista o evento como qualquer outro, com a
--       flag `anomalia` para dar o alarme sem virar metrica.
-- =====================================================================


-- =====================================================================
-- 1) v_projeto_resumo — 1 linha por projeto (base do dashboard/Excel)
-- =====================================================================
drop view if exists public.v_projeto_resumo;

create view public.v_projeto_resumo
with (security_invoker = on)
as
select
  p.id                                as projeto_id,
  p.nome                              as projeto,
  p.fase_atual,
  p.status,
  p.orcamento,

  -- Totais por fase
  coalesce(b.total, 0)                as total_budget,
  coalesce(a.total, 0)                as total_actual,
  p.orcamento - coalesce(a.total, 0)  as saldo_actual,
  p.orcamento - coalesce(b.total, 0)  as saldo_budget,
  case when p.orcamento > 0
       then round((coalesce(a.total, 0) / p.orcamento) * 100, 2)
       else null end                  as pct_comprometido_actual,
  case when p.orcamento > 0
       then round((coalesce(b.total, 0) / p.orcamento) * 100, 2)
       else null end                  as pct_comprometido_budget,

  -- Contagens de pedidos
  coalesce(b.qtd, 0)                  as qtd_pedidos_budget,
  coalesce(a.qtd, 0)                  as qtd_pedidos_actual,
  coalesce(a.qtd_rascunho, 0)         as actual_rascunho,
  coalesce(a.qtd_erro, 0)             as actual_erro,
  coalesce(a.qtd_enviado, 0)          as actual_enviado,
  coalesce(a.qtd_bloqueado, 0)        as actual_bloqueado,
  coalesce(a.valor_enviado_alvo, 0)   as valor_enviado_alvo,

  -- Pessoas (SEMPRE profiles.user_id = auth.uid; NUNCA profiles.id — §2.4/FH47)
  p.responsavel_id,
  coalesce(pr_resp.full_name, pr_resp.email)   as responsavel,
  pr_resp.email                                as responsavel_email,
  p.aprovador_id,
  coalesce(pr_apr.full_name, pr_apr.email)     as aprovador,
  pr_apr.email                                 as aprovador_email,
  p.criado_por,
  coalesce(pr_cri.full_name, pr_cri.email)     as criado_por_nome,

  -- Datas do ciclo
  p.data_inicio,
  p.data_fim,
  p.enviado_para_aprovacao_em,
  p.email_aprovacao_enviado_em,
  p.budget_aprovado_por,
  p.budget_aprovado_em,
  p.created_at,
  p.updated_at,

  -- Ultimo evento registrado (para o controller saber se o projeto "anda")
  ev.ultimo_evento,
  ev.ultimo_evento_em,
  coalesce(ev.qtd_eventos, 0)         as qtd_eventos

from public.projetos p

left join lateral (
  select count(*)               as qtd,
         sum(r.valor_total)     as total
    from public.projeto_requisicoes r
   where r.projeto_id = p.id and r.fase = 'budget'
) b on true

left join lateral (
  select count(*)                                                       as qtd,
         sum(r.valor_total)                                             as total,
         count(*) filter (where r.status = 'rascunho')                  as qtd_rascunho,
         count(*) filter (where r.status = 'erro')                      as qtd_erro,
         count(*) filter (where r.status = 'enviado')                   as qtd_enviado,
         count(*) filter (where r.bloqueado)                            as qtd_bloqueado,
         sum(r.valor_total) filter (where r.numero_pedido_alvo is not null) as valor_enviado_alvo
    from public.projeto_requisicoes r
   where r.projeto_id = p.id and r.fase = 'actual'
) a on true

left join lateral (
  select count(*) as qtd_eventos,
         (array_agg(e.evento     order by e.created_at desc))[1] as ultimo_evento,
         (array_agg(e.created_at order by e.created_at desc))[1] as ultimo_evento_em
    from public.projeto_eventos e
   where e.projeto_id = p.id
) ev on true

left join public.profiles pr_resp on pr_resp.user_id = p.responsavel_id
left join public.profiles pr_apr  on pr_apr.user_id  = p.aprovador_id
left join public.profiles pr_cri  on pr_cri.user_id  = p.criado_por;

comment on view public.v_projeto_resumo is
  'Resumo por projeto para dashboard/Excel do controller (L5). security_invoker=on: respeita o RLS de projetos/projeto_requisicoes/projeto_eventos. Sem metrica de tentativas de estouro (D-16).';


-- =====================================================================
-- 2) v_projeto_eventos_report — trilha de eventos com nomes resolvidos
-- =====================================================================
drop view if exists public.v_projeto_eventos_report;

create view public.v_projeto_eventos_report
with (security_invoker = on)
as
select
  e.id                                as evento_id,
  e.created_at                        as quando,
  (e.created_at at time zone 'America/Sao_Paulo') as quando_brt,
  date_trunc('month', e.created_at)   as competencia,

  e.projeto_id,
  p.nome                              as projeto,
  p.fase_atual                        as projeto_fase_atual,
  p.orcamento,

  e.evento,
  -- rotulo legivel para o Excel
  case e.evento
    when 'pedido_criado'            then 'Pedido criado'
    when 'pedido_editado'           then 'Pedido editado'
    when 'pedido_excluido'          then 'Pedido excluido'
    when 'pedido_enviado_alvo'      then 'Pedido enviado ao ERP'
    when 'teto_rejeitado'           then 'Orcamento excedido (rejeitado)'
    when 'budget_enviado_aprovacao' then 'Budget enviado para aprovacao'
    when 'budget_aprovado'          then 'Budget aprovado'
    else e.evento
  end                                 as evento_label,

  -- D-16: teto_rejeitado nao e metrica de rotina — a tela ja barra antes.
  -- Se aparecer, alguem chamou a RPC por fora: e ANOMALIA, e esta flag existe
  -- para alarmar, nao para contar.
  (e.evento = 'teto_rejeitado')       as anomalia,

  e.fase,
  e.requisicao_id,
  (e.detalhes->>'sequencia')::int     as sequencia,

  -- R-2: numeric em jsonb nao normaliza escala (110000 vs 110000.00).
  -- Tudo que sai de `detalhes` vira numeric ANTES de qualquer comparacao.
  e.valor_antes,
  e.valor_depois,
  case
    when e.valor_antes is null or e.valor_depois is null then null
    else round(e.valor_depois - e.valor_antes, 2)
  end                                 as delta_valor,
  case
    when e.valor_antes is null or e.valor_depois is null or e.valor_antes = 0 then null
    else round(((e.valor_depois - e.valor_antes) / e.valor_antes) * 100, 2)
  end                                 as delta_percentual,
  -- comparacao NUMERICA, nunca textual: `110000` e `110000.00` sao iguais
  case
    when e.valor_antes is null or e.valor_depois is null then null
    else (round(e.valor_antes, 2) is distinct from round(e.valor_depois, 2))
  end                                 as valor_mudou,

  -- Quem agiu (join por profiles.user_id — §2.4/FH47)
  e.usuario_id,
  coalesce(pr.full_name, pr.email, e.usuario_email) as usuario,
  coalesce(e.usuario_email, pr.email)               as usuario_email,
  coalesce(pr.is_admin, false)                      as usuario_era_admin,

  -- Campos uteis por tipo de evento
  e.detalhes->>'numero_pedido_alvo'   as numero_pedido_alvo,
  (e.detalhes->>'sucesso')::boolean   as envio_com_sucesso,
  e.detalhes->>'erro'                 as erro_envio,
  (e.detalhes->>'saldo_disponivel')::numeric as saldo_disponivel,
  (e.detalhes->>'excedente')::numeric        as excedente,
  -- lista dos campos alterados numa edicao, sem despejar o jsonb inteiro
  case
    when e.detalhes ? 'campos_alterados'
      then (select string_agg(k, ', ' order by k)
              from jsonb_object_keys(e.detalhes->'campos_alterados') as k)
    else null
  end                                 as campos_alterados,

  e.detalhes

from public.projeto_eventos e
left join public.projetos  p  on p.id = e.projeto_id
left join public.profiles  pr on pr.user_id = e.usuario_id;

comment on view public.v_projeto_eventos_report is
  'Trilha de eventos do modulo de Projetos com nomes resolvidos (L5). security_invoker=on. Comparacoes de valor sempre como numeric (R-2). teto_rejeitado marcado como anomalia, nao como metrica (D-16).';


-- =====================================================================
-- 3) Grants
-- =====================================================================
grant select on public.v_projeto_resumo          to authenticated;
grant select on public.v_projeto_eventos_report  to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- 4) VERIFICACAO POR LEITURA
-- =====================================================================

-- 4.1 As duas views existem E estao com security_invoker ligado (R-3)
select c.relname as view_name,
       c.reloptions::text as opcoes,
       pg_get_userbyid(c.relowner) as owner,
       (c.reloptions::text ilike '%security_invoker=on%') as invoker_ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='v'
   and c.relname in ('v_projeto_resumo','v_projeto_eventos_report')
 order by c.relname;
-- Esperado: 2 linhas, invoker_ok = true nas duas. Se vier false, PARE: a view
-- estaria expondo todos os projetos a qualquer usuario autenticado.

-- 4.2 Conteudo do resumo (como admin, ve todos)
select projeto, fase_atual, status, orcamento,
       total_budget, total_actual, saldo_actual, pct_comprometido_actual,
       qtd_pedidos_budget, qtd_pedidos_actual,
       actual_rascunho, actual_erro, actual_enviado,
       responsavel, aprovador, ultimo_evento, qtd_eventos
  from public.v_projeto_resumo
 order by projeto;

-- 4.3 Trilha de eventos (deve refletir a validacao do L4 em producao)
select quando_brt, projeto, evento_label, anomalia, fase, sequencia,
       valor_antes, valor_depois, delta_valor, valor_mudou,
       usuario, usuario_era_admin, numero_pedido_alvo, campos_alterados
  from public.v_projeto_eventos_report
 order by quando;
-- Esperado no projeto "Teste Refatoracao": pedido_criado (budget, nfe) ->
-- budget_enviado_aprovacao (nfe) -> budget_aprovado (pedro, usuario_era_admin=true)
-- -> pedido_excluido (actual, nfe) -> pedido_criado (actual, nfe) ->
-- pedido_enviado_alvo. anomalia = false em todos.

-- 4.4 Prova do R-2: nenhum evento deve marcar valor_mudou = true so por escala
select evento_label, valor_antes, valor_depois, valor_mudou, delta_valor
  from public.v_projeto_eventos_report
 where valor_antes is not null and valor_depois is not null
 order by quando;
-- Esperado: valor_mudou = false quando os numeros sao iguais, mesmo que o jsonb
-- tenha gravado "110000" de um lado e "110000.00" do outro.


-- =====================================================================
-- 5) TESTE DE ESCOPO (opcional; Regra 10: sem temp table, rollback no fim)
--    Prova que o security_invoker esta valendo: o operador nao-admin so pode
--    ver os projetos dele. Trocar o sub pelo uid do usuario a testar.
-- =====================================================================
/*
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','<uid-do-usuario-nao-admin>',
                         'role','authenticated')::text, true);
set local role authenticated;
select (select count(*) from public.v_projeto_resumo)         as projetos_visiveis,
       (select count(*) from public.v_projeto_eventos_report) as eventos_visiveis;
rollback;
*/
-- Esperado: contagens MENORES que o total, refletindo o escopo do L3.
-- Se vier o total completo, o security_invoker nao pegou.


-- =====================================================================
-- ROLLBACK:
--   drop view if exists public.v_projeto_resumo;
--   drop view if exists public.v_projeto_eventos_report;
--   notify pgrst, 'reload schema';
-- =====================================================================
