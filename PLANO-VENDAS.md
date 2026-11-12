# PLANO-VENDAS — Espelho das notas fiscais emitidas pela P&F (NF de saída)

> Plano autocontido do módulo. Mudanças entram como prompts novos (Ajuste/Correção), sem reescrever prompt registrado.
> Fonte única: **Alvo** (via erp-proxy). **Nada por certificado digital / SEFAZ** (ordem do Pedro, 30/10/2026).

## 0. Status dos prompts

| Prompt | O quê | Status |
|---|---|---|
| VND-0 | Diagnóstico: fonte, endpoints, estratégia, desenho das tabelas | **concluído 05/11/2026 (este documento)** — nada aplicado |
| VND-1 | Captura de amostras no Alvo (Load completo com itens; tela de listagem) + respostas do fiscal | **concluído 05/11/2026 pelo Lab de API** (§11); restam chave de acesso, nº 5160 e perguntas ao fiscal |
| VND-2 | erp-proxy: liberar `notaFiscal/Load` (leitura) na whitelist do passthrough | **concluído 05/11/2026** — Pedro liberou os dois endpoints do Ajuste A (erp-proxy `7dfe972`) e fez o deploy |
| VND-3 | DDL: tabelas, RLS, RPC de gravação (migration) | **concluído 05/11/2026** — migration `vnd_3_nf_saida` (versão `20261105195613`) aplicada com ordem do Pedro; conferência pós-aplicação na §13.5 |
| VND-4 | Edge `sync-nf-saida-cron` (lista + detalhe um a um) + teste | **concluído 05/11/2026** — v1 em produção; testes A e B aprovados (§14.6) |
| VND-5 | Carga histórica (backfill) desde a data de corte, em lotes | **concluído 05/11/2026** — corte **01/01/2025** (ordem do Pedro); 2.278 notas, 0 erros, 58 lacunas confirmadas; resultado na §16 |
| VND-6 | Cron + kill-switch em `sync_settings` + conferências | **concluído 11/11/2026** — migration `vnd_6_cron`; rodada manual sem erro; `cron.job` 37 **ligado** com ordem do Pedro (§17) |
| VND-7 | Tela Vendas › Notas de Saída (permissão, papel, RPCs de leitura, menu) | **concluído 11/11/2026** — migration `vnd_7_vendas_tela`; teste com usuário sem `is_admin` aprovado; front no `main` (§18) |
| VND-8 | Número de série impresso (`NumSerie/Load`) no espelho de saídas | **concluído 12/11/2026** — migration `vnd_8_series`, Edge v3; carga das ~7.100 séries em lotes (§19) |
| VND-9 | Janela de leitura para o Balancete P&F + leitura de hora em hora e varredura noturna | **em andamento 12/11/2026** — etapa H2 do mesmo desenho (§20) |

## 1. Objetivo e escopo

Ter no Hub, **nota a nota**, tudo o que a P&F emite no Alvo (NF-e de produto e NFS-e), com cabeçalho, itens e situação, atualizado por cron, em **tabelas novas e exclusivas** deste módulo.

**Defaults propostos (decisão do Pedro pendente — §8):**
- Filial `1.01`.
- NF-e série `1` e NFS-e série `001` (únicas vistas até hoje — §2.3).
- Data de corte: **01/01/2026** (NF-e nº 4238, NFS-e nº 377).
- Grava **tudo o que a numeração contém** (venda, remessa, devolução, exportação, NF de entrada própria) e **classifica** por `tipo_nota` + natureza/CFOP. "Venda" é filtro de view, não de carga.

## 2. Achados do VND-0 (com evidência)

### 2.1 O erp-proxy
- Express no Render; token do Alvo (`riosoft-token`) gerenciado no servidor, com 1 retry em 401/403/409 (`src/alvo-client.ts`).
- Auth: JWT do Supabase **ou** `X-System-Secret` (crons/Edges) — `src/middleware/auth.ts`.
- `/alvo/passthrough` só chama endpoints da whitelist `ALLOWED_ENDPOINTS` (`src/routes/alvo.ts`), **case-sensitive**.
- `notaFiscal/Load` **não está na whitelist** — hoje só é chamado dentro da rota própria do intercompany (`src/routes/intercompany.ts:339,387,543,558`).

### 2.2 A fonte: entidade `notaFiscal` do Alvo
- `notaFiscal/Load?modeloCtrlDf=<NF-e|NFS-e>&serieCtrlDf=<série>&numero=<nº>` **funciona e lê notas emitidas pela P&F** — provado pelo intercompany: 69 NF-e e 69 NFS-e da Áustria gravadas em `intercompany_invoices.payload_alvo` (jan–out/2026).
- O payload traz (amostra NF-e 5100, 02/10/2026): `TipoNota` ("Saída"), `OrigemModulo` ("Faturamento"), `CodigoEntidade`, `RazaoSocialEntidade`, `CodigoNatOperacaoProduto` ("7.551"), `DocumentoOrigem`, `VendedorPrincipal`, situação (`Cancelada`, `Denegada`, `Substituida`, `DocumentoHomologado`, `NotaFiscalCanceladaExtemporanea`), integrações (`IntegradoFinanceiro`, `BaixadoEstoque`), valores (`ValorTotal`, `ValorProduto`, `ValorServico`, `ValorFrete`, `ValorICMS`, `ValorIPI`, `ValorISS`, `ValorIBSUF`, `ValorCBS`…), moeda/câmbio (`CodigoIndEconomicoOrigem`, `CambioOriginal`, `ValorOriginal`), `DataUltimaAtualizacao`.
- 🔴 **O Load do intercompany vem SEM itens.** `ItemNfChildList`, `CondPagNfChildList`, `PedVendaNotaFiscalChildList` estão vazias em **138/138** payloads — inclusive na NF-e 5100, que tem `ValorProduto` 995,18 (logo, tem item). Causa quase certa: a chamada não passa `loadChild=All` (mesmo comportamento documentado para `movEstq/Load` em `erp-proxy/src/routes/movEstq.ts:377`). **Confirmar no VND-1.**
- `ChaveDocumentoEletronico` (chave de acesso) veio **null** — provavelmente vive num objeto one-to-one não carregado (`loadOneToOne=All`). **Confirmar no VND-1.**

### 2.3 Numeração e volume (medido em `intercompany_invoices`)
| Modelo | Série | Jan/2026 | Out/2026 | Ritmo |
|---|---|---|---|---|
| NF-e | `1` | 4238 (05/01) | 5100 (02/10) | **~96 números/mês** (todas as NF-e, não só Áustria) |
| NFS-e | `001` | 377 (16/01) | 439 (02/10) | ~7/mês — praticamente todas são da Áustria |

Carga histórica 2026 ≈ **1.050 Loads**. Rotina diária ≈ 5 notas/dia útil.

### 2.4 🔴 DocFin NÃO serve de índice das notas
- **NF-e 5041** aparece ligada a **dois DocFins** (32370 e 32375), mesmo valor R$ 60.772,16 → DocFin→NF não é 1:1.
- Notas sem financeiro (remessa, retorno, industrialização, bonificação) **não geram DocFin** → índice incompleto.
- NF-e de importação aparece no DocFin como origem "Vendas" (armadilha 19 do PLANO-DESPESAS).

### 2.5 🔴 O número da NFS-e é reaproveitado antes do retorno da prefeitura
| Nº | 1ª leitura (DocFin) | 2ª leitura (DocFin) |
|---|---|---|
| 425 | 24/07, R$ 64.992,38, INV 211/2026, **sem** `NumeroRetornoNFSE` (29790) | 31/07, R$ 120.563,44, INV 196/2026, `NumeroRetornoNFSE`="425" (30159) |
| 438 | 01/10, R$ 66.124,13, **sem** retorno (33042) | 30/09, R$ 18.215,34, INV 259/2026, retorno "438" (33199) |

Leitura: enquanto a prefeitura não devolve o número, o registro é provisório e o número pode passar a outra nota. **Consequências para o desenho:** (a) NFS-e sem `NumeroRetornoNFSE` é `provisoria` e precisa ser relida; (b) guardar **histórico de versões** do payload — a linha atual sozinha apagaria a evidência. A NF-e também tem número reservado (`NotaFiscalDtRsvObject`); conferir no VND-1 se o mesmo pode ocorrer.

### 2.6 A série 1 da NF-e é compartilhada
`TipoNota` existe porque a mesma numeração cobre **NF de entrada própria** (ex.: importação) e saída. A carga grava as duas; as views de venda filtram `tipo_nota = 'Saída'`.

### 2.7 O que já existe no Hub (e não serve)
- Nenhuma tabela de NF de saída. `compras_nfe`, `nf_entrada`, `rastreio_nf`, `nfse_adn_doc` são do lado das compras.
- `intercompany_invoices` cobre só a Áustria e está com o cron desligado desde 06/10 (decisão do Pedro). **Este módulo não substitui nem altera o intercompany.**

## 3. Como pegar: varredura por número, uma nota por vez

Fluxo por rodada (Edge `sync-nf-saida-cron`):

1. Para cada série ativa em `nf_saida_serie`, garantir na fila (`nf_saida_fila`) os próximos **N** números depois do maior já lido (N = 20).
2. Atender a fila **em ordem**, um número por vez (concorrência 2–3), via `/alvo/passthrough`:
   `notaFiscal/Load?modeloCtrlDf=…&serieCtrlDf=…&numero=…&loadChild=All&loadOneToOne=All` (parâmetros finais fecham no VND-1).
3. Resultado:
   - **achou** → RPC `nf_saida_gravar` (cabeçalho + itens numa transação; nova versão se o hash mudou) → fila `lida`;
   - **não encontrada** → fila `nao_encontrada` (lacuna). Ao chegar a **K** "não encontrada" seguidas no fim da série (K = 5), parar: é o fim da numeração;
   - **erro** → `tentativas++` e espera 15 min, 1 h, 6 h, 24 h; na 5ª, `estacionada` (mesma régua do `sync-parcelas-pagar` v9).
