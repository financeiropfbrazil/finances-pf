# AJUSTE 1.2 — Missão Aprovação de Requisições
## Fecha a brecha do reenvio de rascunho + gate de permissão no botão Reenviar

> **Convenção:** o guia v2 (`CLAUDE_APROVACAO_REQ.md`) e o `AJUSTE-1.1-APROVACAO-REQ.md`
> permanecem INTACTOS. Este Ajuste **complementa** a Fase 2 (já entregue no commit `c32c69b`)
> com dois itens de correção e duas dívidas registradas. Em conflito, vale o Ajuste mais recente.
> **Base factual:** investigação PROMPT 2.1 (Q1/Q2/Q3) + decisões do Pedro de 07/08/2026.
> **Escopo:** somente frontend/service. **Nenhuma mudança de banco, nenhuma coluna, nenhuma RPC nova.**

---

## 1. Por que este Ajuste existe

A Fase 2 roteou a **submissão** pelo gate, mas o mapa completo de rotas ao ERP (Q2 da investigação)
revelou que um caminho continua livre — e, pior, é um caminho que o **próprio gate alimenta**:

```
Wizard "Enviar" → submeterRequisicao → RPC → [gate]                      ✅ passa pelo gate
        │
        └─ recusa de roteamento (SEM_CENTRO_CUSTO / NAO_AUTORIZADO / …)
              → req fica em 'rascunho'
                    → Detalhe → botão "Reenviar" → reenviarRequisicao → ERP   ❌ SEM gate
```

Toda recusa do gate produz um rascunho, e todo rascunho tem um botão que vai direto ao ERP.
O trigger do banco (`trg_req_protege_aprovacao`) **não** cobre isso: ele protege apenas
`pendente_aprovacao`/`aprovada`/`rejeitada` — `rascunho` e `pendente_envio` ficam de fora
**por design** (é o que permite a persistência legada funcionar).

Junto veio um **achado lateral mais grave que a própria brecha**: o botão Reenviar não tem gate de
permissão nenhum. `podeReenviar` só olha o status (`SuprimentosRequisicaoDetalhe.tsx:414`), então
quem enxerga a requisição enxerga o botão — e quem enxerga inclui os usuários com `view_all`.
A permissão **`compras.requisicoes.reenviar_own` existe no catálogo RBAC e não é checada em
lugar nenhum do app**.

---

## 2. Decisões travadas (Pedro, 07/08/2026)

| # | Tema | Decisão |
|---|---|---|
| B1 | Política de reenvio | **Cada um cuida da própria requisição.** Sem ramo de exceção para `view_all`. O endurecimento imposto pela RPC (`submeter_requisicao` exige ser o requisitante, ou admin) é **aceito de propósito** |
| B2 | `pendente_envio` | **Não entra em correção.** Risco pré-existente, visível na UI com badge próprio, recuperável pelo Reenviar, e com **zero ocorrências** em 222 reqs com trilha. Vira dívida registrada (§5) |
| B3 | Upsert de sucesso silencioso (modo legado) | **Não entra em correção** nesta missão. Dívida registrada (§5) |
| B4 | Cobaia da validação | **Hugo Maffei** (`hugo.maffei@pfbrazil.com`) — `is_admin=false`, papéis `requisitante` + `analista_compras` + `controller_intercompany` |

---

## 3. Item 1 — Rotear o reenvio de rascunho pelo gate

Desenho aprovado (proposta Q3 do agente, sem alterações):

1. **Extrair** de `submeterRequisicao` (`requisicoesService.ts:742-795`) o trecho que já existe —
   o switch de rotas — para uma função **`rotearSubmissao(reqId, …)`**. É movimentação de código,
   não lógica nova: a submissão do wizard passa a chamar a mesma função extraída.
2. **Chamar `rotearSubmissao`** no início de `reenviarRequisicao`, **apenas quando
   `req.status === 'rascunho'`**.
3. **`pendente_envio` continua indo direto ao envio legado**, sem re-roteamento.

Comportamento resultante de `reenviarRequisicao(id)`:

```
status 'aprovada'       → erro, apontando reenviarRequisicaoAprovada (guarda já existe)
status 'pendente_envio' → envio legado, exatamente como hoje (já foi roteado como SEM_GATE)
status 'rascunho'       → rotearSubmissao:
                            SEM_GATE      → envio legado (idêntico a hoje)
                            AUTO_APROVADA → envio com persistência 'rpc'
                            PENDENTE      → NÃO envia; "enviada para aprovação do líder"
                            recusas       → não envia; mensagem visível + "Nada foi enviado ao ERP"
```

