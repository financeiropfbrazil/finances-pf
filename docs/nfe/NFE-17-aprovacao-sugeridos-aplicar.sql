-- =====================================================================
-- NFE-17 — aprovação do pedido e pedidos sugeridos nos Excel (Etapas NF-e/NFS-e e Contabilidade NFS-e) — 11/11/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro (11/11): "Sim, faça coluna nova o que precisar e implante as sugestões
-- nos dois relatórios"; decisões: também os pedidos sugeridos; etapa "Concluída" fica como está.
--
-- O que cria (tudo só leitura, SECURITY DEFINER com gate, sem anon):
--   1. pedidos_aprovacao(numeros[]) → [{numero, status, status_aprovacao, aprovado, aprovado_total, data_aprovacao_alvo}]
--      Gate: nfe_pode_acessar() ou nfse_pode_acessar().
--   2. nfse_pedidos_sugeridos(chaves[]) → [{chave_acesso, candidatos}] — os MESMOS candidatos da etapa 2 do detalhe
--      (nfse_recebida_detalhe, md5 313a5dcd…), calculados em conjunto. Gate nfse_pode_acessar().
--   3. nfe_pedidos_sugeridos(ids[]) → [{id, candidatos}] — os MESMOS da etapa 2 de nfe_recebida_detalhe (md5 74fa7dda…).
--      Gate nfe_pode_acessar().
--   4. _nfse_texto_pedido(xml) — auxiliar interno (descrição do serviço + informações complementares, para achar o
--      número do pedido citado). Sem EXECUTE para anon/authenticated.
--   ⚠️ A regra das sugestões passa a existir em dois lugares (detalhe e lote). Se a regra do detalhe mudar, mudar o lote
--      junto e rodar a conferência de igualdade (NFE-17-aprovacao-sugeridos-verificar.sql).
-- Rollback: NFE-17-aprovacao-sugeridos-rollback.sql (só derruba as funções novas; nada é gravado em tabela).
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if md5(pg_get_functiondef('public.nfse_recebida_detalhe(text)'::regprocedure)) <> '313a5dcd7307a985e806b8087a6f503d'
     or md5(pg_get_functiondef('public.nfe_recebida_detalhe(uuid)'::regprocedure)) <> '74fa7dda3ea7825abf1c43ac8c1beab7' then
    raise exception 'As funções de detalhe mudaram desde a leitura — revisar a cópia da regra antes de aplicar';
  end if;
  if to_regprocedure('public.nfe_pedidos_sugeridos(uuid[])') is not null then
    raise exception 'NFE-17 já aplicada?';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Aprovação dos pedidos (para a coluna "Aprovação do pedido")
-- ---------------------------------------------------------------------
create function public.pedidos_aprovacao(p_numeros text[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
begin
  if not (public.nfe_pode_acessar() or public.nfse_pode_acessar()) then
    raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_numeros), 0) > 5000 then
    raise exception 'No máximo 5.000 pedidos por chamada' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'numero', cp.numero, 'status', cp.status, 'status_aprovacao', cp.status_aprovacao, 'aprovado', cp.aprovado,
             'aprovado_total', cp.status_aprovacao = 'Finalizada' and cp.aprovado = 'Total',
             'data_aprovacao_alvo', cp.data_aprovacao_alvo)
           order by cp.numero)
    from public.compras_pedidos cp
    where cp.codigo_empresa_filial = '1.01' and cp.numero = any (p_numeros)
  ), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------
-- 2. Auxiliar: texto da NFS-e onde se procura o número do pedido (igual ao detalhe: xDescServ + xInfComp;
--    XML ilegível → texto vazio, como o bloco "exception" do detalhe)
-- ---------------------------------------------------------------------
create function public._nfse_texto_pedido(p_xml text)
returns text
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  x xml;
begin
  x := xmlparse(document ltrim(p_xml, chr(65279)));
  return coalesce(public.nfse_adn_xp(x, 'cServ/xDescServ'), '') || ' ' || coalesce(public.nfse_adn_xp(x, 'xInfComp'), '');