4. **Releitura:** notas com emissão nos últimos **10 dias**, NFS-e `provisoria` e lacunas com menos de 7 dias são relidas a cada rodada, para pegar cancelamento, retorno da prefeitura e número reaproveitado.
5. Registrar a execução em `sync_runs` (`job_type='nf_saida'`, carimbo de versão em `observacao`).

**Por que não listar?** Nenhuma listagem de notas está provada (`notaFiscal/GetListForComponents` nunca foi testado). A varredura usa só um endpoint já provado e é **verificável**: toda lacuna fica visível. A listagem entra depois como conferência, se o VND-1 a capturar — útil para descobrir séries que não conhecemos.

## 4. Como cadastrar: tabelas novas (RASCUNHO — não aplicado)

Nomes simétricos ao `nf_entrada` que já existe. Itens e mapeamento fino de tributos **só fecham depois da amostra do VND-1** — "nunca assuma schema".

```sql
-- VND-3 (rascunho) — NÃO APLICAR antes do VND-1 e da aprovação do Pedro.

-- Séries a varrer + ponto de partida
create table public.nf_saida_serie (
  codigo_empresa_filial text not null default '1.01',
  modelo           text not null check (modelo in ('NF-e','NFS-e')),
  serie            text not null,              -- exatamente como o Alvo grava: '1', '001'
  numero_inicial   integer not null,           -- corte do backfill (4238 / 377)
  ativo            boolean not null default true,
  lacunas_fim      integer not null default 5, -- "não encontrada" seguidas = fim da numeração
  observacao       text,
  primary key (codigo_empresa_filial, modelo, serie)
);

-- Fila "um a um": um registro por número tentado (lacunas ficam visíveis)
create table public.nf_saida_fila (
  codigo_empresa_filial text not null,
  modelo     text not null,
  serie      text not null,
  numero     integer not null,
  status     text not null default 'pendente'
             check (status in ('pendente','lida','nao_encontrada','erro','estacionada')),
  tentativas integer not null default 0,
  proxima_em timestamptz,
  ultimo_erro text,
  ultima_tentativa_em timestamptz,
  criado_em  timestamptz not null default now(),
  primary key (codigo_empresa_filial, modelo, serie, numero),
  foreign key (codigo_empresa_filial, modelo, serie) references public.nf_saida_serie
);
create index nf_saida_fila_pendentes on public.nf_saida_fila (status, proxima_em);

-- Cabeçalho: versão ATUAL de cada número
create table public.nf_saida (
  id                    uuid primary key default gen_random_uuid(),
  codigo_empresa_filial text not null,
  modelo                text not null,
  serie                 text not null,
  numero                integer not null,
  numero_alvo           text not null,         -- '0000005100'
  -- LIVRO: o que o Alvo diz
  tipo_nota             text,                  -- 'Saída' | 'Entrada'
  origem_modulo         text,
  data_emissao          date,
  data_saida            timestamptz,           -- DataEntradaSaida
  data_competencia      date,
  codigo_entidade       text,
  razao_social          text,
  nome_fantasia         text,
  cpf_cnpj              text,
  uf                    text,
  pais                  text,
  codigo_nat_operacao_produto text,
  codigo_nat_operacao_servico text,
  documento_origem      text,
  numero_pedido_entidade text,
  vendedor_principal    text,
  chave_acesso          text,                  -- NF-e (origem do campo: VND-1)
  numero_nfse_prefeitura text,                 -- NumeroRetornoNFSE
  cancelada             boolean,
  data_cancelamento     timestamptz,
  denegada              boolean,
  substituida           boolean,
  documento_homologado  boolean,
  integrado_financeiro  boolean,
  baixado_estoque       boolean,
  moeda_codigo          text,                  -- CodigoIndEconomicoOrigem
  cambio                numeric,
  valor_original        numeric(15,2),
  valor_total           numeric(15,2),
  valor_produto         numeric(15,2),
  valor_servico         numeric(15,2),
  valor_frete           numeric(15,2),
  valor_seguro          numeric(15,2),
  valor_despesa         numeric(15,2),
  valor_desconto        numeric(15,2),
  valor_icms            numeric(15,2),
  valor_icms_st         numeric(15,2),
  valor_ipi             numeric(15,2),
  valor_iss             numeric(15,2),
  valor_ibs_uf          numeric(15,2),
  valor_ibs_cidade      numeric(15,2),
  valor_cbs             numeric(15,2),
  -- PIS/COFINS: o Alvo tem 4+ variantes (Produto/Operacao/Servico/RF) — escolher no VND-1
  alvo_atualizado_em    timestamptz,           -- DataUltimaAtualizacao
  situacao_hub          text not null default 'ativa'
                        check (situacao_hub in ('ativa','provisoria','ausente')),
  payload_alvo          jsonb not null,
  payload_hash          text not null,
  versao                integer not null default 1,
  -- ESPELHO: o que o Hub viu
  primeira_leitura_em   timestamptz not null default now(),
  ultima_leitura_em     timestamptz not null default now(),
  ausente_desde         timestamptz,           -- Load deixou de achar o número
  unique (codigo_empresa_filial, modelo, serie, numero)
);
create index nf_saida_emissao on public.nf_saida (data_emissao);
create index nf_saida_entidade on public.nf_saida (codigo_entidade);

-- Histórico: toda versão diferente que o Hub já leu (achado 2.5)
create table public.nf_saida_versao (
  nf_saida_id  uuid not null references public.nf_saida(id) on delete cascade,
  versao       integer not null,
  lido_em      timestamptz not null default now(),
  payload_hash text not null,
  payload_alvo jsonb not null,
  primary key (nf_saida_id, versao)
);

-- Itens (colunas finais dependem da amostra do VND-1)
create table public.nf_saida_item (
  nf_saida_id    uuid not null references public.nf_saida(id) on delete cascade,
  sequencia      integer not null,
  codigo_produto text,
  descricao      text,
  cfop           text,
  ncm            text,
  unidade        text,
  quantidade     numeric,
  valor_unitario numeric,
  valor_total    numeric(15,2),
  payload_item   jsonb not null,
  primary key (nf_saida_id, sequencia)
);

-- Segurança: espelho só leitura para admin (mesmo padrão de rastreio_nf / fin_parcelas_pagar);
-- escrita só pelo service_role (Edge). Permissão própria (ex.: 'vendas.nf_saida.view') entra com a tela.
alter table public.nf_saida_serie  enable row level security;
alter table public.nf_saida_fila   enable row level security;
alter table public.nf_saida        enable row level security;
alter table public.nf_saida_versao enable row level security;
alter table public.nf_saida_item   enable row level security;
create policy nf_saida_admin_select        on public.nf_saida        for select to authenticated using (_is_admin());
create policy nf_saida_item_admin_select   on public.nf_saida_item   for select to authenticated using (_is_admin());
create policy nf_saida_versao_admin_select on public.nf_saida_versao for select to authenticated using (_is_admin());
create policy nf_saida_fila_admin_select   on public.nf_saida_fila   for select to authenticated using (_is_admin());
create policy nf_saida_serie_admin_select  on public.nf_saida_serie  for select to authenticated using (_is_admin());
revoke all on public.nf_saida, public.nf_saida_item, public.nf_saida_versao,
              public.nf_saida_fila, public.nf_saida_serie from anon;
```

**RPC de gravação** `public.nf_saida_gravar(p_filial text, p_modelo text, p_serie text, p_numero integer, p_payload jsonb) returns uuid`:
- `SECURITY DEFINER`, mapeia o payload **em SQL**. Assim dá para reprocessar a partir de `payload_alvo` sem reler o Alvo.
- Se o hash não mudou, só atualiza `ultima_leitura_em`. Se mudou, grava nova versão em `nf_saida_versao`, atualiza o cabeçalho e substitui os itens (delete + insert na mesma transação).
- NFS-e sem `NumeroRetornoNFSE` recebe `situacao_hub='provisoria'`.
- 🔴 Depois do `create`: `revoke execute on function public.nf_saida_gravar(text, text, text, integer, jsonb) from public, anon, authenticated;` e `grant execute … to service_role;`. O padrão do Supabase concede EXECUTE a `anon` nominalmente (CLAUDE.md).

## 5. Rotina

- **Edge** `sync-nf-saida-cron` (molde `sync-parcelas-pagar-cron` v9): `verify_jwt=false`, auth por `x-cron-secret`; secrets `ERP_PROXY_URL`, `ERP_PROXY_SYSTEM_SECRET`, `CRON_SECRET` (já existem). Modos: `varrer` (padrão), `reler`, `numero` (manual, uma nota), `backfill` (lote maior).
- **Disparo:** `public.call_sync_nf_saida_cron(p_triggered_by)`, mesmo molde de `call_sync_parcelas_pagar_cron` (segredo `sync_compras_cron_secret` no Vault).
- **Kill-switch:** linha `sync-nf-saida` em `sync_settings`; a Edge sai sem chamar o Alvo se `enabled=false`.
- **Horário sugerido:** `20 11,16,21 * * 1-5` (UTC) = 08h20, 13h20 e 18h20 BRT. Fora das janelas 07h30/12h30/16h30 e sem colidir com jobs ativos (compras-status :00, nfse-adn :00/:30, parcelas :40, laudos :45). **Nasce desligado**; liga só com ordem do Pedro.
- **erp-proxy (VND-2):** uma linha na whitelist (`"notaFiscal/Load"`), leitura. Deploy fora das janelas do cron.

## 6. Conferências (validação dupla)

1. **Áustria:** as 69 NF-e e as NFS-e da Áustria em `intercompany_invoices` precisam aparecer em `nf_saida` com o mesmo valor e a mesma data. Divergência só é aceitável nos números do achado 2.5.
2. **Lacunas:** listar `nf_saida_fila.status='nao_encontrada'` no meio da série e perguntar ao fiscal se são inutilizações.
3. **Receita:** faturamento mensal (`tipo_nota='Saída'`, não cancelada, CFOP de venda) contra a receita do Balancete (conector Balancete P&F).
4. **Teste sem `is_admin`:** antes de qualquer tela, validar com um usuário sem a flag (CLAUDE.md: o Pedro tem bypass).
5. Conferir `sync_runs` depois de cada rodada; nunca confiar em contagem silenciosa.

