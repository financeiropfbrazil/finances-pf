-- NFE-3-A — rollback: volta o corpo da NFE-3 exatamente como está no banco (md5 0059fe2b35ec6335ef017d981780e163).
-- Só com ordem do Pedro.
create or replace function public.nfe_recebida_detalhe(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  n            public.compras_nfe%rowtype;
  v_alvo_id    uuid;
  v_alvo_data  date;
  v_alvo_fonte text;
  v_itens      jsonb;
  v_txt        text;
  v_cnpj       text;
  v_faturavel  boolean;
  v_situacao   text;
  v_chave_mov  bigint;
  v_hub        jsonb := '[]'::jsonb;
  v_vinculados jsonb := '[]'::jsonb;
  v_candidatos jsonb := '[]'::jsonb;
  v_movestq    jsonb;
  v_anexos     jsonb := '[]'::jsonb;
  v_parcelas   jsonb := '[]'::jsonb;
  v_extra      jsonb;
  v            numeric;
  v_espelho    date;
begin
  if not public.nfe_pode_acessar() then
    raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
  end if;

  select * into n from public.compras_nfe where id = p_id;
  if not found then
    return null;
  end if;
  v := nullif(n.valor_total, 0);
  v_espelho := (select min(f.data_vencimento) from public.fin_parcelas_pagar f);
  v_cnpj := regexp_replace(coalesce(n.emitente_cnpj, ''), '\D', '', 'g');
  v_itens := case when jsonb_typeof(n.dados_extraidos->'itens') = 'array' then n.dados_extraidos->'itens' else '[]'::jsonb end;
  v_faturavel := jsonb_array_length(v_itens) = 0
                 or exists (select 1 from jsonb_array_elements(v_itens) i
                             where coalesce(i->>'cfop', '') ~ '^[567](1[0-2][0-9]|40[0-9]|551|92[29]|933)$');

  v_txt := coalesce((select string_agg(m[1], ' ') from regexp_matches(coalesce(n.raw_xml, ''), '<xPed>([^<]*)</xPed>', 'g') m), '')
           || ' ' || coalesce(substring(coalesce(n.raw_xml, '') from '<infCpl>([^<]*)</infCpl>'), '');

  v_extra := jsonb_strip_nulls(jsonb_build_object(
    'informacoes_complementares', substring(coalesce(n.raw_xml, '') from '<infCpl>([^<]*)</infCpl>'),
    'pedidos_citados', (select jsonb_agg(distinct btrim(m[1])) from regexp_matches(coalesce(n.raw_xml, ''), '<xPed>([^<]*)</xPed>', 'g') m),
    'emitente_uf_xml', substring(coalesce(n.raw_xml, '') from '<enderEmit>[\s\S]*?<UF>([A-Z]{2})</UF>'),
    'emitente_municipio_xml', substring(coalesce(n.raw_xml, '') from '<enderEmit>[\s\S]*?<xMun>([^<]*)</xMun>'),
    'emitente_ie_xml', substring(coalesce(n.raw_xml, '') from '<emit>[\s\S]*?<IE>([^<]*)</IE>'),
    'protocolo_xml', substring(coalesce(n.raw_xml, '') from '<nProt>([0-9]+)</nProt>')
  ));

  if n.data_emissao is not null then
    select a.nfe_id, a.chave_movestq, a.data_entrada, a.fonte
      into v_alvo_id, v_chave_mov, v_alvo_data, v_alvo_fonte
      from public.compras_nfe_no_alvo(n.data_emissao, n.data_emissao) a where a.nfe_id = p_id;
  end if;
  v_situacao := case when v_alvo_id is not null then 'lancada'
                     when n.data_emissao < v_espelho then 'sem_dado_alvo'
                     else 'nao_encontrada' end;

  if v_chave_mov is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'numero', p.pedido_numero, 'valor_na_nf', coalesce(p.valor_itens, p.valor_cabecalho), 'fonte', p.fonte,
             'fornecedor', cp.nome_entidade, 'data_pedido', cp.data_pedido, 'valor_pedido', cp.valor_total,
             'status', cp.status, 'natureza', cp.tipo, 'no_hub', cp.numero is not null,
             'status_local', cp.status_local, 'status_aprovacao', cp.status_aprovacao, 'aprovado', cp.aprovado,
             'comprado', cp.comprado, 'enviou_aprovacao', cp.enviou_aprovacao, 'proximo_aprovador', cp.proximo_aprovador)
           order by p.pedido_numero), '[]'::jsonb)
      into v_vinculados
      from public.rastreio_nf_pedido p
      left join public.compras_pedidos cp on cp.numero = p.pedido_numero and cp.codigo_empresa_filial = '1.01'
     where p.chave_movestq = v_chave_mov and p.codigo_empresa_filial = '1.01';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'numero', x.numero, 'principal', x.principal, 'vinculado_em', x.criado_em, 'vinculado_por', x.por,
           'fornecedor', cp.nome_entidade, 'data_pedido', cp.data_pedido, 'valor_pedido', cp.valor_total,
           'status', cp.status, 'natureza', cp.tipo, 'no_hub', cp.numero is not null,
           'status_local', cp.status_local, 'status_aprovacao', cp.status_aprovacao, 'aprovado', cp.aprovado,
           'comprado', cp.comprado, 'enviou_aprovacao', cp.enviou_aprovacao, 'proximo_aprovador', cp.proximo_aprovador)
         order by x.principal desc, x.numero), '[]'::jsonb)
    into v_hub
    from (select v2.pedido_numero as numero, v2.codigo_empresa_filial as filial, v2.is_principal as principal,
                 v2.created_at as criado_em, coalesce(pr.full_name, pr.email) as por
            from public.compras_nfe_pedidos v2
            left join public.profiles pr on pr.user_id = v2.created_by
           where v2.nfe_id = p_id
          union all
          select n.pedido_compra_numero, '1.01', true, n.updated_at, null
           where n.status_lancamento = 'vinculada' and n.pedido_compra_numero is not null
             and not exists (select 1 from public.compras_nfe_pedidos v3 where v3.nfe_id = p_id)) x
    left join public.compras_pedidos cp on cp.numero = x.numero and cp.codigo_empresa_filial = x.filial;

  if jsonb_array_length(v_vinculados) = 0 and v is not null and v_faturavel and length(v_cnpj) = 14 then
    with ent as (
      select distinct on (e.codigo_entidade) e.codigo_entidade, regexp_replace(e.cnpj, '\D', '', 'g') as cnpj
      from public.compras_entidades_cache e where e.cnpj is not null
      order by e.codigo_entidade, e.updated_at desc
    ), ped as (
      select cp.numero, cp.nome_entidade, cp.data_pedido, cp.valor_total, cp.status, cp.tipo, cp.status_aprovacao,
             cp.status_local, cp.aprovado, cp.comprado, cp.enviou_aprovacao, cp.proximo_aprovador,
             coalesce(nullif(regexp_replace(coalesce(cp.cnpj_entidade, ''), '\D', '', 'g'), ''), e.cnpj) as cnpj
      from public.compras_pedidos cp
      left join ent e on e.codigo_entidade = cp.codigo_entidade
      where cp.codigo_empresa_filial = '1.01' and cp.numero not like 'RASCUNHO%'
        and coalesce(cp.status, '') not in ('Cancelado', 'Encerrado') and cp.status_local::text <> 'excluido_alvo'
        and coalesce(cp.codigo_ind_economico, '0000001') = '0000001'
        and cp.data_pedido between n.data_emissao - 400 and n.data_emissao + 60
        and cp.valor_total > 0
        and not exists (select 1 from jsonb_array_elements(v_hub) h where h->>'numero' = cp.numero)
    ), c as (
      select p.*,
             p.cnpj <> v_cnpj as so_raiz,
             coalesce((select sum(coalesce(l.valor_itens, l.valor_cabecalho, 0)) from public.rastreio_nf_pedido l
                        where l.pedido_numero = p.numero and l.codigo_empresa_filial = '1.01'), 0) as ja_faturado,
             (select count(distinct l.chave_movestq) from public.rastreio_nf_pedido l
               where l.pedido_numero = p.numero and l.codigo_empresa_filial = '1.01') as nfs_ligadas,
             length(ltrim(p.numero, '0')) >= 4
               and v_txt ~ ('(?<![0-9])0*' || ltrim(p.numero, '0') || '(?![0-9])') as citado
      from ped p
      where p.cnpj = v_cnpj or left(p.cnpj, 8) = left(v_cnpj, 8)
    ), achadas as materialized (
      select a.nfe_id from public.compras_nfe_no_alvo(coalesce(v_espelho, n.data_emissao - 400), current_date + 30) a
    ), pend as (
      select m.numero, m.valor_total as vm, m.data_emissao as dm
      from public.compras_nfe m
      where m.id <> p_id and m.valor_total > 0 and m.data_emissao >= v_espelho
        and left(regexp_replace(coalesce(m.emitente_cnpj, ''), '\D', '', 'g'), 8) = left(v_cnpj, 8)
        and not exists (select 1 from achadas a where a.nfe_id = m.id)
        and (jsonb_typeof(m.dados_extraidos->'itens') <> 'array' or jsonb_array_length(m.dados_extraidos->'itens') = 0
             or exists (select 1 from jsonb_array_elements(m.dados_extraidos->'itens') i
                         where coalesce(i->>'cfop', '') ~ '^[567](1[0-2][0-9]|40[0-9]|551|92[29]|933)$'))
    ), f as (
      select c.*, c.valor_total - c.ja_faturado as saldo,
             case when c.citado then 1 else 2 end as forca,
             (select jsonb_agg(jsonb_build_object('numero', m.numero, 'valor', m.vm, 'data_emissao', m.dm)
                               order by abs(c.valor_total - c.ja_faturado - m.vm), m.dm)
                from pend m
               where abs(c.valor_total - c.ja_faturado - m.vm) <= 0.20 * m.vm
                 and c.data_pedido between m.dm - 400 and m.dm + 60) as disputa
      from c
      where abs(c.valor_total - c.ja_faturado - v) <= 0.20 * v
    ), g as (
      select f.* from f
      where abs(f.saldo - v) <= 1
         or not exists (select 1 from jsonb_array_elements(coalesce(f.disputa, '[]'::jsonb)) d
                         where abs(f.saldo - (d->>'valor')::numeric) <= 1)
    ), top as (
      select g.*, g.saldo - v as dif
      from g
      order by g.forca, abs(g.saldo - v), abs(g.data_pedido - n.data_emissao)
      limit 3
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'numero', t.numero, 'fornecedor', t.nome_entidade, 'data_pedido', t.data_pedido,
             'valor_pedido', t.valor_total, 'ja_faturado', t.ja_faturado, 'saldo', t.saldo, 'nfs_ligadas', t.nfs_ligadas,
             'status', t.status, 'aprovacao', t.status_aprovacao, 'natureza', t.tipo, 'so_raiz_cnpj', t.so_raiz,
             'status_local', t.status_local, 'status_aprovacao', t.status_aprovacao, 'aprovado', t.aprovado,
             'comprado', t.comprado, 'enviou_aprovacao', t.enviou_aprovacao, 'proximo_aprovador', t.proximo_aprovador,
             'forca', t.forca,
             'motivo', case t.forca when 1 then 'Número do pedido citado na nota (xPed ou informações complementares) e saldo dentro de ±20% do valor da nota'
                                    else 'Saldo do pedido dentro de ±20% do valor da nota' end,
             'diferenca', round(t.dif, 2), 'diferenca_pct', round(100 * t.dif / v, 1),
             'disputa', coalesce(t.disputa, '[]'::jsonb), 'saldo_nao_confirmado', t.data_pedido < v_espelho)
           order by t.forca, abs(t.dif), abs(t.data_pedido - n.data_emissao)), '[]'::jsonb)
      into v_candidatos
      from top t;
  end if;

  if v_chave_mov is not null then
    select to_jsonb(r) into v_movestq from public.rastreio_nf r
     where r.chave_movestq = v_chave_mov and r.codigo_empresa_filial = '1.01';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'tipo', a.tipo, 'bucket_id', a.bucket_id, 'storage_path', a.storage_path,
           'nome_original', a.nome_original, 'tamanho_bytes', a.tamanho_bytes, 'enviado_em', a.enviado_em,
           'enviado_por', coalesce(pr.full_name, pr.email))
         order by a.enviado_em desc), '[]'::jsonb)
    into v_anexos
    from public.nfe_anexo a
    left join public.profiles pr on pr.user_id = a.enviado_por
   where a.chave_acesso = n.chave_acesso and a.substituido_em is null and a.removido_em is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'chave_docfin', f.chave_docfin, 'sequencia', f.sequencia, 'numero', f.numero, 'especie', f.especie,
           'data_entrada', f.data_entrada, 'data_vencimento', f.data_vencimento, 'data_prorrogacao', f.data_prorrogacao,
           'data_pagamento', f.data_pagamento, 'valor_original', f.valor_original, 'valor_pago', f.valor_pago,
           'valor_juros', f.valor_juros, 'valor_multa', f.valor_multa, 'valor_desconto', f.valor_desconto,
           'situacao', f.nome_situacao, 'codigo_situacao', f.codigo_situacao,
           'classe_pagamento', public.rastreio_classe_pagamento(f.codigo_situacao, f.numero_mov_ctrl_banc, f.tipo_cobranca),
           'tipo_cobranca', f.tipo_cobranca, 'cond_pagamento', f.cond_pagamento, 'sincronizado_em', f.sincronizado_em)
         order by f.sequencia, f.data_vencimento), '[]'::jsonb)
    into v_parcelas
    from public.fin_parcelas_pagar f
   where regexp_replace(coalesce(f.cpf_cnpj_entidade, ''), '\D', '', 'g') = v_cnpj
     and ltrim(f.doc_numero, '0') = ltrim(n.numero, '0')
     and f.ausente_no_alvo_em is null;

  return jsonb_build_object(
    'nota', (to_jsonb(n) - 'raw_xml' - 'dados_extraidos' - 'conferencia_jsonb')
            || v_extra
            || jsonb_build_object(
                 'itens', v_itens, 'faturavel', v_faturavel, 'situacao_alvo', v_situacao,
                 'alvo_chave_movestq', v_chave_mov, 'alvo_data_entrada', v_alvo_data, 'alvo_fonte', v_alvo_fonte,
                 'dias_desde_emissao', current_date - n.data_emissao, 'tem_xml', n.raw_xml is not null),
    'pedidos', jsonb_build_object('vinculados', v_vinculados, 'vinculo_hub', v_hub, 'candidatos', v_candidatos),
    'movestq', v_movestq,
    'anexos', v_anexos,
    'docfin', jsonb_build_object('parcelas', v_parcelas),
    'meta', jsonb_build_object(
      'titulos_lidos_em', (select max(f.sincronizado_em) from public.fin_parcelas_pagar f),
      'alvo_espelho_desde', v_espelho,
      'riosoft_ultima_entrada', (select max(c.imported_at) from public.compras_nfe c where c.origem ilike 'alvo'))
  );
end;
$function$;
