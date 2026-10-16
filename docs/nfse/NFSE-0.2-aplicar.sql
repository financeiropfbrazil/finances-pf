-- =====================================================================
-- NFSE-0.2 — tabela nfse_adn_doc (espelho do ADN da NFS-e Nacional)
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Registro no PLANO-NFSE.md.
--
-- O que é: uma linha por documento que o ADN distribui para a P&F (NFS-e ou
-- evento), lido por NSU pela Edge nfse-adn-sonda (NFSE-0.3) através da rota
-- /nfse-adn do erp-proxy (NFSE-0.1). Fase 0 = sonda de cobertura; a mesma
-- tabela é o espelho que a tela da Fase 1 vai ler.
--
-- Quem grava o quê:
--   Edge (service_role) → nsu, chave_acesso, tipo_documento, tipo_evento, gerado_em, xml
--   Gatilho (este SQL)  → os campos extraídos do XML, papel_pf, extracao_erro
--   Extrair no banco, e não na Edge, deixa uma regra só e permite reextrair tudo
--   depois de um ajuste com: update public.nfse_adn_doc set xml = xml;
--   XML que não abre não derruba a gravação: a linha entra com extracao_erro.
--
-- Acesso: RLS ligada sem policy; anon/authenticated sem privilégio nenhum
-- (o default do Supabase daria tudo a eles); service_role grava; klaus_readonly lê.
--
-- Não toca em nenhum objeto existente (compras_nfse fica como está).
-- UMA transação; qualquer falha desfaz tudo. Rollback: NFSE-0.2-rollback.sql.
-- =====================================================================

begin;

-- ── 0. Pré-voo ───────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000
     or to_regclass('public.intercompany_invoices_master_blocos_manual') is null
     or to_regclass('public.rastreio_tentativa') is null then
    raise exception 'PRÉ-VOO: este banco não parece o Financial Hub (hbtggrbauguukewiknew). Nada foi alterado.';
  end if;
  if to_regclass('public.nfse_adn_doc') is not null
     or to_regprocedure('public.nfse_adn_xp(xml,text)') is not null
     or to_regprocedure('public.nfse_adn_doc_extrair()') is not null then
    raise exception 'PRÉ-VOO: nfse_adn_doc ou suas funções já existem (execução anterior?). Ver NFSE-0.2-rollback.sql.';
  end if;
  -- O gatilho usa xpath(): o Postgres precisa ter suporte a XML.
  perform xmlparse(document '<a><b>1</b></a>');
end $$;

-- ── 1. Tabela ────────────────────────────────────────────────────────
create table public.nfse_adn_doc (
  nsu               bigint      primary key,
  chave_acesso      text,
  tipo_documento    text,                       -- como o ADN manda (ex.: NFSE, EVENTO)
  tipo_evento       text,                       -- ex.: CANCELAMENTO (só em evento)
  gerado_em         timestamptz,                -- quando o ADN gerou o documento
  xml               text,                       -- XML descompactado, como veio
  -- extraídos do XML pelo gatilho (null em evento ou se o XML não abrir)
  numero            text,                       -- infNFSe/nNFSe
  data_emissao      date,                       -- infDPS/dhEmi
  prestador_doc     text,                       -- CNPJ/CPF do prestador (emit)
  prestador_nome    text,
  prestador_cmun    text,                       -- IBGE do endereço do prestador
  cmun_emissor      text,                       -- IBGE do município emissor (infDPS/cLocEmi) — a "prefeitura" da medição
  tomador_doc       text,                       -- CNPJ/CPF/NIF do tomador
  intermediario_doc text,
  valor_servico     numeric(15,2),              -- infDPS/valores/vServPrest/vServ
  valor_liquido     numeric(15,2),              -- infNFSe/valores/vLiq
  papel_pf          text check (papel_pf in ('tomador', 'prestador', 'intermediario')),
  extracao_erro     text,                       -- preenchido quando o XML não abre ou um campo não converte
  lido_em           timestamptz not null default now(),  -- 1ª leitura pelo Hub
  atualizado_em     timestamptz not null default now()
);

comment on table public.nfse_adn_doc is
  'NFSE (PLANO-NFSE.md): espelho do ADN da NFS-e Nacional — um documento por NSU (nota ou evento) em que a P&F '
  '(raiz 26602204) é tomadora, prestadora ou intermediária. Grava: Edge nfse-adn-sonda. Campos extraídos: gatilho '
  'nfse_adn_doc_extrair (reextrair: update set xml = xml). É o que o FISCO mostra, não o que está lançado no Alvo.';
comment on column public.nfse_adn_doc.cmun_emissor is
  'Código IBGE do município emissor (infDPS/cLocEmi). Eixo da medição de cobertura por prefeitura.';
comment on column public.nfse_adn_doc.papel_pf is
  'Papel da P&F (CNPJ raiz 26602204, inclui filiais) no documento. Null em evento ou sem extração.';
