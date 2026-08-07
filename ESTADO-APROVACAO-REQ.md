# ESTADO-APROVACAO-REQ.md — ponto de retomada da missão

> Missão: **Aprovação de Requisições pelo Líder de Departamento**.
> Documentos-mãe (imutáveis por convenção): `CLAUDE_APROVACAO_REQ.md` (guia v2) e `AJUSTE-1.1-APROVACAO-REQ.md` (manda em caso de conflito).
> Este arquivo é o **único mutável** da missão: guarda status e ponto de retomada. Atualizar ao fim de cada prompt.
> Última atualização: **07/08/2026** (PROMPT 2.2 — encerramento de sessão).

## 1. Onde estamos

| Prompt | Escopo | Status |
|---|---|---|
| **PROMPT 0** | Fase 0 — Discovery (read-only) | ✅ concluído → `DISCOVERY-APROVACAO-REQ.md` + `ADENDO-ERP-PROXY-REQCOMP.md` · commit `ad11808` |
| **AJUSTE 1.1** | Decisões A1–A7 + SQL definitivo da Fase 1 | ✅ recebido (autoria do Pedro), incorporado |
| **PROMPT 1** | Fase 1 — SQL pronto para o SQL Editor | ✅ gerado → `SQL-FASE1-APROVACAO.md` · commit `51117c7` |
| **FASE 1 — execução** | Pedro rodou os blocos + gate no SQL Editor | ✅ **executada em 07/08/2026, gate verde** · commit `2ffcdb1` |
| **PROMPT 2** | Fase 2 — código: split do service, roteamento, envio pós-aprovação | ✅ concluído · commit `c32c69b` · **pushado** (`2ffcdb1..c32c69b`) |
| **PROMPT 2.1** | Investigação: `pendente_envio` + brecha do reenvio de rascunho | ✅ concluída (read-only) — conclusões no §4 |
| **AJUSTE 1.2** | Reenvio de rascunho roteado + gate de permissão no botão + dívidas | ⏳ **próximo** — arquivo virá do Pedro |
| **PROMPT 3** | Fase 3 — UI (fila do líder, badges, rascunho, clonar, filtros) | ⏸️ depois do Ajuste 1.2 |
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

1. **Ajuste 1.2** (arquivo do Pedro): roteamento do reenvio de rascunho por `submeter_requisicao` + gate de permissão no botão Reenviar + as dívidas de §4.1 e §4.2 registradas formalmente.
2. **PROMPT 3** (Fase 3 — UI): fila do líder, badges dos estados novos, "Salvar rascunho", clonar, filtros.
3. **Publicar no Lovable** só com a Fase 3 junta.

Os dois arquivos (Ajuste 1.2 e PROMPT 3) serão fornecidos pelo Pedro na próxima sessão.

## 7. Pendências abertas

1. **DÍVIDA-RLS-COMPRAS-REQ** (Ajuste §6): RLS `ALL using(true)` continua aberta; o trigger protege só a superfície da aprovação. Missão própria, prioridade alta pós-piloto.
2. **Dívida `pendente_envio`** (§4.1) e **dívida do upsert sem checagem** (§4.2).
3. **Outro escritor ativo no repo (módulo OP).** O commit `98f3bc7 feat(op): OP-2.7 — criação de RM no Alvo` está no HEAD local e **ainda não no `origin/main`** — ele foi feito depois do push da Fase 2. O commit deste arquivo empilha em cima dele: **ao empurrar, o OP-2.7 vai junto**. Conferir com o dono do módulo OP antes do push.
4. **Cosmético (Fase 3):** `STATUS_MAP`/`statusRequisicao.ts` sem entrada para `pendente_aprovacao`/`aprovada`/`rejeitada`; eventos novos de auditoria sem ícone em `EVENTO_ICON`.

## 8. O que a Fase 3 vai encontrar

- Toda requisição nova nasce `rascunho` e só sai desse estado pela RPC — "Salvar rascunho" é apenas **não chamar** `submeterRequisicao` depois de `criarRequisicao`.
- A listagem não filtra status por padrão: `pendente_aprovacao` e `rejeitada` **aparecerão** para quem tem `view_all` (decisão A4: badge, não esconder).
- `podeGerarPedido` (`status === 'sincronizada'`) e `clonarDeRequisicao` (`pedidosService.ts:1957`) já barram pendente/rejeitada — travas positivas.
- O botão Reenviar já cobre o pós-aprovação; a fila do líder pode reusar `reenviarRequisicaoAprovada` sem código novo de envio.