## 7. Riscos e rollback

| Risco | Mitigação |
|---|---|
| Carga histórica (~1.050 Loads) pesar no Alvo/Render | Lotes de 40–60 por rodada, concorrência 2, fora do horário comercial e das janelas de cron |
| Load sem itens (achado 2.2) | Amostra com `loadChild=All` no VND-1 antes do DDL de itens |
| Número reaproveitado (2.5) | `situacao_hub='provisoria'`, releitura, `nf_saida_versao` |
| NF de entrada própria misturada (2.6) | `tipo_nota` gravado; views filtram |
| Ler "cancelada no Alvo" como "ausente do espelho" (e vice-versa) | Colunas separadas: `cancelada` (livro) × `ausente_desde`/`situacao_hub` (espelho) |
| Passthrough sem gate de papel (BL-5) | Endpoint é só leitura; escrita no banco só via service_role |

**Rollback por etapa:**
- VND-2: remover a linha da whitelist e redeploy.
- VND-3: `drop` das 5 tabelas e da RPC. Nada existente depende delas; o DDL de rollback acompanha a migration.
- VND-4/5: desligar em `sync_settings` e truncar só as tabelas `nf_saida*`, com ordem do Pedro.
- VND-6: `active=false` no `cron.job`.

## 8. Decisões pendentes do Pedro

1. Para que os dados servem (relatório de faturamento, receita por cliente/produto, conciliação com recebimento, rastreio de lote/SN)? Isso define se as **parcelas** (`CondPagNfChildList`) entram já ou numa fase 2.
2. Confirmar os defaults da §1 (filial, séries, corte 01/01/2026, gravar tudo e classificar).
3. Frequência (proposta: 3×/dia útil).
4. Prefixo do módulo e nome do plano (`VND`, `PLANO-VENDAS.md`).

## 9. VND-1 — o que preciso que alguém capture no Alvo (zero risco, só leitura)

Eu não chamo o Alvo daqui: não tenho login do Hub nem o segredo de sistema, e não vou buscar segredo no Vault. Com o DevTools aberto (F12 → aba **Network**, filtro `Fetch/XHR`):

1. **Uma NF-e de venda nacional** (não Áustria) aberta na tela de Faturamento: copiar a **URL completa** da requisição `notaFiscal/Load…` (com todos os parâmetros) e salvar a **resposta** (botão direito → *Copy response*) em um `.json`. Se a tela não trouxer itens, repetir pela aba de itens.
2. **Uma NFS-e** — o mesmo procedimento.
3. **A tela de lista de notas fiscais** filtrada por um mês: copiar a requisição de listagem (provável `notaFiscal/GetListForComponents`): **URL + corpo (Payload) + resposta**.
4. **Perguntas ao fiscal:**
   - Existem outras séries de NF-e/NFS-e além de `1` e `001`, incluindo contingência?
   - A NF de entrada própria (importação) usa a série 1?
   - Quando uma NFS-e não volta da prefeitura, o número é reaproveitado? (achado 2.5)

Os arquivos podem ser colocados na pasta `docs/vendas/amostras/` deste repo ou anexados na conversa.

## 10. Diário

