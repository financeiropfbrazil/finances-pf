# PLANO-VENDAS — Espelho das notas fiscais emitidas pela P&F (NF de saída)

> Plano autocontido do módulo. Mudanças entram como prompts novos (Ajuste/Correção), sem reescrever prompt registrado.
> Fonte única: **Alvo** (via erp-proxy). **Nada por certificado digital / SEFAZ** (ordem do Pedro, 30/10/2026).

## 0. Status dos prompts

| Prompt | O quê | Status |
|---|---|---|
| VND-0 | Diagnóstico: fonte, endpoints, estratégia, desenho das tabelas | **concluído 05/11/2026 (este documento)** — nada aplicado |
| VND-1 | Captura de amostras no Alvo (Load completo com itens; tela de listagem) + respostas do fiscal | aguardando |
| VND-2 | erp-proxy: liberar `notaFiscal/Load` (leitura) na whitelist do passthrough | aguardando VND-1 |
| VND-3 | DDL: tabelas, RLS, RPC de gravação (migration) | aguardando VND-1 (itens) e aprovação do Pedro |
| VND-4 | Edge `sync-nf-saida-cron` (varredura um a um) + teste com 5 notas | aguardando |
| VND-5 | Carga histórica (backfill) desde a data de corte, em lotes | aguardando |
| VND-6 | Cron + kill-switch em `sync_settings` + conferências | aguardando |

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
