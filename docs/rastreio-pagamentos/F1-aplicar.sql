-- =====================================================================
-- LR-PAG · Fase 1 — Pagamentos no Rastreio com regra de prova
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Lote registrado no
-- PLANO-PEDIDOS.md (§2, §3 e diário de 15/10/2026).
--
-- O que faz (UMA transação; qualquer falha desfaz tudo):
--   0. Pré-voo: fingerprint do projeto + definição atual da MV idêntica à
--      analisada (md5) + ausência de restos de execução anterior.
--   1. Guarda a MV atual como mv_rastreio_compras_v1 (rollback instantâneo)
--      e a recalcula AGORA, para a comparação do passo 6 não ter deriva.
--   2. Cria rastreio_classe_pagamento(): a regra "pago só com prova", num
--      lugar só (MV e RPC usam a mesma).
--   3. Cria a nova mv_rastreio_compras = definição atual + 6 trocas
--      verificadas (cada trecho tem de existir o número exato de vezes).
--   4. Índices e acessos idênticos aos de hoje (sem anon/authenticated).
--   5. As 3 views dependentes passam a ler a MV nova (mesmo texto; md5 conferido).
--   6. Compara nova × antiga linha a linha e ABORTA se mudar algo fora do previsto.
--   7. Cria a RPC rastreio_pagamento_nf(chave) para o card (gate + revoke anon).
--
-- Quando rodar: fora do minuto :50–:59 (refresh do jobid 32) e fora de 06h40.
-- Rollback: F1-rollback.sql.
--
-- Ensaio em modo leitura (15/10/2026, texto deste arquivo, sem criar nada):
-- 2.908 linhas; 25 "Pago (1ª parcela)" → "Aguardando pagamento"; 1 "Pago antes
-- da NF" → "Encerrado sem NF ligada"; 27 datas de 1º pagamento; 77 colunas;
-- moedas por NF: BRL 2.207 · USD 5 · EUR 3 · sem título 200 · mista 0.
-- =====================================================================

-- REPEATABLE READ: todos os comandos leem o MESMO instante do banco, então a
-- comparação do passo 6 não sofre com syncs gravando no meio da transação.
begin transaction isolation level repeatable read;

-- ── 0. Pré-voo ───────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000
     or to_regclass('public.intercompany_invoices_master_blocos_manual') is null
     or to_regclass('public.v_intercompany_master_unificado') is null then
    raise exception 'PRÉ-VOO: este banco não parece o Financial Hub (hbtggrbauguukewiknew). Nada foi alterado.';
  end if;
  if md5(pg_get_viewdef('public.mv_rastreio_compras'::regclass, true)) <> '115593bb827af923bb075a7a798620ad' then
    raise exception 'PRÉ-VOO: a definição de mv_rastreio_compras mudou desde a análise de 15/10. Refazer o ensaio.';
  end if;
  if to_regclass('public.mv_rastreio_compras_v1') is not null
     or to_regprocedure('public.rastreio_classe_pagamento(text,text,text)') is not null
     or to_regprocedure('public.rastreio_pagamento_nf(bigint)') is not null then
    raise exception 'PRÉ-VOO: restos de uma execução anterior (v1/funções já existem). Ver F1-rollback.sql.';
  end if;
end $$;

-- ── 1. Guarda a versão atual (rollback) ──────────────────────────────
alter materialized view public.mv_rastreio_compras rename to mv_rastreio_compras_v1;
alter index public.mv_rastreio_compras_pk rename to mv_rastreio_compras_v1_pk;
alter index public.mv_rastreio_compras_pedido_data_idx rename to mv_rastreio_compras_v1_pedido_data_idx;
refresh materialized view public.mv_rastreio_compras_v1;

