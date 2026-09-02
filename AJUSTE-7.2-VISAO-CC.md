# AJUSTE 7.2 — Escopo `view_cc`: o líder enxerga o que onera o centro de custo dele
## Missão Aprovação de Requisições · frente A2

> Guia v2 e Ajustes 1.1/1.2/1.3, PROMPT-3-FASE3, FASE6, Ajustes 6.1/6.2 e 7.1 permanecem INTACTOS.
> Este Ajuste manda dentro do seu escopo. Base: `DISCOVERY-FASE7A.md` (B1–B6) +
> `Permissoes_e_Roles_v2.md` (modelo RBAC) + caso real de 02/09/2026.
> **Escrito para sessão nova.**

---

## 1. O problema

Caio Santos, líder de ENGENHARIA DE MANUFATURA (`00010.00002.00005`), aprovou a requisição
`2ad811a6-…` às 18:11 de 02/09 — fluxo completo, número do ERP `0001475`, sem erro. **E em seguida
perdeu o documento de vista.**

Motivo: a fila de Aprovações mostra apenas `pendente_aprovacao`. Uma vez decidida, a requisição sai
dali — e na listagem geral de Requisições ele continua vendo **só as próprias**, porque seu escopo é
`view_own`.

Consequência de controle: **o líder autoriza gasto no centro de custo pelo qual responde e não tem
como acompanhar o que autorizou** — nem o que a equipe dele requisitou antes, nem o que virou pedido
depois. Ele decide e o documento desaparece.

---

## 2. A decisão de desenho: um terceiro escopo, não um remendo

O `Permissoes_e_Roles_v2.md` §6 estabelece que **escopo é permissão nomeada**: `view_own` (só o que
criei) versus `view_all` (tudo), e que essa distinção "é a base do isolamento entre usuários". O §6
ainda adverte: *"qualquer mexida em RLS ou em query de listagem lá pode vazar dados entre usuários"*.

Portanto, **não** se resolve isto com um `if (é líder)` dentro da query. Cria-se o escopo que faltava,
seguindo a convenção `modulo.recurso.acao`:

| Escopo | Código | Alcance |
|---|---|---|
| Próprios | `compras.requisicoes.view_own` | o que o usuário criou |
| **Por centro de custo** | **`compras.requisicoes.view_cc`** 🆕 | **o que onera os CCs que ele lidera** |
| Tudo | `compras.requisicoes.view_all` | toda a base |

Idem para pedidos: **`compras.pedidos.view_cc`** 🆕.

**Por que isto é o caminho profissional, e não o atalho:**

1. **É auditável.** "Quem pode ver o quê" continua respondível a partir das tabelas `hub_*`, sem ler
   código. Um ramo escondido numa query não aparece em consulta de permissões.
2. **É reversível.** Tirar a visão de alguém é revogar permissão, não editar e republicar tela.
3. **Segue a hierarquia natural** já existente: `view_all` > `view_cc` > `view_own`. Quem tem
   `view_all` não é afetado; quem só tem `view_own` não perde nada.
4. **Desacopla papel de capacidade.** Hoje só `lider_departamento` recebe `view_cc`; amanhã um
   controller de área ou um `visualizador_compras` regional pode receber sem tocar em código.
5. **O que dá o alcance concreto é o mapeamento** `compras_lideres_cc` — a permissão diz *"vê por
   centro de custo"*, o mapa diz *quais*. Sem mapeamento, a permissão não amplia nada.

---

## 3. Regra de vínculo documento ↔ centro de custo

| Documento | Onde o CC vive | Regra |
|---|---|---|
| **Requisição** | `compras_requisicoes.codigo_centro_ctrl` (cabeçalho) | Vínculo pelo cabeçalho. Medido: **zero** requisições com itens em CCs distintos; a interface oferece um seletor único |
| **Pedido** | `compras_pedidos_itens_rateio.codigo_centro_ctrl` (tabela neta) **e** `compras_pedidos.centro_custo` (cabeçalho) | **União das duas fontes.** Qualquer CC presente no rateio dá visão, **independente do percentual**; e o cabeçalho também conta |

⚠️ **A união não é preciosismo:** **1.772 de 1.863 pedidos não têm rateio nenhum** registrado
(consequência da **DÍVIDA-SYNC-PEDIDOS**, aberta). Olhar só o rateio deixaria a visão do líder
praticamente vazia.

**Documento é visto inteiro**, nunca recortado por percentual: se um pedido rateia 70% para o CC do
líder e 30% para outro, ele vê o pedido completo, com todos os itens e valores. Recortar documento
contábil confunde mais do que protege — e o líder precisa do contexto da compra que onera a área dele.

