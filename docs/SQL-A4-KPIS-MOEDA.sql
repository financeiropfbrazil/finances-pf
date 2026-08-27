-- =====================================================================
-- A4 — KPIs por moeda (opção B com as duas condições do Pedro)
-- MOEDA-PEDIDOS · 26/08/2026
-- =====================================================================
--
-- REGRA DE BUCKET (a mesma nas três funções):
--   USD  = codigo_ind_economico = '0000002'
--   EUR  = codigo_ind_economico = '0000003'
--   BRL  = '0000001'  OU  (NULL e o fornecedor NUNCA teve pedido em moeda
--          estrangeira)  -- o "BRL presumido", sempre DECLARADO na tela
--   FORA = NULL e o fornecedor JA teve pedido em moeda estrangeira
--          -- nao entra em nenhuma soma; e o balde da duvida
--
-- Por que a exclusao e por ENTIDADE e nao por lista de nomes: a lista de
-- fornecedores estrangeiros envelhece e nao pega o caso novo. "Entidade que
-- ja teve pedido em moeda estrangeira" e evidencia dura, se auto-mantem e
-- encolhe sozinha conforme o cron preenche a moeda dos vivos.
-- Medido 26/08/2026, janela de 90 dias: 7 pedidos caem em FORA, dos quais
-- apenas 0004741 (PARALLELS GMBH, 883,33) tem valor > 0 — 0,03% do bucket
-- sem-moeda. Os outros 6 sao de valor zero.
--
-- ORDEM E RISCO: mudar RETURNS TABLE exige DROP + CREATE (o
-- CREATE OR REPLACE recusa mudanca de tipo de retorno). DROP e CREATE vao
-- JUNTOS no mesmo bloco DE PROPOSITO: entre um e outro o dashboard fica
-- sem a funcao. E a unica excecao ao "um comando por bloco" aqui, e e para
-- encurtar a janela quebrada, nao por comodidade.
--
-- O DROP APAGA O ACL. Funcao recriada em `public` NASCE com EXECUTE
-- concedido NOMINALMENTE a `anon` (default privilege do Supabase). Por isso
-- cada funcao tem seu REVOKE + GRANT logo abaixo — nao pule.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 1 — dashboard_supr_valor_medio (DROP + CREATE, juntos)
-- ---------------------------------------------------------------------
drop function if exists public.dashboard_supr_valor_medio(date, date);
create function public.dashboard_supr_valor_medio(
  p_data_de date default null,
  p_data_ate date default null
)
returns table(
  qtd bigint, valor_medio numeric, valor_min numeric, valor_max numeric, valor_total numeric,
  qtd_sem_moeda bigint, valor_sem_moeda numeric,
  qtd_usd bigint, valor_usd numeric,
  qtd_eur bigint, valor_eur numeric,
  qtd_fora bigint, valor_fora numeric
)
language sql
stable
as $fn$
  with estrangeiras as (
    select distinct codigo_entidade
    from public.compras_pedidos
    where codigo_ind_economico in ('0000002','0000003')
      and codigo_entidade is not null
  ),
  base as (
    select p.valor_total,
           case
             when p.codigo_ind_economico = '0000002' then 'USD'
             when p.codigo_ind_economico = '0000003' then 'EUR'
             when p.codigo_ind_economico = '0000001' then 'BRL'
             when e.codigo_entidade is not null      then 'FORA'
             else 'BRL_PRESUMIDO'
           end as bucket
    from public.compras_pedidos p
    left join estrangeiras e on e.codigo_entidade = p.codigo_entidade
    where p.valor_total is not null
      and p.valor_total > 0
      and (p_data_de  is null or p.data_pedido >= p_data_de)
      and (p_data_ate is null or p.data_pedido <= p_data_ate)
  )
  select
    count(*) filter (where bucket in ('BRL','BRL_PRESUMIDO'))::bigint,
    round(avg(valor_total) filter (where bucket in ('BRL','BRL_PRESUMIDO'))::numeric, 2),
    round(min(valor_total) filter (where bucket in ('BRL','BRL_PRESUMIDO'))::numeric, 2),
    round(max(valor_total) filter (where bucket in ('BRL','BRL_PRESUMIDO'))::numeric, 2),
    round(coalesce(sum(valor_total) filter (where bucket in ('BRL','BRL_PRESUMIDO')), 0)::numeric, 2),
    count(*) filter (where bucket = 'BRL_PRESUMIDO')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'BRL_PRESUMIDO'), 0)::numeric, 2),
    count(*) filter (where bucket = 'USD')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'USD'), 0)::numeric, 2),
    count(*) filter (where bucket = 'EUR')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'EUR'), 0)::numeric, 2),
    count(*) filter (where bucket = 'FORA')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'FORA'), 0)::numeric, 2)
  from base;
