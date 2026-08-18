# PROMPT 3 — Fase 3 (UI) da missão Aprovação de Requisições
## Fila do líder · badges · motivo da rejeição · clonar · 2 correções herdadas

> Complementa `CLAUDE_APROVACAO_REQ.md` §7 com as decisões do Pedro de 07–10/08/2026.
> Guia v2, Ajuste 1.1 e Ajuste 1.2 permanecem INTACTOS. Em conflito, vale este arquivo.
> **Estado ao entrar:** Fase 1 no banco (gate verde) · Fases 2 e 1.2 pushadas **e publicadas** ·
> zero requisições nos estados novos · único CC mapeado: `00010.00002.00003` (Pedro).

---

## 1. Decisões desta fase (Pedro)

| # | Tema | Decisão |
|---|---|---|
| C1 | Onde vive a fila | **Item de menu próprio** em Suprimentos ("Aprovações"), visível só com `compras.requisicoes.aprovar`, **com badge de contagem** de pendentes. Motivo: sem e-mail (decisão 13), a fila precisa ser visível para virar hábito |
| C2 | Papel `lider_departamento` | Ganha **`compras.requisicoes.create` e `compras.requisicoes.reenviar_own`** — o líder cria requisição **no mesmo wizard que todos**, e o papel passa a ser autossuficiente |
| C3 | Auto-aprovação | Já implementada na RPC (`AUTO_APROVADA` + `aprovacao_automatica=true`). A UI só precisa **informar com clareza** que foi automática |
| C4 | "Desistir da pendente" | **Fora do escopo.** Esperar caso real. Requisição pendente só sai por decisão do líder |
| C5 | Correções herdadas do Ajuste 1.2 | Entram nesta fase: **hook fora de ordem** e **validação "sem itens"** (§5) |

**Nota de desenho a preservar na UI:** a autorização segue o **centro de custo da requisição**, não o
cargo de quem digitou. Trocar o CC no wizard muda o aprovador (ou tira a req do gate). A tela deve
deixar isso legível, não escondido.

---

## 2. SQL desta fase (Pedro executa no SQL Editor — o agente NÃO executa)

Dois statements, um por Run. ⚠️ **Se em algum momento a Fase 3 exigir CREATE FUNCTION, usar tags
nomeadas (`$fn$`, `$r5$`…), nunca `$$` puro** — o SQL Editor corrompe corpos `$$` em silêncio
(armadilha registrada no ESTADO).

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

---

## 3. Escopo de UI

### 3.1 Fila do líder (tela nova)

- Rota nova + **item de menu "Aprovações"** em Suprimentos, gateado por `compras.requisicoes.aprovar`
  via o mecanismo de permissões que o app já usa (**não inventar mecanismo novo**).
- **Badge de contagem** no item de menu: nº de requisições `pendente_aprovacao` nos CCs do usuário
  (admin: todas). Contagem por `count` server-side, nunca trazendo linhas para contar.
- Listagem: `status='pendente_aprovacao'` **e** `codigo_centro_ctrl` ∈ CCs de `compras_lideres_cc`
  onde `lider_user_id = auth.uid() and ativo` (admin vê todas). Paginação `.range()` (max-rows=1000).
  Ordenar por mais antiga primeiro — fila de decisão, não feed.
- Colunas úteis para decidir sem abrir: nº/identificador, requisitante, CC, data, total de itens,
  valor se disponível, há quantos dias espera.
- **Detalhe: reusar o componente existente** (itens, rateio, valores, anexos). Não duplicar tela.
- Ações no detalhe (e, se fizer sentido, na linha da fila):
  - **APROVAR** (primária) → `rpc('aprovar_requisicao')`;
  - **REJEITAR** (destrutiva) → modal com **motivo obrigatório** (mín. 5 caracteres, contador
    visível) → `rpc('rejeitar_requisicao')`.
- **Pós-APROVAR — feedback em 2 tempos** (o envio ao ERP acontece na sessão do líder):
  `Aprovada ✓` → `Enviando ao ERP…` → `Sincronizada (nº X)` **ou** `Erro no envio` com detalhe
  expandível e botão **Reenviar** (caminho `reenviarRequisicaoAprovada`, já existente).
- Tratar todos os retornos das RPCs com mensagem visível: `SEM_PERMISSAO`, `FORA_DO_SEU_CC`,
  `STATUS_INVALIDO:*`, `NAO_ENCONTRADA`, `MOTIVO_OBRIGATORIO`. **Fallback nunca silencioso.**