| Data | Prompt | Registro |
|---|---|---|
| 2026-11-05 | VND-0 | Sessão de investigação, sem código e sem escrita no banco. erp-proxy clonado (somente leitura; HEAD `0c4900b`). Fonte definida: `notaFiscal/Load` (provado pelo intercompany). Achados 2.2 (Load sem itens), 2.4 (DocFin não é índice), 2.5 (NFS-e com número reaproveitado — 425 e 438), 2.6 (série compartilhada). Volume: ~96 NF-e/mês, ~7 NFS-e/mês. Desenho de 5 tabelas + RPC proposto (§4), não aplicado. |
| 2026-11-05 | VND-1 | Pedro rodou 5 chamadas de leitura no Lab de API (§11). Confirmado: com `loadChild=All` vêm itens, lotes, séries, parcelas, classe e pedido de venda (achado 2.2 fechado). **`notaFiscal/GetListForComponents` funciona** com o envelope deduzido do padrão: 50 cabeçalhos, 161 campos, sem filhas. Número inexistente → corpo `null`. NFS-e 425 hoje = versão de 31/07 (achado 2.5 confirmado). Chave de acesso não existe na entidade `notaFiscal`. Desenho revisto no Ajuste A (§12). Nada aplicado. |
| 2026-11-05 | VND-2 | Pedro liberou `notaFiscal/Load` e `notaFiscal/GetListForComponents` na whitelist e fez o deploy. Conferido no GitHub: commit `7dfe972`, só as duas linhas, grafia igual à do Lab. |
| 2026-11-05 | VND-3 | Pedro aprovou as tabelas e o critério de venda pela classe (01 venda, 02 remessa…); perguntou pelo destino (Áustria, Latam, Brasil). Ajuste B (§13): destino já vinha da nota; entra a tabela `nf_saida_pais_regiao`. Script escrito e testado num Postgres 16 local com as amostras do Lab (ver §13.3). **Erro pego no teste:** número de 10 dígitos não convertia (regex `\d{1,9}`) — corrigido para `bigint`/`\d{1,18}`. Nada aplicado em produção. |
| 2026-11-05 | VND-3 (aplicação) | Pedro autorizou ("sim, aplique"). Pré-voo: `compras_pedidos` = 2.414, objetos do intercompany presentes, 0 objetos `nf_saida*`, `_is_admin()` existe. `apply_migration vnd_3_nf_saida` → sucesso (versão `20261105195613`). Conferência na §13.5. Tabelas vazias; nenhum cron, Edge ou `sync_settings` tocado. |
| 2026-11-05 | VND-4 (código) | Edge `sync-nf-saida-cron` v1 escrita (lógica separada em `logica.ts`, injetável). 11 testes Deno da lógica passam; `deno check` do `index.ts` limpo (modo estrito). Build do front ok (cópia com dependências do npm público — o `bun.lock` aponta para o cache privado do Lovable, inacessível daqui). `config.toml` com `verify_jwt=false`. Hashes esperados das 3 notas do Lab calculados (§14.4). **Não deployada.** |
| 2026-11-05 | VND-4 (deploy + teste A) | Pedro deployou pelo CLI a partir de um `git worktree` do branch (o `main` local tinha alterações dele em `PLANO-NFSE.md` e `src/constants/permissions.ts`, intocadas). `get_edge_function`: versão 1, ACTIVE, `verify_jwt=false`, código = branch. Sonda sem segredo (net 36142) → **401 "Não autorizado"** da própria função. Teste A (net 36143) → **500 no início**: `sync_runs_job_type_check` não aceita `nf_saida` (lista fechada de 14 tipos). **Nada gravado** (0 runs `nf_saida`, 0 notas; o Alvo nem foi chamado). **Erro meu: não li as constraints de `sync_runs` antes** — violei o "nunca assuma schema". Correção em `sql/VND-4-sync-runs-job-type.sql`, aguardando aprovação. |
| 2026-11-05 | VND-4 (correção + testes) | Pedro autorizou. Pré-voo: fingerprint 2.416, CHECK igual ao lido. Migration `vnd_4_sync_runs_job_type_nf_saida` aplicada (15 tipos, `convalidated=true`). Teste A refeito (net 36144) → 200, 3 notas gravadas, NF-e 5160 = **não existe no Alvo** (pendência §12.4 fechada), 0 erros, 4 s. **Hashes das 3 notas idênticos aos do Lab.** Teste B (net 36145) → 200, 5 listadas (5189–5193) e 5 detalhadas, 0 falhas; `LISTA INCOMPLETA` esperado (página de 5). Detalhes na §14.6. |
| 2026-11-05 | VND-5 (lista 1) | Pedro autorizou a carga e mudou o corte para **01/01/2025**. Lista NF-e (net 36146, v1) → 4 páginas, 1.200 linhas (novas 1.193; mudaram 2 = 5099/5100, que tinham entrado pelo modo `notas`; iguais 5), 0 erros, 130 s, PARADO PELO WATCHDOG. Cobertura: NF-e 3984–5193 (03/10/2025 → 05/11/2026), 966 saídas, 234 entradas, 124 canceladas. **Achado:** uma página de 300 leva ~30 s no Alvo. Com o watchdog de 110 s cabem ~3 páginas, e a v1 sempre recomeça da página 1 — nunca chegaria a 01/2025. **v2** (`pagina_inicial` + margem de 40 s antes de cada página) escrita, testada (13 testes) e commitada; **aguardando deploy**. |
| 2026-11-05 | VND-5 (NFS-e + detalhe 1 + intercompany) | Lista NFS-e (net 36147, v1) → 1 página, **178 NFS-e** (nº 223–441, 17/01/2025 → 21/10/2026; 163 da PEF; 13 canceladas; 2 sem retorno da prefeitura), lista completa. Detalhe lote 1 (net 36148) → 200 lidas, 198 versões novas, 2 sem mudança (5099/5100), 0 falhas, ~3 notas/s. **Conferência Áustria × `intercompany_invoices`:** NF-e 67 ok; NFS-e 53 ok. **As divergências estão no intercompany, não no espelho:** (a) NFS-e 421–424, 435 e 436 não existem mais no Alvo — eram provisórias (sem `NumeroRetornoNFSE`), reemitidas com outro número (invoice 196/2026: 421 em 08/07 → 425 em 31/07; invoice 259/2026: 436 → 438); (b) **o reaproveitamento de número vale também para NF-e** — o intercompany tem a 5097 como Áustria 01/10, R$ 12.923,10 (DocFin 33037); hoje a 5097 no Alvo é R$ 60.000 de 02/10, **cancelada**, e a Áustria saiu como 5100; (c) NFS-e 433/434: data do DocFin (31/08) × data de emissão da NF (02/09) — fontes diferentes. **Achado para o Pedro:** o intercompany (cron desligado desde 06/10) guarda versões que o Alvo já não tem. |
| 2026-11-05 | VND-5 (detalhe 2–4 + regiões) | Lotes 2 e 3 (net 36149, 36150): 200 + 200 lidas, 0 falhas. Lote 4 em andamento. v2 **ainda não deployada** (função na versão 1). `v_nf_saida_paises_sem_regiao` trouxe 11 países (códigos do Alvo, vários não-ISO): CHI China 24, CHL Chile 21, URU 14, FRA 6, EC Equador 6, ARG 5, POR 4, ITA 2, PL Polônia 2, VE Venezuela 2, DIN Dinamarca 1. Proposta de regiões em `sql/VND-5-regioes-proposta.sql` (Latam: CHL, URU, EC, ARG, VE; Europa: FRA, POR, ITA, PL, DIN; Ásia: CHI) — aplicada na linha seguinte. |
| 2026-11-05 | VND-5 (v2 + regiões) | Lotes 4 e 5 (net 36160, 36161): 200 + 200, 0 falhas; fila 373. Pedro: "publica você" e "ok" para as regiões. **v2 deployada por mim via MCP** `deploy_edge_function` (mesmos `index.ts`/`logica.ts` do branch `4e7a777`, `verify_jwt=false`) → versão 2. Sonda sem segredo (net 36172) → 401. **Regiões aplicadas** (`sql/VND-5-regioes-proposta.sql`): 11 países (Latam 5, Europa 5, Ásia 1). Lista NF-e v2 a partir da página 5 disparada (net 36173). |
| 2026-11-05 | VND-5 (lista concluída) | Lista NF-e v2 (net 36173) → páginas 5–7, 900 novas, 0 erros, 102 s, **chegou ao corte**. Total: **2.100 NF-e** (nº 3076–5193, 25/10/2024 → 05/11/2026; 133 de out–dez/2024 vieram na última página e também serão detalhadas — custo pequeno, relatórios filtram por data) e **178 NFS-e**. 0 países sem região. **Lacunas:** NF-e 18 em 2.118 números (3086, 3223, 3234, 3654, 3761, 3762, 3827, 3903, 4038, 4042, 4162, 4218, 4294, 4322, 4361, 4365, 4943, 5160 — a 5160 já confirmada inexistente); NFS-e 41 em 219 (bloco 224–253, 255, 277, 332, 378, 421–424, 429, 435, 436…), coerente com o reaproveitamento de número (achado 2.5). Fila de detalhe: 1.273. |
| 2026-11-05 | VND-5 (conferência com a contabilidade, 2026) | Lotes 6–7 (net 36174–36175): 200 + 200, 0 falhas. **Receita bruta 4.1.01 (Balancete P&F) × notas de saída classe 01 (não canceladas), 2026:** jan 3,19 mi × 3,34 mi (4 notas de jan ainda na fila); fev +130 mil; mar +26 mil; **abr −60.000,00, mai −120.000,00, jun −180.000,00 exatos**; jul −958 mil; ago −210 mil; set −532 mil. **Achado A — venda para entrega futura conta duas vezes pela classe:** o simples faturamento (5.922, fev, R$ 600 mil, com DocFin) **e** as remessas (5.116/6.116, jan–set, sem financeiro) estão todos na classe **01.02**; somar "classe 01" duplica. As diferenças redondas de abr–jun batem com essas remessas; a regra de qual das duas conta como venda é decisão do Pedro/contabilidade. **Achado B — ~50 notas de saída de 2026 sem classe no Alvo** (`NotaFiscalClasseRecDespChildList` vazia): quase todas não-venda (5.908 comodato, 5.910 bonificação, 5.915 conserto, 5.901 industrialização, 5.927), **mas** a 4371 é venda (5.101.002) e 4977/5040/5133 são remessas 5.116 — a classificação só por classe deixa essas fora; fallback por CFOP fica para decisão. **Achado C (a investigar):** jul e set têm as maiores diferenças e coincidem com as NFS-e provisórias que sumiram do Alvo (421–424 em jul; 435/436 em set) — a contabilidade pode ter registrado as versões que não existem mais. Nenhuma regra alterada. |
| 2026-11-05 | VND-5 (detalhe concluído) | Lotes 8–12 (net 36176–36180): 200 + 200 + 200 + 200 + 73, 0 falhas. **Fila 0: 2.278 notas carregadas** (NF-e 2.100, nº 3076–5193; NFS-e 178, nº 223–441), 0 com erro, 0 estacionadas, 0 ausentes, 2 NFS-e provisórias. 21 execuções `nf_saida` em `sync_runs`, 0 com erro. Volume: 2.278 versões, 5.133 itens, 1.518 parcelas, 2.031 classes, **68 MB** no total das tabelas `nf_saida*`. Fingerprint `compras_pedidos` = 2.416. |
| 2026-11-05 | VND-5 (lacunas) | `modo notas` (net 36182–36185): **as 17 NF-e e as 41 NFS-e vagas não existem no Alvo** (`nao_existe_no_alvo`); com a 5160, as 18 NF-e. Nenhuma nota nova apareceu. As NFS-e 224–253 formam um bloco: o Alvo não tem nenhuma NFS-e entre 17/01/2025 (223, R$ 50) e abril/2025 (254). |
| 2026-11-05 | VND-5 (conferência contábil, completa) | Refeita com o detalhe 100% carregado, jan/2025–set/2026 (out–dez/2025 não comparáveis: lançamentos de encerramento). Com a **regra D** (§16.2), **7 de 19 meses batem no centavo** (mai, jun, ago/2025; abr, mai, jun, jul/2026) e 4 são explicados no centavo: **jan, fev e mar/2025** — a diferença é exatamente a conta 4.1.01.005.003 (serviços mercado externo: 1.114.325,15; 839.004,99; 1.042.302,31) e o Alvo não tem NFS-e nesse trimestre; **ago/2026** −17.067,76 = NFS-e 434 (a contabilidade usou a data do DocFin, 31/08). **Revisão do achado A:** a contabilidade reconhece a receita da venda para entrega futura **na remessa** (5.116/6.116), **não** no simples faturamento (5.922/6.922) — os ±60/120/180 mil “redondos” da linha anterior eram remessas ainda na fila. **Achado C refutado:** jul/2026 bate no centavo quando a NFS-e 432 (emissão 05/08, competência 07) entra pela competência; as NFS-e provisórias que sumiram não entram na contabilidade. Áustria × intercompany repetida: igual à anterior (NF-e 67 ok; NFS-e 53 ok; 5097, 433/434 e 421–424/435/436 já explicadas). **8 países novos** só apareceram com o detalhe completo (CAN, COL, IE, MEX, PA, PER, TUR, UK; 14 notas) — proposta em `sql/VND-5-regioes-proposta-2.sql`, **não aplicada**. |
| 2026-11-11 | Merge | Pedro autorizou o merge do branch do módulo no `main` ("autorizo tudo"): merge `dc2a7de`, sem conflito (o branch só acrescentava arquivos e 5 linhas no `supabase/config.toml`), `bun run build` limpo. |
| 2026-11-11 | VND-6 | Pré-voo: `compras_pedidos` = 2.459; nenhum objeto do VND-6; segredo `sync_compras_cron_secret` no Vault; `sync_runs.job_type` aceita `nf_saida`. 1ª tentativa recusada por inteiro (`update cron.job` → "permission denied for table job" para o papel do MCP; nada gravado); script trocado para `cron.alter_job(cron.schedule(...), active := false)` e aplicado (`vnd_6_cron`). Rodada manual (`call_sync_nf_saida_cron('manual_admin')`, net 37556): rotina desde 27/09, 2 páginas, 480 linhas (30 novas, 1 mudou), 31 detalhes lidos, 0 erro, fila 0, ~68 s. **Job 37 ligado** (`cron.alter_job(37, active := true)`) com ordem do Pedro: 08h20, 13h20 e 18h20 BRT, dias úteis. |
| 2026-11-12 | VND-8 (código) | Sessão "Balancete 2", com ordem do Pedro. Início: remote/branch conferidos, `main` em `6f0bca3` (NFE-18 e PAP-2 de outras sessões, fora do módulo); sessão do módulo Vendas avisada (send_message). `NumSerie/Load` conferido na whitelist do erp-proxy (`3e00b89`, `src/routes/alvo.ts`). Hub: 7.129 controles de série nas notas (2.252 de 2026). Escritos `sql/VND-8-series*.sql` e a Edge v3 (passo 3 de séries, modo `series`); testes Deno 18/18; `deno check` do `index.ts` limpo (cópia com o import do npm, porque esm.sh é bloqueado nesta máquina). |
| 2026-11-11 | VND-7 | Tela Vendas › Notas de Saída (§18). Banco: `vnd_7_vendas_tela` (permissão `vendas.notas.access`, papel `visualizador_vendas` sem usuários, filtro interno e 3 RPCs de leitura com gate). Teste em transação desfeita, com um usuário sem `is_admin`: sem o papel → 42501; leitura direta de `nf_saida` → 0 linhas; com o papel → out/2026 com 71 notas, 7 canceladas, 178 itens (iguais ao Balancete P&F); detalhe da 5106; período de itens > 400 dias recusado. Nada ficou gravado do teste. Front: build limpo, type-check 0 erro, `vitest` 314/314 (teste novo da tela; teste da ordem da sidebar atualizado: "Vendas" no lugar de "nav.sales", mesma posição). |

## 11. VND-1 — resultados (Lab de API, 05/11/2026)

Arquivos recebidos: `lead-nf_saida_1` (NF-e 5100), `_2` (NF-e 5099), `_3` (NFS-e 425), `_5` (lista). Chamada 4 (nº 0009999999) → corpo `null`.

