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
| NFE-1 | RPCs de escrita (`compras_nfe_importar_xml`, `compras_nfe_vincular_pedidos`, `compras_nfe_desvincular`) + tela, upload e diálogo passam a usá-las | SQL + finances-pf | ✅ 30/10 (falta Publish) |
| NFE-2 | Fechar `compras_nfe`, `compras_nfe_pedidos` (leitura com gate, sem escrita direta) e `compras_nfe_fila_chaves` (só serviço); tirar `anon`/`authenticated` das 3 RPCs de cadastro | SQL | ✅ 30/10 (leva da Riosoft de 30/10 conferida: 13 de 13) |
| NFE-3 | Anexos (buckets `nfe-nf-pdf` / `nfe-boleto-pdf`, `nfe_anexo`, RPCs) + RPC `nfe_recebida_detalhe` (6 etapas) | SQL | ✅ 30/10 |
| NFE-4 | Tela de 6 etapas na NF-e + leitura da linha digitável do boleto anexado (Edge `nfse-ler-boleto` aceita anexo de NF-e) | finances-pf + Edge | ✅ 30/10 (falta Publish e teste com boleto real) |
| NFE-3-A | Candidato desconta o vínculo feito no Hub: saldo = pedido − notas ligadas no Alvo − NF-e vinculadas no Hub que o Alvo ainda não tem; nota vinculada no Hub sai da disputa; cartão mostra "Vinculado no Hub à NF X" | SQL + finances-pf | ✅ 30/10 (falta Publish) |
| NFE-5 | Período De/Até no lugar de mês/ano (Pedro, 30/10: "Datepicker profissional com De/Até"): `@/components/PeriodoPicker` comum com Rastreio e NFS-e; a lista não traz mais o `raw_xml` (XML sob demanda em Ver/Baixar) e busca em blocos de 1000; links `?de&ate` (o Rastreio passou a mandar assim; `?mes&ano` antigo continua abrindo o mês) | finances-pf | ✅ 30/10 (falta Publish) |
| NFE-6 | Download de controle das etapas — Excel com as colunas combinadas no chat, respeitando o filtro da tela no momento do clique (mesmo prompt da NFS-e: PLANO-NFSE NFSE-1.15) | SQL + finances-pf | ⬜ |

## 3. Diário (append-only)