**Exclusão:** `rascunho` de outra pessoa **não** entra. Rascunho é trabalho em andamento, não
documento submetido. Da submissão em diante, todos os status.

---

## 4. Implementação

### 4.1 RBAC (SQL para o Pedro executar — o agente **não** executa)

```sql
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.requisicoes.view_cc', 'Ver requisições do centro de custo',
       'Ver todas as requisições dos centros de custo que o usuário lidera', 'compras'
where not exists (select 1 from hub_permissions where codigo='compras.requisicoes.view_cc');
```
```sql
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.pedidos.view_cc', 'Ver pedidos do centro de custo',
       'Ver todos os pedidos que oneram os centros de custo que o usuário lidera', 'compras'
where not exists (select 1 from hub_permissions where codigo='compras.pedidos.view_cc');
```
```sql
-- Papel do líder + gatekeeper de pedidos (ele precisa entrar no módulo para ver a lista)
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='lider_departamento'
  and p.codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc','compras.pedidos.access')
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```
```sql
-- §8.7 do report: permissão nova vai TAMBÉM para o papel admin, senão ele fica defasado
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='admin'
  and p.codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc')
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```
```sql
notify pgrst, 'reload schema';
```

⚠️ Conferir se `lider_departamento` já tem `compras.pedidos.access`; sem ele, o menu de Pedidos não
aparece e a permissão de visão fica inócua.

### 4.2 Resolução do escopo — servidor, não cliente

O Discovery (B4) recomenda **RPC**, e para pedidos é praticamente obrigatório: o CC vive na tabela
neta do rateio, e resolver isso no cliente exigiria trazer rateios para filtrar em memória, esbarrando
no limite de 1000 linhas do PostgREST.

Duas RPCs `SECURITY DEFINER`, `set search_path = public`, **tags nomeadas** (`$q1$`, `$q2$`):

- **`listar_requisicoes_escopo(filtros…)`** e **`listar_pedidos_escopo(filtros…)`**, ambas resolvendo
  internamente, nesta ordem:

```
is_admin                        → tudo
tem view_all                    → tudo
tem view_cc                     → união dos CCs ativos do usuário em compras_lideres_cc
                                  (requisição: cabeçalho; pedido: rateio ∪ cabeçalho)
                                  ∪ os próprios documentos    ← view_cc NUNCA tira o que view_own dava
tem view_own                    → só os próprios
nenhuma                         → nada
```

- Gate de backend via **`user_has_permission(auth.uid(), …)`** — §8.4 do report: *"nunca confiar só
  na UI"*.
- Paginação server-side (`limit`/`offset`) e ordenação — não trazer tudo para filtrar no cliente.
- `rascunho` de terceiro excluído no ramo `view_cc`.

### 4.3 Interface

- **Listagem de Requisições e de Pedidos:** passam a consumir as RPCs. Para quem não tem `view_cc`,
  **o comportamento é idêntico ao de hoje** — é o critério de não-regressão.
- **Indicação de origem da visibilidade:** quando o documento aparece por `view_cc` e não é do
  usuário, marcar discretamente (ex.: chip com o código do CC). Sem isso, o líder soma o que vê e
  supõe que é a base inteira.
- **Filtro "Centro de custo"** na listagem, alimentado pelos CCs que ele lidera (para quem tem
  `view_cc`): é o que torna a visão utilizável por quem responde por vários centros.
- **Detalhe do pedido:** hoje o gate é `view_all` ou ser o requisitante
  (`SuprimentosPedidoDetalhe.tsx:185,208-216`) — **precisa ganhar o ramo `view_cc`**, senão o líder vê
  o pedido na lista e não consegue abrir. É o mesmo bug que o Ajuste 7.1 corrigiu na requisição.
- **Detalhe da requisição:** já tem ramo de líder (commit `f40029c`, 19/08) — **verificar** se ele
  passa a ler `view_cc` em vez da checagem direta em `compras_lideres_cc`, para haver **uma única
  fonte de verdade** de escopo.
- Sem `.update()` direto. Fallback nunca silencioso.

---

## 5. Fora de escopo

Aprovação múltipla por rateio (frente B — depende de a requisição passar a ter rateio de CC, que a
interface hoje não oferece) · rateio de CC na requisição · notificações · fechar RLS
(**DÍVIDA-RLS-COMPRAS-REQ**) · corrigir o sync de pedidos (**missão própria**, especificada em
`MISSAO-SYNC-PEDIDOS.md`) · aposentar `view_own`/`view_all`.

---

## 6. Gate de saída

1. `bun run build` limpo · `tsc --noEmit` sem erros novos · sem regressão de ESLint.
2. **Não-regressão (o mais importante):** usuário com apenas `view_own` vê **exatamente** o que via
   antes; usuário com `view_all`, idem. Medir antes/depois com a mesma consulta.
