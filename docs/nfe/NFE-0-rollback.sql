-- NFE-0 — rollback: devolve o gate legado da compras_nfe_no_alvo e tira as 2 funções novas.
-- Só com ordem do Pedro. A ordem importa: primeiro o corpo antigo (que não usa nfe_pode_acessar), depois o drop.

create or replace function public.compras_nfe_no_alvo(p_de date, p_ate date)
returns table(nfe_id uuid, chave_movestq bigint, data_entrada date, fonte text)
language plpgsql
stable security definer
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

-- esperado: md5(prosrc) = d708176b65dbd0a710c22604faa3ff6a
drop function public.nfe_pode_gravar();
drop function public.nfe_pode_acessar();
