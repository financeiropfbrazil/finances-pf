# PLANO-NFE — Notas Fiscais de produto (NF-e) no esquema de 6 etapas da NFS-e

Ordem do Pedro (30/10/2026): "quero todas as correções, quero o mesmo esquema de 'passos' que temos na NFS para as NFe.
Feche a tabela antiga. Cuidado (pesquise antes para não errar): não estamos importando NFe (produtos) via certificado
digital, mas via uma API (ou webhook) que a Riosoft me manda do Arqimport. Não quebrar isso. Não quero buscar via
certificado digital as NFes."

Tela: `/compras/notas-fiscais` (`src/pages/ComprasNotasFiscais.tsx`). Plano irmão: `PLANO-NFSE.md` (o molde das etapas).

## 0. Regras deste plano

1. **A entrada da Riosoft (Arqimport) é intocável.** Ela chama a Edge `receber-nfe` (v7, `verify_jwt=false`, header
   `x-api-key` = secret `NFE_API_KEY`), que grava em `compras_nfe` com a **chave de serviço** (ignora RLS). Medido em
   29/10: 9 chamadas às 12h00–12h01 BRT, todas 200. Nenhuma tarefa deste plano altera essa Edge, o secret ou a forma
   como ela grava. Conferência depois de cada fechamento: a próxima leva da Riosoft continua entrando (`imported_at`).
2. **Nada por certificado digital.** O caminho antigo (fila `compras_nfe_fila_chaves` → erp-proxy `/nfe/sync-batch` →
   `cadastrar_nfe_da_fila`) fica como está: sem cron, sem uso, sem ser religado. A situação no fisco (cancelamento)
   **não** é acompanhada, porque a única fonte seria a SEFAZ com certificado; a tela diz isso em vez de fingir.
3. Pré-voo de toda escrita no banco: fingerprint (`count(*) from compras_pedidos` ≥ 2.000) + md5 do corpo que vai ser
   trocado. `create or replace` preserva o ACL; função nova recebe `revoke ... from public, anon` com a assinatura.
4. Cada tarefa tem `-aplicar.sql`, `-verificar.sql` e `-rollback.sql` em `docs/nfe/`. Validação sempre com um usuário
   **sem** `is_admin` (Hugo, Analista Fiscal).
5. Permissões (papel Analista Fiscal): `compras.nfe.access` = ver; `compras.nfe.create` = gravar (upload de XML,
   vínculo de pedido, anexos).

## 1. Quem usa as tabelas (medido em 30/10/2026)

| Objeto | Quem lê / grava | Chave |
|---|---|---|
| `compras_nfe` (968 linhas) | `receber-nfe` (Riosoft) grava; `rastro-nfe-feed` lê; tela lê e grava (upload, desvincular) | serviço / usuário |
| `compras_nfe_pedidos` (5) | só o diálogo "Vincular pedido" da tela | usuário |
| `compras_nfe_fila_chaves` | erp-proxy e `receber-chaves-nfe` (caminho por certificado, parado) | serviço |
| `compras_nfe_no_alvo` | coluna "No Alvo" da tela | usuário |
| `cadastrar_nfe`, `cadastrar_nfe_da_fila`, `enfileirar_chaves_nfe` | erp-proxy / Edge com chave de serviço; **executáveis por `anon`** | serviço |
| `rastreio_atualizar_candidatas` | cron do Rastreio (lê `compras_nfe`) | definer |

Antes deste plano: as 3 tabelas tinham policy `ALL using (true)` para `authenticated` — qualquer usuário logado lia e
gravava pela API.

## 2. Tarefas

| ID | O quê | Onde | Status |
|---|---|---|---|
| NFE-0 | `nfe_pode_acessar()` / `nfe_pode_gravar()`; `compras_nfe_no_alvo` aceita `compras.nfe.access` (a coluna "No Alvo" dava 403 para quem não é admin) | SQL | ✅ 30/10 |
| NFE-1 | RPCs de escrita (`compras_nfe_importar_xml`, `compras_nfe_vincular_pedidos`, `compras_nfe_desvincular`) + tela, upload e diálogo passam a usá-las | SQL + finances-pf | ⬜ |
| NFE-2 | Fechar `compras_nfe`, `compras_nfe_pedidos` (leitura com gate, sem escrita direta) e `compras_nfe_fila_chaves` (só serviço); tirar `anon`/`authenticated` das 3 RPCs de cadastro | SQL | ⬜ |
| NFE-3 | Anexos (buckets `nfe-nf-pdf` / `nfe-boleto-pdf`, `nfe_anexo`, RPCs) + RPC `nfe_recebida_detalhe` (6 etapas) | SQL | ⬜ |
| NFE-4 | Tela de 6 etapas na NF-e + leitura da linha digitável do boleto anexado (Edge `nfse-ler-boleto` aceita anexo de NF-e) | finances-pf + Edge | ⬜ |

## 3. Diário (append-only)

| Data | Tarefa | Registro |
|---|---|---|
| 2026-10-30 | NFE-0 | Aplicado (migration `nfe_0_gate_no_alvo`). A coluna "No Alvo" dava 403 para quem não é admin desde a liberação da tela (commit 92ec62a): a RPC conferia a chave legada `compras`. Agora `nfe_pode_acessar()`. Hugo: 172 notas de setembro achadas (= admin); Mirlene (sem Analista Fiscal): 42501. md5 novo 1955aba6…; rollback devolve o corpo antigo exato (md5 d708176b… conferido localmente). |