3. Líder **sem `is_admin`** vê, na listagem de Requisições, as dos CCs que lidera **e** as próprias;
   não vê rascunho alheio; não vê nada de CC que não lidera.
4. O mesmo líder vê, na listagem de Pedidos, os que oneram seus CCs — **por rateio ou por cabeçalho**.
5. Detalhe do pedido abre para o líder (ramo `view_cc`).
6. Consulta das permissões órfãs do papel `admin` (§9.1 do report) **não** retorna as duas novas.
7. Commit com staging explícito, **sem push**.

---

## 7. Validação (Pedro, após Publicar)

⚠️ **Pedro é o único `is_admin`** (§9.3 do report): o bypass mascara todo erro de escopo. A validação
**exige** líder sem esse privilégio.

1. **Caio Santos** (`00010.00002.00005`): abre Requisições e encontra a requisição `2ad811a6-…` que
   aprovou, mais as outras 10 do centro dele. Abre Pedidos e vê os que oneram Engenharia de Manufatura.
2. **Ana Sanches** (12 CCs): a listagem cobre os 12, e o filtro por CC funciona.
   ⚠️ Último login em 11/05 — pedir `Ctrl+Shift+R`.
3. **Hugo Maffei** (`requisitante` + `analista_compras`, sem `view_cc`): comportamento **inalterado**.
4. Um requisitante comum: continua vendo só as próprias.

---

## 8. PROMPT 7.2 — colar na sessão do Claude Code

```
PROMPT 7.2 — Escopo view_cc: líder enxerga requisições e pedidos dos CCs que lidera

Leia, nesta ordem: CLAUDE.md (protocolo de início de sessão) → ESTADO-APROVACAO-REQ.md
→ AJUSTE-7.2-VISAO-CC.md (ESTE MANDA; é o escopo da sessão)
→ DISCOVERY-FASE7A.md (B1–B6: as queries de listagem já foram mapeadas)
→ Permissoes_e_Roles_v2.md (o modelo RBAC que este Ajuste segue).

Contexto: o gate de aprovação está em produção. O líder decide na fila e depois PERDE o documento
de vista — na listagem geral ele só vê as próprias requisições (escopo view_own). Caso real:
Caio Santos aprovou 2ad811a6-… em 02/09 (nº 0001475) e não a encontra mais.

Decisão de desenho: NÃO resolver com um ramo "se é líder" dentro da query. Criar o terceiro
escopo do modelo RBAC — compras.requisicoes.view_cc e compras.pedidos.view_cc — resolvido em RPC
server-side, seguindo o checklist §8 do relatório de permissões (permissão criada → mapeada aos
papéis INCLUSIVE admin → gate de UI → gate de backend com user_has_permission → respeitar own/all).

Escopo: §4 do Ajuste, nada além. §5 lista o que NÃO fazer.

Entregue nesta ordem:
1. SQL-AJUSTE72.md na raiz, com os blocos do §4.1 prontos para eu colar, um statement por bloco,
   com resultado esperado e conferências. ⚠️ TAGS NOMEADAS em todo CREATE FUNCTION ($q1$, $q2$) —
   o SQL Editor corrompe corpos $$ em silêncio. NÃO execute nada: o MCP é read-only.
2. As duas RPCs de listagem (§4.2) no mesmo arquivo SQL.
3. O frontend do §4.3.

Antes de codar, meça e relate (read-only):
- se lider_departamento já tem compras.pedidos.access (sem ele o menu de Pedidos não aparece);
- como SuprimentosRequisicaoDetalhe.tsx resolve hoje o ramo de líder (commit f40029c) — ele deve
  passar a usar view_cc, para haver uma única fonte de verdade de escopo;
- quantos pedidos de 2026 seriam alcançados por rateio vs por cabeçalho (dimensiona a união).

NÃO TOCAR: banco (escrita), crons/Edge Functions, types.ts, fila de Aprovações, mapa de líderes,
arquivos de outras missões no working tree.

Gate de saída: §6 do Ajuste — com atenção especial à NÃO-REGRESSÃO (item 2): quem tem só view_own
ou view_all deve ver exatamente o que via antes. Suprimentos é zona de vazamento own/all.

Git: staging explícito, commit "feat(suprimentos): escopo view_cc para lideres de centro de custo
(AJUSTE 7.2)". SEM push. Atualize o ESTADO-APROVACAO-REQ.md. Termine com: arquivos alterados, como
resolveu a hierarquia de escopos, a medição pedida acima, e o que contradisse a espec.
```

---

*Fim do Ajuste 7.2. Depois: eu executo o SQL, revisão, push, Publicar, validação §7 com Caio e Ana.*
