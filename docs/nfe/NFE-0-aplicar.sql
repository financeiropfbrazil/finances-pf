-- =====================================================================
-- NFE-0 — gate da coluna "No Alvo" da tela de Notas Fiscais (PLANO-NFE.md) — 30/10/2026
-- Projeto: hbtggrbauguukewiknew.
-- Problema: depois do commit 92ec62a a tela abre para o papel Analista Fiscal (compras.nfe.access), mas a RPC
-- compras_nfe_no_alvo ainda conferia a chave legada user_permissions('compras'), que só o admin tem → 403 e coluna "?"
-- (11 chamadas recusadas em 30/10 até 09h56 BRT).
-- O QUE FAZ:
--   1. nfe_pode_acessar()  = admin ou compras.nfe.access (ver)        — molde de nfse_pode_acessar()
--   2. nfe_pode_gravar()   = admin ou compras.nfe.create (gravar)
--   3. compras_nfe_no_alvo: só o gate muda; a consulta é a mesma (create or replace preserva o ACL).
-- Rollback: NFE-0-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.compras_nfe_no_alvo(date,date)'::regprocedure)
     <> 'd708176b65dbd0a710c22604faa3ff6a' then
    raise exception 'compras_nfe_no_alvo mudou desde a medição de 30/10 — conferir antes de aplicar';
  end if;
  if to_regprocedure('public.nfe_pode_acessar()') is not null or to_regprocedure('public.nfe_pode_gravar()') is not null then
    raise exception 'nfe_pode_acessar/nfe_pode_gravar já existem — conferir antes de aplicar';
  end if;
end $$;

create function public.nfe_pode_acessar()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public._is_admin() or coalesce(public.user_has_permission(auth.uid(), 'compras.nfe.access'), false);
$$;

create function public.nfe_pode_gravar()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public._is_admin() or coalesce(public.user_has_permission(auth.uid(), 'compras.nfe.create'), false);
$$;

comment on function public.nfe_pode_acessar() is 'NFE-0: ver Notas Fiscais (admin ou compras.nfe.access).';
comment on function public.nfe_pode_gravar() is 'NFE-0: gravar em Notas Fiscais — upload de XML, vínculo de pedido, anexos (admin ou compras.nfe.create).';

revoke execute on function public.nfe_pode_acessar() from public, anon;
revoke execute on function public.nfe_pode_gravar() from public, anon;
grant execute on function public.nfe_pode_acessar() to authenticated;
grant execute on function public.nfe_pode_gravar() to authenticated;

create or replace function public.compras_nfe_no_alvo(p_de date, p_ate date)
returns table(nfe_id uuid, chave_movestq bigint, data_entrada date, fonte text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  -- NFE-0: gate RBAC (compras.nfe.access, papel Analista Fiscal). Antes: chave legada 'compras', que ninguém tinha.
  if not public.nfe_pode_acessar() then
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

do $$
begin
  if has_function_privilege('anon', 'public.nfe_pode_acessar()', 'execute')
     or has_function_privilege('anon', 'public.nfe_pode_gravar()', 'execute')
     or has_function_privilege('anon', 'public.compras_nfe_no_alvo(date,date)', 'execute') then
    raise exception 'ACESSOS: anon ficou com EXECUTE. Transação desfeita.';
  end if;
end $$;