$fn$;


-- BLOCO 2 — fechar a funcao 1 (o DROP apagou o ACL)
revoke execute on function public.dashboard_supr_valor_medio(date, date) from public, anon;


-- BLOCO 3 — devolver a quem usa
grant execute on function public.dashboard_supr_valor_medio(date, date) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- BLOCO 4 — dashboard_supr_aguardando_aprovacao (DROP + CREATE, juntos)
-- `qtd` continua sendo a FILA INTEIRA (todas as moedas): "quantos pedidos
-- estao parados" nao tem problema de moeda — contagem nao se soma errado.
-- So o VALOR e separado por bucket.
-- ---------------------------------------------------------------------
drop function if exists public.dashboard_supr_aguardando_aprovacao();
create function public.dashboard_supr_aguardando_aprovacao()
returns table(
  qtd bigint, valor_total numeric, dias_espera_max numeric, dias_espera_mediana numeric,
  qtd_sem_moeda bigint, valor_sem_moeda numeric,
  qtd_usd bigint, valor_usd numeric,
  qtd_eur bigint, valor_eur numeric,
  qtd_fora bigint, valor_fora numeric
)
language sql
stable
as $fn$
  with estrangeiras as (
    select distinct codigo_entidade
    from public.compras_pedidos
    where codigo_ind_economico in ('0000002','0000003')
      and codigo_entidade is not null
  ),
  fila as (
    select coalesce(p.valor_total, 0) as valor_total,
           extract(epoch from (now() - p.data_digitacao_alvo)) / 86400.0 as dias_espera,
           case
             when p.codigo_ind_economico = '0000002' then 'USD'
             when p.codigo_ind_economico = '0000003' then 'EUR'
             when p.codigo_ind_economico = '0000001' then 'BRL'
             when e.codigo_entidade is not null      then 'FORA'
             else 'BRL_PRESUMIDO'
           end as bucket
    from public.compras_pedidos p
    left join estrangeiras e on e.codigo_entidade = p.codigo_entidade
    where p.status_aprovacao in ('Em Andamento', 'Reavaliar')
      and p.status not in ('Cancelado', 'Cancelado Parcial', 'Encerrado')
  )
  select
    count(*)::bigint,
    round(coalesce(sum(valor_total) filter (where bucket in ('BRL','BRL_PRESUMIDO')), 0)::numeric, 2),
    round(max(dias_espera)::numeric, 1),
    round(percentile_cont(0.5) within group (order by dias_espera)::numeric, 1),
    count(*) filter (where bucket = 'BRL_PRESUMIDO')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'BRL_PRESUMIDO'), 0)::numeric, 2),
    count(*) filter (where bucket = 'USD')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'USD'), 0)::numeric, 2),
    count(*) filter (where bucket = 'EUR')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'EUR'), 0)::numeric, 2),
    count(*) filter (where bucket = 'FORA')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'FORA'), 0)::numeric, 2)
  from fila;
$fn$;


-- BLOCO 5
revoke execute on function public.dashboard_supr_aguardando_aprovacao() from public, anon;


