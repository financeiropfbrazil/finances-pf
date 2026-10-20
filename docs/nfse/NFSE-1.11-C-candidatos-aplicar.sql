-- =====================================================================
-- NFSE-1.11-C — candidato a pedido: fora os encerrados, disputa entre notas pendentes, saldo não confirmado
-- (PLANO-NFSE) — 20/10/2026. Projeto: hbtggrbauguukewiknew.
-- Regra do Pedro (20/10/2026): "os pedidos candidatos, em notas sem pedido, não podem ter sido vinculados a outra NF,
-- pelo menos não integralmente". Investigação: o saldo ±20% já segue isso com o que o Hub vê, mas falhava em dois
-- pontos (11 de 74 candidatos Encerrados no Alvo, 10 deles sem NF no Hub — pedidos de nov–dez/2025, consumidos antes
-- do espelho; 16 pedidos sugeridos a mais de uma nota pendente). Aprovado pelo Pedro (1 sim · 2 ok · 3 ok):
--   1. Pedido Encerrado no Alvo não entra (como o Cancelado).
--   2. Outras NFS-e pendentes do mesmo fornecedor (raiz do CNPJ) cujo valor cabe no mesmo saldo (±20%) vão em
--      `disputa`; se uma delas tem o valor exato do saldo (±R$ 1) e esta nota não, o pedido fica só com ela.
--   3. `saldo_nao_confirmado` = pedido anterior ao início do espelho do Alvo (meta.alvo_espelho_desde): NFs lançadas
--      antes disso não estão no Hub.
-- `create or replace` preserva o ACL. Rollback: NFSE-1.11-C-candidatos-rollback.sql (corpo da 1.11-B, md5 2762673a…).
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.nfse_recebida_detalhe(text)'::regprocedure)
     <> '2762673a8d3b9b9664492edeb3729a3c' then
    raise exception 'nfse_recebida_detalhe mudou desde a NFSE-1.11-B — conferir antes de aplicar';
  end if;
end $$;