comment on column public.nfse_adn_doc.extracao_erro is
  'Motivo de o gatilho não ter extraído os campos. Linha com valor aqui = XML a examinar, não nota a ignorar.';

create index nfse_adn_doc_chave_idx     on public.nfse_adn_doc (chave_acesso);
create index nfse_adn_doc_prest_num_idx on public.nfse_adn_doc (prestador_doc, numero);
create index nfse_adn_doc_emissao_idx   on public.nfse_adn_doc (data_emissao);

alter table public.nfse_adn_doc enable row level security;
-- Notas fiscais de terceiros: ninguém do app lê nesta fase. O default do Supabase daria tudo a anon/authenticated.
revoke all on public.nfse_adn_doc from public, anon, authenticated;
grant all on public.nfse_adn_doc to service_role;
grant select on public.nfse_adn_doc to klaus_readonly;

-- ── 2. Extração do XML ───────────────────────────────────────────────
-- Valor do 1º nó no caminho 'a/b/c', em qualquer profundidade e sem depender
-- de namespace/prefixo: vira //*[local-name()='a']/*[local-name()='b']/*[local-name()='c'].
-- O xpath() do Postgres devolve o texto ESCAPADO ("A &amp; B"): desfaz aqui, com &amp; por último.
create function public.nfse_adn_xp(p_xml xml, p_caminho text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(
           pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
             (pg_catalog.xpath(
                '/' || (select pg_catalog.string_agg('/*[local-name()=''' || passo || ''']', '' order by ord)
                          from pg_catalog.unnest(pg_catalog.string_to_array(p_caminho, '/')) with ordinality as t(passo, ord))
                || '/text()', p_xml))[1]::text,
             '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', ''''), '&#x0d;', pg_catalog.chr(13)), '&amp;', '&')
         ), '')
$$;

create function public.nfse_adn_doc_extrair()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  x       xml;
  v_raiz  constant text := '26602204';   -- CNPJ raiz da P&F (matriz e filiais)
begin
  new.numero := null; new.data_emissao := null;
  new.prestador_doc := null; new.prestador_nome := null; new.prestador_cmun := null; new.cmun_emissor := null;
  new.tomador_doc := null; new.intermediario_doc := null;
  new.valor_servico := null; new.valor_liquido := null;
  new.papel_pf := null; new.extracao_erro := null;
  new.atualizado_em := now();

  if new.xml is null or btrim(new.xml) = '' then
    new.extracao_erro := 'sem XML';
    return new;
  end if;

  begin
    x := xmlparse(document pg_catalog.ltrim(new.xml, pg_catalog.chr(65279)));   -- tira BOM, se houver

    new.numero            := public.nfse_adn_xp(x, 'infNFSe/nNFSe');
    new.data_emissao      := pg_catalog.left(public.nfse_adn_xp(x, 'infDPS/dhEmi'), 10)::date;
    new.prestador_doc     := coalesce(public.nfse_adn_xp(x, 'infNFSe/emit/CNPJ'), public.nfse_adn_xp(x, 'infNFSe/emit/CPF'),
                                      public.nfse_adn_xp(x, 'infDPS/prest/CNPJ'), public.nfse_adn_xp(x, 'infDPS/prest/CPF'));
    new.prestador_nome    := public.nfse_adn_xp(x, 'infNFSe/emit/xNome');
    new.prestador_cmun    := public.nfse_adn_xp(x, 'infNFSe/emit/enderNac/cMun');
    new.cmun_emissor      := public.nfse_adn_xp(x, 'infDPS/cLocEmi');
    new.tomador_doc       := coalesce(public.nfse_adn_xp(x, 'infDPS/toma/CNPJ'), public.nfse_adn_xp(x, 'infDPS/toma/CPF'),
                                      public.nfse_adn_xp(x, 'infDPS/toma/NIF'));
    new.intermediario_doc := coalesce(public.nfse_adn_xp(x, 'infDPS/interm/CNPJ'), public.nfse_adn_xp(x, 'infDPS/interm/CPF'));
    new.valor_servico     := public.nfse_adn_xp(x, 'infDPS/valores/vServPrest/vServ')::numeric;
    new.valor_liquido     := public.nfse_adn_xp(x, 'infNFSe/valores/vLiq')::numeric;

    new.papel_pf := case
      when pg_catalog.left(new.tomador_doc, 8)       = v_raiz then 'tomador'
      when pg_catalog.left(new.prestador_doc, 8)     = v_raiz then 'prestador'
      when pg_catalog.left(new.intermediario_doc, 8) = v_raiz then 'intermediario'
    end;
  exception when others then
    new.numero := null; new.data_emissao := null;
    new.prestador_doc := null; new.prestador_nome := null; new.prestador_cmun := null; new.cmun_emissor := null;
    new.tomador_doc := null; new.intermediario_doc := null;
    new.valor_servico := null; new.valor_liquido := null; new.papel_pf := null;
    new.extracao_erro := pg_catalog.left(sqlstate || ': ' || sqlerrm, 500);
  end;
  return new;
end;
$$;

create trigger nfse_adn_doc_extrair
  before insert or update of xml on public.nfse_adn_doc
  for each row execute function public.nfse_adn_doc_extrair();

-- Funções novas nascem com EXECUTE nominal para anon/authenticated (default do Supabase):
-- revogar com a assinatura completa. service_role e postgres mantêm.
revoke execute on function public.nfse_adn_xp(xml, text)   from public, anon, authenticated;
revoke execute on function public.nfse_adn_doc_extrair()   from public, anon, authenticated;

-- ── 3. Conferência dentro da transação ───────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.nfse_adn_doc', 'select')
     or has_table_privilege('authenticated', 'public.nfse_adn_doc', 'select')
     or has_table_privilege('anon', 'public.nfse_adn_doc', 'insert')
     or has_table_privilege('authenticated', 'public.nfse_adn_doc', 'insert')
     or has_function_privilege('anon', 'public.nfse_adn_xp(xml,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nfse_adn_xp(xml,text)', 'execute')
     or has_function_privilege('anon', 'public.nfse_adn_doc_extrair()', 'execute') then
    raise exception 'ACESSOS: anon/authenticated ficaram com acesso indevido. Transação desfeita.';
  end if;
  if not has_table_privilege('service_role', 'public.nfse_adn_doc', 'insert')
     or not has_table_privilege('klaus_readonly', 'public.nfse_adn_doc', 'select')
     or not has_function_privilege('service_role', 'public.nfse_adn_xp(xml,text)', 'execute') then
    raise exception 'ACESSOS: service_role/klaus_readonly sem o acesso previsto. Transação desfeita.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.nfse_adn_doc'::regclass) then
    raise exception 'RLS: não ficou ligada. Transação desfeita.';
  end if;
end $$;

-- Autoteste do gatilho com uma nota sintética (desfeito no savepoint: nada fica gravado).
savepoint autoteste;
insert into public.nfse_adn_doc (nsu, chave_acesso, tipo_documento, xml) values
  (-1, 'TESTE', 'NFSE',
   '<?xml version="1.0" encoding="UTF-8"?><NFSe versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse">'
   '<infNFSe Id="NFSTESTE"><nNFSe>123</nNFSe><emit><CNPJ>11222333000181</CNPJ><xNome>Fornecedor &amp; Teste</xNome>'
   '<enderNac><cMun>3549805</cMun><UF>SP</UF></enderNac></emit><valores><vLiq>1450.00</vLiq></valores>'
   '<DPS versao="1.00"><infDPS Id="DPSTESTE"><dhEmi>2026-10-01T09:58:00-03:00</dhEmi><cLocEmi>3549805</cLocEmi>'
   '<prest><CNPJ>11222333000181</CNPJ></prest><toma><CNPJ>26602204000196</CNPJ></toma>'
   '<valores><vServPrest><vServ>1500.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe>'
   '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></NFSe>'),
  (-2, 'TESTE', 'NFSE', '<NFSe><infNFSe>quebrado'),
  (-3, 'TESTE', 'EVENTO', null);
do $$
declare r record;
begin
  select * into r from public.nfse_adn_doc where nsu = -1;
  if r.numero is distinct from '123' or r.data_emissao is distinct from date '2026-10-01'
     or r.prestador_doc is distinct from '11222333000181' or r.prestador_nome is distinct from 'Fornecedor & Teste'
     or r.prestador_cmun is distinct from '3549805' or r.cmun_emissor is distinct from '3549805'
     or r.tomador_doc is distinct from '26602204000196' or r.intermediario_doc is not null
     or r.valor_servico is distinct from 1500.00 or r.valor_liquido is distinct from 1450.00
     or r.papel_pf is distinct from 'tomador' or r.extracao_erro is not null then
    raise exception 'AUTOTESTE: extração da nota sintética saiu errada: %', row_to_json(r);
  end if;
  select * into r from public.nfse_adn_doc where nsu = -2;
  if r.extracao_erro is null or r.numero is not null then
    raise exception 'AUTOTESTE: XML quebrado deveria gravar com extracao_erro: %', row_to_json(r);
  end if;
  select * into r from public.nfse_adn_doc where nsu = -3;
  if r.extracao_erro is distinct from 'sem XML' then
    raise exception 'AUTOTESTE: documento sem XML deveria gravar com extracao_erro = sem XML: %', row_to_json(r);
  end if;
  update public.nfse_adn_doc set xml = xml where nsu = -1;   -- reextração
  if (select numero from public.nfse_adn_doc where nsu = -1) is distinct from '123' then
    raise exception 'AUTOTESTE: reextração (update set xml = xml) falhou.';
  end if;
end $$;
rollback to savepoint autoteste;

do $$
begin
  if exists (select 1 from public.nfse_adn_doc) then
    raise exception 'AUTOTESTE: sobraram linhas de teste. Transação desfeita.';
  end if;
end $$;

commit;
