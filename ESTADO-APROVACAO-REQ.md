# ESTADO-APROVACAO-REQ.md — ponto de retomada da missão

> Missão: **Aprovação de Requisições pelo Líder de Departamento**.
> Documentos-mãe (imutáveis por convenção): `CLAUDE_APROVACAO_REQ.md` (guia v2) e `AJUSTE-1.1-APROVACAO-REQ.md` (manda em caso de conflito).
> Este arquivo é o **único mutável** da missão: guarda status e ponto de retomada. Atualizar ao fim de cada prompt.
> Última atualização: **10/08/2026** (PROMPT 1.2 — Ajuste 1.2 executado).

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
| **PROMPT 1.2** | Execução do Ajuste 1.2 (§3 e §4) — código + medição da permissão | ✅ concluído em 10/08/2026 · commit local · **SEM push** — conclusões no §9 |
| **PROMPT 3** | Fase 3 — UI (fila do líder, badges, rascunho, clonar, filtros) | ⏸️ **próximo** |
| PROMPT 4 / 5 | Validação 255 chars · piloto fim-a-fim | ⏸️ não iniciados |

**Publicação:** a Fase 2 está no `main` (preview do Lovable), mas **NÃO foi publicada**. Decisão do Pedro: **Publicar só quando a Fase 3 estiver junta** — o usuário não deve ver o gate pela metade (sem fila do líder e sem badges dos estados novos).

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

1. **Pedro revisa o diff do Ajuste 1.2** (§9) e dá o push. **Nenhuma correção de banco é necessária** — a medição do §9.3 mostrou o mapeamento da permissão correto.
2. **PROMPT 3** (Fase 3 — UI): fila do líder, badges dos estados novos, "Salvar rascunho", clonar, filtros.
3. **Publicar no Lovable** só com a Fase 3 junta.

O arquivo do PROMPT 3 será fornecido pelo Pedro na próxima sessão.

## 7. Pendências abertas

1. **DÍVIDA-RLS-COMPRAS-REQ** (Ajuste §6): RLS `ALL using(true)` continua aberta; o trigger protege só a superfície da aprovação. Missão própria, prioridade alta pós-piloto.
2. **DÍVIDA-REQ-PENDENTE-ENVIO-ORFA** (§4.1) e **DÍVIDA-REQ-UPSERT-SILENCIOSO** (§4.2) — formalizadas no Ajuste 1.2 §5, decisões B2/B3: **não entram em correção** nesta missão.
3. **Outro escritor ativo no repo (módulo OP).** Resolvido em 10/08: o `origin/main` já está em `919153f` (OP-2.7 e a Fase 4 do OP pushados). O commit do Ajuste 1.2 empilha em cima de `919153f` e leva **só** os arquivos desta missão.
4. **Cosmético (Fase 3):** `STATUS_MAP`/`statusRequisicao.ts` sem entrada para `pendente_aprovacao`/`aprovada`/`rejeitada`; eventos novos de auditoria sem ícone em `EVENTO_ICON`.
5. **Hook fora de ordem, pré-existente** (§9.4): `useHasPermission(COMPRAS_PEDIDOS_CREATE)` em `SuprimentosRequisicaoDetalhe.tsx:292` está **depois** de dois `return` condicionais. Não foi tocado (fora do escopo do Ajuste 1.2). Candidato à Fase 3, que já vai mexer nesse arquivo.

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