-- ── 2. Regra única de pagamento ──────────────────────────────────────
-- Medido em 15/10/2026 no espelho fin_parcelas_pagar (DocFin a pagar):
--   02.002 + NumeroMovCtrlBanc  → dinheiro saiu do banco          → 'pago'
--   02.002 + "BAIXA ADIANTAMENTO" → quitado compensando adiantamento → 'quitado_adto'
--   02.002 sem movimento e sem cobrança conhecida                 → 'baixa_sem_mov' (não conta)
--   02.007 DOCUMENTOS AGRUPADOS → foi para uma fatura agrupadora;
--          o pagamento é da fatura (Fase 2)                       → 'agrupado' (não conta)
--   02.001 em aberto                                               → 'aberto'
--   qualquer outro código                                         → 'desconhecido' (não conta)
-- Projeção do pedido (PC série 0, Realizado=Sim) NÃO passa por aqui: a
-- "data de pagamento" dela é a realização pela NF, nunca um pagamento.
create function public.rastreio_classe_pagamento(p_situacao text, p_mov_ctrl_banc text, p_tipo_cobranca text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case
    when p_situacao = '02.002' and nullif(btrim(p_mov_ctrl_banc), '') is not null then 'pago'
    when p_situacao = '02.002' and p_tipo_cobranca ilike '%BAIXA ADIANTAMENTO%' then 'quitado_adto'
    when p_situacao = '02.002' then 'baixa_sem_mov'
    when p_situacao = '02.007' then 'agrupado'
    when p_situacao = '02.001' then 'aberto'
    else 'desconhecido'
  end
$fn$;
revoke all on function public.rastreio_classe_pagamento(text, text, text) from public, anon, authenticated;

-- ── 3. Nova MV = atual + trocas verificadas ──────────────────────────
do $$
declare
  v text := regexp_replace(pg_get_viewdef('public.mv_rastreio_compras_v1'::regclass, true), ';\s*$', '');
  p text;
begin
  -- Troca 1 (2×, os dois ramos do CTE tit): classe, data de leitura e moeda de cada parcela
  p := 'f\.valor_pago,\s+f\.nome_situacao\s+FROM parc f';
  if regexp_count(v, p) <> 2 then raise exception 'TROCA 1: esperado 2×, achado %×', regexp_count(v, p); end if;
  v := regexp_replace(v, p,
    'f.valor_pago, f.nome_situacao, public.rastreio_classe_pagamento(f.codigo_situacao, f.numero_mov_ctrl_banc, f.tipo_cobranca) AS classe, f.sincronizado_em, f.moeda AS moeda_doc FROM parc f', 'g');

  -- Troca 2: tit_agg — "pagas" e "1º pagamento" só com prova; totais da NF.
  -- MOEDAS (medido em 15/10): valor/valor_original vem na moeda do título
  -- (26 NFs em USD/EUR); valor_pago vem SEMPRE em reais. Por isso total e
  -- em_aberto ficam na moeda do título (tit_moeda) e total_pago/quitado em R$.
  p := 'count\(tit\.data_pagamento\) AS qtd_pagas,\s+min\(tit\.data_pagamento\) AS primeiro_pagamento\s+FROM tit';
  if regexp_count(v, p) <> 1 then raise exception 'TROCA 2: esperado 1×, achado %×', regexp_count(v, p); end if;
  v := regexp_replace(v, p, $r$count(*) FILTER (WHERE tit.classe IN ('pago','quitado_adto')) AS qtd_pagas,
            min(tit.data_pagamento) FILTER (WHERE tit.classe IN ('pago','quitado_adto')) AS primeiro_pagamento,
            sum(tit.valor) AS total,
            sum(tit.valor_pago) FILTER (WHERE tit.classe = 'pago') AS total_pago,
            sum(tit.valor_pago) FILTER (WHERE tit.classe = 'quitado_adto') AS total_quitado_adto,
            sum(tit.valor) FILTER (WHERE tit.classe = 'aberto') AS total_em_aberto,
            count(*) FILTER (WHERE tit.classe IN ('agrupado','baixa_sem_mov','desconhecido')) AS qtd_nao_confirmadas,
            max(tit.data_pagamento) FILTER (WHERE tit.classe IN ('pago','quitado_adto')) AS ultimo_pagamento,
            min(tit.sincronizado_em) AS lido_em,
            CASE WHEN count(DISTINCT tit.moeda_doc) <= 1 THEN min(tit.moeda_doc) ELSE 'MISTA' END AS moeda
           FROM tit$r$);

  -- Troca 3: 1º pagamento do pedido deixa de usar a projeção realizada
  p := 'ELSE b\.proj_primeiro_pagamento';
  if regexp_count(v, p) <> 1 then raise exception 'TROCA 3: esperado 1×, achado %×', regexp_count(v, p); end if;
  v := regexp_replace(v, p, 'ELSE NULL::date');

  -- Trocas 4–6: as colunas novas atravessam base → calc → SELECT final
  p := 'ta\.primeiro_pagamento AS tit_primeiro_pagamento,';
  if regexp_count(v, p) <> 1 then raise exception 'TROCA 4: esperado 1×, achado %×', regexp_count(v, p); end if;
  v := regexp_replace(v, p, 'ta.primeiro_pagamento AS tit_primeiro_pagamento, ta.total AS tit_total, ta.total_pago AS tit_total_pago, ta.total_quitado_adto AS tit_total_quitado_adto, ta.total_em_aberto AS tit_total_em_aberto, ta.qtd_nao_confirmadas AS tit_qtd_nao_confirmadas, ta.ultimo_pagamento AS tit_ultimo_pagamento, ta.lido_em AS tit_lido_em, ta.moeda AS tit_moeda,');

  p := 'b\.tit_primeiro_pagamento,\s+b\.tit_ligacao,';
  if regexp_count(v, p) <> 1 then raise exception 'TROCA 5: esperado 1×, achado %×', regexp_count(v, p); end if;
  v := regexp_replace(v, p, 'b.tit_primeiro_pagamento, b.tit_ligacao, b.tit_total, b.tit_total_pago, b.tit_total_quitado_adto, b.tit_total_em_aberto, b.tit_qtd_nao_confirmadas, b.tit_ultimo_pagamento, b.tit_lido_em, b.tit_moeda,');

  p := 'now\(\) AS atualizado_em\s+FROM calc c';
  if regexp_count(v, p) <> 1 then raise exception 'TROCA 6: esperado 1×, achado %×', regexp_count(v, p); end if;
  v := regexp_replace(v, p, 'now() AS atualizado_em, c.tit_total, c.tit_total_pago, c.tit_total_quitado_adto, c.tit_total_em_aberto, c.tit_qtd_nao_confirmadas, c.tit_ultimo_pagamento, c.tit_lido_em, c.tit_moeda, CASE WHEN c.chave_movestq IS NOT NULL THEN count(*) OVER (PARTITION BY c.chave_movestq) END AS nf_qtd_pedidos FROM calc c');

  execute 'create materialized view public.mv_rastreio_compras as ' || v || ' with data';
end $$;

-- ── 4. Índices e acessos (iguais aos de hoje) ────────────────────────
create unique index mv_rastreio_compras_pk on public.mv_rastreio_compras using btree (pedido_numero, coalesce(chave_movestq, (0)::bigint));
create index mv_rastreio_compras_pedido_data_idx on public.mv_rastreio_compras using btree (pedido_data);
-- O default privileges do Supabase daria tudo a anon/authenticated; hoje a MV não tem isso.
revoke all on public.mv_rastreio_compras from public, anon, authenticated;
grant all on public.mv_rastreio_compras to service_role;
grant select on public.mv_rastreio_compras to klaus_readonly;

-- ── 5. Views dependentes passam a ler a MV nova ──────────────────────
do $$
declare nome text;
begin
  foreach nome in array array['v_rastreio_pedido_fila', 'v_rastreio_b1_prioridade', 'v_rastreio_nf_prioridade'] loop
    execute format('create or replace view public.%I as %s', nome,
      replace(regexp_replace(pg_get_viewdef(format('public.%I', nome)::regclass, true), ';\s*$', ''),
              'mv_rastreio_compras_v1', 'mv_rastreio_compras'));
  end loop;

  -- O texto tem de voltar a ser exatamente o de antes (md5 medido em 15/10).
  if md5(pg_get_viewdef('public.v_rastreio_pedido_fila'::regclass, true))   <> '4b65a356bac80ef2e6c9e85aa8d4403a'
  or md5(pg_get_viewdef('public.v_rastreio_b1_prioridade'::regclass, true)) <> '05d33af313389181049723f2fbd24d91'
  or md5(pg_get_viewdef('public.v_rastreio_nf_prioridade'::regclass, true)) <> '0ed820d3e4c6b03ab313377cf09806df' then
    raise exception 'VIEWS: o texto de alguma view dependente mudou ao reapontar.';
  end if;

  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
             where d.refobjid = 'public.mv_rastreio_compras_v1'::regclass
               and r.ev_class <> 'public.mv_rastreio_compras_v1'::regclass) then
    raise exception 'VIEWS: ainda há view lendo a mv_rastreio_compras_v1.';
  end if;
