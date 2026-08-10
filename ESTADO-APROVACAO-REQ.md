# ESTADO-APROVACAO-REQ.md — ponto de retomada da missão

> Missão: **Aprovação de Requisições pelo Líder de Departamento**.
> Documentos-mãe (imutáveis por convenção): `CLAUDE_APROVACAO_REQ.md` (guia v2) e `AJUSTE-1.1-APROVACAO-REQ.md` (manda em caso de conflito).
> Este arquivo é o **único mutável** da missão: guarda status e ponto de retomada. Atualizar ao fim de cada prompt.
> Última atualização: **10/08/2026** (PROMPT 3 — Fase 3 / UI executada).

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
| **PROMPT 3** | Fase 3 — UI (fila do líder, badges, clonar, correções C5) | ✅ concluído em 10/08/2026 · commit local · **SEM push** — conclusões no §10 |
| PROMPT 4 / 5 | Validação 255 chars · piloto fim-a-fim | ⏸️ não iniciados — a Fase 5 é o roteiro do `PROMPT-3-FASE3.md` §7 (cobaia: Hugo Maffei) |

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

1. **Pedro revisa o diff da Fase 3** (§10) e dá o push.
2. **Rodar o SQL do §10.2** no SQL Editor (`lider_departamento` + `create`/`reenviar_own`) — é pré-condição para qualquer líder sem `is_admin`.
3. **Publicar no Lovable** (Fases 2 + 1.2 + 3).
4. **Fase 5 — validação fim-a-fim** com o Hugo Maffei, roteiro do `PROMPT-3-FASE3.md` §7 (11 passos). Avisar que é teste, principalmente na rejeição.
5. **Fase 4** — validação de 255 chars por item na digitação (prompt próprio).

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
