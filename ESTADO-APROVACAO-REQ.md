# ESTADO-APROVACAO-REQ.md — ponto de retomada da missão

> Missão: **Aprovação de Requisições pelo Líder de Departamento**.
> Documentos-mãe (imutáveis por convenção): `CLAUDE_APROVACAO_REQ.md` (guia v2) e `AJUSTE-1.1-APROVACAO-REQ.md` (manda em caso de conflito).
> Este arquivo é o **único mutável** da missão: guarda status e ponto de retomada. Atualizar ao fim de cada prompt.
> Última atualização: **11/08/2026** (PROMPT 6.2 — atribuição em massa no Mapa de Líderes por CC; só frontend, nenhum SQL).

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
| **PROMPT 1.3** | Execução do Ajuste 1.3 — SQL + frontend | ✅ concluído em 10/08/2026 · commit `ee28acc` · **pushado, NÃO publicado** — conclusões no §11 |
| **PROMPT 1.3-EXEC** | Execução dos 12 blocos do `SQL-AJUSTE13.md` no banco | ✅ **executado em 10/08/2026** — 12/12 blocos verificados; 1 divergência no gate (`anon`, §11.7) — conclusões no §11.7 |
| **PROMPT 6.0** | Fase 6.0 — Discovery do Mapa de Líderes por CC (read-only) | ✅ concluído em 10/08/2026 → `DISCOVERY-FASE6.md` · commit `8134797` |
| **AJUSTE 6.1** | Decisões P1–P5 + SQL e espec de tela da Fase 6 | ✅ recebido (autoria do Pedro), incorporado |
| **PROMPT 6.1** | Fase 6.1 — SQL (`SQL-FASE61.md`) + tela do mapa | ✅ concluído em 10/08/2026 · commit `57d387a` — conclusões no §12 |
| **PROMPT 6.1-EXEC** | Execução dos 15 blocos do `SQL-FASE61.md` no banco | ✅ **executado em 10/08/2026** — 15/15 blocos verificados, **G1–G5 todos verdes** — conclusões no §12.7 |
| **AJUSTE 6.2** | Atribuição em massa (decisões H1–H4) | ✅ recebido (autoria do Pedro), incorporado |
| **PROMPT 6.2** | Seleção múltipla + atribuição em massa na tela do mapa | ✅ concluído em 11/08/2026 · **só frontend, zero SQL** — conclusões no §13 |
| PROMPT 4 | Validação 255 chars na digitação | ⏸️ não iniciado |

**Publicação (medido no git em 10/08/2026):** Fases 2, 1.2 e 3 estão publicadas. O **Ajuste 1.3
(`ee28acc`) está em `origin/main` mas NÃO publicado** — e o SQL dele **já rodou** (§11.7). 🔴 Enquanto
não publicar, a tela no ar chama `rejeitar_requisicao(uuid, text)`, que foi dropada: **rejeitar falha
para o usuário**. Aprovar, criar, submeter e reenviar não são afetados. Publicar é decisão do Pedro.

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

1. ~~**Executar o `SQL-AJUSTE13.md`**~~ ✅ **executado em 10/08/2026** (PROMPT 1.3-EXEC, §11.7). 🔴 **A tela PUBLICADA hoje ainda chama a assinatura ANTIGA `(uuid, text)`, que foi dropada — rejeitar pela tela publicada falha até o Publicar.** A janela é conhecida e foi decisão explícita (SQL primeiro, publicar depois); fechar rápido. Aprovar, criar, submeter e reenviar seguem normais — só a rejeição está nessa janela.
2. ~~**Pedro revisa o diff do Ajuste 1.3** (§11) e dá o push.~~ ✅ push feito (`ee28acc` em `origin/main`).
3. **Publicar no Lovable** — 🔴 **é o passo que fecha a janela de rejeição quebrada** descrita acima.
4. **Validação §8 do Ajuste 1.3** (6 passos: motivo sem observação, "Outros" sem/com observação, rejeição antiga do Hugo legível, sem erro residual, agregação por motivo).
5. **Conferir o SQL do §10.2** (`lider_departamento` + `create`/`reenviar_own`) — se ainda não foi rodado, continua pendente.
6. ~~**Executar o `SQL-FASE61.md`**~~ ✅ **executado em 10/08/2026** (PROMPT 6.1-EXEC, §12.7) — as 3
   RPCs existem, com `anon` fechado. 🔴 **A tela `/settings/lideres-cc` está no repo mas NÃO
   publicada** (commit `57d387a` sequer foi pushado): o banco está pronto e a tela ainda não está no
   ar. Ordem inversa da janela do Ajuste 1.3 — e sem risco, porque nenhuma tela publicada chama
   essas 3 RPCs. **A primeira chamada real de `listar_mapa_lideres` ainda não aconteceu** (§12.7-C).
7. 🔴 **Revisar, pushar e publicar o AJUSTE 6.2** (§13) — a atribuição em massa está no repo,
   **sem push**. Nada no banco mudou, então a tela publicada hoje segue funcionando: a massa
   simplesmente ainda não existe para o usuário.
