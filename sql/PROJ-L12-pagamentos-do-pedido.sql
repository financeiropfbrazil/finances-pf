-- =====================================================================
-- PROJ-L12 — Previsão × pagamento real dos pedidos do Projetos
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md seção 3 (L12) — decisões do Pedro em 15/10/2026:
--   a tela mostra a PREVISÃO (parcelas do pedido, editáveis antes do envio) e,
--   depois da NF, o PAGAMENTO REAL (títulos do Alvo); Data da Entrega sai da tela.
--
-- ESTADO: APLICADO em 16/10/2026 (OK do Pedro) pelo MCP, migration proj_l12_pagamentos_do_pedido.
-- Só leitura, sem DELETE/DROP — pode ir pelo MCP. Rollback em PROJ-L12-rollback.sql.
--
-- POR QUE (medido em 15/10/2026, 1.790 pedidos do Alvo com título a pagar):
--   a data da parcela do PEDIDO é previsão — em 87% dos casos o título vence em
--   outra data (média: 34 dias depois) e a condição do título é a do lançamento
--   da NF (igual à do pedido em só 36%). Ex.: 0004817 previa 08/09; a NF entrou
--   16/09 "à vista" e foi paga 16/09 (R$ 780 contra R$ 700 do pedido).
--   Quem define o pagamento é o lançamento da NF no Alvo.
--
-- FONTES (as mesmas do Rastreio de Compras — a tela do Projetos não pode
-- discordar dele):
--   previsão   → compras_pedidos.parcelas (espelho do pedido no Alvo)
--   pedido→NF  → mv_rastreio_compras (o mesmo vínculo da coluna Etapa)
--   títulos    → fin_parcelas_pagar, com os filtros e a regra de prova de
--                rastreio_pagamento_nf (origem Estoque, sem projeção, presente
--                no Alvo; classe por rastreio_classe_pagamento)
-- =====================================================================


-- =====================================================================
-- 0) PRÉ-VOO
-- =====================================================================
-- select (select count(*) from public.compras_pedidos) as compras_pedidos,          -- ~2.295
--        to_regprocedure('public.projeto_pedidos_pagamentos(uuid)') as rpc,         -- null
--        to_regprocedure('public.rastreio_classe_pagamento(text,text,text)') as classe; -- existe


create or replace function public.projeto_pedidos_pagamentos(p_projeto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not public.projeto_pode_ver(p_projeto_id) then
    raise exception 'Sem permissão para ver este projeto' using errcode = '42501';
  end if;

  with peds as (
    select distinct r.numero_pedido_alvo as numero
      from public.projeto_requisicoes r
     where r.projeto_id = p_projeto_id
       and r.numero_pedido_alvo is not null
  ),
  previsao as (
    select cp.numero,
           jsonb_agg(jsonb_build_object(
             'sequencia',  (p->>'sequencia')::int,
             'vencimento', p->>'vencimento',
             'valor',      (p->>'valor')::numeric
           ) order by (p->>'sequencia')::int) as parcelas
      from public.compras_pedidos cp
      join peds on peds.numero = cp.numero
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(cp.parcelas) = 'array' then cp.parcelas else '[]'::jsonb end) p
     group by cp.numero
  ),
  nfs as (
    select distinct m.pedido_numero as numero, m.chave_movestq, m.nf_numero, m.nf_entrada, m.valor_pedido_na_nf
      from public.mv_rastreio_compras m
      join peds on peds.numero = m.pedido_numero
     where m.chave_movestq is not null
  ),
  titulos as (
    select f.chave_movestq,
           jsonb_agg(jsonb_build_object(
             'vencimento', coalesce(f.data_prorrogacao, f.data_vencimento),
             'valor',      coalesce(f.valor_original, f.valor_bruto),
             'pago_em',    f.data_pagamento,
             'valor_pago', f.valor_pago,
             'classe',     public.rastreio_classe_pagamento(f.codigo_situacao, f.numero_mov_ctrl_banc, f.tipo_cobranca),
             'situacao',   f.nome_situacao
           ) order by coalesce(f.data_prorrogacao, f.data_vencimento), f.sequencia, f.parcial) as lista,
           min(f.sincronizado_em) as lido_em
      from public.fin_parcelas_pagar f
     where f.chave_movestq in (select chave_movestq from nfs)
       and f.origem = 'Estoque'
       and f.projecao = 'Não'
       and f.ausente_no_alvo_em is null
     group by f.chave_movestq
  )
  select jsonb_build_object(
           'success', true,
           'pedidos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'numero',   p.numero,
                      'previsao', coalesce(pv.parcelas, '[]'::jsonb),
                      'nfs', coalesce((
                        select jsonb_agg(jsonb_build_object(
                                 'nf',                n.nf_numero,
                                 'entrada',           n.nf_entrada,
                                 'valor_pedido_na_nf', n.valor_pedido_na_nf,
                                 'qtd_pedidos_na_nf', (select count(distinct x.pedido_numero)
                                                         from public.mv_rastreio_compras x
                                                        where x.chave_movestq = n.chave_movestq),
                                 'titulos',           coalesce(t.lista, '[]'::jsonb),
                                 'titulos_lidos_em',  t.lido_em
                               ) order by n.nf_entrada nulls last, n.nf_numero)
                          from nfs n
                          left join titulos t on t.chave_movestq = n.chave_movestq
                         where n.numero = p.numero), '[]'::jsonb)
                    ) order by p.numero)
               from peds p
               left join previsao pv on pv.numero = p.numero), '[]'::jsonb)
         )
    into v_out;

  return v_out;
end;
$$;

revoke execute on function public.projeto_pedidos_pagamentos(uuid) from anon, public;
grant execute on function public.projeto_pedidos_pagamentos(uuid) to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICAÇÃO POR LEITURA (rodar separado)
-- =====================================================================
-- select has_function_privilege('anon', 'public.projeto_pedidos_pagamentos(uuid)', 'EXECUTE') as anon,          -- false
--        has_function_privilege('authenticated', 'public.projeto_pedidos_pagamentos(uuid)', 'EXECUTE') as auth; -- true