create or replace function public.nfse_recebida_detalhe(p_chave text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  n            record;
  v_xml        text;
  x            xml;
  v_txt        text := '';
  v_extra      jsonb := '{}'::jsonb;
  v_vinculados jsonb := '[]'::jsonb;
  v_candidatos jsonb := '[]'::jsonb;
  v_movestq    jsonb;
  v_anexos     jsonb := '[]'::jsonb;
  v_parcelas   jsonb := '[]'::jsonb;
  v            numeric;
  v_espelho    date;
begin
  if not public.nfse_pode_acessar() then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;

  select * into n from public.v_nfse_recebida where chave_acesso = p_chave;
  if not found then
    return null;
  end if;
  v := nullif(n.valor_servico, 0);
  v_espelho := (select min(f.data_vencimento) from public.fin_parcelas_pagar f);

  select d.xml into v_xml from public.nfse_adn_doc d
   where d.chave_acesso = p_chave and d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador'
   order by d.nsu desc limit 1;
  begin
    x := xmlparse(document ltrim(v_xml, chr(65279)));
    v_extra := jsonb_strip_nulls(jsonb_build_object(
      'descricao_servico', public.nfse_adn_xp(x, 'cServ/xDescServ'),
      'codigo_servico', public.nfse_adn_xp(x, 'cServ/cTribNac'),
      'competencia', public.nfse_adn_xp(x, 'infDPS/dCompet'),
      'informacoes_complementares', public.nfse_adn_xp(x, 'xInfComp'),
      'valor_iss', public.nfse_adn_xp(x, 'vISSQN'),
      'iss_retido', public.nfse_adn_xp(x, 'tribMun/tpRetISSQN'),
      'valor_total_retido', public.nfse_adn_xp(x, 'vTotalRet'),
      'municipio_incidencia', public.nfse_adn_xp(x, 'xLocIncid')
    ));
    v_txt := coalesce(v_extra->>'descricao_servico', '') || ' ' || coalesce(v_extra->>'informacoes_complementares', '');
  exception when others then
    v_extra := jsonb_build_object('erro_xml', left(sqlerrm, 200));
  end;

  if n.alvo_chave_movestq is not null then
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
     where p.chave_movestq = n.alvo_chave_movestq and p.codigo_empresa_filial = '1.01';
  end if;

  if jsonb_array_length(v_vinculados) = 0 and v is not null then
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
    ), c as (
      select p.*,
             p.cnpj <> n.prestador_doc as so_raiz,
             coalesce((select sum(coalesce(l.valor_itens, l.valor_cabecalho, 0)) from public.rastreio_nf_pedido l
                        where l.pedido_numero = p.numero and l.codigo_empresa_filial = '1.01'), 0) as ja_faturado,
             (select count(distinct l.chave_movestq) from public.rastreio_nf_pedido l
               where l.pedido_numero = p.numero and l.codigo_empresa_filial = '1.01') as nfs_ligadas,
             length(ltrim(p.numero, '0')) >= 4
               and v_txt ~ ('(?<![0-9])0*' || ltrim(p.numero, '0') || '(?![0-9])') as citado
      from ped p
      where p.cnpj = n.prestador_doc or left(p.cnpj, 8) = left(n.prestador_doc, 8)
    ), pend as (
      -- NFSE-1.11-C: outras NFS-e do mesmo fornecedor ainda não lançadas no Alvo — disputam o mesmo saldo
      select m.numero, m.valor_servico as vm, m.data_emissao as dm
      from public.v_nfse_recebida m
      where m.situacao_fisco = 'normal' and m.situacao_alvo = 'nao_lancada' and m.valor_servico > 0
        and m.chave_acesso <> p_chave and left(m.prestador_doc, 8) = left(n.prestador_doc, 8)
    ), f as (
      -- NFSE-1.11-B: só entra pedido com SALDO dentro de ±20% da nota; "citado na nota" só põe na frente
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
      -- NFSE-1.11-C: outra nota pendente com o valor exato do saldo (±R$ 1) fica com o pedido, se esta não for exata
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
             'motivo', case t.forca when 1 then 'Número do pedido citado na nota e saldo dentro de ±20% do valor da nota'
                                    else 'Saldo do pedido dentro de ±20% do valor da nota' end,
             'diferenca', round(t.dif, 2), 'diferenca_pct', round(100 * t.dif / v, 1),
             'disputa', coalesce(t.disputa, '[]'::jsonb), 'saldo_nao_confirmado', t.data_pedido < v_espelho)
           order by t.forca, abs(t.dif), abs(t.data_pedido - n.data_emissao)), '[]'::jsonb)
      into v_candidatos
      from top t;
  end if;

  if n.alvo_chave_movestq is not null then
    select to_jsonb(r) into v_movestq from public.rastreio_nf r
     where r.chave_movestq = n.alvo_chave_movestq and r.codigo_empresa_filial = '1.01';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'tipo', a.tipo, 'bucket_id', a.bucket_id, 'storage_path', a.storage_path,
           'nome_original', a.nome_original, 'tamanho_bytes', a.tamanho_bytes, 'enviado_em', a.enviado_em,
           'enviado_por', coalesce(pr.full_name, pr.email))
         order by a.enviado_em desc), '[]'::jsonb)
    into v_anexos
    from public.nfse_anexo a
    left join public.profiles pr on pr.user_id = a.enviado_por
   where a.chave_acesso = p_chave and a.substituido_em is null and a.removido_em is null;

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
   where f.cpf_cnpj_entidade = n.prestador_doc and ltrim(f.doc_numero, '0') = ltrim(n.numero, '0')
     and f.ausente_no_alvo_em is null;

  return jsonb_build_object(
    'nota', to_jsonb(n) || v_extra,
    'pedidos', jsonb_build_object('vinculados', v_vinculados, 'candidatos', v_candidatos),
    'movestq', v_movestq,
    'anexos', v_anexos,
    'docfin', jsonb_build_object('parcelas', v_parcelas),
    'meta', jsonb_build_object(
      'adn_lido_em', (select max(r.finished_at) from public.sync_runs r where r.job_type = 'nfse_adn'),
      'titulos_lidos_em', (select max(f.sincronizado_em) from public.fin_parcelas_pagar f),
      'alvo_espelho_desde', v_espelho)
  );
end;
$function$;

comment on function public.nfse_recebida_detalhe(text) is
  'NFSE-1.11 + 1.11-A/B/C: as 6 etapas do detalhe de uma NFS-e recebida (nota, pedidos ligados/candidatos com saldo '
  'dentro de ±20%, sem encerrados, com disputa entre notas pendentes, e os campos do status efetivo; MovEstq, anexos, '
  'DocFin). Só leitura. Gate nfse_pode_acessar().';
