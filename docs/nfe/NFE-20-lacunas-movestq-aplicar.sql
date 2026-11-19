-- =====================================================================
-- NFE-20 — NF-e lançada no Alvo sem título nem pedido (Pedro, 18–19/11/2026: "Sim")
-- Projeto: hbtggrbauguukewiknew.
-- Problema: a tela de NF-e só reconhece "No Alvo" quando o MovEstq chega ao Hub por um título do contas a pagar
--   (passo B1) ou por um pedido da P&F (passo P). Nota SEM duplicata e SEM pedido nunca é lida — ex.: NF-e 15058
--   da Alegria (bonificação, CFOP 5910, MovEstq 21909). Jul–nov/2026: 131 de 766 NF-e "não encontradas",
--   105 sem duplicata (devolução de amostra, bonificação, retorno, troca, comodato…).
-- Causa: as chaves de MovEstq do Alvo são sequenciais; desde jul/2026 (chave 18128) 2.295 das 4.246 chaves nunca
--   foram lidas pelo Hub. Amostra de 11 (21890–21930, 19/11): 2 NF-e da tela (15058 Alegria, 374 BLUEIT) e 9
--   documentos internos (5 LAUDO, 3 RM, 1 AJUST).
-- Solução (sem mudar a Edge):
--   A) os 2 pontos que casam rastreio_nf por NÚMERO + entidade passam a aceitar só espécie fiscal — laudo, RM e
--      ajuste têm numeração própria do Alvo e não podem "achar" NF-e de mesmo número:
--      compras_nfe_no_alvo (prioridade 3) e rastreio_atualizar_candidatas (no_alvo). Lista = as espécies
--      fiscais que existiam em rastreio_nf em 19/11 (resultado de hoje idêntico, conferido antes/depois).
--   B) rastreio_enfileirar_lacunas(p_limite): põe na fila (rastreio_nf_fila, origem 'lacuna') as chaves entre
--      18128 e a maior chave conhecida que o Hub ainda não leu; a rotina de 3 em 3 min (job 34, passo B2)
--      lê cada uma no Alvo (MovEstq/Load, a mesma leitura de sempre). Nunca acima da maior chave conhecida
--      (chave futura viraria 'nao_encontrada' para sempre). Limite: 400/h de 20h às 7h, 50/h de dia.
--      Job pg_cron 'rastreio-lacunas-movestq' ('17 * * * *').
-- Rollback: NFE-20-lacunas-movestq-rollback.sql.
-- =====================================================================

-- ── A) só espécie fiscal no casamento por número ─────────────────────
do $$
declare
  v_def text; v_old text; v_new text;
  c_fiscal constant text := '(''NF-E'', ''NFS-E'', ''CT-E'', ''DIV'', ''FAT'', ''NF3E'', ''NF3-E'', ''NFCOM'')';
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;

  -- A1. compras_nfe_no_alvo — prioridade 3 ('Alvo (NF ligada a pedido)')
  v_def := pg_get_functiondef('public.compras_nfe_no_alvo(date,date)'::regprocedure);
  if md5(v_def) <> 'ca4072ed6bf5de182da6aaba7f0c5a1e' then
    raise exception 'compras_nfe_no_alvo mudou desde a leitura de 19/11 — conferir';
  end if;
  v_old := E'coalesce(r.status, \'ok\') <> \'nao_encontrada\'\n    union all\n    select nf.id, 4';
  v_new := E'coalesce(r.status, \'ok\') <> \'nao_encontrada\'\n'
        || E'      -- NFE-20: só documento fiscal (laudo, RM e ajuste do Alvo têm numeração própria)\n'
        || E'      and upper(coalesce(r.especie, \'\')) in ' || c_fiscal || E'\n    union all\n    select nf.id, 4';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'A1: trecho não encontrado exatamente 1 vez';
  end if;
  execute replace(v_def, v_old, v_new);

  -- A2. rastreio_atualizar_candidatas — no_alvo por número + entidade
  v_def := pg_get_functiondef('public.rastreio_atualizar_candidatas()'::regprocedure);
  if md5(v_def) <> 'e6a552b9d82d9b3c914bb0cd6a219719' then
    raise exception 'rastreio_atualizar_candidatas mudou desde a leitura de 19/11 — conferir';
  end if;
  v_old := E'e on e.codigo_entidade = n.codigo_entidade\n  ),';
  v_new := E'e on e.codigo_entidade = n.codigo_entidade\n'
        || E'    -- NFE-20: só documento fiscal (laudo, RM e ajuste do Alvo têm numeração própria)\n'
        || E'    where upper(coalesce(n.especie, \'\')) in ' || c_fiscal || E'\n  ),';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'A2: trecho não encontrado exatamente 1 vez';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ── B) fila das chaves de MovEstq nunca lidas ────────────────────────