### 11.1 Load completo (`loadParent=All&loadChild=All&loadOneToOne=All`)
| Nota | O que mostrou |
|---|---|
| NF-e 5100 (Áustria, 7.551) | Mesma nota que o intercompany guardou sem itens agora vem com **1 item** (001.016.052, impressora Zebra, NCM 84433299), 1 parcela (`0000005100/1-1`, **`ChaveDocFin` 33175**), classe `01.03`, pedido de venda `0002632`, vendedor. Achado 2.2 confirmado. |
| NF-e 5099 (ENDOTEC, **5.917 consignação**) | `IntegradoFinanceiro="Não"`, parcela **sem `ChaveDocFin`** (prova do achado 2.4). Item com **lote** (`CtrlLoteLocArmItNfChildList`: `TS00058`, validade 27/01/2027, local `008`) e **série** (`NumSerieItemNfChildList`: `ControleNumSerie` 7418). Classe `02.04` (remessa). |
| NFS-e 425 (Áustria) | Hoje o Alvo devolve a versão de **31/07, R$ 120.563,44, `NumeroRetornoNFSE`="425"**. A versão de 24/07 (R$ 64.992,38) não existe mais sob esse número (achado 2.5 confirmado). **A NFS-e tem 2 itens:** o serviço (002.035, 7.933.001) e um item de **produto a valor zero** (001.010.040, 5.101.003, 11 unidades com 11 séries). Classe `01.07`. |

**Onde mora cada campo do item:**
- natureza/CFOP: `CodigoNatOperacao` (ex.: `5.917`, `7.933.001`; CFOP = 5 primeiros caracteres);
- NCM: `ItemNfFormPrecoObject.NCMNBS`;
- tipo de lançamento: `ItemNfFormPrecoObject.CodigoTipoLanc`;
- CBS/IBS do item: `ItemNfFormPrecoObject`;
- demais campos: `CodigoProduto`, `CodigoAlternativoProduto`, `NomeProduto`, `ItemServico`, `CodigoProdUnidMed`, `Quantidade`, `ValorUnitario`, `ValorTotal`, `NumeroPedVenda`, `ControlaLote`, `PossuiNumSerie`, `Valor{ICMS,IPI,PIS,COFINS,ISS}`.

🔴 **Campo volátil:** `NotaFiscalProtocoloObject.DataHora` vem com a **hora da leitura** (05/11 16:06 numa nota de 02/10). Precisa sair do hash, ou toda releitura vira "versão nova".

🔴 **Chave de acesso:** `ChaveDocumentoEletronico` vem null e não há nenhum número de 44 dígitos nos três payloads. A chave não mora na entidade `notaFiscal`. Fica como pendência (VND-1b), sem bloquear o resto.

### 11.2 Lista (`POST notaFiscal/GetListForComponents`)
Envelope usado: `ClassInput "NotaFiscal"`, `ClassVinculo/ControllerForm/FormName "notaFiscal"`, `Input "gridTableNotaFiscal"`, `Shortcut "notafiscal"`, `Filter "( CodigoEmpresaFilial == '1.01' && ModeloCtrlDf == 'NF-e' )"`, `Order "Numero DESC"`, `PageSize 50`.

Resultado:
- 50 cabeçalhos: nº **5143 → 5193**, emissão 15/10 → 05/11/2026, 21 entidades.
- 161 campos por linha, **sem listas filhas**. Traz `TipoNota`, natureza, entidade, valores, `Cancelada`/`DataCancelamento`, `NumeroRetornoNFSE`, `DocumentoHomologado`, `Substituida`. **Não traz `DataUltimaAtualizacao`.**
- **39 Saída + 11 Entrada (22%)** — achado 2.6 confirmado. Entradas: 3.101.x (importação), 2.9xx.
- **6 canceladas (12%)**: 5147, 5148, 5165, 5180, 5181, 5189.
- **Lacuna única: 5160** (não veio na lista; verificar com Load).
- Saídas com 18 naturezas: venda (5/6.101, 7.101) **e muita não-venda** — bonificação/outras (5.949, 6.910, 7.949), remessa para industrialização (5.901), conserto (5.915), consignação (6.917). Classificar é obrigatório.
- Total das saídas não canceladas no período: R$ 759.668,67 (mistura venda e remessa — só ordem de grandeza).

## 12. Ajuste A ao desenho (substitui §3 e §4 a partir do VND-1)

### 12.1 Como pegar: lista como índice, Load para o detalhe
1. **Lista** (`notaFiscal/GetListForComponents`, PageSize 300, `Order "Numero DESC"`), uma vez por modelo/série. Pagina até a primeira nota com emissão anterior à janela (rotina: 45 dias; backfill: 01/01/2026). Uma chamada traz até 300 cabeçalhos.
2. Grava/atualiza o cabeçalho a partir da lista. Se a nota é nova, ou se mudou algum campo de controle (`Cancelada`, `DataCancelamento`, `ValorTotal`, `NumeroRetornoNFSE`, `Substituida`, `DocumentoHomologado`), marca `detalhe_status='pendente'`.
3. **Load** (`loadChild=All&loadOneToOne=All`) das pendentes, **uma a uma** (concorrência 2), com as mesmas esperas de antes (15 min / 1 h / 6 h / 24 h; estaciona na 5ª). Load `null` ⇒ `ausente_desde`.
4. **Lacunas** (números que faltam entre o menor e o maior da série) aparecem numa view. Cada uma é confirmada com um Load avulso; resposta `null` = número realmente vago.

A varredura por número da §3 vira só o passo 4 (verificação de lacunas). Ganho: ~4 chamadas de lista substituem ~1.000 tentativas às cegas, e cancelamentos aparecem sem reler cada nota.

### 12.2 Tabelas (substitui o rascunho da §4; continua NÃO aplicado)
`nf_saida_serie` e `nf_saida_fila` saem: a fila passa a ser o próprio cabeçalho (`detalhe_status`) e as séries vêm da lista.

| Tabela | Chave | Conteúdo |
|---|---|---|
| `nf_saida` | id; único (filial, modelo, série, número) | Colunas da §4, **mais**: `classe_principal` (`NotaFiscalClasseRecDespChildList`), `numero_pedvenda`, `item_servico_existe`. Controle do detalhe: `detalhe_status` (`pendente`/`carregado`/`erro`/`estacionado`), `tentativas`, `proxima_em`, `ultimo_erro`. Payloads: `payload_lista`, `payload_alvo` (Load) e `payload_hash` **sem `NotaFiscalProtocoloObject`** |
| `nf_saida_versao` | (nf_saida_id, versao) | Como na §4 |
| `nf_saida_item` | (nf_saida_id, sequencia) | `item_servico`, `codigo_produto`, `codigo_alternativo`, `nome_produto`, `natureza_operacao`, `cfop` (gerado: 5 primeiros caracteres), `ncm`, `unidade`, `quantidade`, `valor_unitario`, `valor_total`, `valor_frete`, `valor_icms`, `valor_ipi`, `valor_pis`, `valor_cofins`, `valor_iss`, `valor_cbs`, `valor_ibs_uf`, `codigo_tipo_lanc`, `numero_pedvenda`, `controla_lote`, `possui_num_serie`, `payload_item` |
| `nf_saida_item_lote` | (nf_saida_id, sequencia_item, numero_lote, local) | `CtrlLoteLocArmItNfChildList`: lote, validade, local, quantidade |
| `nf_saida_item_serie` | (nf_saida_id, sequencia_item, controle_num_serie) | `NumSerieItemNfChildList`. O texto da série sai do `NumSerie/Load` ou do espelho do Estoque — **não nesta fase** |
| `nf_saida_parcela` | (nf_saida_id, duplicata) | `CondPagNfChildList[].ParcPagNfChildList[]`: vencimento, valor, condição, **`chave_docfin`** (null quando não gera financeiro) |
| `nf_saida_classe` | (nf_saida_id, codigo_classe) | `NotaFiscalClasseRecDespChildList`: classe e valor. Rateio por CC fica em `payload_alvo` nesta fase |

Classificação para as views (decisão do Pedro): **classe** (`01.x` receita de venda, `02.x` remessa, `03.x` retorno, `04.x` devolução — ver a auditoria das 144 classes no PLANO-DESPESAS) **ou** CFOP do item. A classe é do próprio Alvo e já separa venda de remessa sem tabela de CFOP.

RLS, `revoke` de `anon` e RPC `SECURITY DEFINER` seguem a §4. A RPC passa a gravar também lote, série, parcela e classe.

**Volume:**
- payload de Load com itens: 45–72 KB por nota → ~1.050 notas em 2026 ≈ 60 MB de jsonb (mais as versões);
- lista: ~5 KB por linha.
Se pesar, `payload_lista` pode ser descartado depois de carregado o detalhe.

### 12.3 VND-2 revisto — erp-proxy
Duas linhas de leitura na whitelist de `src/routes/alvo.ts`:
- `"notaFiscal/Load"`
- `"notaFiscal/GetListForComponents"`

Grafia exatamente como a provada no Lab. Deploy fora das janelas de cron.

### 12.4 Pendências que sobraram do VND-1 (nenhuma bloqueia VND-2/VND-3)
- **VND-1b — chave de acesso da NF-e de saída:** descobrir onde o Alvo guarda (tela da NF-e no Alvo → DevTools, ou `GetListForComponents` de alguma entidade de NF-e eletrônica). Necessária só se houver uso para ela (DANFE, cruzamento com SEFAZ — este último proibido por certificado).
- **Nº 5160:** Load avulso no Lab para saber se é vago, de outra filial ou excluído.
- **Lista de NFS-e:** repetir a lista com `ModeloCtrlDf == 'NFS-e'` (feito automaticamente no VND-4).
- **Perguntas ao fiscal** da §9.4 continuam valendo.

## 13. Ajuste B — destino da venda e script do VND-3

### 13.1 Destino (pergunta do Pedro: Áustria, Latam, Brasil…)
A nota já traz o destino. É o cadastro da entidade gravado na nota, e vem tanto na lista quanto no detalhe:
- `SiglaPais` e `NomePais`;
- `SiglaUnidFederacaoEntidade` (UF, ou `EX` = exterior);
- `CodigoCidade` e `NomeCidade`.

Nas 39 saídas da amostra:

| Destino | Notas |
|---|---|
| Brasil | 27 (SP 16, RJ 7, PE 2, SC 1, PR 1) |
| Áustria | 5 |
| EUA | 5 |
| Alemanha | 1 |
| Índia | 1 |

O 1º dígito da natureza bate 100% com o destino (5 estadual, 6 interestadual, 7 exterior).