8. **Fase 4** — validação de 255 chars por item na digitação (prompt próprio).

## 7. Pendências abertas

1. **DÍVIDA-RLS-COMPRAS-REQ** (Ajuste §6): RLS `ALL using(true)` continua aberta; o trigger protege só a superfície da aprovação. Missão própria, prioridade alta pós-piloto.
2. **DÍVIDA-REQ-PENDENTE-ENVIO-ORFA** (§4.1) e **DÍVIDA-REQ-UPSERT-SILENCIOSO** (§4.2) — formalizadas no Ajuste 1.2 §5, decisões B2/B3: **não entram em correção** nesta missão.
3. **Outro escritor ativo no repo (módulo OP).** Resolvido em 10/08: o `origin/main` já está em `919153f` (OP-2.7 e a Fase 4 do OP pushados). O commit do Ajuste 1.2 empilha em cima de `919153f` e leva **só** os arquivos desta missão.
4. ~~**Cosmético (Fase 3):** `STATUS_MAP`/`statusRequisicao.ts` sem os estados novos; eventos sem ícone.~~ ✅ **fechado na Fase 3** (§10.1).
5. ~~**Hook fora de ordem, pré-existente**~~ ✅ **fechado na Fase 3** (C5.1): os 3 `useHasPermission` do detalhe estão no topo do componente.
6. **`src/lib/statusConfig.ts` órfão** — arquivo inteiro sem nenhum import, com um `getStatusRequisicao` concorrente ao de `statusRequisicao.ts`. Não tocado (§10.6-5). Prioridade: baixa, mas é armadilha para quem for mexer em status.
7. **`suprimentos_requisicoes_para` não filtra status** (§10.4): a RPC de relatório passará a contar `pendente_aprovacao`/`rejeitada` nos KPIs. Correção é DDL — decisão do Pedro.
8. **DÍVIDA-RLS-COST-CENTERS** (Ajuste 6.1 §6): `cost_centers` tem policy `ALL using(true)` para `authenticated` — qualquer logado pode INSERT/UPDATE/**DELETE**, e `settings/CostCenters.tsx:305` expõe `.delete()` físico. Sem FK para `compras_lideres_cc`, apagar um CC deixa o mapeamento órfão. **Mitigado só na visualização** (linha `orfao` do mapa). Prioridade alta, junto com a DÍVIDA-RLS-COMPRAS-REQ.
9. **DÍVIDA-SYNC-CC-FORA-DO-GATEWAY** (Ajuste 6.1 §6): o sync de CCs chama o Alvo **direto do navegador** (`CostCenters.tsx:72,148`), contra a regra do CLAUDE.md, e rodou **uma única vez** (30/07/2026 — os 182 registros têm `updated_at` idêntico ao milissegundo), o que sugere botão quebrado. Missão própria: levar ao gateway + cron. A tela do mapa **mostra a data do espelho** para o risco ficar visível.
10. 🔴 **`rejeitar_requisicao` continua executável por `anon`** — mesmo com o `revoke … from anon` do Bloco 10 tendo funcionado. Falta um `revoke … from public` (SQL **fora** dos 12 blocos; não executado). Detalhe e medição no §11.7-B. Sem risco de efeito (o gate `auth.uid() is null → SEM_PERMISSAO` é a 1ª linha da função) e **sem regressão** — a função nova está mais fechada que as 4 irmãs em produção. Decisão do Pedro.
    ✅ **Hipótese do §11.7-B confirmada por experimento na Fase 6.1** (§12.7-B): com os **dois** revokes (`from anon` + `from public`), `has_function_privilege('anon', …)` vai a **`false`**. As 3 RPCs desta fase são as primeiras do projeto de fato fechadas para `anon`. O passivo (`rejeitar_requisicao` + as 4 irmãs + as ~196 funções do CLAUDE.md) **continua aberto** — a receita agora está provada, falta decidir aplicá-la.

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

### 11.7 EXECUÇÃO do `SQL-AJUSTE13.md` no banco (10/08/2026, PROMPT 1.3-EXEC)

Executado pelo agente via **MCP do Supabase com escrita temporária**, autorizada pelo Pedro para esta
sessão (o padrão é `read_only=true`). Os 12 blocos rodaram **verbatim, um por chamada, na ordem**, cada
um seguido de consulta de verificação — o modo de falha conhecido deste ambiente é "sucesso na tela,
efeito ausente ou corpo corrompido", que só se detecta lendo o objeto depois.

**Pré-voo:** `db=postgres`, `compras_pedidos = 1820` (fingerprint do projeto `hbtggrbauguukewiknew`),
`compras_requisicoes = 308`, `rejeitadas = 1`, `compras_motivos_rejeicao = null`. **Zero** transações
com `xact_start` > 2 min. Antes do Bloco 7, o `pg_get_functiondef` literal das 3 funções foi capturado
para rollback — **conferiu exatamente com o §11.5**, que estava correto.

#### A. Blocos — o que executou × o que a verificação confirmou

| # | Bloco | Verificação independente |
|---|---|---|
| 1 | `create table compras_motivos_rejeicao` | `to_regclass` não-nulo; **7 colunas** com os tipos exatos |
| 2 | `enable row level security` | `pg_class.relrowsecurity = true` |
| 3 | `create policy motivos_rejeicao_select` | `pg_policy`: cmd `r` (SELECT), role `authenticated`, `using = true` |
| 4 | seed dos 10 motivos | 10 linhas, ordem 10…100, `outros` com `exige_observacao=true`, **acentuação íntegra** |
| 5 | `add column motivo_rejeicao_codigo` | `information_schema`: as 2 colunas `text`, nuláveis |
| 6 | `notify pgrst` | sem objeto a consultar (sinal assíncrono); efeito real provado no Bloco 12 + C1/C3 |
| 7 | `fn_req_protege_aprovacao()` | **as 2 linhas novas presentes** (ramo INSERT e ramo UPDATE); `prosecdef=false` (INVOKER preservado), `proconfig=null` (sem `search_path`); `trg_req_protege_aprovacao@compras_requisicoes` continua apontando para a função |
| 8 | `drop function rejeitar_requisicao(uuid,text)` | **zero** assinaturas de `rejeitar_requisicao` no catálogo |
| 9 | `create rejeitar_requisicao(uuid,text,text)` | assinatura exata; `SECURITY DEFINER`; `search_path=public`; todos os gates presentes no corpo (`user_has_permission`, `for update`, `FORA_DO_SEU_CC`, `MOTIVO_INVALIDO`, `OBSERVACAO_OBRIGATORIA`) e o `motivo_rejeicao_codigo=v_motivo.codigo` no UPDATE |
| 10 | `grant … to authenticated` + `revoke … from anon` | `authenticated` ✅; **`anon` removido do ACL nominal**, mas ainda executa por PUBLIC — ver **B** |
| 11 | `submeter_requisicao(uuid)` | **3 ocorrências** de `erro_ultimo_envio` (os três desfechos) + o `UPDATE` **novo** do ramo `SEM_GATE`; `SECURITY DEFINER` e `search_path` redeclarados; ACL preservado |
| 12 | `notify pgrst` | idem Bloco 6 |

**Nenhum bloco deu erro. Nenhum SQL fora dos 12 blocos foi executado** (o rollback do arquivo não foi
tocado). O único DDL destrutivo foi o `drop function` do Bloco 8, previsto no arquivo.

#### B. 🔴 ACHADO — o gate C1 saiu VERMELHO em `anon_pode`, e a regra do CLAUDE.md está incompleta

`has_function_privilege('anon', …) = true` na função nova, apesar de o revoke do Bloco 10 ter
funcionado. A causa foi medida, comparando o ACL da nova com o das 4 irmãs do módulo:

| Função | `proacl` | `anon` executa? |
|---|---|---|
| `rejeitar_requisicao(uuid,text,text)` **nova** | `{=X/postgres, postgres=X, authenticated=X, service_role=X}` | true |
| `aprovar_requisicao`, `submeter_requisicao`, `registrar_envio_requisicao`, `_req_evento` | `{=X/postgres, postgres=X, **anon=X**, authenticated=X, service_role=X}` | true |

O `anon=X/postgres` **sumiu** da função nova (o revoke pegou; as irmãs ainda o têm). O que sobrou é a
entrada **`=X/postgres`** — grantee vazio = **PUBLIC**, o default **nativo do PostgreSQL**: todo
`CREATE FUNCTION` concede EXECUTE a PUBLIC, independentemente do Supabase. Como `anon` é membro de
PUBLIC, herda o EXECUTE.

> **Correção da regra do `CLAUDE.md`:** o arquivo afirma que `revoke … from public` "NÃO tranca RPC
> nova — use `revoke … from anon`". A medição de hoje mostra que **são precisos os DOIS**: `from anon`
> tira o grant nominal do default privilege do Supabase, `from public` tira o default nativo do
> Postgres. **Nenhum dos dois sozinho tranca.** O `SQL-AJUSTE13.md` tem só o primeiro — por isso o
> gate C1 não fecha como escrito.

**Não corrigido de propósito:** o `revoke execute on function public.rejeitar_requisicao(uuid,text,text)
from public;` é SQL **fora** dos 12 blocos, e a regra da sessão proíbe inventar SQL. Fica como
pendência §7.8 para decisão do Pedro. **Não há risco de efeito** (a 1ª linha da função é
`if auth.uid() is null then return 'SEM_PERMISSAO'`) e **não há regressão** — a função nova está um
passo mais fechada que as irmãs que já estavam em produção. É o passivo de 196/284 funções já
registrado no CLAUDE.md, não algo criado aqui.

#### C. Conferências do gate de saída (§7 do arquivo)

| # | Esperado | Obtido | Veredito |
|---|---|---|---|
| **C1** | 1 linha · `(p_req_id uuid, p_motivo_codigo text, p_observacao text)` · definer `true` · authenticated `true` · **anon `false`** | 1 linha · assinatura exata · `true` · `true` · **anon `true`** | ⚠️ **4 de 5** — a crítica "a assinatura antiga não existe mais" passou (1 linha só); `anon` diverge pela causa do **B** |
| **C2** | `protege_coluna_nova = true` (e tag = 0) | `true` · `0` | ✅ **crítica passou** |
| **C3** | 10 motivos, `outros` exige observação, ordem 10…100 · 2 colunas `text` | idêntico | ✅ |
| **C4** | 1 linha, `motivo_rejeicao` preenchido, `motivo_rejeicao_codigo = null` | `6e2d2fe3…` · "Não está com Classe correta" · `null` · `2026-08-10 18:49:43+00` | ✅ retrocompatibilidade (G4) intacta |
| **C5** | `SEM_PERMISSAO` | `SEM_PERMISSAO` | ✅ função viva, gate de auth funcionando |

**As duas conferências críticas do prompt passaram:** `rejeitar_requisicao(uuid, text)` não existe mais
(C1, 1 linha só) e `motivo_rejeicao_codigo` aparece no `pg_get_functiondef` de
`fn_req_protege_aprovacao` (C2).

#### D. Checagem extra — contrato frontend × banco

Fora do arquivo, para evitar o "function not found in schema cache" clássico: os nomes dos parâmetros
que o service envia (`requisicoesService.ts:1256-1259` → `p_req_id`, `p_motivo_codigo`, `p_observacao`)
batem **exatamente** com a assinatura criada no Bloco 9, e `listarMotivosRejeicao` (`:1225-1230`) lê
`compras_motivos_rejeicao` pelas colunas `codigo, rotulo, exige_observacao, ordem` com `ativo=true` —
todas existentes, com a policy de SELECT para `authenticated` no lugar (Bloco 3).

#### E. Rollback disponível

O `pg_get_functiondef` literal das 3 funções **antes** do Ajuste ficou salvo no scratchpad da sessão
(`rollback-funcoes-pre-ajuste13.sql`, já com tags nomeadas `$trg$`/`$r3$`/`$r1$`) e confere com o
§11.5. Reverter `rejeitar_requisicao` para `(uuid, text)` exige reverter também o commit `ee28acc`
(frontend chama com 3 parâmetros).

---

## 12. FASE 6 — Mapa de Líderes por CC (10/08/2026, PROMPTs 6.0 e 6.1)

### 12.1 Discovery (PROMPT 6.0, commit `8134797`) — o que mudou de entendimento

Detalhe completo em `DISCOVERY-FASE6.md`. Os três achados que mandaram na fase:

1. **A tabela espelho de CCs é `public.cost_centers`** (182 linhas, chave `erp_code`), e a query do
   F-D1 da espec **era cega para ela** (nome em inglês): apontava `rh_centros_custo`, que é do módulo
   de RH, tem outra chave e cobre só 36 dos 43 CCs em uso. Caso do padrão LIVRO × ESPELHO.
2. **Renumeração do plano de CCs no Alvo em 17/05/2026:** o bloco `00001.*` inteiro (82 CCs) foi
   encerrado e substituído por `00007–00010`. 14 CCs com histórico de requisições são desses códigos
   mortos — se entrassem no mapa, apareceriam como "sem líder" para sempre.
3. **O formato do código não é fixo:** há CC ativo com 4 níveis (`00010.00002.00007.00001`) e com 6
   dígitos no último nível (`00008.00002.000012`). **Validar por existência, nunca por regex.**

### 12.2 Arquivos entregues (PROMPT 6.1)

| Arquivo | Mudança |
|---|---|
| **`SQL-FASE61.md`** 🆕 | 15 blocos (um statement cada) + pré-voo + 5 conferências (G1–G5) + rollback. Todo `CREATE FUNCTION` com **tag nomeada** (`$a1$`, `$r1$`, `$l1$`). **PENDENTE — o Pedro executa** |
| **`src/services/lideresCcService.ts`** 🆕 | `listarMapaLideres`, `listarUsuariosParaSelecao`, `obterDataEspelhoCcs`, `listarMapeamentosInativos`, `atribuirLiderCc`, `revogarLiderCc` + `traduzirRetorno` (nenhum retorno de RPC cai no vazio, incl. `OK:n`) |
| **`src/pages/settings/LideresCC.tsx`** 🆕 | Tela do mapa: cobertura X/81, data do espelho com destaque > 7 dias, tabela por CC com órfãos no topo, filtro "somente sem líder", histórico de revogados, dialog de atribuição com seletor de usuário, confirmação de remoção informando pendentes |
| `src/App.tsx` | Rota `/settings/lideres-cc` — **sem `PermissionRoute`**, gate interno `is_admin` (idêntico a `/settings/users`) |
| `src/components/AppSidebar.tsx` | Item "Líderes por CC" em Configurações, `adminOnly: true` |
| `src/contexts/LanguageContext.tsx` | Chave `settings.lideres_cc` (pt/en) |

**Não tocados:** banco (MCP read-only, provado), `cost_centers` e sua tela, crons/Edge Functions,
`types.ts`, RLS, as RPCs do fluxo de aprovação, `requisicoesService.ts`, arquivos do módulo OP.

**Gate de saída:** `bun run build` ✅ · `tsc --noEmit -p tsconfig.app.json` **exit 0** ✅ · ESLint:
os 3 arquivos editados **20 problemas antes e 20 depois** (zero regressão, medido com `git stash`);
service **+11** e página **+1**, todos `no-explicit-any` do padrão dominante (`(supabase as any)`
obrigatório porque `types.ts` não pode ser tocado, `err: any` em catch).

### 12.3 As 3 RPCs (contrato — o SQL está no `SQL-FASE61.md`)

| RPC | Assinatura | Retornos |
|---|---|---|
| `atribuir_lider_cc` | `(p_user_id uuid, p_cc text, p_motivo text default null) → text` | `OK` · `SEM_PERMISSAO` · `USUARIO_INVALIDO` · `CC_INVALIDO` · `PAPEL_INEXISTENTE` |
| `revogar_lider_cc` | `(p_user_id uuid, p_cc text) → text` | `OK:<n>` (n = pendentes no CC, informativo) · `SEM_PERMISSAO` · `NAO_ENCONTRADA` |
| `listar_mapa_lideres` | `() → TABLE(erp_code, nome, department_type, lideres jsonb, qtd_lideres, pendentes, total_reqs, orfao)` | 0 linhas sem permissão |

Gate das três: **`hub_caller_is_admin()`** (decisão P2), o mesmo helper das RPCs `hub_*`.

### 12.4 Contrato real das RPCs `hub_*` — lido do `pg_get_functiondef`, não da espec

| RPC | O que a leitura mostrou |
|---|---|
| `hub_caller_is_admin()` | `select coalesce(is_admin,false) from profiles where user_id=auth.uid()`. **Só a flag** — não olha papel nem permissão |
| `hub_list_users_with_roles()` | `RAISE EXCEPTION … 42501` se não for admin. Devolve `user_id, full_name, email, is_admin, is_active, must_change_password, funcionario_alvo_codigo, roles jsonb, created_at`; `roles` é `jsonb_agg` de `{codigo, nome, modulo, atribuido_em}` só dos **não revogados** |
| `hub_assign_role(uuid, text, text default null)` | Gate `hub_caller_is_admin()`. Valida o alvo em **`auth.users`** (não em `profiles`). **Atribuição composta:** `analista_compras` ⇒ também `requisitante`. Insere `(user_id, role_id, atribuido_por, motivo)` — **não passa `atribuido_em`** (default `now()`, NOT NULL). Motivo default `'Atribuído via UI de Gestão de Usuários'`. Se o papel é `admin`, sincroniza `profiles.is_admin=true`. Retorna **jsonb** |
| `hub_revoke_role(uuid, text, text default null)` | Gate idem. **Bloqueia auto-revogação de admin** e **bloqueia ficar sem nenhum admin ativo**. Revogação composta espelhando a atribuição. `update … set revogado_em=now(), revogado_por=caller, motivo=coalesce(p_motivo, motivo) where revogado_em is null`. Retorna **jsonb** |

**Consequências aplicadas ao SQL desta fase:**
- As RPCs novas **não chamam** `hub_assign_role`/`hub_revoke_role` — escrevem direto em
  `hub_user_roles` preenchendo **os mesmos campos**. Motivo: aquelas são compostas e sincronizam
  `profiles.is_admin`; `lider_departamento` não é composto nem é admin, e herdar esse comportamento
  seria efeito colateral silencioso.
- As RPCs `hub_*` sinalizam erro por **exceção**; as desta missão devolvem **código de retorno em
  texto**. Mantive o padrão da missão (§3.2 do Ajuste), traduzido em `lideresCcService`.

### 12.5 O que contradisse a espec

1. **`PAPEL_INEXISTENTE` é retorno novo, fora da lista do Ajuste §3.2.** Sem ele, se o papel
   `lider_departamento` sumisse do banco, `atribuir_lider_cc` gravaria o mapeamento e sairia `OK`
   **sem conceder o papel** — quebrando o F2 em silêncio. Nunca deve ocorrer (o papel existe:
   `4c647f92-…`, módulo `compras`).
2. **Ordem das validações invertida em relação ao texto do Ajuste:** o papel é resolvido **antes**
   do upsert do mapeamento. O §3.2 lista o papel no passo 5, depois do upsert (passo 4) — mas um
   `return` em plpgsql **não desfaz** um INSERT já executado, então validar depois de escrever
   deixaria a tabela inconsistente. Nenhuma escrita acontece antes de todas as validações.
3. **Os CTEs de `listar_mapa_lideres` usam aliases próprios** (`cc`, `cc_nome`, `cc_orfao`) em vez
   dos nomes de saída. Em `RETURNS TABLE` os nomes de saída viram variáveis plpgsql: reusar
   `erp_code`/`nome`/`orfao` daria `column reference is ambiguous` **em tempo de execução** — erro
   que passaria pelo `create` e só apareceria na primeira chamada real da tela.
4. **`revoke … from public` incluído** (blocos 6, 10, 14), além do `from anon` que o CLAUDE.md manda.
   O Ajuste §6 diz que as RPCs desta fase "nascem com o mesmo padrão" das irmãs — escrevi os dois
   revokes para não criar passivo novo sabendo, e marquei os 3 blocos como puláveis se o Pedro
   preferir uniformidade com as irmãs. Base: a medição do §11.7-B (nenhum dos dois revokes fecha
   sozinho).
5. **A rota nasceu sem `PermissionRoute`**, ao contrário de `/settings/cost-centers`. É o molde de
   `/settings/users`, que o Ajuste §4 manda seguir: gate no componente + `adminOnly` no menu. Não
   foi preciso mexer no `AppSidebar.tsx:350` porque `hasAccess` já tem bypass total para `is_admin`.
6. **Service novo (`lideresCcService.ts`) em vez de estender `requisicoesService.ts`.** O Ajuste não
   diz onde o acesso a dados deve morar e o molde (`Users.tsx`) chama `supabase.rpc` direto na
   página; o CLAUDE.md manda passar por `src/services/`. Segui o CLAUDE.md, em arquivo próprio para
   não inchar o service da missão de requisições com um assunto administrativo.

### 12.6 O que só é provável depois do SQL rodar

A tela **não foi exercida contra o banco** — as 3 RPCs ainda não existem. Build e tipos passam
porque o acesso é via `(supabase as any).rpc(...)`, que não é tipado (`types.ts` intocado). O gate
§5.2 do Ajuste (**testar com o Hugo, sem `is_admin`**) continua sendo o único jeito de provar que a
tela some para não-admin — o Pedro tem bypass e nunca veria o erro.

### 12.7 EXECUÇÃO do `SQL-FASE61.md` no banco (10/08/2026, PROMPT 6.1-EXEC)

Executado pelo agente via **MCP do Supabase com escrita temporária**, autorizada pelo Pedro para esta
sessão. Os 15 blocos rodaram **verbatim, um por chamada, na ordem** — incluindo os blocos 6, 10 e 14
(`revoke … from public`), que o arquivo marcava como puláveis. Cada bloco que cria ou altera objeto
foi seguido de **consulta de verificação independente**: o modo de falha deste ambiente é "sucesso na
tela, efeito ausente ou corpo corrompido", que só se detecta lendo o catálogo depois.

Ferramenta usada: `execute_sql`, **não** `apply_migration` — o CLAUDE.md registra que o histórico de
migrations diverge do banco, e `apply_migration` gravaria linha em `supabase_migrations`.

**Pré-voo:** zero transações com `xact_start` > 2 min · `db=postgres` · `compras_pedidos = 1820`
(fingerprint do projeto `hbtggrbauguukewiknew`) · `compras_requisicoes = 309` · `lideres_cc = 1` ·
`universo_cc = 81` · `pendentes = 0` — **idêntico ao esperado no arquivo**.

#### A. Blocos — o que executou × o que a verificação confirmou

| # | Bloco | Verificação independente |
|---|---|---|
| 1 | 5 colunas de auditoria em `compras_lideres_cc` | `information_schema`: **10 colunas**; as 5 novas com os tipos exatos (`uuid`/`timestamptz`/`text`) e **todas nuláveis** |
| 2 | Backfill da linha do piloto | **exatamente 1 linha** — `2ead8f87-…` · `00010.00002.00003` · `2026-08-07 19:49:19.440688+00` · `Seed piloto — Fase 1`, **acentuação íntegra** |
| 3 | `atribuir_lider_cc` (tag `$a1$`) | assinatura `p_user_id uuid, p_cc text, p_motivo text`; `prosecdef=true`; `proconfig={search_path=public}`; corpo real contém gate, `PAPEL_INEXISTENTE`, `on conflict (lider_user_id, codigo_centro_ctrl)`, escrita em `hub_user_roles` e validação de CC por **existência** (`group_type='F'`) |
| 4 | `grant … to authenticated` | `authenticated=X` no `proacl` |
| 5 | `revoke … from anon` | **`anon=X` sumiu** do ACL nominal — mas `anon_pode` ainda `true` (herança de PUBLIC) |
| 6 | `revoke … from public` | `=X/postgres` sumiu · **`anon_pode = false`** · `authenticated` e `service_role` preservados |
| 7 | `revogar_lider_cc` (tag `$r1$`) | assinatura `p_user_id uuid, p_cc text`; definer + `search_path`; corpo com gate, `NAO_ENCONTRADA`, retorno `OK:n`, revogação do papel e **nenhum `delete` físico** (soft-delete, F4) |
| 8 / 9 / 10 | grant · revoke `anon` · revoke `public` | mesma progressão do 4/5/6 — ACL final `{postgres, authenticated, service_role}`, **`anon_pode = false`** |
| 11 | `listar_mapa_lideres` (tag `$l1$`) | `pg_get_function_result`: `TABLE(erp_code text, nome text, department_type text, lideres jsonb, qtd_lideres integer, pendentes integer, total_reqs integer, orfao boolean)` — **8 colunas na ordem exata**; definer + `search_path`; gate e linha de órfãos presentes |
| 12 / 13 / 14 | grant · revoke `anon` · revoke `public` | idem — **`anon_pode = false`** |
| 15 | `notify pgrst, 'reload schema'` | sinal assíncrono, sem objeto a consultar; efeito real só se prova na 1ª chamada do frontend |

**Nenhum bloco deu erro. Nenhum SQL fora dos 15 blocos + consultas de verificação foi executado** — o
rollback do arquivo não foi tocado. **Zero DDL destrutivo nesta fase** (não há `drop`/`delete`).

#### B. ✅ A receita dos DOIS revokes está PROVADA

O experimento saiu limpo porque cada revoke foi medido isoladamente. ACL de `atribuir_lider_cc` ao
longo dos blocos 4 → 5 → 6:

| Depois do bloco | `proacl` | `anon` executa? |
|---|---|---|
| 4 (grant) | `{=X/postgres, postgres=X, **anon=X**, authenticated=X, service_role=X}` | `true` |
| 5 (`revoke from anon`) | `{**=X/postgres**, postgres=X, authenticated=X, service_role=X}` | `true` ⚠️ |
| 6 (`revoke from public`) | `{postgres=X, authenticated=X, service_role=X}` | **`false`** ✅ |

Confirma ponto a ponto a medição do §11.7-B: `from anon` tira o grant nominal do default privilege do
Supabase, `from public` tira o default nativo do Postgres, e **nenhum dos dois sozinho fecha**. As 3
RPCs desta fase são as **primeiras do projeto de fato fechadas para `anon`**.

> **A regra do `CLAUDE.md` (§Supabase) continua incompleta** — ela manda só `revoke … from anon`.
> Toda RPC nova precisa dos **dois**. Correção do arquivo: decisão do Pedro (é edição de doc-mãe).

#### C. 🔴 O que a G3 **não** prova — o corpo da consulta nunca rodou

`G3` devolve 0 linhas **porque o gate barrou na 1ª linha** — o `return query` com os CTEs de
`listar_mapa_lideres` **nunca chegou a executar**. É exatamente a armadilha do CLAUDE.md ("um caminho
feliz que nunca rodou não é caminho validado"): o erro `column reference is ambiguous` que o §12.5-3
antecipou é de **tempo de execução** e passaria por tudo o que foi medido aqui. **A primeira chamada
real é a do Pedro abrindo `/settings/lideres-cc` depois do Publicar.**

Mitigação parcial (leitura pura, fora da função, sem escrita): a mesma consulta rodada como SELECT
devolve **81 linhas · 0 órfãos · 1 CC com líder · 80 sem líder** — dados e forma conferem, e a
cobertura da tela deve abrir em **1 de 81**. Isso valida os dados, **não** a resolução de nomes do
plpgsql.

`max(cost_centers.updated_at) = 2026-07-30 19:54:09.977+00` → o espelho de CCs está com **11 dias**,
então a tela deve mostrar o destaque de "> 7 dias" já na primeira abertura (P3 funcionando).

#### D. Conferências do gate de saída (G1–G5)

| # | Esperado | Obtido | Veredito |
|---|---|---|---|
| **G1** | `5` · `0` · `1` | `5` · `0` · `1` | ✅ |
| **G2** | 3 linhas · definer `true` · `search_path=public` · authenticated `true` · **anon `false`** | idêntico nas 3, com as assinaturas exatas | ✅ **inclusive `anon = false`** — o que a C1 do Ajuste 1.3 não conseguiu |
| **G3** | `0` linhas | `0` | ✅ gate provado (mas ver **C**) |
| **G4** | `SEM_PERMISSAO` · `SEM_PERMISSAO` | idêntico | ✅ nada escrito (gate é a 1ª linha das duas) |
| **G5** | `309` · `0` · `1` · `81` | `309` · `0` · `1` · `81` | ✅ **idêntico ao pré-voo** — fluxo de aprovação intacto (P5) |

**5 de 5 verdes.** Diferença relevante em relação ao Ajuste 1.3, cujo gate saiu 4/5.

#### E. Rollback disponível

O §3 do `SQL-FASE61.md` (3 `drop function` + `notify`, e opcionalmente o `drop column`). **Não
executado.** Derrubar as RPCs sem reverter o commit `57d387a` deixaria `/settings/lideres-cc` com
`not found in schema cache` — visível e não destrutivo, e hoje nem isso, já que a tela não está
publicada. Nenhuma outra tela usa essas 3 funções.

---

## 13. AJUSTE 6.2 — atribuição em massa (11/08/2026, PROMPT 6.2)

Atribuir 78 CCs um a um era o gargalo. **Só frontend: nenhum SQL, nenhuma RPC nova, nenhuma
migration.** `atribuir_lider_cc` já é idempotente (upsert por `(lider_user_id, codigo_centro_ctrl)`)
e concede `lider_departamento` só se ainda não houver linha ativa — então N chamadas em laço deixam
**uma** linha de papel, não N. Foi o suficiente.

### 13.1 Arquivos alterados (2)

| Arquivo | Mudança |
|---|---|
| `src/services/lideresCcService.ts` | **`atribuirLideresEmMassa(userId, ccs, motivo, onProgresso)`** + tipos `ItemMassa`/`RelatorioMassa`. Laço **sequencial** (`for` + `await`), progresso por callback, `try/catch` por item — **uma falha nunca aborta o restante**; cada retorno entra no relatório com o código cru da RPC já traduzido |
| `src/pages/settings/LideresCC.tsx` | Coluna de checkbox + "todos os visíveis" tri-state · barra de ação sticky · diálogo de massa em 3 telas (formulário → progresso → relatório) · aviso de H1 também no diálogo **individual** · nota de H2 no cabeçalho da coluna Líder(es) e na linha com 2+ líderes |

**Não tocados:** banco (nenhuma escrita nesta sessão), as 3 RPCs, `types.ts`, RLS, crons,
`requisicoesService.ts`, a fila de aprovações, arquivos do módulo OP.

**Gate de saída:** `bun run build` ✅ · `tsc --noEmit -p tsconfig.app.json` **exit 0** ✅ · ESLint nos
2 arquivos **12 → 13** (o `+1` é o `catch (err: any)` do laço, padrão dominante do projeto; medido
com `git stash`). **Zero SQL executado** — conferido: nenhuma chamada de escrita ao MCP nesta sessão.

### 13.2 Filtro × seleção — a regra que resolve a ambiguidade

O conflito real: a seleção é **acumulada** (§3.1 manda preservar ao trocar de filtro), mas o
cabeçalho é **"todos os visíveis"**. Se os dois lessem o mesmo conjunto, ou o filtro apagaria
seleção, ou o cabeçalho marcaria a base inteira.

| Elemento | Lê qual conjunto |
|---|---|
| `selecionados` (estado) | acumulado, **sobrevive** a qualquer troca de filtro |
| Checkbox do cabeçalho (estado e ação) | **só `visiveisSelecionaveis`** = filtradas − órfãs. Marcar/desmarcar mexe só nesses; o que está fora do filtro não é tocado |
| Barra de ação e diálogo | o acumulado (`linhasSelecionadas`), que é o que de fato será atribuído |

Consequência que exigiu texto na tela: dá para ter 20 selecionados com 3 visíveis. A barra diz
**"N selecionados · M fora do filtro atual"** — sem isso, o usuário confirmaria 20 achando que são 3.
E o estado `indeterminate` mede **só o visível**: senão o cabeçalho ficaria eternamente parcial por
causa de linhas que ninguém está vendo.

`linhasSelecionadas` deriva de `linhas` (não de `selecionados` direto), então um CC que suma do mapa
num recarregamento não é contado nem enviado.

### 13.3 O que contradisse a espec

1. **"Já é líder — será ignorado" foi implementado como ignorar de verdade** (não entra no laço). O
   §3.3 diz "a RPC reativa sem efeito prático" — mas **tem** efeito: o `on conflict do update`
   sobrescreve `atribuido_por`, `atribuido_em` e `motivo` do vínculo existente. Chamar para quem já
   é líder **apagaria a trilha original** (inclusive trocando o motivo antigo por `null` quando o
   campo da massa vem vazio). Ignorar preserva a auditoria e é o que a própria UI promete.
2. **O mesmo caso foi fechado na atribuição individual**, que a espec não menciona: escolher alguém
   que já lidera aquele CC agora mostra "já lidera este centro de custo" e **desabilita** o botão.
   Antes, o clique sobrescrevia a trilha em silêncio — mesmo defeito do item 1, no caminho de um a um.
3. **Contador "ignorados" congelado no disparo.** Depois do laço a tela recarrega e todos os alvos
   passam a ter o líder — recalcular os grupos faria o relatório dizer que quase tudo foi ignorado.
   O número é fotografado antes de começar.
4. **Estilo do checkbox parcial ajustado no uso, não no componente.** O `ui/checkbox.tsx` desenha o
   mesmo ✓ para `checked` e `indeterminate` — "alguns" ficaria idêntico a "todos". Corrigido com
   `data-[state=indeterminate]` na instância; mexer no componente compartilhado afetaria outras telas
   (ele é usado em Reembolso NF, entre outras).
5. **H2 não gerou código, como o Ajuste previa** — mas gerou **duas** superfícies de texto, não uma:
   tooltip no cabeçalho da coluna e a linha "Qualquer um deles aprova sozinho" sob CCs com 2+
   líderes. A leitura errada ("aprovação conjunta") só aparece quando há mais de um nome à vista.
6. **Revogação em massa continua fora** (H4), inclusive na barra de seleção: selecionar não oferece
   nenhuma ação destrutiva.

### 13.4 O que só é provável rodando

A massa **não foi exercida** contra o banco — esta sessão não teve escrita. Falta, na validação §6
do Ajuste: atribuir a 3+ CCs e conferir `compras_lideres_cc`; confirmar que `hub_user_roles` ganhou
**uma** linha por líder e não uma por CC; e o caso de dois líderes no mesmo CC decidindo a mesma
requisição (o segundo deve receber `STATUS_INVALIDO` + recarga, comportamento já existente).
