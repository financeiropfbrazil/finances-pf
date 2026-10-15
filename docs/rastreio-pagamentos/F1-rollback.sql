-- =====================================================================
-- LR-PAG · Fase 1 — ROLLBACK
-- Volta ao estado de antes do F1-aplicar.sql usando a cópia guardada
-- (mv_rastreio_compras_v1). Só funciona enquanto a v1 não for apagada
-- (F1-limpeza.sql). Uma transação; qualquer falha desfaz tudo.
-- Quando rodar: fora do minuto :50–:59 (refresh do jobid 32).
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.mv_rastreio_compras_v1') is null then
    raise exception 'ROLLBACK: mv_rastreio_compras_v1 não existe (já limpa?). Rollback por esta via não é possível.';
  end if;
  if to_regclass('public.mv_rastreio_compras_v2') is not null then
    raise exception 'ROLLBACK: mv_rastreio_compras_v2 já existe (rollback anterior pela metade?). Conferir antes.';
  end if;
end $$;

-- 1. A MV nova sai do caminho (as views a acompanham pelo OID)
alter materialized view public.mv_rastreio_compras rename to mv_rastreio_compras_v2;
alter index public.mv_rastreio_compras_pk rename to mv_rastreio_compras_v2_pk;
alter index public.mv_rastreio_compras_pedido_data_idx rename to mv_rastreio_compras_v2_pedido_data_idx;

-- 2. A versão guardada volta ao nome original
alter materialized view public.mv_rastreio_compras_v1 rename to mv_rastreio_compras;
alter index public.mv_rastreio_compras_v1_pk rename to mv_rastreio_compras_pk;
alter index public.mv_rastreio_compras_v1_pedido_data_idx rename to mv_rastreio_compras_pedido_data_idx;

-- 3. As 3 views voltam a ler a versão restaurada (texto e md5 de 15/10)
do $$
declare nome text;
begin
  foreach nome in array array['v_rastreio_pedido_fila', 'v_rastreio_b1_prioridade', 'v_rastreio_nf_prioridade'] loop
    execute format('create or replace view public.%I as %s', nome,
      replace(regexp_replace(pg_get_viewdef(format('public.%I', nome)::regclass, true), ';\s*$', ''),
              'mv_rastreio_compras_v2', 'mv_rastreio_compras'));
  end loop;
  if md5(pg_get_viewdef('public.v_rastreio_pedido_fila'::regclass, true))   <> '4b65a356bac80ef2e6c9e85aa8d4403a'
  or md5(pg_get_viewdef('public.v_rastreio_b1_prioridade'::regclass, true)) <> '05d33af313389181049723f2fbd24d91'
  or md5(pg_get_viewdef('public.v_rastreio_nf_prioridade'::regclass, true)) <> '0ed820d3e4c6b03ab313377cf09806df'
  or md5(pg_get_viewdef('public.mv_rastreio_compras'::regclass, true))      <> '115593bb827af923bb075a7a798620ad' then
    raise exception 'ROLLBACK: o texto restaurado não bate com o de 15/10. Transação desfeita.';
  end if;
end $$;

-- 4. Remove o que a Fase 1 criou (a v2 depende da função de classe: vai antes)
drop materialized view public.mv_rastreio_compras_v2;
drop function public.rastreio_pagamento_nf(bigint);
drop function public.rastreio_classe_pagamento(text, text, text);

-- 5. A versão restaurada estava parada desde a aplicação: recalcula
refresh materialized view public.mv_rastreio_compras;

commit;

-- O frontend da Fase 1 não quebra sem as colunas novas e sem a RPC: os totais
-- aparecem como "—" e o botão de parcelas some. Para voltar o código também:
-- git revert do commit da Fase 1.