**Por que `pendente_envio` fica de fora:** só o modo legado grava esse status, logo a req já foi
roteada como `SEM_GATE`; re-rotear devolveria `STATUS_INVALIDO:pendente_envio`.

**Por que a RPC serve sem alteração:** `submeter_requisicao` exige `status='rascunho'`, e toda
falha de envio no caminho SEM_GATE devolve a req a `rascunho`
(`requisicoesService.ts:669-695` e `:976-1000`) — exatamente o estado que a RPC aceita.

Três consequências **aceitas**, a tratar na UI e não a contornar:

- **Re-roteamento muda o destino, de propósito.** Se um CC ganhar líder entre a criação e o
  reenvio, a req que antes ia direto passa a exigir aprovação. É o gate funcionando — mas o toast
  precisa dizer isso com clareza ("foi para aprovação do líder"), senão parece que a req sumiu.
- **Endurecimento de permissão** (decisão B1): quem não é o requisitante recebe `NAO_AUTORIZADO`.
- **Ruído de auditoria:** cada clique gera um `submetida_sem_gate`/`enviada_aprovacao` novo.
  Aceitável — é trilha, não lixo.

**Os 4 rascunhos legados** (falhas de envio pré-existentes): todos caem em `SEM_GATE` — os CCs
deles não estão no piloto, só `00010.00002.00003` está mapeado. Comportamento idêntico ao de hoje.
Seguem falhando por validação do próprio Alvo (255/100 chars, validade do CC) até o dado ser
corrigido — o que é correto e não é problema deste Ajuste.

---

## 4. Item 2 — Gate de permissão no botão Reenviar

Hoje `podeReenviar` (`SuprimentosRequisicaoDetalhe.tsx:414`) só avalia status. Passa a exigir
**também** que o usuário possa reenviar **aquela** requisição:

| Situação | Pode reenviar? |
|---|---|
| É o requisitante da req **e** tem `compras.requisicoes.reenviar_own` | ✅ |
| É `is_admin` | ✅ (bypass do RBAC, consistente com o resto do Hub) |
| Tem `view_all` mas **não** é o requisitante | ❌ **botão escondido** (decisão B1) |
| Req `aprovada` com `erro_ultimo_envio` | ✅ para requisitante, líder do CC da req, ou admin — este caminho vai por `reenviarRequisicaoAprovada`, cuja autorização já é validada server-side pela RPC R4 |

Regras de implementação:

- Ler a permissão pelo mesmo mecanismo que o app já usa para gatear UI (`get_user_permissions` /
  hook de permissões existente) — **não inventar mecanismo novo**.
- **Esconder** o botão (não desabilitar): botão morto na tela gera chamado de suporte.
- Isto é **gate de UI**. O gate real de servidor para o caminho de rascunho passa a ser a própria
  `submeter_requisicao` (Item 1), que valida requisitante + `compras.requisicoes.create`.
- ⚠️ **A permissão `compras.requisicoes.reenviar_own` já existe no catálogo** (report de
  Permissões §5). **Não criar permissão nova.** Verificar, porém, a quais papéis ela está mapeada
  hoje — se `requisitante` não a tiver, os requisitantes perdem o botão e o mapeamento precisa ser
  corrigido no banco (uma linha em `hub_role_permissions`, executada pelo Pedro no SQL Editor).
  **Medir antes de assumir.**

---

## 5. Dívidas registradas (NÃO corrigir nesta missão)

> **DÍVIDA-REQ-PENDENTE-ENVIO-ORFA** (origem: investigação 2.1, Q1b). Se a aba fechar ou a máquina
> cair entre gravar `pendente_envio` e a persistência final, a req fica presa nesse status — e, no
> pior caso, já existe no ERP. Não há retry nem conserto server-side: o Job 1 filtra por status +
> `numero_alvo not null`, e o Job 4 casa por `numero_alvo`, que ela não tem. **Mitigadores:** é
> pré-existente e idêntico ao código antigo; a UI mostra badge "Pendente de envio" e oferece
> Reenviar; **zero ocorrências em 222 reqs com trilha**. Prioridade: baixa.