- **Concorrência:** se outro líder (ou admin) decidiu antes, a RPC devolve `STATUS_INVALIDO:*` —
  a tela deve dizer "esta requisição já foi decidida" e recarregar a fila, não travar.

### 3.2 Badges e listagem (decisão A4 do Ajuste 1.1 — mostrar, não esconder)

Novos estados no vocabulário de status (`src/lib/statusRequisicao.ts` e onde mais existir):

| Estado | Rótulo | Tratamento visual |
|---|---|---|
| `pendente_aprovacao` | **Pendente aprovação** | neutro/âmbar |
| `aprovada` (sem erro) | **Aprovada — enviando** | neutro |
| `aprovada` + `erro_ultimo_envio` | **Aprovada — erro no envio** | **cor forte** (é exceção) |
| `rejeitada` | **Rejeitada** | neutro, sem alarme |

- Aparecem na listagem para quem já enxerga a req (inclui `view_all`) — **sem esconder**.
- Adicionar os novos estados aos **filtros/dropdown de status** em todas as telas que os tenham.
- ⚠️ **Filtros por negação** (`neq` / `NOT IN`): reescrever como **lista positiva** — negação deixa
  passar status novos e exclui NULL silenciosamente.
- Não confundir vocabulário: **"aprovação do líder (requisição)"** ≠ **"aprovação do pedido (Alvo)"**.
  Rotular explicitamente onde as duas puderem ser lidas juntas.

### 3.3 Detalhe da requisição

- `rejeitada`: card em destaque com **motivo + quem rejeitou + quando**. Visível a todos que veem a
  req; destaque maior para o requisitante.
- `aprovada`: mostrar **quem aprovou e quando**; se `aprovacao_automatica=true`, rotular como
  **"Aprovação automática (líder do centro de custo)"** — a distinção é auditável e deve ser legível.
- `pendente_aprovacao`: deixar claro que está aguardando decisão do líder do CC, **sem prometer
  notificação** (não há e-mail — decisão 13). Se possível, informar o CC responsável.

### 3.4 Clonar para Nova Requisição

- Botão no detalhe, **qualquer status**, gateado por `compras.requisicoes.create`.
- Copia cabeçalho (funcionário, CC, finalidade, data de necessidade), itens e rateios.
  **Anexos ficam de fora no v1** — informar isso ao usuário.
- Resultado: novo **rascunho** do usuário atual, abrindo no wizard para revisão (nunca submete direto).
- É o caminho de reaproveitamento de req rejeitada (que é terminal).

---

## 4. Fora do escopo (não fazer)

- E-mails/notificações de qualquer tipo (decisão gerencial 13).
- Cancelar/excluir requisição pendente (C4).
- Escalonamento por ausência do líder, SLA, lembretes.
- Alçada por valor.
- Cópia de anexos no Clonar.
- Mexer em RLS da família de requisições (**DÍVIDA-RLS-COMPRAS-REQ**, missão própria).
- Crons, Edge Functions, `types.ts`, arquivos de outras missões no working tree.

---

## 5. Correções herdadas (C5)

1. **Hook fora de ordem** — `useHasPermission(COMPRAS_PEDIDOS_CREATE)` em
   `SuprimentosRequisicaoDetalhe.tsx` é chamado **depois** de returns condicionais (herdado de
   `a973f1c`, Lovable, maio/2026). Viola as Rules of Hooks e pode causar render inconsistente.
   Mover para o topo, junto com os demais.
2. **Validação "sem itens"** — hoje quem falha por falta de itens é `enviarRequisicaoAlvo`, que a rota
   `PENDENTE` não chama, então uma req sem itens pode ir para a fila do líder. Validar **no wizard**,
   antes da submissão (que é onde deveria estar desde sempre).

---

## 6. Gate de saída da Fase 3

1. `bun run build` limpo · `tsc --noEmit` sem erros novos · ESLint sem regressão relevante.
2. Fila só aparece para quem tem `compras.requisicoes.aprovar`; badge de contagem correto.
3. Todos os retornos de RPC tratados com mensagem visível (listar no relatório qual mensagem
   corresponde a cada retorno).