end $$;

-- ── 6. Comparação nova × antiga (mesmo instante, sem deriva) ─────────
do $$
declare
  n_novo int; n_velho int; sem_par int; outra int; trans_invalida int; mudou_etapa int; mudou_pp int;
begin
  select count(*) into n_novo from public.mv_rastreio_compras;
  select count(*) into n_velho from public.mv_rastreio_compras_v1;

  with j as (
    select n.etapa, o.etapa as etapa_antes, n.primeiro_pagamento, o.primeiro_pagamento as pp_antes,
           n.pedido_numero as ped_novo, o.pedido_numero as ped_velho,
           (to_jsonb(o) - array['etapa','etapa_ordem','primeiro_pagamento','primeiro_pagamento_origem','dias_ciclo_total','dias_nf_pagamento','tit_qtd_pagas','atualizado_em'])
             is distinct from
           (to_jsonb(n) - array['etapa','etapa_ordem','primeiro_pagamento','primeiro_pagamento_origem','dias_ciclo_total','dias_nf_pagamento','tit_qtd_pagas','atualizado_em',
                                'tit_total','tit_total_pago','tit_total_quitado_adto','tit_total_em_aberto','tit_qtd_nao_confirmadas','tit_ultimo_pagamento','tit_lido_em','tit_moeda','nf_qtd_pedidos'])
             as outra_coluna
    from public.mv_rastreio_compras n
    full join public.mv_rastreio_compras_v1 o
      on o.pedido_numero = n.pedido_numero and coalesce(o.chave_movestq, 0) = coalesce(n.chave_movestq, 0)
  )
  select count(*) filter (where ped_novo is null or ped_velho is null),
         count(*) filter (where ped_novo is not null and ped_velho is not null and outra_coluna),
         count(*) filter (where etapa is distinct from etapa_antes
                            and not ((etapa_antes = 'Pago (1ª parcela)' and etapa = 'Aguardando pagamento')
                                  or (etapa_antes = 'Pago antes da NF' and etapa in ('Aguardando NF', 'Encerrado sem NF ligada', 'Pedido em aprovação')))),
         count(*) filter (where etapa is distinct from etapa_antes),
         count(*) filter (where primeiro_pagamento is distinct from pp_antes)
    into sem_par, outra, trans_invalida, mudou_etapa, mudou_pp
  from j;

  raise notice 'COMPARAÇÃO: linhas nova=% antiga=% · sem par=% · outra coluna mudou=% · etapa mudou=% (inválidas=%) · 1º pagamento mudou=%',
    n_novo, n_velho, sem_par, outra, mudou_etapa, trans_invalida, mudou_pp;

  -- Ensaio de 15/10: 26 etapas e 27 datas mudam; teto de 40 deixa folga para o dia.
  if n_novo <> n_velho or sem_par > 0 or outra > 0 or trans_invalida > 0 or mudou_etapa > 40 or mudou_pp > 40 then
    raise exception 'COMPARAÇÃO FALHOU — transação desfeita, nada foi alterado. (nova=% antiga=% sem_par=% outra=% inválidas=% etapa=% 1ºpag=%)',
      n_novo, n_velho, sem_par, outra, trans_invalida, mudou_etapa, mudou_pp;
  end if;