🔴 **O código de país do Alvo NÃO é ISO:** `AUS` = Áustria (no ISO é Austrália), `ALE` = Alemanha (ISO `DEU`). Nunca cruzar com tabela ISO; usar o código do Alvo.

**Região** não existe no Alvo. Entra a tabela `nf_saida_pais_regiao` (país do Alvo → região), mantida pelo Pedro:
- Carga inicial com os 5 países vistos: BRA→Brasil, AUS→Áustria, USA→América do Norte, ALE→Europa, IND→Ásia. **Os nomes das regiões são proposta, para o Pedro confirmar.**
- País novo (ex.: o primeiro cliente Latam) aparece em `v_nf_saida_paises_sem_regiao` e, na `v_nf_saida`, como "(sem região)", até ser cadastrado.

**Entrega em outro endereço:** 2 casos na amostra (5156, 5159: entrega para a entidade 0000002, seq. 18). A nota traz só o código da entidade de entrega, a sequência do endereço e o nome. O endereço por extenso exigiria `Entidade/Load` — **fora desta fase**; os três campos ficam gravados.

**Intercompany:** a `v_nf_saida` marca `intercompany_austria` (entidade `0000017`). Assim a PEF Áustria se separa de outro cliente austríaco que venha a existir.

### 13.2 O que o script cria (`sql/VND-3-nf-saida.sql`; rollback em `sql/VND-3-nf-saida-rollback.sql`)
- **8 tabelas:** `nf_saida`, `nf_saida_versao`, `nf_saida_item`, `nf_saida_item_lote`, `nf_saida_item_serie`, `nf_saida_parcela`, `nf_saida_classe`, `nf_saida_pais_regiao`.
- **3 views** (`security_invoker`):
  - `v_nf_saida`: região, intercompany, abrangência pelo 1º dígito da natureza, tipo de operação pela classe (01 venda, 02 remessa, 03 retorno, 04 devolução de venda, 05 devolução de compra);
  - `v_nf_saida_lacunas`;
  - `v_nf_saida_paises_sem_regiao`.
- **3 RPCs** (`SECURITY DEFINER`, só `service_role`):
  - `nf_saida_registrar_lista(jsonb)`;
  - `nf_saida_gravar_detalhe(uuid, jsonb)`;
  - `nf_saida_registrar_falha(uuid, text)`.
- **4 funções auxiliares**, sem acesso externo.
- **Diferenças em relação à §12.2:**
  - o payload do detalhe fica **só** em `nf_saida_versao` (`nf_saida` guarda hash e nº da versão), para não gravar o mesmo JSON duas vezes;
  - sem `payload_item`, porque o item já está no payload da versão;
  - valores em `numeric` sem escala fixa (o item tem frete com 6 casas);
  - `numero` é `bigint`, gerado a partir de `numero_alvo`;
  - a identidade única é por `numero_alvo`, o texto do Alvo.
- **Cabeçalho por chave presente:** a lista (161 campos) só atualiza as colunas que traz. Moeda, câmbio, integração financeira etc. vêm só do detalhe e não são apagados quando a lista volta.
- **Não toca em nada existente:**
  - nenhuma linha em `sync_settings` ou `cron.job` (isso é VND-4/VND-6);
  - nenhuma permissão nova para usuários: leitura só para admin, escrita só pelo `service_role`.

### 13.3 Teste local (Postgres 16, com as amostras reais do Lab e as permissões padrão do Supabase reproduzidas)

| Cenário | Resultado |
|---|---|
| Lista de 50, 1ª e 2ª vez | 50 novas; depois 50 iguais |
| Detalhe 5100 / 5099 / NFS-e 425 | Itens, lote `TS00058`, 1 + 11 séries, parcelas (DocFin 33175, 30159; a 5099 sem DocFin), classes 01.03 / 02.04 / 01.07 — tudo igual às amostras |
| Mesmo detalhe com `DataHora` do protocolo trocada | `sem_mudanca` (o campo volátil fica fora do hash) |
| Conteúdo diferente (valor) | versão 2, histórico com 2 versões, itens regravados |
| Lista sem a 5170 (antes carregada) | `reconferir: 1`; a 5170 volta a pendente |
| Cancelamento novo na lista | `mudaram: 1`; a nota volta a pendente |
| Lista depois do detalhe | moeda/câmbio/valor original preservados |
| Detalhe de outra nota | recusado com erro |
| Load `null` | `situacao_hub = ausente` |
| 5 falhas | estacionado; a próxima tentativa só depois de 24 h |
| Lacunas | aparece a 5160 |
| Região e tipo na view | 5099 Brasil/estadual/remessa; 5100 Áustria/exterior/venda/intercompany; NFS-e 425 Áustria/exterior/venda |
| Permissões | anon: negado em tabela, view e RPC. Usuário sem admin: 0 linhas, RPC e escrita negadas. Admin: lê tudo. `service_role`: executa as RPCs. Nenhuma função ficou com EXECUTE para `anon` ou `authenticated` |
| Rollback | remove todos os objetos `nf_saida*` (0 restantes) |

### 13.4 Aplicação (depois do OK do Pedro)
1. Pré-voo: fingerprint `compras_pedidos` (~2.414) e confirmar 0 objetos `nf_saida*`.
2. `apply_migration` com o conteúdo de `sql/VND-3-nf-saida.sql` (nome `vnd_3_nf_saida`).
3. Conferência:
   - objetos criados;
   - ACL das funções sem `anon`/`authenticated`;
   - RLS ligado nas 8 tabelas.
4. As tabelas ficam vazias até o VND-4. A carga começa pelas 4 amostras.

### 13.5 Conferência pós-aplicação (05/11/2026, produção)
| Item | Resultado |
|---|---|
| 8 tabelas | RLS ligado em todas, 1 policy de SELECT para admin em cada |
| Permissão de tabela | `authenticated`: só SELECT (filtrado pelo RLS); `anon`: nenhuma |
| 3 views | `security_invoker=true`; `authenticated`: só SELECT; `anon`: nenhuma |
| 7 funções | `anon` e `authenticated` **sem** EXECUTE (conferido com `has_function_privilege`); `service_role` com EXECUTE. As 3 RPCs são `SECURITY DEFINER` |
| Dados | `nf_saida` vazia; `nf_saida_pais_regiao` com os 5 países |
| Fingerprint | `compras_pedidos` = 2.414 (inalterado) |
| Migration | registrada em `supabase_migrations.schema_migrations` como `vnd_3_nf_saida` |

Rollback disponível: `sql/VND-3-nf-saida-rollback.sql` (só com ordem do Pedro — apaga os dados importados).

## 14. VND-4 — Edge `sync-nf-saida-cron`

### 14.1 Arquivos
- `supabase/functions/sync-nf-saida-cron/index.ts` — handler. Responsável por:
  - autenticação (`x-cron-secret` = `CRON_SECRET`);
  - kill-switch `sync_settings('sync-nf-saida')`: sem linha = liberado; a linha entra no VND-6;
  - `sync_runs` (`job_type='nf_saida'`, carimbo `edge v1-2026-11-05`);
  - proxy e banco reais.
- `supabase/functions/sync-nf-saida-cron/logica.ts` — passos `passoLista`, `passoDetalhe` e `passoNotas`, sem rede (dependências injetadas).
- `supabase/functions/sync-nf-saida-cron/logica.test.ts` — 11 testes. Rodar com:
  ```bash
  deno test supabase/functions/sync-nf-saida-cron/logica.test.ts
  ```
- `supabase/config.toml` — `[functions.sync-nf-saida-cron] verify_jwt = false`.

### 14.2 Modos (`body.modo`)

| Modo | O que faz | Padrões |
|---|---|---|
| `rotina` (cron) | lista dos últimos 45 dias (NF-e e NFS-e) + detalhe das pendentes | até 3 páginas de 300; até 60 detalhes; 3 em paralelo; watchdog 110 s |
| `lista` | só a lista, até `body.desde` (backfill) | até 10 páginas |
| `detalhe` | só a fila de detalhe (backfill em lotes) | até 60 (máx. 200) |
| `notas` | notas escolhidas `[{modelo, serie, numero}]` (até 20). Nota que o Alvo não tem e o Hub também não: só relatada | — |

Ajustes por chamada: `modelos`, `page_size` (1–300), `max_paginas` (1–20), `max_detalhes` (0–200), `desde`.

### 14.3 Regras de proteção (cobertas por teste)
- **Página suspeita:** página da lista com qualquer linha de outra filial ou modelo é **recusada inteira**.
- **Lista incompleta:** a lista para na 1ª página com emissão anterior ao corte, ou numa página curta. Se o limite de páginas acabar antes disso, a rodada sai como `LISTA INCOMPLETA` no `sync_runs`.
- **Respostas do Load:**
  - objeto → grava;
  - `null` → `ausente_desde`;
  - erro → `registrar_falha`, com espera crescente.
- **Erro de RPC** (ex.: detalhe de outra nota) vira falha daquela nota; não derruba a rodada.
- **Watchdog** interrompe antes de estourar o tempo da Edge.

### 14.4 Teste em produção (depois do OK do Pedro)
1. **Deploy**, por um dos dois caminhos:
   - CLI do Pedro:
     ```bash
     supabase functions deploy sync-nf-saida-cron --project-ref hbtggrbauguukewiknew --no-verify-jwt --use-api
     ```
   - ou `deploy_edge_function` do MCP.

   Os secrets já existem no projeto.
2. **Sonda sem segredo** → **401** da própria função.
3. **Teste A — `modo notas`** com NF-e 5100, 5099, 5160 e NFS-e 425. O `payload_hash` gravado tem de ser **igual** ao calculado das amostras do Lab, salvo se a nota mudou no Alvo desde então:

   | Nota | Hash esperado (Lab) |
   |---|---|
   | NF-e 5100 | `9c890a9c222de2007571b56006e8b4fe` |
   | NF-e 5099 | `6a86b31dea94e545ffdbd2006f6f7de9` |
   | NFS-e 425 | `b7c7fbd6b95898f98e890658f9a6b499` |

   A 5160 deve voltar `nao_existe_no_alvo` (responde a pendência §12.4) ou ser gravada.