-- BLOCO 6
grant execute on function public.dashboard_supr_aguardando_aprovacao() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- BLOCO 7 — dashboard_supr_volume_mensal (DROP + CREATE, juntos)
-- O grafico plota valor_total (BRL). As series USD/EUR vao junto para a
-- tela poder declarar o que ficou de fora em cada mes.
-- ---------------------------------------------------------------------
drop function if exists public.dashboard_supr_volume_mensal();
create function public.dashboard_supr_volume_mensal()
returns table(
  mes text, qtd bigint, valor_total numeric,
  qtd_sem_moeda bigint, valor_sem_moeda numeric,
  valor_usd numeric, valor_eur numeric, valor_fora numeric
)
language sql
stable
as $fn$
  with estrangeiras as (
    select distinct codigo_entidade
    from public.compras_pedidos
    where codigo_ind_economico in ('0000002','0000003')
      and codigo_entidade is not null
  ),
  base as (
    select to_char(p.data_pedido, 'YYYY-MM') as mes,
           coalesce(p.valor_total, 0) as valor_total,
           case
             when p.codigo_ind_economico = '0000002' then 'USD'
             when p.codigo_ind_economico = '0000003' then 'EUR'
             when p.codigo_ind_economico = '0000001' then 'BRL'
             when e.codigo_entidade is not null      then 'FORA'
             else 'BRL_PRESUMIDO'
           end as bucket
    from public.compras_pedidos p
    left join estrangeiras e on e.codigo_entidade = p.codigo_entidade
    where p.data_pedido is not null
      and p.data_pedido >= (date_trunc('month', current_date) - interval '5 months')::date
  )
  select
    mes,
    count(*)::bigint,
    round(coalesce(sum(valor_total) filter (where bucket in ('BRL','BRL_PRESUMIDO')), 0)::numeric, 2),
    count(*) filter (where bucket = 'BRL_PRESUMIDO')::bigint,
    round(coalesce(sum(valor_total) filter (where bucket = 'BRL_PRESUMIDO'), 0)::numeric, 2),
    round(coalesce(sum(valor_total) filter (where bucket = 'USD'), 0)::numeric, 2),
    round(coalesce(sum(valor_total) filter (where bucket = 'EUR'), 0)::numeric, 2),
    round(coalesce(sum(valor_total) filter (where bucket = 'FORA'), 0)::numeric, 2)
  from base
  group by mes
  order by mes asc;
$fn$;


-- BLOCO 8
revoke execute on function public.dashboard_supr_volume_mensal() from public, anon;


-- BLOCO 9
grant execute on function public.dashboard_supr_volume_mensal() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- BLOCO 10 — VERIFY de ACL. Esperado: 3 linhas, anon_pode = false,
-- auth_pode = true. Se anon_pode vier true, o REVOKE nao pegou.
-- ---------------------------------------------------------------------
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_pode,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_pode,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as svc_pode
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('dashboard_supr_valor_medio',
                    'dashboard_supr_aguardando_aprovacao',
                    'dashboard_supr_volume_mensal')
order by p.proname;


-- ---------------------------------------------------------------------
-- BLOCO 11 — VERIFY de dados. Roda a funcao e mostra a composicao.
-- ---------------------------------------------------------------------
select qtd, valor_total, qtd_sem_moeda, valor_sem_moeda,
       qtd_usd, valor_usd, qtd_eur, valor_eur, qtd_fora, valor_fora
from public.dashboard_supr_valor_medio(
  (current_date - interval '90 days')::date,
  current_date
);


-- ---------------------------------------------------------------------
-- BLOCO 12 — VERIFY das outras duas (nao devem dar erro de coluna)
-- ---------------------------------------------------------------------
select * from public.dashboard_supr_aguardando_aprovacao();


-- =====================================================================
-- ROLLBACK — GUARDAR, NAO EXECUTAR
-- Restaura as tres funcoes como estavam antes do A4. O ACL original
-- incluia anon (=X/postgres + anon=X/postgres); o rollback abaixo NAO
-- devolve anon de proposito — reabrir seria regressao de seguranca.
-- =====================================================================
-- drop function if exists public.dashboard_supr_valor_medio(date, date);
-- create function public.dashboard_supr_valor_medio(p_data_de date default null, p_data_ate date default null)
-- returns table(qtd bigint, valor_medio numeric, valor_min numeric, valor_max numeric, valor_total numeric)
-- language sql stable as $fn$
--   select count(*)::bigint, round(avg(valor_total)::numeric,2), round(min(valor_total)::numeric,2),
--          round(max(valor_total)::numeric,2), round(sum(valor_total)::numeric,2)
--   from compras_pedidos
--   where valor_total is not null and valor_total > 0
--     and (p_data_de is null or data_pedido >= p_data_de)
--     and (p_data_ate is null or data_pedido <= p_data_ate);
-- $fn$;
-- grant execute on function public.dashboard_supr_valor_medio(date, date) to authenticated, service_role;
