-- =====================================================================
-- VND-3 — Espelho das notas fiscais emitidas pela P&F (PLANO-VENDAS.md §12)
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Só cria objetos NOVOS
-- (prefixo nf_saida). Não altera nenhum objeto existente.
-- Rollback: sql/VND-3-nf-saida-rollback.sql
-- Pré-voo obrigatório antes de aplicar (resultado esperado em 05/11/2026):
--   select count(*) from public.compras_pedidos;          -- ~2.414
--   select count(*) from pg_class
--    where relnamespace='public'::regnamespace and relname like 'nf\_saida%';  -- 0
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Funções auxiliares de conversão (formato do Alvo → Postgres)
-- ---------------------------------------------------------------------
-- "Sim"/"Não" → boolean; qualquer outro valor → null (não confirmado).
create function public.nf_saida__bool(p text) returns boolean
language sql immutable as $$
  select case p when 'Sim' then true when 'Não' then false else null end
$$;

-- Data como o Alvo escreveu (fuso local), sem converter para UTC.
-- 0001-01-01 e 1900-01-01 são "vazio" no .NET/Alvo → null.
create function public.nf_saida__dt(p text) returns date
language sql immutable as $$
  select case when p is null or p = '' or left(p, 4) < '1901' then null
              else left(p, 10)::date end
$$;

create function public.nf_saida__ts(p text) returns timestamptz
language sql stable as $$
  select case when p is null or p = '' or left(p, 4) < '1901' then null
              else p::timestamptz end
$$;

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------
create table public.nf_saida (
  id                          uuid primary key default gen_random_uuid(),
  codigo_empresa_filial       text not null,
  modelo                      text not null,              -- 'NF-e' | 'NFS-e'
  serie                       text not null,              -- como o Alvo grava: '1', '001'
  numero_alvo                 text not null,              -- '0000005100'
  numero                      bigint generated always as
                                (case when numero_alvo ~ '^\d{1,18}$' then numero_alvo::bigint end) stored,

  -- LIVRO: o que o Alvo diz
  tipo_nota                   text,                       -- 'Saída' | 'Entrada' (a série é compartilhada)
  origem_modulo               text,
  data_emissao                date,
  data_saida                  timestamptz,                -- DataEntradaSaida
  data_competencia            date,
  data_digitacao              timestamptz,
  codigo_entidade             text,
  razao_social                text,
  nome_fantasia               text,
  cpf_cnpj                    text,
  tipo_pessoa                 text,
  natureza_entidade           text,
  -- destino (cadastro da entidade gravado na nota)
  sigla_pais                  text,                       -- código do ALVO, não ISO ('AUS' = Áustria)
  nome_pais                   text,
  uf                          text,                       -- 'EX' = exterior
  codigo_cidade               text,
  nome_cidade                 text,
  endereco_entrega_mesmo      boolean,
  codigo_entidade_entrega     text,
  sequencia_endereco_entrega  integer,
  nome_entidade_entrega       text,
  -- operação
  codigo_nat_operacao_produto text,
  codigo_nat_operacao_servico text,
  codigo_tipo_lanc_produto    text,
  codigo_tipo_lanc_servico    text,
  classe_principal            text,                       -- classe de maior valor (detalhe)
  documento_origem            text,
  numero_pedvenda             text,                       -- 1º PedVendaNotaFiscalChildList (detalhe)
  numero_pedido_entidade      text,
  vendedor_principal          text,
  numero_nfse_prefeitura      text,                       -- NumeroRetornoNFSE
  data_retorno_nfse           date,
  -- situação no Alvo
  cancelada                   boolean,
  data_cancelamento           timestamptz,
  denegada                    boolean,
  substituida                 boolean,
  documento_homologado        boolean,
  integrado_financeiro        boolean,
  baixado_estoque             boolean,
  -- moeda e valores (cabeçalho; PIS/COFINS ficam no item)
  moeda_codigo                text,                       -- CodigoIndEconomicoOrigem
  cambio                      numeric,
  valor_original              numeric,
  valor_total                 numeric,
  valor_produto               numeric,
  valor_servico               numeric,
  valor_frete                 numeric,
  valor_seguro                numeric,
  valor_despesa               numeric,
  valor_desconto              numeric,
  valor_icms                  numeric,
  valor_icms_st               numeric,
  valor_ipi                   numeric,
  valor_iss                   numeric,
  valor_cbs                   numeric,
  valor_ibs_uf                numeric,
  valor_ibs_cidade            numeric,
  alvo_atualizado_em          timestamptz,                -- DataUltimaAtualizacao (só no detalhe)

  -- ESPELHO: o que o Hub viu
  payload_lista               jsonb,                      -- linha da lista (GetListForComponents)
  lista_hash                  text,
  payload_hash                text,                       -- hash do detalhe atual (o payload fica em nf_saida_versao)
  versao                      integer not null default 0, -- 0 = detalhe ainda não lido
  detalhe_status              text not null default 'pendente'
                                check (detalhe_status in ('pendente','carregado','erro','estacionado')),
  tentativas                  integer not null default 0,
  proxima_em                  timestamptz,
  ultimo_erro                 text,
  primeira_leitura_em         timestamptz not null default now(),
  ultima_leitura_lista_em     timestamptz,
  ultima_leitura_detalhe_em   timestamptz,
  ausente_desde               timestamptz,                -- o Load passou a devolver null
  situacao_hub                text generated always as (
                                case when ausente_desde is not null then 'ausente'
                                     when modelo = 'NFS-e' and numero_nfse_prefeitura is null then 'provisoria'
                                     else 'ativa' end) stored,

  constraint nf_saida_identidade unique (codigo_empresa_filial, modelo, serie, numero_alvo)
);
create index nf_saida_fila     on public.nf_saida (detalhe_status, proxima_em);
create index nf_saida_emissao  on public.nf_saida (data_emissao);
create index nf_saida_entidade on public.nf_saida (codigo_entidade);
create index nf_saida_numero   on public.nf_saida (codigo_empresa_filial, modelo, serie, numero);

