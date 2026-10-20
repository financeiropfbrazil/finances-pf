-- =====================================================================
-- CARTAO-1 — Base de vencimento por linha no Lançamento de Cartão (/cartao) — 20/10/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro em 20/10/2026: base de vencimento editável por linha,
--   pré-preenchida com o vencimento da fatura na importação, com edição em massa.
--   1. cartao_import_item.data_base_vencimento (date, nula). NULL = linha anterior a esta tarefa: o front exibe e
--      emite o vencimento do lote no lugar — foi o que o Alvo recebeu nelas. SEM backfill (as 583 linhas de hoje
--      ficam intactas, inclusive updated_at).
--   2. fn_cartao_definir_base_vencimento(uuid[], date): SECURITY DEFINER, gate cartao.edit, tudo ou nada.
--      Recusa linha emitida EXPLICITAMENTE: o trg_cartao_item_status só trava UPDATE que tira a linha de
--      'emitido' — um UPDATE que mantém o status passa pelo 1º IF do gatilho.
-- Gateway: nenhuma mudança. O front manda a base da linha no campo data_vencimento de POST /cartao/emitir, que o
--   mapper já usa em DataBaseVencimento e no vencimento/prorrogação da parcela única.
-- ORDEM: aplicar ANTES do merge do front no main (o import grava a coluna nova).
-- Rollback: CARTAO-1-rollback.sql.
-- =====================================================================

-- ── Pré-voo (parar se divergir) ──────────────────────────────────────
-- select count(*) from public.compras_pedidos;                                             -- ≈ 2.311 em 20/10/2026
-- select count(*) from public.cartao_import_item;                                          -- 583 em 20/10/2026
-- select count(*) from information_schema.columns
--  where table_schema = 'public' and table_name = 'cartao_import_item'
--    and column_name = 'data_base_vencimento';                                              -- 0
-- select to_regprocedure('public.fn_cartao_definir_base_vencimento(uuid[],date)');         -- NULL

-- ── 1. Coluna ────────────────────────────────────────────────────────
alter table public.cartao_import_item add column data_base_vencimento date;

comment on column public.cartao_import_item.data_base_vencimento is
  'Base de vencimento do RDESP da linha (DataBaseVencimento e vencimento/prorrogação da parcela no Alvo). '
  'Nasce com o vencimento da fatura na importação e é editável até a emissão. '
  'NULL só em linhas anteriores a 20/10/2026: usar cartao_import_lote.data_vencimento.';

-- ── 2. RPC (uma ou várias linhas) ────────────────────────────────────
create function public.fn_cartao_definir_base_vencimento(p_item_ids uuid[], p_data_base_vencimento date)
returns setof public.cartao_import_item
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pedidas  integer;
  v_achadas  integer;
  v_emitidas integer;
begin
  if not user_has_permission(auth.uid(), 'cartao.edit') then
    raise exception 'Sem permissao cartao.edit';
  end if;

  if p_data_base_vencimento is null then
    raise exception 'Base de vencimento obrigatoria.';
  end if;

  select count(distinct x) into v_pedidas from unnest(p_item_ids) as x;
  if v_pedidas = 0 then
    raise exception 'Nenhuma linha informada.';
  end if;

  -- trava as linhas antes de conferir: nada muda entre a conferência e a gravação
  perform 1 from cartao_import_item where id = any(p_item_ids) for update;

  select count(*), count(*) filter (where status_linha = 'emitido')
    into v_achadas, v_emitidas
    from cartao_import_item
   where id = any(p_item_ids);

  if v_achadas <> v_pedidas then
    raise exception '% de % linha(s) nao encontrada(s).', v_pedidas - v_achadas, v_pedidas;
  end if;

  if v_emitidas > 0 then
    raise exception '% linha(s) ja emitida(s) no Alvo; a base de vencimento delas so muda no Alvo.', v_emitidas;
  end if;

  return query
    with alteradas as (
      update cartao_import_item
         set data_base_vencimento = p_data_base_vencimento
       where id = any(p_item_ids)
      returning *
    )
    select * from alteradas;
end;
$function$;

-- Função nova em public nasce com EXECUTE nominal para anon (default privileges) — revogar com a assinatura completa.
revoke execute on function public.fn_cartao_definir_base_vencimento(uuid[], date) from public;
revoke execute on function public.fn_cartao_definir_base_vencimento(uuid[], date) from anon;
