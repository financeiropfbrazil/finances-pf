-- =====================================================================
-- NFSE-1.15 — download de controle das etapas da NFS-e (PLANO-NFSE.md) — 30/10/2026
-- Projeto: hbtggrbauguukewiknew. Mesmas colunas e regras da NF-e (PLANO-NFE NFE-6), mais "Situação no fisco".
-- RPC nfse_relatorio_etapas(p_de, p_ate): uma linha por NFS-e (v_nfse_recebida) com emissão no período. jsonb.
--   pedidos     = os do lançamento no Alvo (MovEstq). Sugestões automáticas NÃO entram.
--   DocFin      = o título achado pela view (alvo_chave_docfin, inclusive nota lançada como DIV citando o número);
--                 sem ele, CNPJ do prestador + número da nota.
--   etapa_atual = 1ª etapa não concluída; nota cancelada/substituída no fisco mostra isso no lugar.
-- Gate: nfse_pode_acessar(). Período: De e Até obrigatórios, no máximo ~3 anos.
-- Rollback: NFSE-1.15-relatorio-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regprocedure('public.nfse_relatorio_etapas(date,date)') is not null then
    raise exception 'nfse_relatorio_etapas já existe — conferir antes de aplicar';
  end if;
end $$;

create function public.nfse_relatorio_etapas(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
begin
  if not public.nfse_pode_acessar() then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 1100 then
    raise exception 'Período inválido: De e Até são obrigatórios (até 3 anos).' using errcode = '22023';
  end if;

  with nf as materialized (
    select n.chave_acesso, n.numero, n.prestador_nome, n.prestador_doc, n.valor_servico, n.data_emissao,
           n.situacao_fisco, n.situacao_alvo, n.alvo_chave_movestq, n.alvo_chave_docfin, n.alvo_data_entrada
    from public.v_nfse_recebida n
    where n.data_emissao between p_de and p_ate
  ), ped as (
    select nf.chave_acesso, string_agg(distinct p.pedido_numero, ', ') as pedidos,
           max(cp.data_pedido) as data_pedido, max(cp.data_aprovacao_alvo) as aprovado_em
    from nf
    join public.rastreio_nf_pedido p on p.chave_movestq = nf.alvo_chave_movestq and p.codigo_empresa_filial = '1.01'
    left join public.compras_pedidos cp on cp.numero = p.pedido_numero and cp.codigo_empresa_filial = '1.01'
    group by nf.chave_acesso
  ), mov as (
    select nf.chave_acesso, coalesce(r.data_entrada, nf.alvo_data_entrada) as data_entrada, r.data_hora_digitacao
    from nf
    left join public.rastreio_nf r on r.chave_movestq = nf.alvo_chave_movestq and r.codigo_empresa_filial = '1.01'
  ), anx as (
    select a.chave_acesso, a.tipo, a.enviado_em, coalesce(pr.full_name, pr.email) as por
    from public.nfse_anexo a
    left join public.profiles pr on pr.user_id = a.enviado_por
    where a.substituido_em is null and a.removido_em is null
      and a.chave_acesso in (select nf.chave_acesso from nf)
  ), tit as (
    select nf.chave_acesso, f.*
    from nf join public.fin_parcelas_pagar f on f.chave_docfin = nf.alvo_chave_docfin
    where nf.alvo_chave_docfin is not null and f.ausente_no_alvo_em is null
    union all
    select nf.chave_acesso, f.*
    from nf join public.fin_parcelas_pagar f
      on f.cpf_cnpj_entidade = nf.prestador_doc and ltrim(f.doc_numero, '0') = ltrim(nf.numero, '0')
    where nf.alvo_chave_docfin is null and f.ausente_no_alvo_em is null
  ), parc as (
    select t.chave_acesso, t.chave_docfin, t.data_vencimento, t.data_pagamento,
           public.rastreio_classe_pagamento(t.codigo_situacao, t.numero_mov_ctrl_banc, t.tipo_cobranca)
             in ('pago', 'quitado_adto') as paga
    from tit t
  ), fin as (
    select p.chave_acesso, min(p.chave_docfin) as docfin, count(*) as total, count(*) filter (where p.paga) as pagas,
           min(p.data_vencimento) filter (where not p.paga) as proximo_vencimento,
           max(p.data_pagamento) filter (where p.paga) as pago_em,
           bool_or(not p.paga and p.data_vencimento < current_date) as vencida,
           max(case when p.paga and p.data_pagamento is not null then p.data_pagamento - p.data_vencimento
                    when not p.paga and p.data_vencimento < current_date then current_date - p.data_vencimento end) as atraso
    from parc p group by p.chave_acesso
  ), linhas as (
    select nf.*, ped.pedidos, ped.data_pedido, ped.aprovado_em, mov.data_entrada, mov.data_hora_digitacao,
           anf.enviado_em as nf_anexado_em, anf.por as nf_anexado_por,
           abo.enviado_em as boleto_anexado_em, abo.por as boleto_anexado_por,
           fin.docfin, coalesce(fin.total, 0) as parcelas_total, coalesce(fin.pagas, 0) as parcelas_pagas,
           fin.proximo_vencimento, fin.pago_em, fin.vencida, fin.atraso,
           nf.situacao_alvo in ('lancada_nfse', 'lancada_outra_especie') as lancada
    from nf
    left join ped on ped.chave_acesso = nf.chave_acesso
    left join mov on mov.chave_acesso = nf.chave_acesso
    left join anx anf on anf.chave_acesso = nf.chave_acesso and anf.tipo = 'nf'
    left join anx abo on abo.chave_acesso = nf.chave_acesso and abo.tipo = 'boleto'
    left join fin on fin.chave_acesso = nf.chave_acesso
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave_acesso', l.chave_acesso, 'numero', l.numero, 'fornecedor', l.prestador_nome, 'cnpj', l.prestador_doc,
           'valor', l.valor_servico, 'emissao', l.data_emissao, 'situacao_fisco', l.situacao_fisco,
           'pedidos', l.pedidos, 'data_pedido', l.data_pedido,
           'pedido_aprovado_em', (l.aprovado_em at time zone 'America/Sao_Paulo')::date,
           'dias_pedido_emissao', l.data_emissao - l.data_pedido,
           'chave_movestq', l.alvo_chave_movestq, 'lancado_em', case when l.lancada then l.data_entrada end,
           'digitado_em', l.data_hora_digitacao,
           'nf_anexado_em', l.nf_anexado_em, 'nf_anexado_por', l.nf_anexado_por,
           'boleto_anexado_em', l.boleto_anexado_em, 'boleto_anexado_por', l.boleto_anexado_por,
           'docfin', l.docfin, 'parcelas_total', l.parcelas_total, 'parcelas_pagas', l.parcelas_pagas,
           'proximo_vencimento', l.proximo_vencimento, 'pago_em', l.pago_em,
           'situacao_pagamento', case when l.parcelas_total = 0 then null
                                      when l.parcelas_pagas = l.parcelas_total then 'Pago'
                                      when l.vencida then 'Vencido'
                                      when l.parcelas_pagas > 0 then 'Parcial'
                                      else 'Em aberto' end,
           'etapa_atual', case
               when l.situacao_fisco = 'cancelada' then 'Cancelada no fisco'
               when l.situacao_fisco = 'substituida' then 'Substituída no fisco'
               when l.situacao_alvo = 'sem_dado_alvo' then 'Sem dado do Alvo'
               when l.pedidos is null then '2 · Pedidos'
               when not l.lancada then '3 · MovEstq'
               when l.nf_anexado_em is null then '4 · PDF da nota'
               when l.boleto_anexado_em is null then '5 · Boleto'
               when l.parcelas_total = 0 or l.parcelas_pagas < l.parcelas_total then '6 · DocFin'
               else 'Concluída' end,
           'dias_emissao_lancamento', case when l.lancada then l.data_entrada - l.data_emissao end,
           'dias_em_aberto', case when not l.lancada and l.situacao_fisco = 'normal' then current_date - l.data_emissao end,
           'dias_emissao_digitacao', (l.data_hora_digitacao at time zone 'America/Sao_Paulo')::date - l.data_emissao,
           'dias_lancamento_pagamento', case when l.lancada and l.parcelas_total > 0 and l.parcelas_pagas = l.parcelas_total
                                             then l.pago_em - l.data_entrada end,
           'dias_atraso', l.atraso)
         order by l.data_emissao desc, l.numero), '[]'::jsonb)
    into v_res
    from linhas l;

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'gerado_em', now(), 'linhas', v_res);
end;
$function$;

comment on function public.nfse_relatorio_etapas(date, date) is
  'NFSE-1.15: download de controle das etapas da NFS-e (nota, pedido, MovEstq, anexos, DocFin e dias entre etapas) para '
  'o período de emissão. Só leitura. Gate nfse_pode_acessar().';

revoke execute on function public.nfse_relatorio_etapas(date, date) from public, anon;
grant execute on function public.nfse_relatorio_etapas(date, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.nfse_relatorio_etapas(date, date)', 'execute') then
    raise exception 'ACESSOS: anon ficou com EXECUTE. Transação desfeita.';
  end if;
end $$;
