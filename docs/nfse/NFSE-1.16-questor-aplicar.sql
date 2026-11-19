-- =====================================================================
-- NFSE-1.16 — natureza do Questor em cada NFS-e, para a contabilidade (PLANO-NFSE.md) — 30/10/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro (30/10): a contabilidade importa as notas de serviço no Questor e
-- precisa da classificação ("Natureza" 8.000.xxx, lista Relatorios_Serviços_Tomados.csv). Ela monta o arquivo;
-- o Hub só entrega a informação. Os códigos 8.000.xxx não existem em nenhum lugar do Hub nem do Alvo (a natureza
-- de operação do Alvo nas NFS-e é 1.933.002 / 1.902.002 para qualquer serviço) ⇒ de/para pela CLASSE de despesa do
-- Alvo, aprovado pelo Pedro ("ok, aprovado"; crédito de PIS/COFINS fica de fora: "vamos assim, depois mudamos").
--
--   questor_natureza         = as 45 naturezas da lista, com o texto da contabilidade (inclusive os erros de digitação)
--   questor_natureza_classe  = de/para classe do Alvo → natureza (74 classes). observacao preenchida = escolha
--                              provisória entre duas naturezas possíveis, a confirmar com a contabilidade
--   nfse_relatorio_questor(p_de, p_ate) = uma linha por NFS-e (v_nfse_recebida) com emissão no período:
--      classe principal = a de maior valor, nesta ordem de fonte:
--        1. DocFin (desp_docfin_rateio — o fato contábil)
--        2. pedido(s) do lançamento (compras_pedidos: classe_rateio, senão classe_rec_desp)
--        3. "fornecedor": o prestador só tem UMA classe em todos os pedidos e DocFins dele no Hub (sugestão, marcada)
--      a classe 09.04 (multa/juros) nunca é a do serviço — entra no DocFin na hora do pagamento.
--      natureza = de/para da classe principal; classe sem de/para ⇒ natureza vazia (a contabilidade classifica).
-- Tabelas fechadas (RLS sem policy, revoke de public/anon/authenticated): só a RPC lê. Mudar o de/para = SQL por
-- prompt (não há tela de edição). Gate: nfse_pode_acessar(). Período: De e Até obrigatórios, no máximo ~3 anos.
-- Rollback: NFSE-1.16-questor-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regclass('public.questor_natureza') is not null or to_regclass('public.questor_natureza_classe') is not null then
    raise exception 'questor_natureza / questor_natureza_classe já existem — conferir antes de aplicar';
  end if;
  if to_regprocedure('public.nfse_relatorio_questor(date,date)') is not null then
    raise exception 'nfse_relatorio_questor já existe — conferir antes de aplicar';
  end if;
end $$;