exception when others then
  return '';
end;
$fn$;

-- ---------------------------------------------------------------------
-- 3. NFS-e: pedidos sugeridos em lote (cópia da regra de nfse_recebida_detalhe, NFSE-1.11-B/C)
-- ---------------------------------------------------------------------
create function public.nfse_pedidos_sugeridos(p_chaves text[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_espelho date;
begin
  if not public.nfse_pode_acessar() then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_chaves), 0) > 5000 then
    raise exception 'No máximo 5.000 notas por chamada' using errcode = '22023';
  end if;
  v_espelho := (select min(f.data_vencimento) from public.fin_parcelas_pagar f);

  return coalesce((
    with base as materialized (
      select m.chave_acesso, m.numero, m.data_emissao, m.prestador_doc, m.valor_servico, m.situacao_fisco,
             m.situacao_alvo, m.alvo_chave_movestq
      from public.v_nfse_recebida m
    ), nf as materialized (
      -- só notas sem pedido no lançamento do Alvo e com valor (as mesmas em que o detalhe calcula candidatos)
      select b.chave_acesso, b.data_emissao, b.prestador_doc, nullif(b.valor_servico, 0) as v
      from base b
      where b.chave_acesso = any (p_chaves)
        and nullif(b.valor_servico, 0) is not null
        and not exists (select 1 from public.rastreio_nf_pedido p
                         where b.alvo_chave_movestq is not null and p.chave_movestq = b.alvo_chave_movestq
                           and p.codigo_empresa_filial = '1.01')
    ), txt as materialized (
      select nf.chave_acesso,
             coalesce((select public._nfse_texto_pedido(d.xml) from public.nfse_adn_doc d
                        where d.chave_acesso = nf.chave_acesso and d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador'
                        order by d.nsu desc limit 1), '') as t
      from nf
    ), ent as (
      select distinct on (e.codigo_entidade) e.codigo_entidade, regexp_replace(e.cnpj, '\D', '', 'g') as cnpj
      from public.compras_entidades_cache e where e.cnpj is not null
      order by e.codigo_entidade, e.updated_at desc
    ), ped as materialized (
      select cp.numero, cp.nome_entidade, cp.data_pedido, cp.valor_total, cp.status, cp.tipo, cp.status_aprovacao,
             cp.status_local, cp.aprovado, cp.comprado, cp.enviou_aprovacao, cp.proximo_aprovador,
             coalesce(nullif(regexp_replace(coalesce(cp.cnpj_entidade, ''), '\D', '', 'g'), ''), e.cnpj) as cnpj
      from public.compras_pedidos cp
      left join ent e on e.codigo_entidade = cp.codigo_entidade
      where cp.codigo_empresa_filial = '1.01' and cp.numero not like 'RASCUNHO%'
        and coalesce(cp.status, '') not in ('Cancelado', 'Encerrado') and cp.status_local::text <> 'excluido_alvo'
        and coalesce(cp.codigo_ind_economico, '0000001') = '0000001'
        and cp.valor_total > 0
    ), fat as materialized (
      select l.pedido_numero, sum(coalesce(l.valor_itens, l.valor_cabecalho, 0)) as ja_faturado,
             count(distinct l.chave_movestq) as nfs_ligadas
      from public.rastreio_nf_pedido l
      where l.codigo_empresa_filial = '1.01'
      group by l.pedido_numero
    ), c as (
      select nf.chave_acesso as nota, nf.v, nf.data_emissao as emissao, nf.prestador_doc as doc, p.*,
             p.cnpj <> nf.prestador_doc as so_raiz,
             coalesce(fa.ja_faturado, 0) as ja_faturado,
             coalesce(fa.nfs_ligadas, 0) as nfs_ligadas,
             length(ltrim(p.numero, '0')) >= 4
               and tx.t ~ ('(?<![0-9])0*' || ltrim(p.numero, '0') || '(?![0-9])') as citado
      from nf
      join txt tx on tx.chave_acesso = nf.chave_acesso
      join ped p on p.data_pedido between nf.data_emissao - 400 and nf.data_emissao + 60
                and (p.cnpj = nf.prestador_doc or left(p.cnpj, 8) = left(nf.prestador_doc, 8))
      left join fat fa on fa.pedido_numero = p.numero
    ), pend as materialized (
      -- NFSE-1.11-C: NFS-e do mesmo fornecedor ainda não lançadas no Alvo — disputam o mesmo saldo
      select b.chave_acesso, b.numero, b.valor_servico as vm, b.data_emissao as dm, left(b.prestador_doc, 8) as raiz
      from base b
      where b.situacao_fisco = 'normal' and b.situacao_alvo = 'nao_lancada' and b.valor_servico > 0
    ), f as (
      -- NFSE-1.11-B: só entra pedido com SALDO dentro de ±20% da nota; "citado na nota" só põe na frente
      select c.*, c.valor_total - c.ja_faturado as saldo,
             case when c.citado then 1 else 2 end as forca,
             (select jsonb_agg(jsonb_build_object('numero', m.numero, 'valor', m.vm, 'data_emissao', m.dm)
                               order by abs(c.valor_total - c.ja_faturado - m.vm), m.dm)
                from pend m
               where m.chave_acesso <> c.nota and m.raiz = left(c.doc, 8)
                 and abs(c.valor_total - c.ja_faturado - m.vm) <= 0.20 * m.vm
                 and c.data_pedido between m.dm - 400 and m.dm + 60) as disputa
      from c
      where abs(c.valor_total - c.ja_faturado - c.v) <= 0.20 * c.v
    ), g as (
      -- NFSE-1.11-C: outra nota pendente com o valor exato do saldo (±R$ 1) fica com o pedido, se esta não for exata
      select f.* from f
      where abs(f.saldo - f.v) <= 1
         or not exists (select 1 from jsonb_array_elements(coalesce(f.disputa, '[]'::jsonb)) d
                         where abs(f.saldo - (d->>'valor')::numeric) <= 1)
    ), top as (
      select g.*, g.saldo - g.v as dif,
             row_number() over (partition by g.nota
                                order by g.forca, abs(g.saldo - g.v), abs(g.data_pedido - g.emissao), g.numero) as rn
      from g
    ), por_nota as (
      select t.nota,
             jsonb_agg(jsonb_build_object(
               'numero', t.numero, 'fornecedor', t.nome_entidade, 'data_pedido', t.data_pedido,
               'valor_pedido', t.valor_total, 'ja_faturado', t.ja_faturado, 'saldo', t.saldo, 'nfs_ligadas', t.nfs_ligadas,
               'status', t.status, 'aprovacao', t.status_aprovacao, 'natureza', t.tipo, 'so_raiz_cnpj', t.so_raiz,
               'status_local', t.status_local, 'status_aprovacao', t.status_aprovacao, 'aprovado', t.aprovado,
               'comprado', t.comprado, 'enviou_aprovacao', t.enviou_aprovacao, 'proximo_aprovador', t.proximo_aprovador,
               'forca', t.forca,
               'motivo', case t.forca when 1 then 'Número do pedido citado na nota e saldo dentro de ±20% do valor da nota'
                                      else 'Saldo do pedido dentro de ±20% do valor da nota' end,
               'diferenca', round(t.dif, 2), 'diferenca_pct', round(100 * t.dif / t.v, 1),
               'disputa', coalesce(t.disputa, '[]'::jsonb), 'saldo_nao_confirmado', t.data_pedido < v_espelho)
             order by t.rn) as candidatos
      from top t
      where t.rn <= 3
      group by t.nota
    )
    select jsonb_agg(jsonb_build_object('chave_acesso', pn.nota, 'candidatos', pn.candidatos))
    from por_nota pn
  ), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------
-- 4. NF-e: pedidos sugeridos em lote (cópia da regra de nfe_recebida_detalhe, NFE-3/NFE-3-A)
-- ---------------------------------------------------------------------
create function public.nfe_pedidos_sugeridos(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_espelho date;
  v_de      date;
  v_ate     date;
begin
  if not public.nfe_pode_acessar() then
    raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 5000 then
    raise exception 'No máximo 5.000 notas por chamada' using errcode = '22023';
  end if;
  v_espelho := (select min(f.data_vencimento) from public.fin_parcelas_pagar f);
  select min(n.data_emissao), max(n.data_emissao) into v_de, v_ate from public.compras_nfe n where n.id = any (p_ids);
  if v_de is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with alvo_nota as materialized (
      -- lançamento no Alvo de cada nota (o detalhe usa compras_nfe_no_alvo do dia da emissão)
      select a.nfe_id, a.chave_movestq from public.compras_nfe_no_alvo(v_de, v_ate) a where a.nfe_id = any (p_ids)
    ), nf as materialized (
      select n.id, n.data_emissao, nullif(n.valor_total, 0) as v, n.status_lancamento, n.pedido_compra_numero,
             regexp_replace(coalesce(n.emitente_cnpj, ''), '\D', '', 'g') as cnpj,
             coalesce((select string_agg(m[1], ' ') from regexp_matches(coalesce(n.raw_xml, ''), '<xPed>([^<]*)</xPed>', 'g') m), '')
               || ' ' || coalesce(substring(coalesce(n.raw_xml, '') from '<infCpl>([^<]*)</infCpl>'), '') as txt
      from public.compras_nfe n
      where n.id = any (p_ids)
        and nullif(n.valor_total, 0) is not null
        and length(regexp_replace(coalesce(n.emitente_cnpj, ''), '\D', '', 'g')) = 14
        -- faturável (NFE-8): sem itens lidos, ou algum item com CFOP de venda
        and (jsonb_typeof(n.dados_extraidos->'itens') is distinct from 'array'
             or jsonb_array_length(n.dados_extraidos->'itens') = 0
             or exists (select 1 from jsonb_array_elements(n.dados_extraidos->'itens') i
                         where coalesce(i->>'cfop', '') ~ '^[567](1[0-2][0-9]|40[0-9]|551|92[29]|933)$'))
        -- sem pedido no lançamento do Alvo
        and not exists (select 1 from alvo_nota a
                          join public.rastreio_nf_pedido p on p.chave_movestq = a.chave_movestq and p.codigo_empresa_filial = '1.01'
                         where a.nfe_id = n.id)
    ), vhub as (
      -- vínculo feito no Hub (botão "Vincular") — esses pedidos não voltam como sugestão
      select v2.nfe_id, v2.pedido_numero as numero
      from public.compras_nfe_pedidos v2
      join nf on nf.id = v2.nfe_id and nf.status_lancamento = 'vinculada'
      union all
      select nf.id, nf.pedido_compra_numero
      from nf
      where nf.status_lancamento = 'vinculada' and nf.pedido_compra_numero is not null
        and not exists (select 1 from public.compras_nfe_pedidos v3 where v3.nfe_id = nf.id)
    ), ent as (
      select distinct on (e.codigo_entidade) e.codigo_entidade, regexp_replace(e.cnpj, '\D', '', 'g') as cnpj
      from public.compras_entidades_cache e where e.cnpj is not null
      order by e.codigo_entidade, e.updated_at desc
    ), ped as materialized (
      select cp.numero, cp.nome_entidade, cp.data_pedido, cp.valor_total, cp.status, cp.tipo, cp.status_aprovacao,
             cp.status_local, cp.aprovado, cp.comprado, cp.enviou_aprovacao, cp.proximo_aprovador,
             coalesce(nullif(regexp_replace(coalesce(cp.cnpj_entidade, ''), '\D', '', 'g'), ''), e.cnpj) as cnpj
      from public.compras_pedidos cp
      left join ent e on e.codigo_entidade = cp.codigo_entidade
      where cp.codigo_empresa_filial = '1.01' and cp.numero not like 'RASCUNHO%'
        and coalesce(cp.status, '') not in ('Cancelado', 'Encerrado') and cp.status_local::text <> 'excluido_alvo'
        and coalesce(cp.codigo_ind_economico, '0000001') = '0000001'
        and cp.valor_total > 0
    ), achadas as materialized (
      select a.nfe_id from public.compras_nfe_no_alvo(coalesce(v_espelho, v_de - 400), current_date + 30) a
    ), hub as materialized (
      -- NFE-3-A: NF-e vinculadas NO HUB a um pedido e que o Alvo ainda não tem — contam como saldo usado do pedido
      select v2.nfe_id, v2.pedido_numero, m.numero, m.valor_total, m.data_emissao,
             v2.is_principal or (select count(*) from public.compras_nfe_pedidos v3 where v3.nfe_id = v2.nfe_id) = 1 as consome
      from public.compras_nfe_pedidos v2
      join public.compras_nfe m on m.id = v2.nfe_id and m.status_lancamento = 'vinculada'
      where v2.codigo_empresa_filial = '1.01'
        and not exists (select 1 from achadas a where a.nfe_id = v2.nfe_id)
    ), fat as materialized (
      select l.pedido_numero, sum(coalesce(l.valor_itens, l.valor_cabecalho, 0)) as ja_faturado,
             count(distinct l.chave_movestq) as nfs_ligadas
      from public.rastreio_nf_pedido l
      where l.codigo_empresa_filial = '1.01'
      group by l.pedido_numero
    ), c as (
      select nf.id as nota, nf.v, nf.data_emissao as emissao, nf.cnpj as doc, p.*,
             p.cnpj <> nf.cnpj as so_raiz,
             coalesce((select sum(h.valor_total) from hub h
                        where h.pedido_numero = p.numero and h.consome and h.nfe_id <> nf.id), 0) as hub_reservado,
             (select jsonb_agg(jsonb_build_object('numero', h.numero, 'valor', h.valor_total, 'data_emissao', h.data_emissao)
                               order by h.data_emissao)
                from hub h where h.pedido_numero = p.numero and h.nfe_id <> nf.id) as vinculado_hub_a,
             coalesce(fa.ja_faturado, 0) as ja_faturado,
             coalesce(fa.nfs_ligadas, 0) as nfs_ligadas,
             length(ltrim(p.numero, '0')) >= 4
               and nf.txt ~ ('(?<![0-9])0*' || ltrim(p.numero, '0') || '(?![0-9])') as citado
      from nf
      join ped p on p.data_pedido between nf.data_emissao - 400 and nf.data_emissao + 60
                and (p.cnpj = nf.cnpj or left(p.cnpj, 8) = left(nf.cnpj, 8))
                and not exists (select 1 from vhub vh where vh.nfe_id = nf.id and vh.numero = p.numero)
      left join fat fa on fa.pedido_numero = p.numero
    ), c2 as (
      select c.*, c.valor_total - c.ja_faturado - c.hub_reservado as saldo_calc from c
    ), pend as materialized (
      select m.id, m.numero, m.valor_total as vm, m.data_emissao as dm,
             left(regexp_replace(coalesce(m.emitente_cnpj, ''), '\D', '', 'g'), 8) as raiz
      from public.compras_nfe m
      where m.valor_total > 0 and m.data_emissao >= v_espelho
        and not exists (select 1 from achadas a where a.nfe_id = m.id)
        and coalesce(m.status_lancamento, 'pendente') <> 'vinculada'
        and (jsonb_typeof(m.dados_extraidos->'itens') <> 'array' or jsonb_array_length(m.dados_extraidos->'itens') = 0
             or exists (select 1 from jsonb_array_elements(m.dados_extraidos->'itens') i
                         where coalesce(i->>'cfop', '') ~ '^[567](1[0-2][0-9]|40[0-9]|551|92[29]|933)$'))
    ), f as (
      select c.*, c.saldo_calc as saldo,
             case when c.citado then 1 else 2 end as forca,
             (select jsonb_agg(jsonb_build_object('numero', m.numero, 'valor', m.vm, 'data_emissao', m.dm)
                               order by abs(c.saldo_calc - m.vm), m.dm)
                from pend m
               where m.id <> c.nota and m.raiz = left(c.doc, 8)
                 and abs(c.saldo_calc - m.vm) <= 0.20 * m.vm
                 and c.data_pedido between m.dm - 400 and m.dm + 60) as disputa
      from c2 c
      where abs(c.saldo_calc - c.v) <= 0.20 * c.v
    ), g as (
      select f.* from f
      where abs(f.saldo - f.v) <= 1
         or not exists (select 1 from jsonb_array_elements(coalesce(f.disputa, '[]'::jsonb)) d
                         where abs(f.saldo - (d->>'valor')::numeric) <= 1)
    ), top as (
      select g.*, g.saldo - g.v as dif,
             row_number() over (partition by g.nota
                                order by g.forca, abs(g.saldo - g.v), abs(g.data_pedido - g.emissao), g.numero) as rn
      from g
    ), por_nota as (
      select t.nota,
             jsonb_agg(jsonb_build_object(
               'numero', t.numero, 'fornecedor', t.nome_entidade, 'data_pedido', t.data_pedido,
               'valor_pedido', t.valor_total, 'ja_faturado', t.ja_faturado, 'saldo', t.saldo, 'nfs_ligadas', t.nfs_ligadas,
               'status', t.status, 'aprovacao', t.status_aprovacao, 'natureza', t.tipo, 'so_raiz_cnpj', t.so_raiz,
               'status_local', t.status_local, 'status_aprovacao', t.status_aprovacao, 'aprovado', t.aprovado,
               'comprado', t.comprado, 'enviou_aprovacao', t.enviou_aprovacao, 'proximo_aprovador', t.proximo_aprovador,
               'forca', t.forca,
               'motivo', case t.forca when 1 then 'Número do pedido citado na nota (xPed ou informações complementares) e saldo dentro de ±20% do valor da nota'
                                      else 'Saldo do pedido dentro de ±20% do valor da nota' end,
               'diferenca', round(t.dif, 2), 'diferenca_pct', round(100 * t.dif / t.v, 1),
               'disputa', coalesce(t.disputa, '[]'::jsonb), 'saldo_nao_confirmado', t.data_pedido < v_espelho,
               'hub_reservado', t.hub_reservado, 'vinculado_hub_a', coalesce(t.vinculado_hub_a, '[]'::jsonb))
             order by t.rn) as candidatos
      from top t
      where t.rn <= 3
      group by t.nota
    )
    select jsonb_agg(jsonb_build_object('id', pn.nota, 'candidatos', pn.candidatos))
    from por_nota pn
  ), '[]'::jsonb);
end;
$fn$;

comment on function public.pedidos_aprovacao(text[]) is 'NFE-17: aprovação dos pedidos (coluna "Aprovação do pedido" dos Excel de notas).';
comment on function public.nfse_pedidos_sugeridos(text[]) is 'NFE-17: candidatos da etapa 2 da NFS-e em lote (Excel). Mesma regra de nfse_recebida_detalhe — mudar as duas juntas.';
comment on function public.nfe_pedidos_sugeridos(uuid[]) is 'NFE-17: candidatos da etapa 2 da NF-e em lote (Excel). Mesma regra de nfe_recebida_detalhe — mudar as duas juntas.';
comment on function public._nfse_texto_pedido(text) is 'NFE-17: auxiliar interno de nfse_pedidos_sugeridos.';

-- Toda função nova em public nasce com EXECUTE nominal para anon (default privileges do Supabase): tirar com a assinatura.
revoke execute on function public.pedidos_aprovacao(text[]) from public, anon;
revoke execute on function public.nfse_pedidos_sugeridos(text[]) from public, anon;
revoke execute on function public.nfe_pedidos_sugeridos(uuid[]) from public, anon;
revoke execute on function public._nfse_texto_pedido(text) from public, anon, authenticated;
