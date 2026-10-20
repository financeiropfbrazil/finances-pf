-- =====================================================================
-- NFS-e — CONFERÊNCIA COMPLETA (só leitura). Cole inteira no SQL Editor do Supabase (projeto
-- hbtggrbauguukewiknew) e rode. Uma linha por verificação: o que foi medido, o resultado, o esperado e ok.
-- Horários em Brasília. "Em horário" = dia útil entre 07h00 e 19h00 (quando o job 35 roda).
-- =====================================================================
with
agora as (
  select now() at time zone 'America/Sao_Paulo' as brt,
         extract(isodow from now() at time zone 'America/Sao_Paulo') between 1 and 5
           and (now() at time zone 'America/Sao_Paulo')::time between time '07:10' and time '19:00' as em_horario
),
job as (select jobid, active, schedule from cron.job where jobid in (1, 30, 34, 35)),
adn as (
  select max(finished_at) filter (where coalesce(total_erros, 0) = 0) as ultima_ok,
         count(*) filter (where started_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as runs_hoje,
         count(*) filter (where started_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
                          and coalesce(total_erros, 0) > 0) as erros_hoje,
         count(*) filter (where finished_at is null and started_at < now() - interval '10 minutes') as presas
  from public.sync_runs where job_type = 'nfse_adn'
),
lista as (
  select max(started_at) as ultima, (array_agg(total_erros order by started_at desc))[1] as erros_ultima,
         (array_agg(total_consultados order by started_at desc))[1] as titulos_ultima
  from public.sync_runs where job_type = 'parcelas_pagar' and observacao like '[lista]%'
),
nsu as (select max(nsu) as maximo, count(*) as docs from public.nfse_adn_doc),
fila as (
  select (select count(*) from public.fin_parcelas_pagar where origem = 'Estoque' and load_em is null) as titulos,
         (select count(*) from public.v_rastreio_nf_pendentes) as nfs,
         (select count(*) from public.v_rastreio_pedido_fila) as pedidos,
         (select count(*) from public.rastreio_tentativa where tentativas >= 5) as estacionados
),
mes as (
  select count(*) as recebidas,
         count(*) filter (where situacao_alvo in ('lancada_nfse', 'lancada_outra_especie')) as lancadas,
         count(*) filter (where situacao_alvo = 'nao_lancada' and situacao_fisco = 'normal' and dias_desde_emissao > 15) as nao_lancadas_15d
  from public.v_nfse_recebida
  where data_emissao >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
)
select ordem, verificacao, resultado, esperado,
       case when ok is null then 'ℹ️' when ok then '✅' else '❌' end as ok
from (
  select 1 as ordem, 'Projeto certo (pedidos em compras_pedidos)' as verificacao,
         (select count(*) from public.compras_pedidos)::text as resultado, '≈ 2.300 ou mais' as esperado,
         (select count(*) from public.compras_pedidos) > 2000 as ok
  union all
  select 2, 'Job 35 — leitura do fisco (ADN)', (select case when active then 'ligado' else 'DESLIGADO' end || ' · ' || schedule from job where jobid = 35),
         'ligado · 0,30 10-21 * * 1-5 (07h–18h30, dias úteis)', (select active and schedule = '0,30 10-21 * * 1-5' from job where jobid = 35)
  union all
  select 3, 'Job 30 — contas a pagar do Alvo', (select case when active then 'ligado' else 'DESLIGADO' end || ' · ' || schedule from job where jobid = 30),
         'ligado · 40 9,15 * * 1-5 (06h40 e 12h40)', (select active and schedule = '40 9,15 * * 1-5' from job where jobid = 30)
  union all
  select 4, 'Job 34 — MovEstq e pedidos das NFs', (select case when active then 'ligado' else 'DESLIGADO' end || ' · ' || schedule from job where jobid = 34),
         'ligado · */3 * * * *', (select active from job where jobid = 34)
  union all
  select 5, 'Job 1 — pedidos do Alvo e do Hub', (select case when active then 'ligado' else 'DESLIGADO' end || ' · ' || schedule from job where jobid = 1),
         'ligado · 0 11-20 * * 1-5 (08h–17h)', (select active from job where jobid = 1)
  union all
  select 6, 'Kill-switches (sync_settings)',
         (select string_agg(job_name || '=' || case when enabled then 'ligado' else 'PAUSADO' end, ' · ' order by job_name)
            from public.sync_settings where job_name in ('nfse-adn-sonda', 'sync-parcelas-pagar')),
         'os dois ligados',
         (select count(*) = 2 and bool_and(enabled) from public.sync_settings where job_name in ('nfse-adn-sonda', 'sync-parcelas-pagar'))
  union all
  select 7, 'Última leitura do ADN sem erro',
         (select to_char(ultima_ok at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' (há ' ||
                 round(extract(epoch from now() - ultima_ok) / 60) || ' min)' from adn),
         'há menos de 40 min (em horário)',
         (select case when em_horario then (select ultima_ok > now() - interval '40 minutes' from adn) end from agora)
  union all
  select 8, 'Leituras do ADN hoje / com erro / presas',
         (select runs_hoje || ' / ' || erros_hoje || ' / ' || presas from adn), 'erro 0 e presa 0',
         (select erros_hoje = 0 and presas = 0 from adn)
  union all
  select 9, 'Documentos do ADN sem buraco (NSU)',
         (select 'NSU máx ' || maximo || ' · ' || docs || ' docs · buracos ' || (maximo - docs) from nsu), 'buracos 0',
         (select maximo = docs from nsu)
  union all
  select 10, 'Última leitura do contas a pagar',
         (select to_char(ultima at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' · ' || titulos_ultima || ' títulos · erros ' || erros_ultima from lista),
         'hoje 06h40 ou 12h40 (dia útil), erros 0',
         (select erros_ultima = 0 and ultima > now() - interval '4 days' from lista)
  union all
  select 11, 'Fila do job 34 (títulos / NFs / pedidos / estacionados)',
         (select titulos || ' / ' || nfs || ' / ' || pedidos || ' / ' || estacionados from fila),
         'perto de 0; estacionados 0', (select estacionados = 0 and titulos + nfs + pedidos < 50 from fila)
  union all
  select 12, 'Pedidos — última sincronização',
         (select to_char(max(synced_at) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') from public.compras_pedidos),
         'na última hora (08h–17h, dia útil)', null
  union all
  select 13, 'NFS-e do mês: recebidas / lançadas / não lançadas há +15 dias',
         (select recebidas || ' / ' || lancadas || ' / ' || nao_lancadas_15d from mes), 'mesmos números da tela', null
  union all
  select 14, 'PDFs anexados (nota / boleto)',
         (select count(*) filter (where tipo = 'nf') || ' / ' || count(*) filter (where tipo = 'boleto')
            from public.nfse_anexo where substituido_em is null and removido_em is null),
         'o que foi anexado pela tela', null
) x
order by ordem;