> **DÍVIDA-REQ-UPSERT-SILENCIOSO** (origem: investigação 2.1, Q1b terceiro caso). No modo legado, se
> o upsert de sucesso falhar (rede, RLS, trigger), o código **segue como sucesso**: a requisição
> existe no ERP e o Hub não registra. Contraste deliberado com o modo `rpc`, onde
> `registrar_envio_requisicao` grita. **Correção futura:** aplicar ao caminho legado o mesmo
> tratamento de erro crítico que a Fase 2 introduziu no caminho novo ("FOI criada no ERP nº X —
> NÃO reenvie"). Prioridade: média.

---

## 6. Gate de saída do Ajuste 1.2

1. `bun run build` limpo e `tsc --noEmit` sem erros novos.
2. **Grep prova** que nenhum caminho de UI leva uma req em `rascunho` ao ERP sem passar por
   `rotearSubmissao`/`submeter_requisicao`. Refazer o mapa do Q2 e apresentar a tabela atualizada,
   com o caminho #2 agora marcado ✅.
3. `pendente_envio` continua indo direto ao envio legado (não regrediu).
4. `reenviarRequisicaoAprovada` continua sendo o único caminho para req `aprovada`.
5. Medição do mapeamento de `compras.requisicoes.reenviar_own` aos papéis, reportada ao Pedro.
6. Commit com staging explícito. **Sem push** até revisão. **Sem Publicar** (só com a Fase 3).

---

## 7. PROMPT 1.2 — texto pronto para a nova sessão do Claude Code

```
PROMPT 1.2 — Ajuste 1.2 (fechar brecha do reenvio de rascunho + gate de permissão)

Leia, nesta ordem: CLAUDE.md (protocolo de início de sessão) → ESTADO-APROVACAO-REQ.md
→ CLAUDE_APROVACAO_REQ.md (guia v2) → AJUSTE-1.1-APROVACAO-REQ.md
→ AJUSTE-1.2-APROVACAO-REQ.md (este manda; é o escopo desta sessão)
→ DISCOVERY-APROVACAO-REQ.md (contexto).

Contexto: Fase 1 executada (gate verde) e Fase 2 concluída e pushada (commit c32c69b).
Nada publicado no Lovable. A investigação 2.1 mapeou todas as rotas ao ERP e encontrou
uma brecha (#2) e uma lacuna de permissão — é o que esta sessão fecha.

Escopo — SOMENTE os itens §3 e §4 do Ajuste 1.2:
1. Extrair o switch de rotas de submeterRequisicao para rotearSubmissao(reqId, ...) e chamá-lo
   no início de reenviarRequisicao APENAS quando status === 'rascunho'. pendente_envio continua
   no envio legado. Tratar as 4 saídas com toasts claros (incluindo "foi para aprovação do líder").
2. podeReenviar passa a exigir, além do status: ser o requisitante da req E ter
   compras.requisicoes.reenviar_own (ou is_admin). Esconder o botão, não desabilitar.
   Usar o mecanismo de permissões que o app já tem — não criar mecanismo novo.
3. MEDIR (read-only) a quais papéis compras.requisicoes.reenviar_own está mapeada hoje e
   reportar. NÃO alterar o banco: se o mapeamento estiver errado, eu corrijo no SQL Editor.

NÃO TOCAR: banco (MCP é read-only), RPCs, trigger, crons/Edge Functions, fila do líder e
badges (Fase 3), types.ts, arquivos de outras missões no working tree.

Gate de saída (§6 do Ajuste): build + tsc limpos; refazer o mapa de rotas ao ERP do Q2 e
apresentar a tabela atualizada com o caminho #2 marcado ✅; confirmar que pendente_envio e
reenviarRequisicaoAprovada não regrediram.

Git: staging explícito só dos arquivos tocados, commit
"fix(suprimentos): roteia reenvio de rascunho pelo gate + permissao no botao reenviar (AJUSTE 1.2)".
SEM push. Atualize o ESTADO-APROVACAO-REQ.md. Termine com: arquivos alterados, tabela de rotas
atualizada, resultado da medição da permissão, e o que contradisse a espec.
```

---

## 8. Depois deste Ajuste

1. Pedro revisa o diff, dá o push (sem Publicar) e, se a medição do §4 pedir, corrige o
   mapeamento da permissão no SQL Editor.
2. **PROMPT 3 — Fase 3 (UI):** fila do líder, badges na listagem, motivo da rejeição no detalhe,
   "Clonar para Nova Requisição" em qualquer status.
3. **Fase 5 — validação fim-a-fim** com Hugo Maffei (cobaia) e o CC `00010.00002.00003`.
4. Só então: **Publicar** (Fases 2+3 juntas).

---

*Fim do Ajuste 1.2. Guia v2 e Ajuste 1.1 intactos. Sem mudança de banco. Próximo: PROMPT 3 (Fase 3).*
