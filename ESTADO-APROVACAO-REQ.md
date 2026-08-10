# ESTADO-APROVACAO-REQ.md — ponto de retomada da missão

> Missão: **Aprovação de Requisições pelo Líder de Departamento**.
> Documentos-mãe (imutáveis por convenção): `CLAUDE_APROVACAO_REQ.md` (guia v2) e `AJUSTE-1.1-APROVACAO-REQ.md` (manda em caso de conflito).
> Este arquivo é o **único mutável** da missão: guarda status e ponto de retomada. Atualizar ao fim de cada prompt.
> Última atualização: **10/08/2026** (PROMPT 1.3 — motivos estruturados de rejeição).

## 1. Onde estamos

| Prompt | Escopo | Status |
|---|---|---|
| **PROMPT 0** | Fase 0 — Discovery (read-only) | ✅ concluído → `DISCOVERY-APROVACAO-REQ.md` + `ADENDO-ERP-PROXY-REQCOMP.md` · commit `ad11808` |
| **AJUSTE 1.1** | Decisões A1–A7 + SQL definitivo da Fase 1 | ✅ recebido (autoria do Pedro), incorporado |
| **PROMPT 1** | Fase 1 — SQL pronto para o SQL Editor | ✅ gerado → `SQL-FASE1-APROVACAO.md` · commit `51117c7` |
| **FASE 1 — execução** | Pedro rodou os blocos + gate no SQL Editor | ✅ **executada em 07/08/2026, gate verde** · commit `2ffcdb1` |
| **PROMPT 2** | Fase 2 — código: split do service, roteamento, envio pós-aprovação | ✅ concluído · commit `c32c69b` · **pushado** (`2ffcdb1..c32c69b`) |
| **PROMPT 2.1** | Investigação: `pendente_envio` + brecha do reenvio de rascunho | ✅ concluída (read-only) — conclusões no §4 |
| **AJUSTE 1.2** | Reenvio de rascunho roteado + gate de permissão no botão + dívidas | ✅ recebido (autoria do Pedro), incorporado |
| **PROMPT 1.2** | Execução do Ajuste 1.2 (§3 e §4) — código + medição da permissão | ✅ concluído em 10/08/2026 · commit `3f88fbd` · **pushado e publicado** — conclusões no §9 |
| **PROMPT 3** | Fase 3 — UI (fila do líder, badges, clonar, correções C5) | ✅ concluído em 10/08/2026 · commit `cc58e9c` · **pushado e publicado** — conclusões no §10 |
| **FASE 5 — validação** | Piloto fim-a-fim com o Hugo Maffei | ✅ **executada em 10/08/2026** — gate funcionando em produção; 3 achados viraram o Ajuste 1.3 |
| **AJUSTE 1.3** | Motivos estruturados de rejeição + limpeza de `erro_ultimo_envio` | ✅ recebido (autoria do Pedro), incorporado |
| **PROMPT 1.3** | Execução do Ajuste 1.3 — SQL + frontend | ✅ concluído em 10/08/2026 · commit local · **SEM push** · **SQL PENDENTE de execução** — conclusões no §11 |
| PROMPT 4 | Validação 255 chars na digitação | ⏸️ não iniciado |

**Publicação:** Fases 2 e 1.2 estão publicadas. A Fase 3 está só no repo local (nem push): publicar é decisão do Pedro **depois** de revisar o diff e rodar o SQL do §10.2.

⚠️ **Pré-condição da Fase 3 no banco (ainda NÃO executada):** o papel `lider_departamento` precisa de `compras.requisicoes.create` e `compras.requisicoes.reenviar_own` (SQL medido e reproduzido no §10.2). Sem isso, um líder **sem `is_admin`** não consegue criar nem reenviar requisição própria.

## 2. FASE 1 — o que está no ar (07/08/2026, gate verde)

| Objeto | Detalhe |
|---|---|
| RPCs | `submeter_requisicao(uuid)` · `aprovar_requisicao(uuid)` · `rejeitar_requisicao(uuid, text)` · `registrar_envio_requisicao(uuid, text, text)` · `marcar_arquivo_req_enviado` (pré-existente) — todas `SECURITY DEFINER` |
| Helper | `_req_evento(uuid, text, jsonb, boolean default true)` — grava em `compras_requisicoes_auditoria` |
| Trigger | `trg_req_protege_aprovacao` + `fn_req_protege_aprovacao()` — **`SECURITY INVOKER` por design** (o `current_user` precisa refletir quem chama). Protege `pendente_aprovacao`/`aprovada`/`rejeitada` e as colunas de decisão contra escrita direta via API |
| Tabela | `compras_lideres_cc` (RLS ligada, policy só de SELECT; gestão via SQL Editor) |
| Colunas novas | `aprovada_por_user_id`, `aprovada_em`, `aprovacao_automatica`, `rejeitada_por_user_id`, `rejeitada_em`, `motivo_rejeicao` |
| RBAC | permissão `compras.requisicoes.aprovar` + papel `lider_departamento`; permissão mapeada também ao papel `admin` |
| Seed do piloto | Pedro × `00010.00002.00003` (Controladoria/Financeiro) — 1 linha |
| Dados | **293 requisições existentes intactas** (nenhuma em estado do fluxo novo) |

### ⚠️ Armadilha do ambiente descoberta na execução (custou duas rodadas perdidas)

O **SQL Editor do Supabase pré-processa o texto antes de enviar ao banco**:

1. Ao ver um `create table`, ele **injeta por conta própria** um `ALTER TABLE <var> ENABLE ROW LEVEL SECURITY`.
2. O parser dele **confunde variáveis declaradas no bloco `declare` dentro de um corpo `$$ … $$` com nomes de tabela** — e a função é gravada **corrompida, em silêncio** (sem erro na tela).

**Solução adotada: usar tags nomeadas em todo `CREATE FUNCTION`** — `$fn$`, `$r1$`, `$r2$`, `$r3$`, `$r4$`… em vez de `$$` anônimo. Com a tag nomeada o pré-processador não entra no corpo.