create table public.questor_natureza (
  codigo    text primary key check (codigo ~ '^[0-9]\.[0-9]{3}\.[0-9]{3}$'),
  descricao text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.questor_natureza_classe (
  codigo_classe text primary key,
  natureza      text not null references public.questor_natureza (codigo),
  observacao    text,
  atualizado_em timestamptz not null default now()
);

comment on table public.questor_natureza is
  'NFSE-1.16: naturezas de serviços tomados do Questor (lista da contabilidade, 30/10/2026). Fechada: só a RPC lê.';
comment on table public.questor_natureza_classe is
  'NFSE-1.16: de/para classe de rec/desp do Alvo → natureza do Questor. observacao = escolha provisória a confirmar.';

alter table public.questor_natureza enable row level security;
alter table public.questor_natureza_classe enable row level security;
revoke all on table public.questor_natureza from public, anon, authenticated;
revoke all on table public.questor_natureza_classe from public, anon, authenticated;

insert into public.questor_natureza (codigo, descricao) values
  ('8.000.001', 'Servicos Tomados c/ Contabilidade'),
  ('8.000.002', 'Servicos Tomados Terceiros Direto - PJ'),
  ('8.000.003', 'Servicos Tomados c/ Informatica / Manut TI'),
  ('8.000.004', 'Servicos Tomados c/ Pesquisas e Desenvolvimento'),
  ('8.000.005', 'Serv Tomados Auditoria/Consultoria/Certificação da Qualidade'),
  ('8.000.006', 'Servicos Tomados c/ Manut Maquinas e Equipamentos'),
  ('8.000.008', 'Servicos Tomados licenciamento ou Cessao de Direito'),
  ('8.000.012', 'Serv. Tomados - Despesas com Viagens e Estadias-hospedagem'),
  ('8.000.015', 'Serviços Tomados Experimental Animal'),
  ('8.000.016', 'Servicos Tomados c/ Dedetizacao / Controle de Pragas'),
  ('8.000.017', 'Servicos Tomados com Limpeza, Conservacao Manutencao'),
  ('8.000.021', 'Servicos Tomados Feiras, Congressos, Eventos, Palestras'),
  ('8.000.025', 'Servicos Tomados com Pericias, Analises Tecnicas'),
  ('8.000.029', 'Servicos Tomados c/ Material de Escritorio'),
  ('8.000.030', 'Serv. Tomados Propagandas/Marketing'),
  ('8.000.031', 'Servicos Tomados c/ Advocacia'),
  ('8.000.033', 'Serviços Tomados c/ Tradução'),
  ('8.000.035', 'Servicos Tomados - Produção'),
  ('8.000.036', 'Serviços Financeiros'),
  ('8.000.039', 'Servicos Tomados c/ Coleta / Descarte de Residuos'),
  ('8.000.040', 'Serv Tomados c/ Medicina / Seg trabalho'),
  ('8.000.042', 'Servicos Tomados - Seguranca/vigilancia/Monitoramento'),
  ('8.000.044', 'Servico Tomados com Monitoramento, Vigilancia'),
  ('8.000.048', 'Serv. Tomados Cursos/Treinamentos'),
  ('8.000.051', 'Servicos Tomados Transporte Funcionarios'),
  ('8.000.054', 'Serv. Tomados com RH'),
  ('8.000.056', 'Servicos Tomados - Plano de Saude'),
  ('8.000.057', 'Credito de vale Refeicao'),
  ('8.000.058', 'Serviços Tomados c/ Controle de Qualidade'),
  ('8.000.059', 'Servicos Tomados - Moveis e Utensilios - ATIVO'),
  ('8.000.061', 'Serv. Tomados c/ Bolsa Auxilio / Estagiarios -menor aprendiz'),
  ('8.000.065', 'Servicos com Software'),
  ('8.000.066', 'Servico Tomados com Benfeitorias em Imovel de Terceiros'),
  ('8.000.067', 'Despesa com Importacao'),
  ('8.000.068', 'Serviço com Evento, Confraternizacao funcionarios'),
  ('8.000.069', 'Licença de Softaware - Ativo'),
  ('8.000.070', 'Serviço Tomado com Marketing / Cominicacao'),
  ('8.000.071', 'Serviço Tomados com Taxas Licenças Diversas'),
  ('8.000.101', 'Servicos Tomados - Frete s/ vendas'),
  ('8.000.112', 'Serv. Tomados - Manutencao Bens Instalações'),
  ('8.000.113', 'Beneficiamento de terceiros'),
  ('8.000.115', 'Servicos Tomados com Beneficios Colaboradores/ funcionario - tratamento- massagem - RH'),
  ('8.000.119', 'Serv/Consultoria PROCTORIA'),
  ('8.000.120', 'Serviço com Fretes Diversos'),
  ('8.000.151', 'Servicos Tomados Transporte - sem cred- diretoria');

insert into public.questor_natureza_classe (codigo_classe, natureza, observacao) values
  ('21.01', '8.000.001', null),
  ('16.01', '8.000.002', null),
  ('19.04', '8.000.003', null),
  ('25.03', '8.000.004', null),
  ('25.01', '8.000.004', 'Provisória: P&D antes do tipo de serviço (alternativa 8.000.006)'),
  ('25.02', '8.000.004', 'Provisória: P&D antes do tipo de serviço'),
  ('25.06', '8.000.004', 'Provisória: P&D antes do tipo de serviço (alternativa 8.000.120)'),
  ('25.07', '8.000.004', 'Provisória: P&D antes do tipo de serviço'),
  ('25.09', '8.000.004', 'Provisória: P&D antes do tipo de serviço (alternativa 8.000.067)'),
  ('25.10', '8.000.004', 'Provisória: P&D antes do tipo de serviço (alternativa 8.000.035)'),
  ('25.12', '8.000.004', 'Provisória: P&D antes do tipo de serviço (alternativa 8.000.012)'),
  ('25.13', '8.000.004', 'Provisória: P&D antes do tipo de serviço (alternativa 8.000.012)'),
  ('25.14', '8.000.004', 'Provisória: P&D antes do tipo de serviço (alternativa 8.000.012)'),
  ('21.03', '8.000.005', null),
  ('21.04', '8.000.005', null),
  ('21.05', '8.000.005', null),
  ('21.07', '8.000.005', 'Provisória: consultoria regulatória lida como consultoria da qualidade'),
  ('19.02', '8.000.006', null),
  ('19.06', '8.000.006', null),
  ('15.01', '8.000.012', null),
  ('15.02', '8.000.012', 'Provisória: única natureza de viagens da lista'),
  ('15.03', '8.000.012', 'Provisória: única natureza de viagens da lista'),
  ('15.04', '8.000.012', 'Provisória: única natureza de viagens da lista'),
  ('15.05', '8.000.012', 'Provisória: única natureza de viagens da lista'),
  ('15.06', '8.000.012', 'Provisória: única natureza de viagens da lista'),
  ('25.11', '8.000.015', null),
  ('21.13', '8.000.016', null),
  ('21.12', '8.000.017', null),
  ('20.05', '8.000.017', null),
  ('14.04', '8.000.021', null),
  ('18.05', '8.000.029', null),
  ('21.02', '8.000.031', null),
  ('21.10', '8.000.033', null),
  ('20.06', '8.000.035', null),
  ('20.02', '8.000.035', 'Provisória: esterilização como serviço de produção (alternativa 8.000.113)'),
  ('21.09', '8.000.036', null),
  ('20.03', '8.000.039', null),
  ('16.14', '8.000.040', null),
  ('16.13', '8.000.040', null),
  ('21.11', '8.000.042', 'Provisória: a lista tem duas de segurança (alternativa 8.000.044)'),
  ('16.17', '8.000.048', null),
  ('16.09', '8.000.051', 'Provisória: vale-transporte como transporte de funcionários'),
  ('21.08', '8.000.054', null),
  ('16.19', '8.000.054', 'Provisória: onboarding como RH (alternativa 8.000.048)'),
  ('16.08', '8.000.056', null),
  ('16.10', '8.000.057', null),
  ('20.04', '8.000.058', null),
  ('24.06', '8.000.059', null),
  ('16.15', '8.000.061', null),
  ('19.05', '8.000.065', 'Provisória: alternativas 8.000.003 (TI) e 8.000.008 (licenciamento)'),
  ('24.09', '8.000.066', null),
  ('11.08', '8.000.067', null),
  ('11.09', '8.000.067', null),
  ('16.16', '8.000.068', null),
  ('24.05', '8.000.069', null),
  ('26.03', '8.000.069', 'Provisória: software de P&D é ativo (alternativa 8.000.004)'),
  ('14.03', '8.000.070', 'Provisória: a lista tem duas de marketing (alternativa 8.000.030)'),
  ('14.07', '8.000.070', 'Provisória: a lista tem duas de marketing (alternativa 8.000.030)'),
  ('14.09', '8.000.070', 'Provisória: a lista tem duas de marketing (alternativa 8.000.030)'),
  ('14.11', '8.000.070', 'Provisória: a lista tem duas de marketing (alternativa 8.000.030)'),
  ('23.16', '8.000.071', null),
  ('23.17', '8.000.071', null),
  ('12.06', '8.000.101', null),
  ('19.01', '8.000.112', null),
  ('19.03', '8.000.112', null),
  ('20.01', '8.000.113', null),
  ('16.11', '8.000.115', null),
  ('21.06', '8.000.119', null),
  ('12.07', '8.000.120', null),
  ('12.01', '8.000.120', 'Provisória: frete de compra como frete diverso'),
  ('12.02', '8.000.120', 'Provisória: frete de compra como frete diverso'),
  ('12.03', '8.000.120', 'Provisória: frete de compra como frete diverso'),
  ('12.04', '8.000.120', 'Provisória: frete de compra como frete diverso'),
  ('12.05', '8.000.120', 'Provisória: frete de compra como frete diverso');

do $$
declare v_faltam text;
begin
  select string_agg(m.codigo_classe, ', ') into v_faltam
  from public.questor_natureza_classe m
  where not exists (select 1 from public.classes_rec_desp k where k.codigo = m.codigo_classe);
  if v_faltam is not null then
    raise exception 'De/para com classe que não existe no Alvo: %. Transação desfeita.', v_faltam;
  end if;
  if (select count(*) from public.questor_natureza) <> 45 or (select count(*) from public.questor_natureza_classe) <> 74 then
    raise exception 'Contagem inesperada (esperado 45 naturezas e 74 classes). Transação desfeita.';
  end if;
end $$;

create function public.nfse_relatorio_questor(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
  v_de_para jsonb;
begin
  if not public.nfse_pode_acessar() then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 1100 then
    raise exception 'Período inválido: De e Até são obrigatórios (até 3 anos).' using errcode = '22023';
  end if;

  with nf as materialized (
    select n.chave_acesso, n.numero, n.data_emissao, n.prestador_doc, n.prestador_nome, n.municipio_emissor,
           n.valor_servico, n.valor_liquido, n.situacao_fisco, n.situacao_alvo, n.alvo_data_entrada,
           n.alvo_chave_docfin, n.alvo_pedido
    from public.v_nfse_recebida n
    where n.data_emissao between p_de and p_ate
  ), xml as (
    select nf.chave_acesso,
           substring(d.xml, '<dCompet>([^<]*)</dCompet>') as competencia,
           substring(d.xml, '<cTribNac>([^<]*)</cTribNac>') as codigo_servico,
           replace(substring(d.xml, '<xDescServ>([^<]*)</xDescServ>'), '&amp;', '&') as descricao_servico
    from nf
    join public.nfse_adn_doc d on d.chave_acesso = nf.chave_acesso and d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador'
  ), cls_doc as (
    select nf.chave_acesso, r.codigo_classe as classe, sum(r.valor_brl) as valor
    from nf
    join public.desp_docfin_rateio r on r.chave_docfin = nf.alvo_chave_docfin
    where r.codigo_classe <> '09.04'
    group by 1, 2
  ), cls_ped as (
    select nf.chave_acesso, coalesce(r->>'classe', cp.classe_rec_desp) as classe,
           sum(coalesce(case when jsonb_typeof(r->'valor') = 'number' then (r->>'valor')::numeric end, cp.valor_total)) as valor
    from nf
    join lateral unnest(string_to_array(nf.alvo_pedido, ', ')) p(num) on true
    join public.compras_pedidos cp on cp.numero = p.num and cp.codigo_empresa_filial = '1.01'
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(cp.classe_rateio) = 'array' then cp.classe_rateio else '[]'::jsonb end) r on true
    where coalesce(r->>'classe', cp.classe_rec_desp) <> '09.04'
    group by 1, 2
  ), forn as (
    select distinct nf.prestador_doc from nf where nf.prestador_doc is not null
  ), hist as (
    select f.prestador_doc, coalesce(r->>'classe', cp.classe_rec_desp) as classe
    from forn f
    join public.compras_pedidos cp on cp.cnpj_entidade = f.prestador_doc and cp.codigo_empresa_filial = '1.01'
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(cp.classe_rateio) = 'array' then cp.classe_rateio else '[]'::jsonb end) r on true
    union
    select f.prestador_doc, r.codigo_classe
    from forn f
    join public.fin_parcelas_pagar t on t.cpf_cnpj_entidade = f.prestador_doc
    join public.desp_docfin_rateio r on r.chave_docfin = t.chave_docfin
  ), hist_unica as (
    select h.prestador_doc, min(h.classe) as classe
    from hist h
    where h.classe is not null and h.classe <> '09.04'
    group by 1
    having count(distinct h.classe) = 1
  ), cls as (
    select d.chave_acesso, d.classe, d.valor, 'docfin' as origem from cls_doc d
    union all
    select p.chave_acesso, p.classe, p.valor, 'pedido' from cls_ped p
    where not exists (select 1 from cls_doc d where d.chave_acesso = p.chave_acesso)
    union all
    select nf.chave_acesso, h.classe, null, 'fornecedor'
    from nf join hist_unica h on h.prestador_doc = nf.prestador_doc
    where not exists (select 1 from cls_doc d where d.chave_acesso = nf.chave_acesso)
      and not exists (select 1 from cls_ped p where p.chave_acesso = nf.chave_acesso)
  ), principal as (
    select distinct on (c.chave_acesso) c.chave_acesso, c.classe, c.origem
    from cls c
    order by c.chave_acesso, c.valor desc nulls last, c.classe
  ), outras as (
    select c.chave_acesso,
           string_agg(c.classe || coalesce(' ' || k.nome, ''), ' · ' order by c.valor desc nulls last, c.classe) as outras
    from cls c
    join principal p on p.chave_acesso = c.chave_acesso and p.classe <> c.classe
    left join public.classes_rec_desp k on k.codigo = c.classe
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave_acesso', nf.chave_acesso, 'numero', nf.numero, 'emissao', nf.data_emissao,
           'competencia', x.competencia, 'cnpj', nf.prestador_doc, 'prestador', nf.prestador_nome,
           'municipio', nf.municipio_emissor, 'valor_servico', nf.valor_servico, 'valor_liquido', nf.valor_liquido,
           'situacao_fisco', nf.situacao_fisco, 'situacao_alvo', nf.situacao_alvo,
           'lancado_em', case when nf.situacao_alvo in ('lancada_nfse', 'lancada_outra_especie') then nf.alvo_data_entrada end,
           'pedidos', nf.alvo_pedido, 'docfin', nf.alvo_chave_docfin,
           'codigo_servico', x.codigo_servico, 'descricao_servico', x.descricao_servico,
           'classe', p.classe, 'classe_nome', k.nome, 'classe_origem', p.origem, 'outras_classes', o.outras,
           'natureza', q.codigo, 'natureza_descricao', q.descricao)
         order by nf.data_emissao desc, nf.numero), '[]'::jsonb)
    into v_res
    from nf
    left join xml x on x.chave_acesso = nf.chave_acesso
    left join principal p on p.chave_acesso = nf.chave_acesso
    left join public.classes_rec_desp k on k.codigo = p.classe
    left join public.questor_natureza_classe m on m.codigo_classe = p.classe
    left join public.questor_natureza q on q.codigo = m.natureza and q.ativo
    left join outras o on o.chave_acesso = nf.chave_acesso;

  select coalesce(jsonb_agg(jsonb_build_object(
           'natureza', q.codigo, 'natureza_descricao', q.descricao,
           'classe', m.codigo_classe, 'classe_nome', k.nome, 'observacao', m.observacao)
         order by q.codigo, m.codigo_classe), '[]'::jsonb)
    into v_de_para
    from public.questor_natureza q
    left join public.questor_natureza_classe m on m.natureza = q.codigo
    left join public.classes_rec_desp k on k.codigo = m.codigo_classe
   where q.ativo;

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'gerado_em', now(), 'linhas', v_res, 'de_para', v_de_para);
end;
$function$;

comment on function public.nfse_relatorio_questor(date, date) is
  'NFSE-1.16: natureza do Questor de cada NFS-e do período (pela emissão), pela classe de despesa do Alvo '
  '(DocFin, senão pedido, senão a única classe do fornecedor) e o de/para questor_natureza_classe. Só leitura. '
  'Gate nfse_pode_acessar().';

revoke execute on function public.nfse_relatorio_questor(date, date) from public, anon;
grant execute on function public.nfse_relatorio_questor(date, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.nfse_relatorio_questor(date, date)', 'execute') then
    raise exception 'ACESSOS: anon ficou com EXECUTE. Transação desfeita.';
  end if;
  if has_table_privilege('anon', 'public.questor_natureza', 'select')
     or has_table_privilege('authenticated', 'public.questor_natureza_classe', 'select') then
    raise exception 'ACESSOS: tabela do de/para aberta. Transação desfeita.';
  end if;
end $$;