4. **Teste B — `modo rotina` pequeno:**
   ```json
   {"modelos":["NF-e"],"page_size":5,"max_paginas":1,"max_detalhes":5}
   ```
   Resultado esperado: 5 notas mais recentes listadas e detalhadas; `LISTA INCOMPLETA` é o esperado neste teste.
5. **Conferências:**
   - `sync_runs` sem erro;
   - itens, lotes, séries, parcelas e classes coerentes com o Alvo;
   - `v_nf_saida` com região e tipo;
   - fingerprint de `compras_pedidos` inalterado.

**Disparo do teste:** `net.http_post` avulso a partir do banco, com o segredo lido do Vault dentro do próprio SQL. Mesmo molde da "opção B" do PLANO-PEDIDOS: o segredo não sai do banco. A função `call_sync_nf_saida_cron` fica para o VND-6, junto com o cron.

**Rollback:**
- desativar via `sync_settings` (inserir a linha com `enabled=false`) ou apagar a função no painel;
- os dados do teste ficam só nas tabelas `nf_saida*`, e o `VND-3-nf-saida-rollback.sql` remove tudo.

### 14.5 Correção: `sync_runs.job_type` (aplicada 05/11/2026)
`sync_runs` tem `sync_runs_job_type_check` com **lista fechada** de 14 tipos. Todo job novo precisa entrar nessa lista antes da 1ª execução.

- **Script:** `sql/VND-4-sync-runs-job-type.sql`. Recria o CHECK com as mesmas 14 entradas, na mesma ordem, mais `nf_saida` no fim.
- **Execução:** uma transação, com lock rápido.
- **Rollback:** `sql/VND-4-sync-runs-job-type-rollback.sql`.

Depois de aplicado, refazer o Teste A (§14.4) sem mudar a Edge.

### 14.6 Resultado dos testes em produção (05/11/2026)

| Teste | Resultado |
|---|---|
| Sonda sem segredo (net 36142) | 401 "Não autorizado", da própria função |
| A — `notas` (net 36144) | NF-e 5100, 5099 e NFS-e 425 gravadas com `payload_hash` **igual** ao das amostras do Lab (`9c890a9c…`, `6a86b31d…`, `b7c7fbd6…`). NF-e 5160 → `nao_existe_no_alvo`. Itens, lote `TS00058`, 1 + 11 séries, parcelas (DocFin 33175, 30159; a 5099 sem DocFin) e classes iguais ao Lab |
| B — `rotina` (5 NF-e, net 36145) | 5189–5193 listadas e detalhadas, 0 falhas. Detalhes abaixo |
| `v_nf_saida` | região, abrangência e tipo de operação corretos nas 8 notas; 0 países sem região |
| `sync_runs` | 2 execuções `nf_saida`, 0 erros, carimbo `edge v1-2026-11-05` |
| Volume | 8 versões = 232 kB (~29 kB/nota com compressão) → ~30 MB para 2026 |
| Fingerprint | `compras_pedidos` 2.416 (crescimento normal desde a manhã) |

Detalhes do teste B:
- **5193** é **Entrada** (3.101.004, importação da PEF, classe 11.02 → "outros"), corretamente fora de "venda";
- **5192** é venda para a PEF (7.101.001, R$ 120.949,72, 4 itens, 4 lotes, 12 séries, com DocFin);
- **5190 e 5191** são remessas (5.949.996, classe 02.x);
- **5189** aparece **cancelada**;
- a soma dos itens = valor de produtos em todas.

**Lição registrada:** antes de gravar em tabela existente, ler também as constraints (`pg_constraint`), não só as colunas. `sync_runs.job_type` tem lista fechada: **todo job novo exige ALTER do CHECK antes da 1ª execução.** Sugestão para as "armadilhas conhecidas" do CLAUDE.md.

## 15. Próximos passos

### VND-5 — carga histórica desde 01/01/2026 (aguardando OK do Pedro)
> **Concluído em 05/11/2026 com corte em 01/01/2025** — resultado na §16.
1. **Lista:** uma execução de `{"modo":"lista","desde":"2026-01-01"}`.
   - Volume: ~955 NF-e (4 páginas de 300) e ~70 NFS-e (1 página).
   - Só grava cabeçalhos.
2. **Detalhe:** execuções de `{"modo":"detalhe","max_detalhes":200}` até a fila zerar.
   - Estimativa: ~6–7 execuções de até 110 s, com 3 leituras simultâneas no Alvo.
   - Rodar fora do horário comercial.
3. **Conferências:**
   - `v_nf_saida_lacunas`: cada número vago confirmado por `modo notas`;
   - Áustria × `intercompany_invoices` (69 NF-e + NFS-e da PEF): valor e data;
   - faturamento mensal × receita do Balancete;
   - estacionadas = 0.

### VND-6 — cron e kill-switch
- Wrapper `call_sync_nf_saida_cron`, com `revoke` de `anon` e `authenticated` (não repetir o BL-27).
- Linha `sync-nf-saida` em `sync_settings`.
- `cron.job` com `20 11,16,21 * * 1-5` (08h20, 13h20 e 18h20 BRT), **criado desativado**.

### Merge do branch no `main`
Para o repositório refletir o que está em produção (Edge, SQL e plano). Precisa da autorização do Pedro.
> **Feito em 11/11/2026** (merge `dc2a7de`, autorizado pelo Pedro): o branch `claude/awesome-cray-f2x4ay` entrou no `main` sem conflito; build limpo.

## 16. VND-5 — resultado da carga histórica (05/11/2026)

### 16.1 O que está no espelho

| | NF-e série 1 | NFS-e série 001 |
|---|---|---|
| Notas | 2.100 (nº 3076–5193) | 178 (nº 223–441) |
| Período | 25/10/2024 → 05/11/2026 (1.967 desde 2025) | 17/01/2025 → 21/10/2026 |
| Carregadas / erro / estacionadas | 2.100 / 0 / 0 | 178 / 0 / 0 |
| Canceladas | 204 | 13 |
| NFS-e provisórias (sem retorno da prefeitura) | — | 2 |
| Lacunas de numeração | 18, **todas inexistentes no Alvo** | 41, **todas inexistentes no Alvo** |

Execuções: 21 em `sync_runs` (`job_type='nf_saida'`), 0 com erro. Volume total das tabelas `nf_saida*`: 68 MB.

### 16.2 Conferência com a contabilidade (Balancete P&F, conta 4.1.01)

**Regra D** (consulta 7 em `sql/VND-5-conferencias.sql`), que é a que melhor reproduz a contabilidade:
- conta como venda: classe 01 do Alvo, **menos** o simples faturamento de entrega futura (5.922/6.922);
- **mais** as remessas de entrega futura que estão sem classe no Alvo (5.116/6.116);
- data: NF-e pela emissão; NFS-e pela menor data entre emissão e competência.

| Mês | Balancete 4.1.01 | Espelho (regra D) | Diferença | Explicação |
|---|---:|---:|---:|---|
| 2025-01 | 2.464.691,28 | 1.350.366,13 | −1.114.325,15 | = serviços mercado externo (4.1.01.005.003); o Alvo não tem NFS-e no trimestre |
| 2025-02 | 2.237.139,98 | 1.398.134,99 | −839.004,99 | idem |
| 2025-03 | 2.310.429,71 | 1.268.127,40 | −1.042.302,31 | idem |
| 2025-04 | 2.993.689,06 | 2.955.077,22 | −38.611,84 | a investigar |
| 2025-05 | 3.595.878,53 | 3.595.878,53 | **0,00** | |
| 2025-06 | 2.111.140,92 | 2.111.140,92 | **0,00** | |
| 2025-07 | 3.247.495,86 | 3.463.031,10 | +215.535,24 | a investigar |
| 2025-08 | 1.912.172,56 | 1.912.172,56 | **0,00** | |
| 2025-09 | 2.240.096,93 | 2.245.493,13 | +5.396,20 | a investigar |
| 2025-10 | 4.712.201,17 | 5.213.704,85 | +501.503,68 | a investigar (há 6.917 consignação 120 mil e 6.111 60 mil na classe 01) |
| 2026-01 | 3.339.377,53 | 3.364.750,39 | +25.372,86 | a investigar |
| 2026-02 | 2.511.877,73 | 2.521.544,08 | +9.666,35 | a investigar |
| 2026-03 | 3.267.023,79 | 3.292.934,45 | +25.910,66 | a investigar |
| 2026-04 | 2.008.723,29 | 2.008.723,29 | **0,00** | |
| 2026-05 | 2.772.464,51 | 2.772.464,51 | **0,00** | |
| 2026-06 | 2.901.302,55 | 2.901.302,55 | **0,00** | |
| 2026-07 | 3.237.110,07 | 3.237.110,07 | **0,00** | |
| 2026-08 | 1.904.001,87 | 1.886.934,11 | −17.067,76 | = NFS-e 434 (contabilidade pela data do DocFin, 31/08) |
| 2026-09 | 2.739.580,98 | 2.636.452,24 | −103.128,74 | a investigar (−120.196,50 se a 434 for para agosto) |

Out–dez/2025 ficam fora: há lançamentos de encerramento no Balancete.

**Leitura:** o espelho reproduz a contabilidade no centavo em 7 meses e explica outros 4. A regra D é **evidência**, não decisão. Nada na view foi alterado: `tipo_operacao` continua sendo a classe do Alvo.

### 16.3 Decisões que ficam com o Pedro
1. **Regra de "venda" para relatório:** adotar a regra D (simples faturamento fora, remessa de entrega futura dentro, NFS-e pela competência quando anterior à emissão)? Se sim, vira um Ajuste na `v_nf_saida` (prompt novo).
2. **Notas sem classe no Alvo** (remessas 5.116 de abr, mai e set/2025 e de set/2026; a 4371, venda 5.101): corrigir a classe no Alvo, ou o Hub assume o CFOP como reserva?
3. **Serviços de jan–mar/2025:** onde foram emitidas as NFS-e desse trimestre (o Alvo pula de 223 para 254)? Se foram fora do Alvo, o espelho nunca vai tê-las.
4. **Regiões dos 8 países novos** (`sql/VND-5-regioes-proposta-2.sql`): MEX em Latam ou América do Norte? TUR em Europa ou Ásia?
5. **Intercompany com versões que o Alvo já não tem** (NF-e 5097; NFS-e 421–424, 435, 436): o espelho mostra a versão atual; o intercompany está parado desde 06/10.