-- Toda versão diferente do detalhe que o Hub já leu (achado 2.5: número reaproveitado).
create table public.nf_saida_versao (
  nf_saida_id  uuid not null references public.nf_saida(id) on delete cascade,
  versao       integer not null,
  lido_em      timestamptz not null default now(),
  payload_hash text not null,
  payload_alvo jsonb not null,
  primary key (nf_saida_id, versao)
);

create table public.nf_saida_item (
  nf_saida_id        uuid not null references public.nf_saida(id) on delete cascade,
  sequencia          integer not null,
  item_servico       boolean,
  codigo_produto     text,
  codigo_alternativo text,
  nome_produto       text,
  natureza_operacao  text,                                 -- CodigoNatOperacao (ex.: '5.917', '7.933.001')
  cfop               text generated always as (left(natureza_operacao, 5)) stored,
  ncm                text,                                 -- ItemNfFormPrecoObject.NCMNBS
  unidade            text,
  quantidade         numeric,
  valor_unitario     numeric,
  valor_total        numeric,
  valor_frete        numeric,
  valor_desconto     numeric,
  valor_icms         numeric,
  valor_icms_st      numeric,
  valor_ipi          numeric,
  valor_pis          numeric,
  valor_cofins       numeric,
  valor_iss          numeric,
  valor_cbs          numeric,
  valor_ibs_uf       numeric,
  valor_ibs_cidade   numeric,
  codigo_tipo_lanc   text,
  numero_pedvenda    text,
  controla_lote      boolean,
  possui_num_serie   boolean,
  primary key (nf_saida_id, sequencia)
);
create index nf_saida_item_produto on public.nf_saida_item (codigo_produto);

create table public.nf_saida_item_lote (
  nf_saida_id    uuid not null references public.nf_saida(id) on delete cascade,
  sequencia_item integer not null,
  ordem          integer not null,
  codigo_produto text,
  numero_lote    text,
  data_validade  date,
  codigo_local   text,
  quantidade     numeric,
  primary key (nf_saida_id, sequencia_item, ordem)
);
create index nf_saida_item_lote_lote on public.nf_saida_item_lote (numero_lote);

create table public.nf_saida_item_serie (
  nf_saida_id        uuid not null references public.nf_saida(id) on delete cascade,
  sequencia_item     integer not null,
  controle_num_serie bigint not null,                      -- texto da série: NumSerie/Load (fase futura)
  primary key (nf_saida_id, sequencia_item, controle_num_serie)
);
create index nf_saida_item_serie_controle on public.nf_saida_item_serie (controle_num_serie);

create table public.nf_saida_parcela (
  nf_saida_id          uuid not null references public.nf_saida(id) on delete cascade,
  sequencia_cond       integer not null,
  sequencia_parcela    integer not null,
  duplicata            text,
  codigo_cond_pag      text,
  nome_cond_pag        text,
  data_vencimento      date,
  valor                numeric,
  codigo_tipo_cobranca text,
  chave_docfin         bigint,                             -- null = nota não gerou financeiro
  primary key (nf_saida_id, sequencia_cond, sequencia_parcela)
);
create index nf_saida_parcela_docfin on public.nf_saida_parcela (chave_docfin);

create table public.nf_saida_classe (
  nf_saida_id   uuid not null references public.nf_saida(id) on delete cascade,
  codigo_classe text not null,
  valor         numeric,
  natureza      text,
  primary key (nf_saida_id, codigo_classe)
);