**Regra para as próximas fases:** todo SQL entregue ao Pedro nasce com tag nomeada por função. Se uma função voltar a se comportar de forma estranha depois de "executar com sucesso", a primeira hipótese é esta — conferir o corpo real com `pg_get_functiondef`.

## 3. FASE 2 — o que foi entregue (commit `c32c69b`)

| Arquivo | Mudança |
|---|---|
| `src/services/requisicoesService.ts` | **Split**: `enviarRequisicao`/`enviarRequisicaoComArquivos` (one-shot) substituídas por `criarRequisicao(input) → id` (persiste rascunho + itens + rateios + anexos) e `enviarRequisicaoAlvo(id, opts)` (caminho Alvo isolado, dois modos de persistência). Novas: `submeterRequisicao(input)` (criar → RPC → rotear) e `reenviarRequisicaoAprovada(id, …)`. Helpers: `tentarRegistrarErroNoRascunho`, `registrarDesfechoViaRpc`, `mensagemRecusaSubmissao`. `reenviarRequisicao` legado intacto + guarda que recusa req `aprovada` |
| `src/pages/SuprimentosRequisicaoNova.tsx` | Botão final chama `submeterRequisicao`; trata 5 saídas (PENDENTE, sucesso, recusa de roteamento, "criada no ERP mas não registrada no Hub", falha de envio) |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx` | `podeReenviar` inclui `aprovada` + `erro_ultimo_envio`; nesse caso usa `reenviarRequisicaoAprovada`, nunca o legado |

**Modos de persistência do envio** (`opts.persistencia`):
- `legado` → upsert direto (`pendente_envio` → `sincronizada` | `rascunho`+erro). Só na rota `SEM_GATE`.
- `rpc` → desfecho **exclusivamente** por `registrar_envio_requisicao`. Nas rotas `AUTO_APROVADA` e no reenvio pós-aprovação (escrita direta seria recusada pelo trigger).

**Propriedade útil derivada:** só o modo legado grava `pendente_envio` ⇒ **req nesse status esteve no caminho SEM_GATE**.

Não tocados: crons/Edge Functions, `types.ts`, fila do líder e badges (Fase 3), `pedidosService.ts`, arquivos do módulo OP.

## 4. INVESTIGAÇÃO 2.1 — conclusões (07/08, read-only)

### 4.1 `pendente_envio` — **não entra em correção**

Fica como **dívida**, não como bug a corrigir agora. Razões medidas:
- Risco **pré-existente** (o código antigo tinha o mesmo comportamento).
- O estado é **visível**: badge próprio (`SuprimentosRequisicaoDetalhe.tsx:56`, `src/lib/statusRequisicao.ts`) e a listagem não filtra status por padrão.
- É **recuperável pelo próprio usuário**: o botão Reenviar aceita `pendente_envio`.
- **Zero ocorrências**: nenhuma das 222 requisições com trilha de auditoria tem `envio_tentado` como último evento — nenhum ciclo de envio ficou aberto na história do módulo. Zero linhas em `pendente_envio` hoje e no Discovery de 06/08.
- Só fica preso por queda de aba/rede/máquina entre gravar `pendente_envio` (`requisicoesService.ts:559-575`) e a persistência final; erro do gateway é capturado e devolve a req a `rascunho` (`:669-695`).

### 4.2 DÍVIDA registrada — upsert de sucesso não verifica erro (modo legado)

No modo `legado`, o upsert de sucesso (`requisicoesService.ts:619` e `:932`) **não checa `error`**: se a escrita falhar, o código **segue como sucesso** e a requisição fica em `pendente_envio` **já existindo no ERP** (sem `numero_alvo` no Hub). O modo `rpc` não tem esse buraco — `registrarDesfechoViaRpc` (`:325-345`) confere o retorno e **grita**. Herdado do legado; candidato natural ao Ajuste 1.2.

### 4.3 BRECHA a corrigir — reenvio de rascunho pula o gate

Item #2 do mapa de caminhos: o botão **Reenviar** em req `rascunho` (`SuprimentosRequisicaoDetalhe.tsx:414-426` → `:285` → `reenviarRequisicao`, `requisicoesService.ts:822`) chama `/req-comp/insert` **sem passar por `submeter_requisicao`**. Uma req que caiu em rascunho — inclusive por recusa no roteamento — pode ser empurrada ao ERP por ali. É o **único** vazamento do gate: todos os outros caminhos de UI ou passam pelo gate, ou só leem (`sincronizarStatusRequisicao`, cron "Rodar Agora"), ou operam sobre req que já está no ERP (`/req-comp/update` da baixa), ou são de outra entidade (`/ped-comp/insert` do módulo Projetos).

### 4.4 LACUNA a corrigir — botão Reenviar sem gate de permissão

O botão só olha `podeReenviar` (`SuprimentosRequisicaoDetalhe.tsx:414`); quem enxerga a req enxerga o botão (`view_all` **ou** dono **ou** funcionário vinculado, `:98-104`). A permissão **`compras.requisicoes.reenviar_own` existe no catálogo RBAC e não é checada em lugar nenhum** do frontend nem do backend.

## 5. Decisões do Pedro (07/08/2026)

1. **Política de reenvio: cada um cuida da própria requisição.** Sem ramo de exceção para quem tem `view_all`. O endurecimento que vem de `submeter_requisicao` (exige ser o requisitante ou admin **e** ter `compras.requisicoes.create`) é **aceito de propósito** — quem não é dono deixa de reenviar requisição alheia.
2. **Cobaia da validação (Fase 5): Hugo Maffei** — `hugo.maffei@pfbrazil.com`, `is_admin = false`, papéis `requisitante` + `analista_compras` + `controller_intercompany`. Pendência do Ajuste §8 **fechada**.

Consequência já medida da decisão 1: os 4 rascunhos legados estão em CCs **sem líder** (`00010.00003.00001` ×3, bianca.goncalves; `00008.00001.00003` ×1, larissa.maraus), ambas com `compras.requisicoes.create` e sem `is_admin` — com o roteamento do Ajuste 1.2 elas seguem rota `SEM_GATE`, ou seja **comportamento idêntico ao de hoje**, e continuam reenviando as próprias reqs. (Essas 4 falham por validação do próprio Alvo — 255/100 chars, validade do CC — e vão continuar falhando até o dado ser corrigido: assunto da Fase 4.)

## 6. Próximo passo

1. **Executar o `SQL-AJUSTE13.md`** no SQL Editor (12 blocos + 5 conferências). ⚠️ **O frontend do Ajuste 1.3 já chama a assinatura nova de `rejeitar_requisicao` (3 parâmetros)** — enquanto o SQL não rodar, rejeitar pela tela falha. Ordem correta: SQL primeiro, push/Publicar depois.
2. **Pedro revisa o diff do Ajuste 1.3** (§11) e dá o push.
3. **Publicar no Lovable.**
4. **Validação §8 do Ajuste 1.3** (6 passos: motivo sem observação, "Outros" sem/com observação, rejeição antiga do Hugo legível, sem erro residual, agregação por motivo).
5. **Conferir o SQL do §10.2** (`lider_departamento` + `create`/`reenviar_own`) — se ainda não foi rodado, continua pendente.
6. **Fase 4** — validação de 255 chars por item na digitação (prompt próprio).

## 7. Pendências abertas

1. **DÍVIDA-RLS-COMPRAS-REQ** (Ajuste §6): RLS `ALL using(true)` continua aberta; o trigger protege só a superfície da aprovação. Missão própria, prioridade alta pós-piloto.
2. **DÍVIDA-REQ-PENDENTE-ENVIO-ORFA** (§4.1) e **DÍVIDA-REQ-UPSERT-SILENCIOSO** (§4.2) — formalizadas no Ajuste 1.2 §5, decisões B2/B3: **não entram em correção** nesta missão.
3. **Outro escritor ativo no repo (módulo OP).** Resolvido em 10/08: o `origin/main` já está em `919153f` (OP-2.7 e a Fase 4 do OP pushados). O commit do Ajuste 1.2 empilha em cima de `919153f` e leva **só** os arquivos desta missão.
4. ~~**Cosmético (Fase 3):** `STATUS_MAP`/`statusRequisicao.ts` sem os estados novos; eventos sem ícone.~~ ✅ **fechado na Fase 3** (§10.1).
5. ~~**Hook fora de ordem, pré-existente**~~ ✅ **fechado na Fase 3** (C5.1): os 3 `useHasPermission` do detalhe estão no topo do componente.
6. **`src/lib/statusConfig.ts` órfão** — arquivo inteiro sem nenhum import, com um `getStatusRequisicao` concorrente ao de `statusRequisicao.ts`. Não tocado (§10.6-5). Prioridade: baixa, mas é armadilha para quem for mexer em status.
7. **`suprimentos_requisicoes_para` não filtra status** (§10.4): a RPC de relatório passará a contar `pendente_aprovacao`/`rejeitada` nos KPIs. Correção é DDL — decisão do Pedro.

## 8. O que a Fase 3 vai encontrar

- Toda requisição nova nasce `rascunho` e só sai desse estado pela RPC — "Salvar rascunho" é apenas **não chamar** `submeterRequisicao` depois de `criarRequisicao`.
- A listagem não filtra status por padrão: `pendente_aprovacao` e `rejeitada` **aparecerão** para quem tem `view_all` (decisão A4: badge, não esconder).
- `podeGerarPedido` (`status === 'sincronizada'`) e `clonarDeRequisicao` (`pedidosService.ts:1957`) já barram pendente/rejeitada — travas positivas.
- O botão Reenviar já cobre o pós-aprovação; a fila do líder pode reusar `reenviarRequisicaoAprovada` sem código novo de envio.
- O gate de UI do Reenviar já enxerga o líder do CC (§9.2) — a fila do líder pode reusar a mesma leitura de `compras_lideres_cc`.

## 9. AJUSTE 1.2 — o que foi entregue (10/08/2026, PROMPT 1.2)

### 9.1 Arquivos alterados (2 de código + este)

| Arquivo | Mudança |
|---|---|
| `src/services/requisicoesService.ts` | **`rotearSubmissao(reqId, {userId, userName})`** extraída de `submeterRequisicao` (movimentação de código, zero lógica nova) — é agora o único ponto que consulta `submeter_requisicao` e despacha as 4 saídas. `submeterRequisicao` = `criarRequisicao` + `rotearSubmissao`. **`reenviarRequisicao` desvia para `rotearSubmissao` quando `status === 'rascunho'`**; `pendente_envio` segue no corpo legado **intocado**. Retorno passou de `EnvioResult` para `SubmissaoResult` (ganhou `rota`; `rota: null` = caminho legado) |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx` | `podeReenviar` ganhou gate de permissão (§9.2). Botão **Reenviar escondido** quando não autorizado — Editar/Excluir seguem só pela condição de status (`statusPermiteAcoesDeRascunho`), inalterados. `handleReenviar` trata a saída `PENDENTE` com toast próprio ("Enviada para aprovação do líder… Nada foi enviado ao ERP") |