| Data | Tarefa | Registro |
|---|---|---|
| 2026-10-30 | NFE-0 | Aplicado (migration `nfe_0_gate_no_alvo`). A coluna "No Alvo" dava 403 para quem não é admin desde a liberação da tela (commit 92ec62a): a RPC conferia a chave legada `compras`. Agora `nfe_pode_acessar()`. Hugo: 172 notas de setembro achadas (= admin); Mirlene (sem Analista Fiscal): 42501. md5 novo 1955aba6…; rollback devolve o corpo antigo exato (md5 d708176b… conferido localmente). |
| 2026-10-30 | NFE-1 | RPCs aplicadas (migration `nfe_1_rpcs_escrita`; a 1ª tentativa parou na confirmação do servidor sem resposta e não gravou nada; a 2ª foi aprovada pelo Pedro). Upload de XML, "Vincular" e "Desvincular" passam pelas RPCs (`src/services/nfeRecebidasService.ts`). Correção junto: desvincular agora também apaga os vínculos de `compras_nfe_pedidos` (antes ficavam órfãos). Testes como Hugo e Mirlene em `NFE-1-rpcs-verificar.sql`. Build, tsc, 256 testes; lint dos 3 arquivos alterados caiu de 8 para 4 erros. **Achado fora do escopo:** `compras_pedidos` também tem policy `ALL using (true)` para `authenticated`. |
| 2026-10-30 | NFE-2 | Tabelas fechadas (migration `nfe_2_fechar_tabelas`, aprovada pelo Pedro). `compras_nfe` e `compras_nfe_pedidos`: só SELECT com `nfe_pode_acessar()`; `compras_nfe_fila_chaves`: só serviço; `cadastrar_nfe`, `cadastrar_nfe_da_fila`, `enfileirar_chaves_nfe`: só `service_role`. `service_role` tem BYPASSRLS e manteve os privilégios → a Edge `receber-nfe` (Riosoft) segue gravando (insert simulado ok, desfeito). Hugo lê 968 e não grava direto (42501); Mirlene lê 0; anon 42501. ⚠️ Até o Publish do commit 248c473, o upload de XML, "Vincular" e "Desvincular" da versão publicada falham (eram escrita direta; usados 4 e 2 vezes desde junho). O rollback não devolve nada a anon (CLAUDE.md). |
| 2026-10-30 | NFE-3 | Aplicado (migration `nfe_3_anexos_detalhe`). Buckets privados `nfe-nf-pdf`/`nfe-boleto-pdf`, `nfe_anexo` fechada, RPCs de anexo com `nfe_pode_gravar()`, `nfe_recebida_detalhe` com `nfe_pode_acessar()`. Mesma régua da NFS-e (±20% do saldo, sem Encerrado/Cancelado, disputa entre NF-e pendentes da mesma raiz, saldo não confirmado); "citado" procura o pedido em `<xPed>` e `<infCpl>`; nota sem CFOP de venda não recebe candidato. 13 notas testadas como Hugo (41–332 ms) — detalhe em `NFE-3-anexos-detalhe-verificar.sql`. |
| 2026-10-30 | NFE-4 | Tela: a linha expandida de Notas Fiscais virou as 6 etapas (`src/components/nfe/NfeDetalheEtapas.tsx`), reaproveitando as peças da NFS-e (exportadas de `NfseDetalheEtapas.tsx`, sem mudar o comportamento da NFS-e; `AreaAnexo` e `LeituraBoleto` recebem as ações por prop, padrão NFS-e). Etapa 1 mostra emitente, município/UF e IE do XML, CFOPs, informações complementares e "situação no fisco não acompanhada"; etapa 2 separa pedido do Alvo, vínculo do Hub (com Vincular/Desvincular) e candidatos; etapa 4 = DANFE. Itens e impostos continuam abaixo das etapas. Coluna "Situação" da lista: "Recebida" (com explicação) no lugar do "normal" cru; aviso do contas a pagar corrigido para 06h40 e 12h40. Edge `nfse-ler-boleto` v2 (`origem: 'nfe'` → gate `nfe_pode_acessar`, tabela `nfe_anexo`, beneficiário × `emitente_cnpj`); deploy conferido (401 sem login). Prévia visual com dados reais de 5 notas (lançada, citada, disputa, retorno, vínculo do Hub), sem erro de console e sem rolagem lateral em 1280/1534. Build, tsc, 256 testes; lint igual ao HEAD nos arquivos existentes. |
| 2026-10-30 | NFE-2 (conferência) | A leva da Riosoft de hoje entrou depois do fechamento: 13 chamadas à `receber-nfe` entre 12h00 e 12h02 BRT, todas 200; 13 NF-e novas em `compras_nfe` (total 977). Entrada intacta. |
| 2026-10-30 | NFE-3-A | Pergunta do Pedro: "caso algum pedido já tenha NF vinculada, esse pedido não é mais usado para ser candidato de outra NF, certo?" — vale para nota ligada no Alvo (saldo), mas o vínculo do Hub não era descontado. Corrigido (migration `nfe_3a_candidato_desconta_vinculo_hub`, "ok" do Pedro): nota vinculada no Hub e ainda fora do Alvo consome o saldo do pedido (vários pedidos → tudo no principal) e sai da disputa; quando a nota aparece no Alvo, vale o lançamento. Teste (desfeito): 0005190 vinculado no Hub à NF 1273 (R$ 311,40) → some da NF 7750. Obs.: o corpo da NFE-3 no banco é o do arquivo sem as linhas de comentário (md5 0059fe2b…); o rollback da 3-A usa esse corpo exato. |
| 2026-10-30 | NFE-5 | Seletor De/Até (componente comum extraído do Rastreio, sem mudar o comportamento do Rastreio). A lista de NF-e deixou de carregar o XML de todas as notas (um mês já trazia ~5 MB; um ano passaria de 30 MB): o XML vem só em "Ver XML"/"Baixar XML". Busca em blocos de 1000 (teto do PostgREST). Build, tsc, 256 testes; lint igual ao HEAD. |