## 17. VND-6 — agendamento (11/11/2026)

- Função `call_sync_nf_saida_cron(p_triggered_by, p_body)` (SECURITY DEFINER; `revoke` de public/anon/authenticated com a assinatura completa — sem o furo do BL-27).
- Kill-switch `sync_settings('sync-nf-saida')`, `enabled = true`.
- `cron.job` **37** `sync-nf-saida-3x-dia`, `20 11,16,21 * * 1-5` (UTC) = **08h20, 13h20 e 18h20 BRT**, dias úteis, **ligado** (ordem do Pedro, 11/11/2026).
- **Lição:** o papel do MCP não faz `update cron.job` ("permission denied for table job"); ligar/desligar é por `cron.alter_job(<jobid>, active := true|false)`.
- **Desligar:** `select cron.alter_job(37, active := false);` ou `update public.sync_settings set enabled = false where job_name = 'sync-nf-saida';` (a Edge sai sem chamar o Alvo). Rollback completo: `sql/VND-6-cron-rollback.sql`.

## 18. VND-7 — tela Vendas › Notas de Saída (11/11/2026)

**Decisões do Pedro (11/11):** a tela fica num menu próprio **Vendas**, no lugar da "Receita de Vendas" antiga (`/sales`, que lia a tabela `sales_invoices`, vazia, e que nenhum usuário tinha liberada); "autorizo tudo" (merge, agendamento, desenho da tela e push no `main`).

**Banco** (`sql/VND-7-vendas-tela.sql`; rollback `sql/VND-7-vendas-tela-rollback.sql`; conferência `sql/VND-7-vendas-tela-verificar.sql`):
- permissão `vendas.notas.access` (módulo `vendas`) e papel `visualizador_vendas` ("Visualizador de Vendas"), ligados; **nenhum usuário recebeu o papel** — atribuir pela tela de usuários;
- `_vendas_notas_filtradas(...)` — filtro comum (só `tipo_nota = 'Saída'`, período pela emissão, modelo, tipo de operação, região, canceladas, busca por cliente/CNPJ/número/pedido); sem EXECUTE para anon/authenticated;
- `vendas_notas_listar(p_de, p_ate, ...)` — lista paginada (até 5.000), resumo (notas, canceladas, valor sem as canceladas, por região e por tipo), última leitura do Alvo, última rodada, pendentes de detalhe e se o agendamento está ligado;
- `vendas_nota_detalhe(p_id)` — nota, itens, lotes, séries (número de controle), parcelas e classes;
- `vendas_itens_listar(p_de, p_ate, ...)` — itens do período para o Excel (até 400 dias);
- as três RPCs: SECURITY DEFINER, gate `_is_admin() or user_has_permission(auth.uid(), 'vendas.notas.access')`, `revoke` de anon; as tabelas `nf_saida*` continuam com leitura direta só para admin.

**Front:**
- menu **Vendas › Notas de Saída** (`/vendas/notas`, `PermissionRoute permKey="vendas.notas.access"`); `/sales` redireciona para a tela nova; `Sales.tsx` ficou no repositório, sem rota;
- `src/services/vendasNotasService.ts` e `src/pages/VendasNotasSaida.tsx`: período (De/Até, pela emissão), cartões (notas, canceladas no Alvo, valor sem as canceladas, por região), filtros (NF-e/NFS-e, operação, região, "No Alvo: válidas/canceladas"), lista com situação (Válida/Cancelada = livro; Provisória e "Sumiu do Alvo" = espelho), detalhe ao clicar (itens, lotes, séries, parcelas, classes), Excel com abas Notas e Itens, "Lidas do Alvo até …";
- "Operação" é a classe do Alvo (`tipo_operacao`), sem a regra D (§16.3, decisão pendente).

**Testes:** usuário sem `is_admin` (transação desfeita): sem o papel recusado, com o papel lê; `vitest` da tela (`src/test/vendas-notas-saida.test.tsx`); suíte 314/314.

**Rollback:** `git revert` do commit do front + `sql/VND-7-vendas-tela-rollback.sql`.

**Conferência com o Balancete P&F (11/11/2026).** O projeto Balancete carregou as mesmas notas de jan–out/2026 (808 notas; contagens, canceladas e valores iguais aos do espelho, mês a mês) e explica a receita do balancete (4.1.01) **sem diferença** em todos os meses de jan–set/2026, nota a nota. As diferenças da regra D de 2026 (§16.2) vêm de: NFS-e lançadas pelo mês do serviço (432 em julho; 433 e 434 em agosto; 439 em setembro), NF 4976 cancelada e lançada como receita em setembro (120.000,00), notas de venda sem lançamento (4426, 400,00; 4674, 12.993,37, conserto em garantia; 5011, 286,02) e câmbio das NFS-e 376 e 438. Serve de evidência para as decisões da §16.3.

## 19. VND-8 — número de série impresso (12/11/2026)

**Origem.** Desenho "Notas fiscais do Hub no Balancete, sem carga manual" (repositório `balancete-starter`,
`docs/DESENHO-ENVIO-AUTOMATICO-NOTAS.md`), aprovado pelo Pedro em 12/11/2026: o Balancete P&F passa a **buscar** as
notas no Hub por uma janela só de leitura (VND-9), em vez da carga manual pelos scripts. Etapa H1.

**Problema → causa → impacto → solução → risco**
- **Problema:** o espelho guarda só o número de **controle** de cada série (`nf_saida_item_serie.controle_num_serie`),
  não o número impresso na peça (ex.: TSV05642).
- **Causa:** a nota (`notaFiscal/Load`) só traz `ControleNumSerie`; o número impresso está no cadastro de séries do
  Alvo (`NumSerie/Load`), que o VND-4 deixou para "fase futura" (comentário no VND-3).
- **Impacto:** a busca automática do Balancete traria as séries sem o número impresso (hoje ele tem as 4.023 séries de
  2026 com o número, pela carga manual); a tela Vendas também mostra só o controle.
- **Solução:**
  1. tabela `nf_saida_serie_cadastro` (uma linha por controle: número impresso, lote, produto, situação, tentativas,
     resposta do Alvo) e fila `v_nf_saida_serie_fila` (controles sem cadastro, ou com falha e espera vencida);
  2. RPCs `nf_saida_serie_gravar` e `nf_saida_serie_registrar_falha` (só `service_role`; mesma escada de esperas do
     detalhe: 15 min, 1 h, 6 h, 24 h; estaciona na 5ª);
  3. Edge v3: passo 3 da rotina, depois do detalhe (até 60 controles por rodada), e modo `series` para a carga dos
     existentes (até 300 por chamada, 3 em paralelo, mesmo watchdog). Resposta com erro dentro do JSON, outro controle
     ou sem `NumeroSerie` = falha; `null` = ausente no Alvo.
- **Risco:** baixo. Só acrescenta (nada existente muda); `NumSerie/Load` é leitura e já está liberado no erp-proxy;
  volume de ~7.100 consultas na carga inicial (em lotes de 300, fora das janelas do cron) e ~200 por mês depois.

**Rollback:** voltar a Edge para a v2 (`git revert` do commit + deploy) e rodar `sql/VND-8-series-rollback.sql`.
**Conferência:** `sql/VND-8-series-verificar.sql` (cadastro × fila × controles nas notas; amostra comparável com a
ferramenta `buscar_serie` do Balancete; permissões).

## 20. VND-9 — janela de leitura para o Balancete P&F e frequência (12/11/2026)

Etapa H2 do mesmo desenho do §19.

**Problema → causa → impacto → solução → risco**
- **Problema:** o Balancete P&F só recebe as notas de saída por carga manual (scripts no navegador do Pedro); em
  12/11 ele ia até 31/10, e o espelho já tinha 29 notas de novembro. E o espelho lê o Alvo só 3×/dia útil.
- **Causa:** não existe caminho entre o Hub e o Balancete; o Balancete não tem acesso ao Alvo.
- **Impacto:** o conector do Balancete (Claude) responde com dados atrasados; a conferência notas × contabilidade
  depende de alguém lembrar de rodar os scripts.
- **Solução:**
  1. **Janela só de leitura** `exportar-notas-balancete` (Edge, `x-api-key` = segredo `BALANCETE_EXPORT_KEY`, o mesmo
     guardado no Balancete; sem o segredo a função fica fechada). `resumo`: por mês, notas, canceladas, pendentes de
     detalhe, séries sem número e a impressão digital (muda quando qualquer nota ou série muda), mais as últimas
     rodadas completas. `mes`: a página do mês (20 notas por padrão) com a última versão de cada nota (o mesmo
     objeto do `notaFiscal/Load`), limpa como nos scripts, e o número impresso das séries. Só notas de saída que
     ainda existem no Alvo. Cada chamada vai para `nf_saida_exportacao_log`; chave de desligar em `sync_settings`.
  2. **Frequência:** job 37 de hora em hora (07h20–20h20 BRT, dias úteis) e **varredura toda madrugada**
     (02h00–02h15 BRT): lista dos últimos 13 meses em 3 rodadas e uma rotina reforçada (200 detalhes, 200 séries).
     A rodada (a) termina com "LISTA INCOMPLETA" de propósito; a (b) continua de onde ela parou.
- **Risco:** baixo. A janela só lê; quem decide o que carregar é o Balancete. Mais leituras do Alvo (14 rotinas por
  dia útil, cerca de 1 minuto cada, e 4 rodadas de madrugada), fora das janelas de 07h30/12h30/16h30. Volta à
  frequência anterior sem mexer em mais nada (`sql/VND-9-cron-rollback.sql`).

**Arquivos:** `sql/VND-9-exportar-balancete.sql` (+ rollback), `sql/VND-9-cron.sql` (+ rollback),
`supabase/functions/exportar-notas-balancete/` (testes Deno 5/5).