**Não tocados:** banco (MCP read-only, provado), RPCs, trigger, crons/Edge Functions, `types.ts`, `SuprimentosRequisicaoNova.tsx`, `pedidosService.ts`, arquivos do módulo OP.

**Gate de saída:** `bun run build` ✅ · `tsc --noEmit -p tsconfig.app.json` ✅ exit 0 · ESLint 86→**87** (+1 `no-explicit-any`, o `(supabase as any)` obrigatório da leitura de `compras_lideres_cc` — padrão do projeto, `types.ts` não pode ser tocado).

### 9.2 Gate de permissão implementado (Ajuste §4)

| Situação | Botão Reenviar | Regra no código |
|---|---|---|
| Requisitante da req **e** tem `compras.requisicoes.reenviar_own` | ✅ | `isRequisitante && podeReenviarOwn` |
| `is_admin` | ✅ | bypass, consistente com `useHasPermission` e `user_has_permission` |
| `view_all` mas **não** é o requisitante | ❌ escondido | decisão B1 — sem ramo de exceção |
| Req `aprovada` + `erro_ultimo_envio` | ✅ requisitante, **líder do CC** ou admin | ramo próprio; espelha a autorização que a RPC R4 aplica no servidor |

O ramo do líder lê `compras_lideres_cc` (`codigo_centro_ctrl` + `lider_user_id` + `ativo`) numa query só habilitada quando `status === 'aprovada'`. Sem ele, um líder **sem `is_admin`** perderia o botão da própria fila — o erro clássico de validar só com o Pedro.