4. Filtros de status revisados: **nenhuma negação** remanescente que possa vazar status novos.
5. Nenhum caminho novo ao ERP: o mapa de rotas do Ajuste 1.2 §6 continua válido — refazer e apresentar.
6. Commit com staging explícito. **Sem push** até revisão do Pedro. **Publicar** é decisão do Pedro
   após a validação da Fase 5.

---

## 7. Validação (Fase 5 — depois do Publicar, com o Pedro presente)

Cobaia: **Hugo Maffei** (`hugo.maffei@pfbrazil.com`) — `is_admin=false`; papéis `requisitante`,
`analista_compras`, `controller_intercompany`. **Avisar antes que é teste**, principalmente a rejeição.

| # | Passo | Esperado |
|---|---|---|
| 1 | Hugo cria req com CC **fora** do piloto | `SEM_GATE` → vai ao ERP como sempre |
| 2 | Hugo cria req com CC `00010.00002.00003` | `pendente_aprovacao`; **não** aparece na fila de compras; **não** existe no Alvo |
| 3 | Hugo tenta acessar a fila de Aprovações | **Não vê o menu**; acesso direto à rota é negado |
| 4 | Pedro abre Aprovações | Vê a req; detalhe completo legível (itens, rateio, anexos) |
| 5 | Pedro **rejeita** com motivo | `rejeitada`; Hugo vê motivo+quem+quando; nunca vai ao ERP; cron não ressuscita |
| 6 | Hugo usa **Clonar** na rejeitada | Novo rascunho dele, com itens e rateio |
| 7 | Hugo cria outra e Pedro **aprova** | `aprovada` → envio → `numero_alvo` → `sincronizada` → operadora enxerga → vira pedido normalmente |
| 8 | Pedro cria req no **próprio CC** | `AUTO_APROVADA`, rotulada como aprovação automática, direto ao ERP |
| 9 | Req com observação de item **>255 chars**, aprovada | Falha no envio → `aprovada` + erro visível → corrigir → **Reenviar** → `sincronizada` |
| 10 | Rodar um ciclo do cron | Nenhuma req `pendente_aprovacao`/`rejeitada` alterada |
| 11 | Hugo tenta escrever direto na API (curl com JWT) numa req pendente | `PROTEGIDO_APROVACAO` (prova do trigger) |

---

## 8. PROMPT — colar na sessão do Claude Code

```
PROMPT 3 — Fase 3 (UI) da missão Aprovação de Requisições

Leia, nesta ordem: CLAUDE.md (protocolo de início de sessão) → ESTADO-APROVACAO-REQ.md
→ CLAUDE_APROVACAO_REQ.md (guia v2) → AJUSTE-1.1 → AJUSTE-1.2 → PROMPT-3-FASE3.md
(este último manda em conflito e é o escopo desta sessão) → DISCOVERY-APROVACAO-REQ.md (contexto).

Estado: Fase 1 no banco (gate verde), Fases 2 e 1.2 pushadas E PUBLICADAS. Zero requisições nos
estados novos. Único CC mapeado: 00010.00002.00003 (Pedro). Não há tela de aprovação ainda —
é o que esta sessão constrói.

Escopo: §3 e §5 do PROMPT-3-FASE3.md, nada além. §4 lista o que NÃO fazer.

Antes de codar, verifique no banco (read-only) e relate:
- se o papel lider_departamento já tem create/reenviar_own (SQL do §2 — quem executa é o Pedro,
  você só mede e reporta);
- todos os pontos que filtram status de requisição por NEGAÇÃO (neq / NOT IN), com arquivo:linha —
  eles precisam virar lista positiva.

Regras: nenhuma escrita no banco (MCP read-only). Se precisar de SQL, escreva para o Pedro executar,
usando tags nomeadas ($fn$, $r5$…) em qualquer CREATE FUNCTION — nunca $$ puro.
Gate de saída: §6. Git: staging explícito, commit
"feat(suprimentos): fase 3 aprovacao de requisicoes — fila do lider, badges, clonar (PROMPT 3)".
SEM push. Atualize o ESTADO-APROVACAO-REQ.md. Termine com: arquivos alterados, mapeamento
retorno-de-RPC → mensagem na tela, filtros por negação corrigidos, mapa de rotas ao ERP refeito,
e o que contradisse a espec.
```

---

*Fim do PROMPT 3. Depois desta fase: SQL do §2 (Pedro), revisão, push, Publicar e validação §7 com o Hugo.*