end $$;

-- ── 7. RPC do card: parcelas da NF, classificadas ────────────────────
create function public.rastreio_pagamento_nf(p_chave_movestq bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if not (public._is_admin() or public.user_has_permission(auth.uid(), 'compras.rastreio.access')) then
    raise exception 'Relatório de rastreio: acesso restrito a administradores' using errcode = '42501';
  end if;

  with parc as (
    select f.*,
           public.rastreio_classe_pagamento(f.codigo_situacao, f.numero_mov_ctrl_banc, f.tipo_cobranca) as classe
    from public.fin_parcelas_pagar f
    where f.chave_movestq = p_chave_movestq
      and f.origem = 'Estoque' and f.projecao = 'Não' and f.ausente_no_alvo_em is null
  )
  select jsonb_build_object(
    'chave_movestq', p_chave_movestq,
    'lido_em', (select min(sincronizado_em) from parc),
    'parcelas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'titulo', p.numero,
               'especie', p.especie,
               'sequencia', p.sequencia,
               'parcial', p.parcial,
               'vencimento', coalesce(p.data_prorrogacao, p.data_vencimento),
               'valor', coalesce(p.valor_original, p.valor_bruto),
               'pago_em', p.data_pagamento,
               'valor_pago', p.valor_pago,
               'classe', p.classe,
               'situacao', p.codigo_situacao,
               'situacao_nome', p.nome_situacao,
               'cobranca', p.tipo_cobranca,
               'mov_bancario', nullif(btrim(p.numero_mov_ctrl_banc), ''),
               'moeda', p.moeda,
               'lido_em', p.sincronizado_em)
             order by p.data_vencimento, p.sequencia, p.parcial)
      from parc p), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object('pedido', m.pedido_numero, 'valor_na_nf', m.valor_pedido_na_nf)
             order by m.pedido_numero)
      from public.mv_rastreio_compras m
      where m.chave_movestq = p_chave_movestq), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$fn$;
-- Função nova em public nasce com EXECUTE nominal para anon (default privileges):
-- revoke com a assinatura completa (CLAUDE.md, achado de 08/08/2026).
revoke all on function public.rastreio_pagamento_nf(bigint) from public, anon;
grant execute on function public.rastreio_pagamento_nf(bigint) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.rastreio_pagamento_nf(bigint)', 'execute')
     or has_function_privilege('anon', 'public.rastreio_classe_pagamento(text,text,text)', 'execute')
     or has_table_privilege('anon', 'public.mv_rastreio_compras', 'select')
     or has_table_privilege('authenticated', 'public.mv_rastreio_compras', 'select') then
    raise exception 'ACESSOS: anon/authenticated ficaram com acesso indevido. Transação desfeita.';
  end if;
end $$;

commit;

-- Depois do commit (fora da transação), confira com F1-verificar.sql.