### 9.3 MEDIÇÃO da permissão `compras.requisicoes.reenviar_own` (read-only, 10/08) — **nada a corrigir**

| Papel | `reenviar_own` | `create` (exigida pela RPC) | `view_all` | Usuários |
|---|---|---|---|---|
| `admin` | ✅ | ✅ | ✅ | 1 |
| `analista_compras` | ✅ | ✅ | ✅ | 6 |
| `analista_fiscal` | ✅ | ✅ | ✅ | 0 |
| `requisitante` | ✅ | ✅ | ❌ | 42 |
| `lider_departamento` | ❌ | ❌ | ❌ | 1 |
| `visualizador_compras` | ❌ | ❌ | ✅ | 1 |

- ✅ **`requisitante` TEM a permissão** — os 42 requisitantes não perdem o botão. **Nenhuma linha em `hub_role_permissions` precisa ser inserida.**
- ✅ `reenviar_own` está mapeada **exatamente aos mesmos papéis** que `create` — o gate de UI e a RPC `submeter_requisicao` (que exige `create`) concordam por construção.
- ⚠️ **`visualizador_compras`** (1 usuário) tem `view_all` e **não** tem `reenviar_own`: é precisamente o caso que a lacuna deixava passar. A partir deste ajuste ele deixa de ver o botão em requisição alheia — comportamento pretendido pela decisão B1.
- ⚠️ **`lider_departamento` não tem `reenviar_own` nem `create`** (só `access` + `aprovar`). É o motivo do ramo separado do §9.2. Se a Fase 3 quiser que o líder reenvie/submeta fora do pós-aprovação, aí sim o mapeamento precisará de decisão do Pedro.

### 9.4 O que contradisse a espec

1. **O botão Excluir estava no mesmo `{podeReenviar && …}` do Reenviar.** Endurecer `podeReenviar` cru teria escondido **Excluir** (que tem permissão própria, `delete_own`, hoje não checada) para quem não é o requisitante — mudança silenciosa fora do escopo. Resolvido separando a condição de status do gate de permissão.
2. **O Ajuste §4 (linha 4 da tabela) e o texto do PROMPT 1.2 divergem** no caso `aprovada`: o prompt resume tudo em "requisitante **e** `reenviar_own` (ou admin)"; o Ajuste concede o pós-aprovação também ao **líder do CC**. Seguido o **Ajuste**, que manda — e a medição do §9.3 confirma que era o certo (o líder não tem `reenviar_own`).
3. **Requisição em rascunho sem itens** deixou de falhar cedo com "Requisição sem itens": na rota `PENDENTE` ela vai para a fila do líder sem passar por `enviarRequisicaoAlvo` (que é quem valida). Caso de borda sem ocorrência conhecida (rascunho nasce de falha de envio, e já tinha itens); nas rotas `SEM_GATE`/`AUTO_APROVADA` a validação continua igual. Registrado, não corrigido.
4. **Hook fora de ordem pré-existente** em `SuprimentosRequisicaoDetalhe.tsx:292` (`useHasPermission` depois de dois early returns, desde maio/2026 — commit `a973f1c`, Lovable). Viola as regras de hooks do React. **Não tocado** (fora do escopo); os hooks novos deste ajuste foram todos para o topo do componente. Ver §7.5.

### 9.5 Mapa de rotas ao ERP — refeito após o Ajuste (gate de saída §6.2)

Grep de referência: `req-comp|ped-comp|erp-proxy.onrender|ERP_PROXY_URL` em `*.ts,*.tsx` (repo inteiro, incluindo `supabase/functions/`).

| # | Caminho | Onde | Rota no ERP | Gate |
|---|---|---|---|---|
| 1 | Wizard "Enviar" (Nova Requisição) | `SuprimentosRequisicaoNova.tsx:382` → `submeterRequisicao` → `rotearSubmissao` | `POST /req-comp/insert` · `insert-multipart` | ✅ passa por `submeter_requisicao` |
| 2 | **Botão "Reenviar" em req `rascunho`** | `Detalhe:handleReenviar` → `reenviarRequisicao:874` → **`rotearSubmissao`** | idem | ✅ **FECHADO neste Ajuste** (era o vazamento) |
| 3 | Botão "Reenviar" em req `pendente_envio` | `reenviarRequisicao` corpo legado `:961/:963` | idem | ➖ dispensa: só a persistência legada grava esse status ⇒ a req **já foi roteada** como `SEM_GATE` |
| 4 | Botão "Reenviar" em req `aprovada` + erro | `reenviarRequisicaoAprovada` → `enviarRequisicaoAlvo(persistencia:'rpc')` | idem | ➖ já passou pelo gate (foi aprovada); desfecho só pela R4 |
| 5 | Sincronizar status (open-load e botão) | `requisicoesService:1223` | `GET /req-comp/{filial}/{numero}` | ➖ leitura |
| 6 | Cron agendado e "Rodar Agora" | `sync-compras-status-cron:448,:739` (`sync_cron_trigger_now`) | `GET /req-comp/list` · `GET /req-comp/{…}` | ➖ leitura (escreve status só no Hub) |
| 7 | Baixa da requisição ao virar pedido | `pedidosService:374` (GET) · `:403` (POST) | `POST /req-comp/update` | ➖ opera sobre req que **já existe** no ERP |
| 8 | Projetos — enviar pedido | `alvoProjetoPedidoService:287` | `POST /ped-comp/insert` | ➖ outra entidade (PedComp), fora da missão |