-- País do Alvo → região de venda (mantida pelo Pedro). País sem linha aqui
-- aparece em v_nf_saida_paises_sem_regiao.
create table public.nf_saida_pais_regiao (
  sigla_pais    text primary key,                          -- código do Alvo, não ISO
  nome_pais     text,
  regiao        text not null,
  atualizado_em timestamptz not null default now()
);
insert into public.nf_saida_pais_regiao (sigla_pais, nome_pais, regiao) values
  ('BRA', 'BRASIL',         'Brasil'),
  ('AUS', 'Áustria',        'Áustria'),
  ('USA', 'ESTADOS UNIDOS', 'América do Norte'),
  ('ALE', 'ALEMANHA',       'Europa'),
  ('IND', 'INDIA',          'Ásia');

-- ---------------------------------------------------------------------
-- 3. Cabeçalho: aplica só as chaves PRESENTES no JSON (a lista tem 161
--    campos; o detalhe tem todos). Assim a lista nunca apaga com null um
--    campo que só o detalhe traz.
-- ---------------------------------------------------------------------
create function public.nf_saida__aplicar_cabecalho(p_id uuid, j jsonb) returns void
language sql as $$
  update public.nf_saida set
    tipo_nota                   = case when j ? 'TipoNota'                       then j->>'TipoNota' else tipo_nota end,
    origem_modulo               = case when j ? 'OrigemModulo'                   then j->>'OrigemModulo' else origem_modulo end,
    data_emissao                = case when j ? 'DataEmissao'                    then public.nf_saida__dt(j->>'DataEmissao') else data_emissao end,
    data_saida                  = case when j ? 'DataEntradaSaida'               then public.nf_saida__ts(j->>'DataEntradaSaida') else data_saida end,
    data_competencia            = case when j ? 'DataCompetencia'                then public.nf_saida__dt(j->>'DataCompetencia') else data_competencia end,
    data_digitacao              = case when j ? 'DataDigitacao'                  then public.nf_saida__ts(j->>'DataDigitacao') else data_digitacao end,
    codigo_entidade             = case when j ? 'CodigoEntidade'                 then j->>'CodigoEntidade' else codigo_entidade end,
    razao_social                = case when j ? 'RazaoSocialEntidade'            then j->>'RazaoSocialEntidade' else razao_social end,
    nome_fantasia               = case when j ? 'NomeFantasia'                   then j->>'NomeFantasia' else nome_fantasia end,
    cpf_cnpj                    = case when j ? 'CPFCNPJ'                        then j->>'CPFCNPJ' else cpf_cnpj end,
    tipo_pessoa                 = case when j ? 'TipoPessoa'                     then j->>'TipoPessoa' else tipo_pessoa end,
    natureza_entidade           = case when j ? 'NaturezaEntidade'               then j->>'NaturezaEntidade' else natureza_entidade end,
    sigla_pais                  = case when j ? 'SiglaPais'                      then j->>'SiglaPais' else sigla_pais end,
    nome_pais                   = case when j ? 'NomePais'                       then j->>'NomePais' else nome_pais end,
    uf                          = case when j ? 'SiglaUnidFederacaoEntidade'     then j->>'SiglaUnidFederacaoEntidade' else uf end,
    codigo_cidade               = case when j ? 'CodigoCidade'                   then j->>'CodigoCidade' else codigo_cidade end,
    nome_cidade                 = case when j ? 'NomeCidade'                     then j->>'NomeCidade' else nome_cidade end,
    endereco_entrega_mesmo      = case when j ? 'EnderecoEntregaMesmo'           then public.nf_saida__bool(j->>'EnderecoEntregaMesmo') else endereco_entrega_mesmo end,
    codigo_entidade_entrega     = case when j ? 'CodigoEntidadeEnderecoEntrega'  then j->>'CodigoEntidadeEnderecoEntrega' else codigo_entidade_entrega end,
    sequencia_endereco_entrega  = case when j ? 'SequenciaEnderecoEntrega'       then (j->>'SequenciaEnderecoEntrega')::integer else sequencia_endereco_entrega end,
    nome_entidade_entrega       = case when j ? 'NomeEntidadeEntrega'            then j->>'NomeEntidadeEntrega' else nome_entidade_entrega end,
    codigo_nat_operacao_produto = case when j ? 'CodigoNatOperacaoProduto'       then j->>'CodigoNatOperacaoProduto' else codigo_nat_operacao_produto end,
    codigo_nat_operacao_servico = case when j ? 'CodigoNatOperacaoServico'       then j->>'CodigoNatOperacaoServico' else codigo_nat_operacao_servico end,
    codigo_tipo_lanc_produto    = case when j ? 'CodigoTipoLancProduto'          then j->>'CodigoTipoLancProduto' else codigo_tipo_lanc_produto end,
    codigo_tipo_lanc_servico    = case when j ? 'CodigoTipoLancServico'          then j->>'CodigoTipoLancServico' else codigo_tipo_lanc_servico end,
    documento_origem            = case when j ? 'DocumentoOrigem'                then j->>'DocumentoOrigem' else documento_origem end,
    numero_pedido_entidade      = case when j ? 'NumeroPedidoEntidade'           then j->>'NumeroPedidoEntidade' else numero_pedido_entidade end,
    vendedor_principal          = case when j ? 'VendedorPrincipal'              then j->>'VendedorPrincipal' else vendedor_principal end,
    numero_nfse_prefeitura      = case when j ? 'NumeroRetornoNFSE'              then j->>'NumeroRetornoNFSE' else numero_nfse_prefeitura end,
    data_retorno_nfse           = case when j ? 'DataRetornoNFSE'                then public.nf_saida__dt(j->>'DataRetornoNFSE') else data_retorno_nfse end,
    cancelada                   = case when j ? 'Cancelada'                      then public.nf_saida__bool(j->>'Cancelada') else cancelada end,
    data_cancelamento           = case when j ? 'DataCancelamento'               then public.nf_saida__ts(j->>'DataCancelamento') else data_cancelamento end,
    denegada                    = case when j ? 'Denegada'                       then public.nf_saida__bool(j->>'Denegada') else denegada end,
    substituida                 = case when j ? 'Substituida'                    then public.nf_saida__bool(j->>'Substituida') else substituida end,
    documento_homologado        = case when j ? 'DocumentoHomologado'            then public.nf_saida__bool(j->>'DocumentoHomologado') else documento_homologado end,
    integrado_financeiro        = case when j ? 'IntegradoFinanceiro'            then public.nf_saida__bool(j->>'IntegradoFinanceiro') else integrado_financeiro end,
    baixado_estoque             = case when j ? 'BaixadoEstoque'                 then public.nf_saida__bool(j->>'BaixadoEstoque') else baixado_estoque end,
    moeda_codigo                = case when j ? 'CodigoIndEconomicoOrigem'       then j->>'CodigoIndEconomicoOrigem' else moeda_codigo end,
    cambio                      = case when j ? 'CambioOriginal'                 then (j->>'CambioOriginal')::numeric else cambio end,
    valor_original              = case when j ? 'ValorOriginal'                  then (j->>'ValorOriginal')::numeric else valor_original end,
    valor_total                 = case when j ? 'ValorTotal'                     then (j->>'ValorTotal')::numeric else valor_total end,
    valor_produto               = case when j ? 'ValorProduto'                   then (j->>'ValorProduto')::numeric else valor_produto end,
    valor_servico               = case when j ? 'ValorServico'                   then (j->>'ValorServico')::numeric else valor_servico end,
    valor_frete                 = case when j ? 'ValorFrete'                     then (j->>'ValorFrete')::numeric else valor_frete end,
    valor_seguro                = case when j ? 'ValorSeguro'                    then (j->>'ValorSeguro')::numeric else valor_seguro end,
    valor_despesa               = case when j ? 'ValorDespesa'                   then (j->>'ValorDespesa')::numeric else valor_despesa end,
    valor_desconto              = case when j ? 'ValorTotalDesconto'             then (j->>'ValorTotalDesconto')::numeric else valor_desconto end,
    valor_icms                  = case when j ? 'ValorICMS'                      then (j->>'ValorICMS')::numeric else valor_icms end,
    valor_icms_st               = case when j ? 'ValorICMSST'                    then (j->>'ValorICMSST')::numeric else valor_icms_st end,
    valor_ipi                   = case when j ? 'ValorIPI'                       then (j->>'ValorIPI')::numeric else valor_ipi end,
    valor_iss                   = case when j ? 'ValorISS'                       then (j->>'ValorISS')::numeric else valor_iss end,
    valor_cbs                   = case when j ? 'ValorCBS'                       then (j->>'ValorCBS')::numeric else valor_cbs end,
    valor_ibs_uf                = case when j ? 'ValorIBSUF'                     then (j->>'ValorIBSUF')::numeric else valor_ibs_uf end,
    valor_ibs_cidade            = case when j ? 'ValorIBSCidade'                 then (j->>'ValorIBSCidade')::numeric else valor_ibs_cidade end,
    alvo_atualizado_em          = case when j ? 'DataUltimaAtualizacao'          then public.nf_saida__ts(j->>'DataUltimaAtualizacao') else alvo_atualizado_em end
  where id = p_id
