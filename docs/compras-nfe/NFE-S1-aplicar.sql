-- =====================================================================
-- NFE-S1 — Status "No Alvo" das NF-e de /compras/notas-fiscais (19/10/2026)
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Ordem do Pedro em 19/10/2026:
-- "Arrume o status e remova o botão Lançar e a função que o faz".
--
-- Problema: a tela mostrava o status do PRÓPRIO Hub (status_lancamento), que só
-- mudaria se a nota fosse lançada pela tela — o que nunca aconteceu. Resultado:
-- 930 de 932 NF-e "pendentes", 748 delas já lançadas no Alvo.
-- Solução: uma RPC de leitura que diz, para cada NF-e do período, se ela está
-- no Alvo, olhando os espelhos do Alvo (mesma regra do Rastreio,
-- rastreio_atualizar_candidatas → no_alvo, + chave de acesso + ausente_no_alvo_em):
--   1. rastreio_nf.chave_acesso_nfe = chave de acesso de 44 dígitos
--   2. fin_parcelas_pagar (origem Estoque, sem projeção, não excluído no Alvo) — número + CNPJ
--   3. rastreio_nf — número + CNPJ (CNPJ pela entidade do contas a pagar)
--   4. desp_realizado_doc (operação ≠ Saída) — número + CNPJ   [espelho congelado em 06/10]
--   5. intercompany_movestq_cache — número + CNPJ               [espelho congelado em 06/10]
-- Gate: o mesmo da rota (permKey "compras", legado user_permissions) ou admin.
-- Objeto novo; não altera nada existente. Rollback: NFE-S1-rollback.sql.
-- =====================================================================

-- ── Pré-voo (rodar antes; parar se divergir) ─────────────────────────
-- select count(*) from public.compras_pedidos;                         -- ≈ 2.305 em 19/10/2026
-- select to_regprocedure('public.compras_nfe_no_alvo(date,date)');      -- deve ser NULL (não existe)

create function public.compras_nfe_no_alvo(p_de date, p_ate date)
returns table (nfe_id uuid, chave_movestq bigint, data_entrada date, fonte text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not (public._is_admin()
          or exists (select 1 from public.user_permissions up
                     where up.user_id = auth.uid() and up.menu_key = 'compras' and up.allowed)) then
    raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
  end if;

  return query
  with nf as (
    select c.id,
           ltrim(c.numero, '0') as num,
           regexp_replace(coalesce(c.emitente_cnpj, ''), '\D', '', 'g') as cnpj,
           regexp_replace(coalesce(c.chave_acesso, ''), '\D', '', 'g') as chave
    from public.compras_nfe c
    where c.data_emissao between p_de and p_ate
  ),
  ent as (
    select distinct f.codigo_entidade, regexp_replace(f.cpf_cnpj_entidade, '\D', '', 'g') as cnpj
    from public.fin_parcelas_pagar f
    where f.cpf_cnpj_entidade is not null
  ),
  achado as (
    select nf.id, 1 as prio, 'Alvo (chave de acesso)'::text as fonte, r.chave_movestq, r.data_entrada
    from nf
    join public.rastreio_nf r
      on length(nf.chave) = 44
     and regexp_replace(coalesce(r.chave_acesso_nfe, ''), '\D', '', 'g') = nf.chave
    where r.codigo_empresa_filial = '1.01' and coalesce(r.status, 'ok') <> 'nao_encontrada'
    union all
    select nf.id, 2, 'Contas a pagar do Alvo', f.chave_movestq, f.data_entrada
    from nf
    join public.fin_parcelas_pagar f
      on ltrim(f.doc_numero, '0') = nf.num
     and regexp_replace(f.cpf_cnpj_entidade, '\D', '', 'g') = nf.cnpj
    where f.origem = 'Estoque' and f.projecao = 'Não' and f.ausente_no_alvo_em is null
    union all
    select nf.id, 3, 'Alvo (NF ligada a pedido)', r.chave_movestq, r.data_entrada
    from nf
    join ent e on e.cnpj = nf.cnpj
    join public.rastreio_nf r
      on r.codigo_entidade = e.codigo_entidade
     and ltrim(r.numero, '0') = nf.num
    where r.codigo_empresa_filial = '1.01' and coalesce(r.status, 'ok') <> 'nao_encontrada'
    union all
    select nf.id, 4, 'Despesas (espelho)', d.chave_movestq, d.data_movimento
    from nf
    join public.desp_realizado_doc d
      on ltrim(d.numero, '0') = nf.num
     and regexp_replace(d.cpf_cnpj_entidade, '\D', '', 'g') = nf.cnpj
    where d.operacao is distinct from 'Saída'
    union all
    select nf.id, 5, 'Intercompany (espelho)', i.chave_movestq, i.data_entrada
    from nf
    join public.intercompany_movestq_cache i
      on ltrim(i.numero, '0') = nf.num
     and regexp_replace(i.cpf_cnpj_entidade, '\D', '', 'g') = nf.cnpj
  )
  select distinct on (a.id) a.id, a.chave_movestq, a.data_entrada, a.fonte
  from achado a
  order by a.id, a.prio, a.data_entrada desc nulls last;
end;
$function$;

comment on function public.compras_nfe_no_alvo(date, date) is
  'NFE-S1 (19/10/2026): para as NF-e de compras_nfe emitidas no período, a chave do MovEstq no Alvo e onde foi achada. '
  'Só devolve as encontradas; ausente = não encontrada nos espelhos do Alvo. Gate: admin ou permissão legada "compras".';

-- Toda função nova em public nasce com EXECUTE nominal para anon (CLAUDE.md): revogar com a assinatura completa.
revoke execute on function public.compras_nfe_no_alvo(date, date) from anon;
revoke execute on function public.compras_nfe_no_alvo(date, date) from public;
grant execute on function public.compras_nfe_no_alvo(date, date) to authenticated;