create function public.rastreio_enfileirar_lacunas(p_limite integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
-- NFE-20 (PLANO-NFE): chaves de MovEstq entre a 1ª de jul/2026 e a maior conhecida que o Hub nunca leu → fila do
-- passo B2 (job 34). Sem p_limite: 400 de 20h às 7h (BRT), 50 de dia. Retorna quantas entraram na fila.
declare
  v_piso   constant bigint := 18128;
  v_teto   bigint;
  v_limite integer;
  v_n      integer;
begin
  select greatest(
           coalesce((select max(r.chave_movestq) from public.rastreio_nf r where r.codigo_empresa_filial = '1.01'), 0),
           coalesce((select max(f.chave_movestq) from public.fin_parcelas_pagar f), 0))::bigint
    into v_teto;
  v_limite := coalesce(p_limite,
                case when extract(hour from now() at time zone 'America/Sao_Paulo') between 7 and 19 then 50 else 400 end);
  if v_limite < 1 or v_limite > 2000 then
    raise exception 'p_limite fora de 1..2000' using errcode = '22023';
  end if;

  insert into public.rastreio_nf_fila (codigo_empresa_filial, chave_movestq, origem, pedido_numero, criado_em)
  select '1.01', l.chave, 'lacuna', null, now()
  from (
    select g::bigint as chave
    from generate_series(v_piso, v_teto) g
    where not exists (select 1 from public.rastreio_nf r where r.codigo_empresa_filial = '1.01' and r.chave_movestq = g)
      and not exists (select 1 from public.fin_parcelas_pagar f where f.chave_movestq = g)
      and not exists (select 1 from public.rastreio_nf_fila q where q.codigo_empresa_filial = '1.01' and q.chave_movestq = g)
    order by g desc
    limit v_limite
  ) l
  on conflict (codigo_empresa_filial, chave_movestq) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.rastreio_enfileirar_lacunas(integer) from public, anon, authenticated;

select cron.schedule('rastreio-lacunas-movestq', '17 * * * *', $cron$ select public.rastreio_enfileirar_lacunas(); $cron$);

-- ── A3) (19/11, após o lote de validação) também só ENTRADA ──────────
-- O 1º lote de 100 trouxe 11 NF-e de SAÍDA (vendas da P&F também são MovEstq, espécie "NF-e"): sem isto, uma venda
-- para o cliente X nº N poderia "achar" uma nota que o próprio X emitiu com o mesmo nº. Antes da NFE-20 todo
-- registro fiscal em rastreio_nf era de entrada ⇒ resultado de hoje inalterado. md5 de antes: f5c46c72… / 60d2da3e…
do $$
declare v_def text; v_old text;
begin
  v_def := pg_get_functiondef('public.compras_nfe_no_alvo(date,date)'::regprocedure);
  if md5(v_def) <> 'f5c46c72e7d451494589dd9b1f0f3a00' then raise exception 'compras_nfe_no_alvo mudou — conferir'; end if;
  v_old := E'      and upper(coalesce(r.especie, \'\')) in (';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'A3.1: trecho ≠ 1'; end if;
  execute replace(v_def, v_old, E'      and r.operacao is distinct from \'Saída\'\n' || v_old);

  v_def := pg_get_functiondef('public.rastreio_atualizar_candidatas()'::regprocedure);
  if md5(v_def) <> '60d2da3e2fe422fb2e717bcdc855a12f' then raise exception 'rastreio_atualizar_candidatas mudou — conferir'; end if;
  v_old := E'    where upper(coalesce(n.especie, \'\')) in (';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'A3.2: trecho ≠ 1'; end if;
  execute replace(v_def, v_old, E'    where n.operacao is distinct from \'Saída\'\n      and upper(coalesce(n.especie, \'\')) in (');
end $$;