$$;

-- ---------------------------------------------------------------------
-- 4. RPC 1 — grava uma página da LISTA (GetListForComponents)
--    Nota nova ou com linha diferente → detalhe 'pendente'.
--    Nota já gravada, dentro da faixa de números da página, que NÃO veio
--    → 'pendente' (o Load dirá se sumiu).
-- ---------------------------------------------------------------------
create function public.nf_saida_registrar_lista(p_linhas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_id uuid; v_hash text; v_old text;
  v_novas int := 0; v_mudaram int := 0; v_iguais int := 0; v_reconferir int := 0; v_n int;
  k record;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON';
  end if;

  for r in select x from jsonb_array_elements(p_linhas) x loop
    if coalesce(r->>'CodigoEmpresaFilial','') = '' or coalesce(r->>'ModeloCtrlDf','') = ''
       or coalesce(r->>'SerieCtrlDf','') = '' or coalesce(r->>'Numero','') = '' then
      raise exception 'linha da lista sem identidade completa: %', left(r::text, 200);
    end if;
    v_hash := md5((r - 'NotaFiscalProtocoloObject')::text);
    v_id := null;

    insert into nf_saida (codigo_empresa_filial, modelo, serie, numero_alvo,
                          payload_lista, lista_hash, ultima_leitura_lista_em)
    values (r->>'CodigoEmpresaFilial', r->>'ModeloCtrlDf', r->>'SerieCtrlDf', r->>'Numero',
            r, v_hash, now())
    on conflict on constraint nf_saida_identidade do nothing
    returning id into v_id;

    if v_id is not null then
      v_novas := v_novas + 1;
    else
      select id, lista_hash into v_id, v_old
        from nf_saida
       where codigo_empresa_filial = r->>'CodigoEmpresaFilial' and modelo = r->>'ModeloCtrlDf'
         and serie = r->>'SerieCtrlDf' and numero_alvo = r->>'Numero'
       for update;
      if v_old is distinct from v_hash then
        update nf_saida
           set payload_lista = r, lista_hash = v_hash, detalhe_status = 'pendente',
               tentativas = 0, proxima_em = null, ultimo_erro = null
         where id = v_id;
        v_mudaram := v_mudaram + 1;
      else
        v_iguais := v_iguais + 1;
      end if;
      update nf_saida set ultima_leitura_lista_em = now(), ausente_desde = null where id = v_id;
    end if;

    perform nf_saida__aplicar_cabecalho(v_id, r);
  end loop;

  -- faixa de cada série na página: o que já existe e não veio → reconferir
  for k in
    select x->>'CodigoEmpresaFilial' f, x->>'ModeloCtrlDf' m, x->>'SerieCtrlDf' s,
           min((x->>'Numero')::bigint) mn, max((x->>'Numero')::bigint) mx
      from jsonb_array_elements(p_linhas) x
     where x->>'Numero' ~ '^\d{1,18}$'
     group by 1, 2, 3
  loop
    update nf_saida n
       set detalhe_status = 'pendente', tentativas = 0, proxima_em = null, ultimo_erro = null
     where n.codigo_empresa_filial = k.f and n.modelo = k.m and n.serie = k.s
       and n.numero between k.mn and k.mx
       and n.ausente_desde is null
       and n.detalhe_status <> 'pendente'
       and not exists (select 1 from jsonb_array_elements(p_linhas) y
                        where y->>'CodigoEmpresaFilial' = k.f and y->>'ModeloCtrlDf' = k.m
                          and y->>'SerieCtrlDf' = k.s and y->>'Numero' = n.numero_alvo);
    get diagnostics v_n = row_count;
    v_reconferir := v_reconferir + v_n;
  end loop;

  return jsonb_build_object('linhas', jsonb_array_length(p_linhas), 'novas', v_novas,
                            'mudaram', v_mudaram, 'iguais', v_iguais, 'reconferir', v_reconferir);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. RPC 2 — grava o DETALHE (notaFiscal/Load com loadChild=All)
--    payload null → nota sumiu do Alvo (ausente_desde).
--    Hash igual → só carimba a leitura. Hash diferente → nova versão,
--    cabeçalho atualizado e filhas regravadas na mesma transação.
-- ---------------------------------------------------------------------
create function public.nf_saida_gravar_detalhe(p_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v nf_saida%rowtype;
  v_hash text;
  v_itens jsonb;
begin
  select * into v from nf_saida where id = p_id for update;
  if not found then
    raise exception 'nf_saida % não existe', p_id;
  end if;

  if p_payload is null or jsonb_typeof(p_payload) = 'null' then
    update nf_saida
       set ausente_desde = coalesce(ausente_desde, now()), detalhe_status = 'carregado',
           tentativas = 0, proxima_em = null, ultimo_erro = null, ultima_leitura_detalhe_em = now()
     where id = p_id;
    return jsonb_build_object('resultado', 'ausente', 'versao', v.versao);
  end if;

  if p_payload->>'CodigoEmpresaFilial' is distinct from v.codigo_empresa_filial
     or p_payload->>'ModeloCtrlDf'     is distinct from v.modelo
     or p_payload->>'SerieCtrlDf'      is distinct from v.serie
     or p_payload->>'Numero'           is distinct from v.numero_alvo then
    raise exception 'o detalhe recebido (% % % %) não é da nota % % % %',
      p_payload->>'CodigoEmpresaFilial', p_payload->>'ModeloCtrlDf', p_payload->>'SerieCtrlDf', p_payload->>'Numero',
      v.codigo_empresa_filial, v.modelo, v.serie, v.numero_alvo;
  end if;

  -- NotaFiscalProtocoloObject.DataHora traz a hora da LEITURA: fora do hash.
  v_hash := md5((p_payload - 'NotaFiscalProtocoloObject')::text);

  if v.payload_hash is distinct from v_hash then
    insert into nf_saida_versao (nf_saida_id, versao, payload_hash, payload_alvo)
    values (p_id, v.versao + 1, v_hash, p_payload);

    update nf_saida set payload_hash = v_hash, versao = v.versao + 1 where id = p_id;
    perform nf_saida__aplicar_cabecalho(p_id, p_payload);

    delete from nf_saida_item        where nf_saida_id = p_id;
    delete from nf_saida_item_lote   where nf_saida_id = p_id;
    delete from nf_saida_item_serie  where nf_saida_id = p_id;
    delete from nf_saida_parcela     where nf_saida_id = p_id;
    delete from nf_saida_classe      where nf_saida_id = p_id;

    v_itens := coalesce(p_payload->'ItemNfChildList', '[]'::jsonb);

    insert into nf_saida_item (nf_saida_id, sequencia, item_servico, codigo_produto, codigo_alternativo,
      nome_produto, natureza_operacao, ncm, unidade, quantidade, valor_unitario, valor_total,
      valor_frete, valor_desconto, valor_icms, valor_icms_st, valor_ipi, valor_pis, valor_cofins,
      valor_iss, valor_cbs, valor_ibs_uf, valor_ibs_cidade, codigo_tipo_lanc, numero_pedvenda,
      controla_lote, possui_num_serie)
    select p_id, (it->>'Sequencia')::integer, nf_saida__bool(it->>'ItemServico'), it->>'CodigoProduto',
           it->>'CodigoAlternativoProduto', it->>'NomeProduto', it->>'CodigoNatOperacao',
           it->'ItemNfFormPrecoObject'->>'NCMNBS', it->>'CodigoProdUnidMed',
           (it->>'Quantidade')::numeric, (it->>'ValorUnitario')::numeric, (it->>'ValorTotal')::numeric,
           (it->>'ValorFrete')::numeric, (it->>'ValorDescontoEspecial')::numeric,
           (it->>'ValorICMS')::numeric, (it->>'ValorICMSST')::numeric, (it->>'ValorIPI')::numeric,
           (it->>'ValorPIS')::numeric, (it->>'ValorCOFINS')::numeric, (it->>'ValorISS')::numeric,
           (it->'ItemNfFormPrecoObject'->>'ValorCBS')::numeric,
           (it->'ItemNfFormPrecoObject'->>'ValorIBSUF')::numeric,
           (it->'ItemNfFormPrecoObject'->>'ValorIBSCidade')::numeric,
           it->'ItemNfFormPrecoObject'->>'CodigoTipoLanc', it->>'NumeroPedVenda',
           nf_saida__bool(it->>'ControlaLote'), nf_saida__bool(it->>'PossuiNumSerie')
      from jsonb_array_elements(v_itens) it;

    insert into nf_saida_item_lote (nf_saida_id, sequencia_item, ordem, codigo_produto,
                                    numero_lote, data_validade, codigo_local, quantidade)
    select p_id, (it->>'Sequencia')::integer, l.ord::integer, l.x->>'CodigoProduto',
           l.x->>'NumeroCtrlLote', nf_saida__dt(l.x->>'DataValidadeCtrlLote'),
           l.x->>'CodigoLocArmaz', (l.x->>'Quantidade')::numeric
      from jsonb_array_elements(v_itens) it
      cross join lateral jsonb_array_elements(coalesce(it->'CtrlLoteLocArmItNfChildList', '[]'::jsonb))
           with ordinality as l(x, ord);

    insert into nf_saida_item_serie (nf_saida_id, sequencia_item, controle_num_serie)
    select distinct p_id, (it->>'Sequencia')::integer, (s->>'ControleNumSerie')::bigint
      from jsonb_array_elements(v_itens) it
      cross join lateral jsonb_array_elements(coalesce(it->'NumSerieItemNfChildList', '[]'::jsonb)) s
     where s->>'ControleNumSerie' is not null;

    insert into nf_saida_parcela (nf_saida_id, sequencia_cond, sequencia_parcela, duplicata,
      codigo_cond_pag, nome_cond_pag, data_vencimento, valor, codigo_tipo_cobranca, chave_docfin)
    select p_id, coalesce((c.x->>'Sequencia')::integer, c.ord::integer),
           coalesce((pp.y->>'SequenciaParcela')::integer, pp.ord::integer),
           pp.y->>'Duplicata', c.x->>'CodigoCondPag', c.x->>'NomeCondicaoPagamento',
           nf_saida__dt(pp.y->>'DataVencimento'), (pp.y->>'ValorParcela')::numeric,
           pp.y->>'CodigoTipoCobranca', (c.x->>'ChaveDocFin')::bigint
      from jsonb_array_elements(coalesce(p_payload->'CondPagNfChildList', '[]'::jsonb))
           with ordinality as c(x, ord)
      cross join lateral jsonb_array_elements(coalesce(c.x->'ParcPagNfChildList', '[]'::jsonb))
           with ordinality as pp(y, ord);

    insert into nf_saida_classe (nf_saida_id, codigo_classe, valor, natureza)
    select p_id, x->>'CodigoClasseRecDesp', sum((x->>'Valor')::numeric), max(x->>'Natureza')
      from jsonb_array_elements(coalesce(p_payload->'NotaFiscalClasseRecDespChildList', '[]'::jsonb)) x
     where x->>'CodigoClasseRecDesp' is not null
     group by x->>'CodigoClasseRecDesp';

    update nf_saida
       set classe_principal = (select codigo_classe from nf_saida_classe
                                where nf_saida_id = p_id
                                order by valor desc nulls last, codigo_classe limit 1),
           numero_pedvenda  = p_payload->'PedVendaNotaFiscalChildList'->0->>'NumeroPedVenda'
     where id = p_id;
  end if;

  update nf_saida
     set ausente_desde = null, detalhe_status = 'carregado', tentativas = 0, proxima_em = null,
         ultimo_erro = null, ultima_leitura_detalhe_em = now()
   where id = p_id;

  return jsonb_build_object(
    'resultado', case when v.payload_hash is distinct from v_hash then 'nova_versao' else 'sem_mudanca' end,
    'versao', case when v.payload_hash is distinct from v_hash then v.versao + 1 else v.versao end);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. RPC 3 — falha ao ler o detalhe: espera 15 min, 1 h, 6 h, 24 h;
--    na 5ª tentativa a nota fica 'estacionado' (régua do sync-parcelas-pagar v9).
-- ---------------------------------------------------------------------
create function public.nf_saida_registrar_falha(p_id uuid, p_erro text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t int; v_s text;
begin
  update nf_saida
     set tentativas     = tentativas + 1,
         ultimo_erro    = left(coalesce(p_erro, '(sem mensagem)'), 2000),
         detalhe_status = case when tentativas + 1 >= 5 then 'estacionado' else 'erro' end,
         proxima_em     = now() + case tentativas + 1 when 1 then interval '15 minutes'
                                                      when 2 then interval '1 hour'
                                                      when 3 then interval '6 hours'
                                                      else interval '24 hours' end
   where id = p_id
  returning tentativas, detalhe_status into v_t, v_s;
  if not found then
    raise exception 'nf_saida % não existe', p_id;
  end if;
  return jsonb_build_object('tentativas', v_t, 'detalhe_status', v_s);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Views (security_invoker: respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------
create view public.v_nf_saida with (security_invoker = true) as
select n.id, n.codigo_empresa_filial, n.modelo, n.serie, n.numero, n.numero_alvo,
       n.tipo_nota, n.data_emissao, n.data_competencia, n.codigo_entidade, n.razao_social,
       n.nome_fantasia, n.cpf_cnpj, n.sigla_pais, n.nome_pais, n.uf, n.nome_cidade,
       coalesce(r.regiao, '(sem região)') as regiao,
       (n.codigo_entidade = '0000017') as intercompany_austria,
       case when n.modelo = 'NFS-e' then coalesce(n.codigo_nat_operacao_servico, n.codigo_nat_operacao_produto)
            else coalesce(n.codigo_nat_operacao_produto, n.codigo_nat_operacao_servico) end as natureza_principal,
       case left(case when n.modelo = 'NFS-e' then coalesce(n.codigo_nat_operacao_servico, n.codigo_nat_operacao_produto)
                      else coalesce(n.codigo_nat_operacao_produto, n.codigo_nat_operacao_servico) end, 1)
            when '5' then 'estadual' when '6' then 'interestadual' when '7' then 'exterior'
            when '1' then 'entrada estadual' when '2' then 'entrada interestadual' when '3' then 'entrada exterior'
       end as abrangencia,
       n.classe_principal,
       case when n.classe_principal is null then null
            else case left(n.classe_principal, 2)
                   when '01' then 'venda' when '02' then 'remessa' when '03' then 'retorno'
                   when '04' then 'devolução de venda' when '05' then 'devolução de compra'
                   else 'outros' end
       end as tipo_operacao,
       n.numero_pedvenda, n.vendedor_principal, n.cancelada, n.data_cancelamento,
       n.numero_nfse_prefeitura, n.moeda_codigo, n.cambio, n.valor_original,
       n.valor_total, n.valor_produto, n.valor_servico, n.valor_frete, n.valor_desconto,
       n.valor_icms, n.valor_ipi, n.valor_iss, n.valor_cbs, n.valor_ibs_uf,
       n.integrado_financeiro, n.baixado_estoque,
       n.situacao_hub, n.detalhe_status, n.versao, n.ausente_desde,
       n.ultima_leitura_lista_em, n.ultima_leitura_detalhe_em
  from public.nf_saida n
  left join public.nf_saida_pais_regiao r on r.sigla_pais = n.sigla_pais;

create view public.v_nf_saida_lacunas with (security_invoker = true) as
with faixa as (
  select codigo_empresa_filial, modelo, serie, min(numero) mn, max(numero) mx
    from public.nf_saida where numero is not null
   group by 1, 2, 3)
select f.codigo_empresa_filial, f.modelo, f.serie, g.numero
  from faixa f
  cross join lateral generate_series(f.mn, f.mx) as g(numero)
 where not exists (select 1 from public.nf_saida n
                    where n.codigo_empresa_filial = f.codigo_empresa_filial and n.modelo = f.modelo
                      and n.serie = f.serie and n.numero = g.numero);

create view public.v_nf_saida_paises_sem_regiao with (security_invoker = true) as
select n.sigla_pais, max(n.nome_pais) as nome_pais, count(*) as notas
  from public.nf_saida n
  left join public.nf_saida_pais_regiao r on r.sigla_pais = n.sigla_pais
 where r.sigla_pais is null and n.sigla_pais is not null
 group by n.sigla_pais;

-- ---------------------------------------------------------------------
-- 8. Segurança
--    Tabelas: RLS ligado; leitura só admin (padrão de rastreio_nf);
--    escrita só service_role (Edge), que ignora RLS.
--    Funções: o default do schema concede EXECUTE a anon/authenticated
--    NOMINALMENTE — revogar com a assinatura completa (CLAUDE.md).
-- ---------------------------------------------------------------------
alter table public.nf_saida             enable row level security;
alter table public.nf_saida_versao      enable row level security;
alter table public.nf_saida_item        enable row level security;
alter table public.nf_saida_item_lote   enable row level security;
alter table public.nf_saida_item_serie  enable row level security;
alter table public.nf_saida_parcela     enable row level security;
alter table public.nf_saida_classe      enable row level security;
alter table public.nf_saida_pais_regiao enable row level security;

create policy nf_saida_admin_select             on public.nf_saida             for select to authenticated using (_is_admin());
create policy nf_saida_versao_admin_select      on public.nf_saida_versao      for select to authenticated using (_is_admin());
create policy nf_saida_item_admin_select        on public.nf_saida_item        for select to authenticated using (_is_admin());
create policy nf_saida_item_lote_admin_select   on public.nf_saida_item_lote   for select to authenticated using (_is_admin());
create policy nf_saida_item_serie_admin_select  on public.nf_saida_item_serie  for select to authenticated using (_is_admin());
create policy nf_saida_parcela_admin_select     on public.nf_saida_parcela     for select to authenticated using (_is_admin());
create policy nf_saida_classe_admin_select      on public.nf_saida_classe      for select to authenticated using (_is_admin());
create policy nf_saida_pais_regiao_admin_select on public.nf_saida_pais_regiao for select to authenticated using (_is_admin());

revoke all on public.nf_saida, public.nf_saida_versao, public.nf_saida_item, public.nf_saida_item_lote,
              public.nf_saida_item_serie, public.nf_saida_parcela, public.nf_saida_classe,
              public.nf_saida_pais_regiao,
              public.v_nf_saida, public.v_nf_saida_lacunas, public.v_nf_saida_paises_sem_regiao
  from anon;
revoke insert, update, delete, truncate, references, trigger
    on public.nf_saida, public.nf_saida_versao, public.nf_saida_item, public.nf_saida_item_lote,
       public.nf_saida_item_serie, public.nf_saida_parcela, public.nf_saida_classe,
       public.nf_saida_pais_regiao,
       public.v_nf_saida, public.v_nf_saida_lacunas, public.v_nf_saida_paises_sem_regiao
  from authenticated;

revoke execute on function public.nf_saida__bool(text)                     from public, anon, authenticated;
revoke execute on function public.nf_saida__dt(text)                       from public, anon, authenticated;
revoke execute on function public.nf_saida__ts(text)                       from public, anon, authenticated;
revoke execute on function public.nf_saida__aplicar_cabecalho(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.nf_saida_registrar_lista(jsonb)          from public, anon, authenticated;
revoke execute on function public.nf_saida_gravar_detalhe(uuid, jsonb)     from public, anon, authenticated;
revoke execute on function public.nf_saida_registrar_falha(uuid, text)     from public, anon, authenticated;
grant  execute on function public.nf_saida_registrar_lista(jsonb)          to service_role;
grant  execute on function public.nf_saida_gravar_detalhe(uuid, jsonb)     to service_role;
grant  execute on function public.nf_saida_registrar_falha(uuid, text)     to service_role;