**Conclusão:** os **únicos** pontos que criam uma requisição no ERP são `/req-comp/insert` e `/req-comp/insert-multipart`, e ambos só são alcançados por `enviarRequisicaoAlvo` (linhas 1, 2 e 4) ou pelo corpo legado de `reenviarRequisicao` (linha 3). Após o Ajuste, **nenhum caminho leva uma req em `rascunho` ao ERP sem passar por `rotearSubmissao`/`submeter_requisicao`**.

**Não regrediram:** `pendente_envio` continua indo direto ao envio legado (linha 3 — código **não editado**, só o desvio anterior a ele); `reenviarRequisicaoAprovada` continua sendo o único caminho para req `aprovada` (a guarda de `reenviarRequisicao` que recusa `aprovada` segue intacta e vem **antes** do desvio novo).

---

## 10. FASE 3 — o que foi entregue (10/08/2026, PROMPT 3)

### 10.1 Arquivos alterados (8 modificados + 2 novos + este)

| Arquivo | Mudança |
|---|---|
| **`src/pages/SuprimentosAprovacoes.tsx`** 🆕 | Fila do líder: lista `pendente_aprovacao` dos CCs do usuário (admin vê todas), **mais antiga primeiro**, com dias de espera, requisitante, CC, itens e data de necessidade. Ações Aprovar/Rejeitar na linha; **aprovar é em 2 tempos** (`Aprovada ✓` → `Enviando ao ERP…` → `Sincronizada (nº X)` \| erro com instrução de Reenviar). Modal de rejeição com motivo obrigatório e contador. Estado vazio distingue "sem pendências" de "você não lidera nenhum CC" |
| **`src/hooks/useAprovacoesPendentes.ts`** 🆕 | Contagem para o badge do menu. `count` server-side (`head: true`, zero linhas trafegadas), só consulta quem tem `compras.requisicoes.aprovar`, revalida ao focar a aba |
| `src/services/requisicoesService.ts` | `listarCentrosDeCustoDoLider`, `contarRequisicoesPendentes`, `listarRequisicoesPendentes` (`.range()`, teto 1000), `aprovarRequisicao`, `rejeitarRequisicao` (com `traduzirDecisao` — nenhum retorno de RPC cai no vazio), `carregarRequisicaoParaClonar`. **C5.2:** validação de "sem itens" em `rotearSubmissao`. Negação `!== rascunho && !== pendente_envio` → lista positiva `STATUS_REENVIAVEIS_LEGADO` |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx` | Cards de estado do gate (rejeitada com motivo/quem/quando; aprovada com autoria e rótulo de **aprovação automática**; pendente explicando que depende do líder do CC e que **não há aviso por e-mail**). Ações Aprovar/Rejeitar para o líder do CC. Botão **Clonar**. `STATUS_MAP` e `EVENTO_ICON` com os estados/eventos novos. **C5.1:** 3 hooks movidos para o topo. Open-load com lista positiva |
| `src/pages/SuprimentosRequisicaoNova.tsx` | **Clonar**: `?clonarDe=<id>` pré-preenche cabeçalho, itens e rateios; loader durante a cópia; aviso de anexos não copiados e de data vencida. Guarda para o auto-preenchimento do perfil não competir com a clonagem |
| `src/pages/SuprimentosRequisicoes.tsx` | Dropdown de status com `pendente_aprovacao`, `aprovada`, `rejeitada`. **Removido** o `STATUS_CONFIG` morto (2º vocabulário de status, sem uso e já desatualizado) |
| `src/lib/statusRequisicao.ts` | 4 estados novos com rótulo/ícone/tooltip; cor forte **só** para `aprovada + erro_ultimo_envio`. Negação `status !== 'cancelada'` → lista positiva `STATUS_QUE_ACEITAM_PEDIDO` |
| `src/components/AppSidebar.tsx` | Item **"Aprovações"** em Suprimentos, gateado por `compras.requisicoes.aprovar`, com **badge de contagem** (suporte a badge por URL no grupo) |
| `src/App.tsx` | Rota `/suprimentos/aprovacoes` com `<PermissionRoute permKey="compras.requisicoes.aprovar">` |
| `src/constants/permissions.ts` | `COMPRAS_REQUISICOES_APROVAR` e `ROLES.LIDER_DEPARTAMENTO` |

**Não tocados:** banco (MCP read-only, provado), RPCs, trigger, crons/Edge Functions, `types.ts`, RLS, `pedidosService.ts`, arquivos do módulo OP.

**Gate de saída:** `bun run build` ✅ · `tsc --noEmit -p tsconfig.app.json` exit 0 ✅ · ESLint **+24** ocorrências, todas `no-explicit-any` do mesmo padrão já dominante (`(supabase as any)` obrigatório porque `types.ts` não pode ser tocado, `(row: any)` em mapeamentos, `err: any` em catch). Zero regra nova violada; um `eslint-disable` inútil que eu havia introduzido foi removido.

### 10.2 SQL desta fase — **PENDENTE, o Pedro executa** (medido em 10/08, read-only)

Hoje `lider_departamento` tem **apenas** `compras.requisicoes.access` e `compras.requisicoes.aprovar`. Falta o previsto na decisão C2:

```sql
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='lider_departamento'
  and p.codigo in ('compras.requisicoes.create','compras.requisicoes.reenviar_own')
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```
```sql
notify pgrst, 'reload schema';
```
Conferência (esperado: 4 linhas — `access`, `aprovar`, `create`, `reenviar_own`):
```sql
select p.codigo from hub_role_permissions rp
join hub_roles r on r.id=rp.role_id
join hub_permissions p on p.id=rp.permission_id
where r.codigo='lider_departamento' order by p.codigo;
```

**Consequência de não rodar:** hoje o único líder é o Pedro, que é `is_admin` e tem bypass — o defeito fica **invisível** até existir um líder sem a flag. É exatamente a armadilha registrada no CLAUDE.md.

### 10.3 Retorno de RPC → mensagem na tela (gate §6.3)

`aprovar_requisicao` / `rejeitar_requisicao` (via `traduzirDecisao`):

| Retorno | Mensagem | Efeito na tela |
|---|---|---|
| `OK` | (aprovar) "Aprovada ✓" → "Enviando ao ERP…" · (rejeitar) "Requisição rejeitada — o requisitante verá o motivo. Ela não vai ao ERP." | segue para o envio / fecha o modal |
| `STATUS_INVALIDO:<x>` | "Esta requisição já foi decidida por outra pessoa (status atual: `<x>`). A fila foi recarregada." | **recarrega** fila + badge; não trava |
| `SEM_PERMISSAO` | "Você não tem permissão para aprovar ou rejeitar requisições." | toast destrutivo |
| `FORA_DO_SEU_CC` | "Esta requisição pertence a um centro de custo que você não lidera." | toast destrutivo |
| `NAO_ENCONTRADA` | "Requisição não encontrada — ela pode ter sido excluída." | recarrega fila + badge |
| `MOTIVO_OBRIGATORIO` | "Informe o motivo da rejeição (mínimo de 5 caracteres)." | toast destrutivo (a UI já barra antes) |
| qualquer outro | "Retorno inesperado ao aprovar/rejeitar a requisição: `"<x>"`." | toast destrutivo — **nunca silencioso** |
| erro de transporte | "Falha ao aprovar/rejeitar: `<mensagem>`" | toast destrutivo |

Envio pós-aprovação (2º tempo, via `reenviarRequisicaoAprovada` → R4): sucesso → "Sincronizada (nº X)"; falha → "Aprovada, mas o envio ao ERP falhou … a aprovação foi preservada. Use *Reenviar*". Os retornos de `submeter_requisicao` continuam traduzidos por `mensagemRecusaSubmissao` (Fase 2).

### 10.4 Filtros de status por NEGAÇÃO — varredura e correção

Grep: `.neq(` · `.not(` · `NOT IN` · `!== '<status>'` em `src/` e `supabase/functions/`.

| Arquivo:linha (HEAD) | Expressão | Veredito |
|---|---|---|
| `src/lib/statusRequisicao.ts:21` | `numero_pedido_compra_alvo && status !== "cancelada"` | ✅ **corrigido** → `STATUS_QUE_ACEITAM_PEDIDO` (`sincronizada`, `convertida_pedido`) |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx:219` | open-load: `status !== "rascunho" && status !== "pendente_envio"` | ✅ **corrigido** → `STATUS_QUE_EXISTEM_NO_ERP` (`sincronizada`, `cancelada`, `convertida_pedido`) |
| `src/services/requisicoesService.ts:870` | `status !== "rascunho" && status !== "pendente_envio"` (guarda do reenvio) | ✅ **corrigido** → `STATUS_REENVIAVEIS_LEGADO`. Já era seguro (recusa por omissão), virou lista positiva explícita |
| `src/services/requisicoesService.ts:823` | `status !== "aprovada"` (guarda de `reenviarRequisicaoAprovada`) | ➖ **é positiva** — exige um único status; negá-la seria o inseguro |
| `src/services/pedidosService.ts:1975` | `req.status !== "sincronizada"` (`clonarDeRequisicao` → pedido) | ➖ **é positiva** — trava dura, pendente/rejeitada nunca vira pedido |
| `src/pages/SuprimentosRequisicoes.tsx:176` | `.not("numero_pedido_compra_alvo","is",null)` | ➖ não é status (filtro "já virou pedido") |
| `sync-compras-status-cron:716` | `.not("numero_alvo","is",null)` | ➖ não é status; é a guarda que mantém os estados novos fora do Job 1 |
| `sync-compras-status-cron:1334` | `.not("status","in",…)` | ➖ **status de PEDIDO no Alvo**, outro vocabulário — fora desta missão |
| demais `.neq/.not` (RM, laudos, e-mail NF-e, cartão, entidades…) | — | ➖ outros módulos |

**Remanescente conhecido, fora do alcance do código:** a RPC de relatório `suprimentos_requisicoes_para` (gate `view_all`) **não filtra status** — passará a contar `pendente_aprovacao`/`rejeitada` nos KPIs. Está no banco, não no repo: correção exige DDL (decisão do Pedro, não entrou nesta fase).

### 10.5 Mapa de rotas ao ERP — refeito (gate §6.5)

Grep: `req-comp/insert` · `req-comp/update` · `req-comp/list` · `/req-comp/${` · `callGatewayReqComp(`.

| # | Caminho | Onde | Rota | Gate |
|---|---|---|---|---|
| 1 | Wizard "Enviar" (inclusive vindo de **Clonar**) | `Nova.tsx` → `submeterRequisicao` → `rotearSubmissao` | `POST /req-comp/insert(-multipart)` (`:594/:596`) | ✅ |
| 2 | Reenviar em req `rascunho` | `reenviarRequisicao` → `rotearSubmissao` | idem | ✅ |
| 3 | Reenviar em `pendente_envio` | corpo legado (`:986/:988`) | idem | ➖ já roteada como `SEM_GATE` |
| 4 | **APROVAR na fila / no detalhe** e Reenviar pós-aprovação | `reenviarRequisicaoAprovada` → `enviarRequisicaoAlvo('rpc')` | idem (`:594/:596`) | ➖ **passou pelo gate**: só chega aqui req `aprovada`, e a RPC R2 validou permissão + CC |
| 5 | Sincronizar status | `requisicoesService:1498` | `GET /req-comp/{filial}/{nº}` | ➖ leitura |
| 6 | Cron e "Rodar Agora" | `sync-compras-status-cron:448,:739` | `GET /req-comp/list`, `/{…}` | ➖ leitura |
| 7 | Baixa ao virar pedido | `pedidosService:374/:403` | `POST /req-comp/update` | ➖ req já existe no ERP |

**A Fase 3 não criou nenhuma rota nova ao ERP.** A fila decide por RPC (`aprovar_requisicao`/`rejeitar_requisicao`, que nunca falam com o ERP) e o envio reusa o caminho #4, já existente. **Clonar não envia nada**: só pré-preenche o wizard, que continua entrando pelo #1. O mapa do Ajuste 1.2 §6 segue válido.

### 10.6 O que contradisse a espec

1. **A validação "sem itens" já existia no wizard** (`Nova.tsx:344`, "Adicione ao menos um item") — a espec do §5.2 mandava criá-la lá. O buraco real era outro: o **reenvio de rascunho** (aberto pelo Ajuste 1.2) chama `rotearSubmissao` sem passar pelo wizard. A validação foi para `rotearSubmissao`, que cobre os dois caminhos; a do wizard fica como feedback antecipado.
2. **Rota `/suprimentos/aprovacoes`, não `/suprimentos/requisicoes/aprovacoes`** (o guia §7.2 sugeria a segunda, como exemplo). Como irmã de `/suprimentos/requisicoes/:id`, ela dependeria do ranking do React Router para não ser lida como um `id` — dependência desnecessária.
3. **"Valor se disponível" na fila não foi implementado**: requisição de compra **não tem valor** no Hub nem no ERP (preço só existe no pedido). A coluna seria sempre vazia.
4. **`STATUS_CONFIG` morto removido** de `SuprimentosRequisicoes.tsx`. A espec mandava atualizar o vocabulário "onde mais existir"; esse mapa não tinha nenhum uso — atualizá-lo perpetuaria um segundo vocabulário fadado a divergir.
5. **`src/lib/statusConfig.ts` continua órfão** (arquivo inteiro sem nenhum import, com um `getStatusRequisicao` concorrente). **Não foi tocado** — remover arquivo inteiro passa do escopo. Fica registrado como candidato a limpeza.
6. **Clonar não grava rascunho no banco**: abre o wizard pré-preenchido (`?clonarDe=`) e o rascunho nasce na submissão, já como requisição do usuário atual. Gravar antes exigiria o wizard saber **editar** requisição existente — funcionalidade que não está nesta fase (o botão "Editar" segue `disabled`). O efeito visível ao usuário é o mesmo e nada de lixo é criado se ele desistir.
7. **Reenvio pós-aprovação no detalhe usa `reenviarRequisicaoAprovada` também para o PRIMEIRO envio** (logo após aprovar). O nome diz "reenviar", mas é o mesmo caminho correto (valida `aprovada` + desfecho só pela R4); duplicar a função só pelo nome seria pior.

---

## 11. AJUSTE 1.3 — motivos estruturados de rejeição (10/08/2026, PROMPT 1.3)

### 11.0 🔴 LIÇÃO DA VALIDAÇÃO — `status text` **com CHECK** se comporta como enum

A Fase 5 (Hugo, 10/08) quebrou ao gravar `pendente_aprovacao`: a coluna `compras_requisicoes.status`
é `text`, mas tem uma **CHECK constraint** que o Discovery **não mediu** — ele mediu o *tipo*
(`information_schema.columns` → `text` ✅) e concluiu "sem `ALTER TYPE`, sem enum". A constraint
listava só os 6 status antigos, então os 3 estados novos eram recusados **pelo banco**, não pelo tipo.

> **Regra para toda missão futura:** ao introduzir valor novo em coluna de status, perguntar
> **"existe CHECK nessa coluna?"** — `select pg_get_constraintdef(oid) from pg_constraint where
> conrelid='<tabela>'::regclass and contype='c';`. Tipo `text` **não** significa domínio livre.

Corrigida pelo Pedro em produção. Estado atual, medido em 10/08 — **9 valores**:
`rascunho`, `pendente_envio`, `erro_envio`, `sincronizada`, `cancelada`, `convertida_pedido`,
`pendente_aprovacao`, `aprovada`, `rejeitada`.
ℹ️ `erro_envio` está na constraint mas **nenhum código o grava** — é valor órfão, não usado pelo módulo.

### 11.1 Arquivos alterados (3 modificados + 2 novos)

| Arquivo | Mudança |
|---|---|
| **`SQL-AJUSTE13.md`** 🆕 | 12 blocos na ordem de execução (um statement por bloco) + 5 conferências + rollback. **PENDENTE — o Pedro executa.** Todo `CREATE FUNCTION` com tag nomeada (`$trg$`, `$r3$`, `$r1$`) |
| **`src/components/compras/ModalRejeicaoRequisicao.tsx`** 🆕 | Modal único de rejeição: dropdown do catálogo (ordenado, só ativos), observação opcional/obrigatória conforme `exige_observacao`, contador visível, botão travado enquanto a seleção for inválida. **Antes eram duas cópias** do mesmo diálogo (fila e detalhe) — divergiriam na primeira mudança de regra |
| `src/services/requisicoesService.ts` | `listarMotivosRejeicao()`; `rejeitarRequisicao(id, motivoCodigo, observacao)` com a assinatura nova; `traduzirDecisao` passa a cobrir `MOTIVO_INVALIDO` e `OBSERVACAO_OBRIGATORIA` |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx` | Usa o modal compartilhado; card de rejeição mostra **rótulo do motivo** em destaque + observação; card de erro de envio agora só aparece nos status em que o erro é atual (`STATUS_QUE_MOSTRAM_ERRO_DE_ENVIO`) |
| `src/pages/SuprimentosAprovacoes.tsx` | Usa o modal compartilhado (removidos `Dialog`/`Textarea` locais e o estado `motivo`) |

**Gate de saída:** `bun run build` ✅ · `tsc --noEmit -p tsconfig.app.json` exit 0 ✅ · ESLint: service **+1**
(o `(supabase as any)` da leitura do catálogo — `types.ts` não pode ser tocado), detalhe e fila **0**,
componente novo **limpo (0)**. Nenhuma rota nova ao ERP (§11.4).

### 11.2 O que muda nas 3 funções do banco

| Função | Mudança | Preservado |
|---|---|---|
| `fn_req_protege_aprovacao()` (trigger) | +2 linhas: `motivo_rejeicao_codigo is not null` (INSERT) e `is distinct from` (UPDATE). Sem isso a coluna nova ficaria gravável por API direta | Todo o resto: `SECURITY INVOKER` de propósito, **sem** `set search_path` (a função não referencia tabela), mesmas exceções, mesmos ramos |
| `rejeitar_requisicao` | Assinatura **`(uuid, text, text)`** — a antiga `(uuid, text)` é **dropada** (não deixar caminho que pule o catálogo). Valida o código contra `compras_motivos_rejeicao` (`MOTIVO_INVALIDO`) e a observação quando `exige_observacao` (`OBSERVACAO_OBRIGATORIA`). Grava `motivo_rejeicao_codigo` + observação em `motivo_rejeicao`. Evento `rejeitada_lider` leva `motivo_codigo`, `motivo_rotulo` e `observacao` | Todos os gates: `auth.uid() is null`, `user_has_permission`, `FOR UPDATE`, `status='pendente_aprovacao'`, `is_admin`/escopo por CC. `SECURITY DEFINER` + `search_path` redeclarados |
| `submeter_requisicao` | `erro_ultimo_envio = null` nos três desfechos de sucesso | Toda a lógica de roteamento, gates e eventos |

⚠️ **Ordem dos gates alterada de propósito em `rejeitar_requisicao`:** a checagem de permissão passou
para **antes** da validação do motivo. Na versão antiga, `MOTIVO_OBRIGATORIO` vinha antes de
`user_has_permission` — quem não pode aprovar descobriria o formato do catálogo pelos erros.

### 11.3 Retornos novos → mensagem na tela

| Retorno | Mensagem |
|---|---|
| `MOTIVO_INVALIDO` | "Motivo de rejeição inválido ou desativado. Recarregue a página e escolha um motivo da lista." |
| `OBSERVACAO_OBRIGATORIA` | "O motivo escolhido exige observação (mínimo de 5 caracteres). Descreva o que precisa mudar." |
| `MOTIVO_OBRIGATORIO` | **mantido** no tradutor: é o retorno da assinatura ANTIGA. Se o SQL ainda não tiver sido executado, o erro aparece explicado em vez de virar "retorno inesperado" |

### 11.4 Mapa de rotas ao ERP

**Inalterado.** O Ajuste 1.3 não toca em nenhum caminho de envio: rejeição nunca fala com o ERP, e a
limpeza de `erro_ultimo_envio` acontece dentro da RPC de roteamento. O mapa do §10.5 segue válido.

### 11.5 Definições ANTES do Ajuste (rollback — medidas em 10/08/2026)

Estado exato em produção antes dos blocos do `SQL-AJUSTE13.md`, para restaurar se preciso (recolar
sempre com tag nomeada):

- **`fn_req_protege_aprovacao()`**: idêntica à do Bloco 7, **sem** as duas linhas marcadas `-- AJUSTE 1.3`.
- **`rejeitar_requisicao(p_req_id uuid, p_motivo text)`**: `security definer`, `search_path=public`;
  ordem `auth.uid() null` → `p_motivo` nulo ou `< 5` → `MOTIVO_OBRIGATORIO` → `user_has_permission` →
  `select … for update` → `status <> 'pendente_aprovacao'` → `is_admin`/CC → `update` gravando
  `motivo_rejeicao=trim(p_motivo)` → evento `rejeitada_lider` com `jsonb_build_object('motivo', …, 'cc', …)`.
- **`submeter_requisicao(p_req_id uuid)`**: idêntica à do Bloco 11, **sem** os três `erro_ultimo_envio=null`
  e **sem** o `update` no ramo `SEM_GATE` (esse ramo só gravava auditoria e retornava).

### 11.6 O que contradisse a espec

1. **O ramo `SEM_GATE` de `submeter_requisicao` não tinha `UPDATE` nenhum.** O §4.2 diz "nos três
   desfechos o UPDATE passa a incluir `erro_ultimo_envio = null`", supondo que os três já gravavam.
   Foi preciso **criar** um UPDATE nesse ramo. É seguro (a req está em `rascunho`, fora dos estados
   protegidos), mas é statement novo, não um campo a mais num existente.
2. **As funções em produção divergiam do AJUSTE-1.1 documentado.** Ambas ganharam um
   `if auth.uid() is null then return 'SEM_PERMISSAO'` no topo (e `rejeitar_requisicao` mudou a forma
   de ler `is_admin`) em algum momento entre a Fase 1 e hoje. Recriei a partir do
   **`pg_get_functiondef` real**, não do texto do Ajuste 1.1 — que teria revertido essas melhorias em
   silêncio.
3. **Modal extraído para componente compartilhado.** O §5.1 fala em "modal de rejeição" no singular,
   mas existiam **duas** cópias (fila do líder e detalhe). Aplicar a mudança em duas cópias
   perpetuaria a divergência; o escopo do prompt permite mexer na fila "além do modal" — foi
   exatamente o modal.
4. **Tooltip do badge `rejeitada` não mostra o rótulo do motivo.** `getStatusRequisicao` recebe só a
   linha da requisição, sem o catálogo; carregar o catálogo dentro de uma função de formatação pura
   seria pior. Com motivo estruturado e sem observação, o tooltip cai no texto genérico
   ("Rejeitada pelo líder…"). O rótulo aparece no card do detalhe, que é onde o §5.3 pede.
5. **Card de erro: lista positiva em vez de excluir só `pendente_aprovacao`.** O §5.4 pede "não
   exibir em `pendente_aprovacao`"; implementei enumerando onde **deve** aparecer (`rascunho`,
   `pendente_envio`, `aprovada`), o que também cobre `rejeitada`, `cancelada` e `convertida_pedido` —
   e segue a regra de listas positivas adotada na Fase 3.
