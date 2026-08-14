# DISCOVERY-FASE7A.md — bug da fila + visão do líder por Centro de Custo

> Execução do **PROMPT 7.0 §4** (Discovery, 100% leitura). Sessão de **14/08/2026**.
> Nenhum arquivo de código alterado. Nenhuma escrita no banco (MCP `read_only`).
> Documentos-mãe (`CLAUDE_APROVACAO_REQ.md`, Ajustes 1.1/1.2/1.3, `PROMPT-3-FASE3.md`,
> `FASE6-MAPA-LIDERES-CC.md`, Ajustes 6.1/6.2, `PROMPT-7.0-VISAO-LIDER.md`) **intactos**.

## 0. Protocolo de início de sessão (CLAUDE.md)

| Passo | Resultado |
|---|---|
| Prompt identificado | **PROMPT 7.0 — Discovery da Fase 7A** |
| `git remote -v` | `https://github.com/financeiropfbrazil/finances-pf.git` ✅ |
| `git branch --show-current` | `main` |
| `git log -1 --oneline` | `3dc0cca docs(despesas): armadilhas 39-41 …` |
| `git pull origin main` | **Already up to date** — zero commits vindos do Lovable |
| Projeto Supabase | `hbtggrbauguukewiknew` ✅ — `src/integrations/supabase/client.ts:5` e fingerprint abaixo |

**Fingerprint (pré-voo, antes de qualquer outra query):**

```sql
select current_database(), (select count(*) from public.compras_pedidos), …
```
| `db` | `compras_pedidos` | `compras_requisicoes` | `compras_lideres_cc` | `pendente_aprovacao` |
|---|---|---|---|---|
| `postgres` | **1863** | 323 | 14 | **1** |

(1820 → 1863 pedidos desde a medição de 10/08 registrada no `ESTADO-APROVACAO-REQ.md` §12.7 —
crescimento normal do sync. É o projeto certo.)

---

# PARTE A — O BUG (§4.1)

## 🔴 Veredito em uma frase

**A hipótese da espec está certa no mecanismo e errada no lugar.** O `view_own` é de fato aplicado
**antes** do teste de liderança — mas em `SuprimentosRequisicaoDetalhe.tsx`, **não** na fila. A query
da fila (`/suprimentos/aprovacoes`) **não tem filtro nenhum de `view_own`** e, medida sob a identidade
da própria Ana no banco, **devolve a requisição do Diego**. O que está comprovadamente quebrado é a
**tela de detalhe**: a líder recebe *"Requisição não encontrada"* ao abrir a requisição que ela
precisa decidir — inclusive clicando no card da própria fila.

---

## A1 — Qual query alimenta a fila, com que filtros e em que ordem

### A1.1 A cadeia completa

| # | Onde | Arquivo:linha | O que faz |
|---|---|---|---|
| 1 | Página | `src/pages/SuprimentosAprovacoes.tsx:70-78` | `useQuery(["requisicoes_pendentes_aprovacao", user.id, isAdmin])` → `listarRequisicoesPendentes(user.id, isAdmin)`, `enabled: !!user` |
| 2 | Service | `src/services/requisicoesService.ts:1135-1162` | monta a query |
| 3 | Escopo | `src/services/requisicoesService.ts:1097-1106` | `listarCentrosDeCustoDoLider(userId)` → `compras_lideres_cc` (`lider_user_id`, `ativo=true`) |

### A1.2 Os filtros, **na ordem em que são aplicados** (`requisicoesService.ts:1144-1157`)

```
1. .from("compras_requisicoes")
2. .select("id, numero_alvo, descricao, codigo_centro_ctrl, centro_ctrl_nome,
            funcionario_nome, codigo_funcionario, requisitante_user_id,
            data_necessidade, total_itens, created_at, updated_at")
3. .eq("status", "pendente_aprovacao")
4. .order("created_at", { ascending: true })          -- mais antiga primeiro
5. .range(0, 199)                                      -- teto de 200 linhas
6. SE !isAdmin:
     ccs = listarCentrosDeCustoDoLider(userId)         -- 2ª ida ao banco
     se ccs.length === 0 → return []                   -- corta antes de consultar
     .in("codigo_centro_ctrl", ccs)
```

**Não existe, em nenhum ponto desta cadeia, filtro por `requisitante_user_id`, por
`codigo_funcionario`, nem leitura de `compras.requisicoes.view_own`/`view_all`.** A única restrição de
escopo é a lista de CCs liderados.

### A1.3 O que descarta a requisição do Diego: **nada** — medido

**Evidência 1 — dados (leitura direta):**

```sql
select id, status, codigo_centro_ctrl, length(codigo_centro_ctrl), requisitante_user_id, created_at
from compras_requisicoes where id='7247431f-a21c-4eca-bfee-514276e7fd12';
```
→ `pendente_aprovacao` · `00007.00001.00002` · **len 17** (sem espaço à direita) ·
requisitante `f60a4fbe…` (diego.amancio) · criada `2026-08-12 16:53:13+00` · descrição
`COMPRA DE DOMINIO DRYPATCH`.

Mapeamento da Ana (`e96876e1…`): **12 CCs ativos**, incluindo `00007.00001.00002`
(`ativo=true`, `atribuido_em 2026-08-11 00:56:25+00`), todos com `length=17`. Nenhuma divergência de
formatação entre as duas colunas.

**Evidência 2 — a fila, executada COM A IDENTIDADE DA ANA no Postgres** (transação
`begin … rollback`, zero escrita):

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"e96876e1-57d3-4ca2-ac14-c20931e95489","role":"authenticated"}';
select (select count(*) from compras_lideres_cc where lider_user_id=auth.uid() and ativo)  as meus_ccs,
       (select count(*) from compras_requisicoes r
         where r.status='pendente_aprovacao'
           and r.codigo_centro_ctrl in (select codigo_centro_ctrl from compras_lideres_cc
                                        where lider_user_id=auth.uid() and ativo))          as fila_visivel;
```
→ `current_user = authenticated` · `uid = e96876e1…` · **`meus_ccs = 12`** · **`fila_visivel = 1`** ✅

**Evidência 3 — a forma exata da URL do PostgREST é válida** (o `in.()` com 12 códigos contendo
pontos era suspeito). Requisição real ao `/rest/v1/` com a chave anon pública do bundle:

```
GET /rest/v1/compras_requisicoes?select=id,…&status=eq.pendente_aprovacao
    &codigo_centro_ctrl=in.(00007.00001.00002,00007.00004.00005,…)&order=created_at.asc
Range: 0-199
→ HTTP 200, []   (0 linhas porque a policy é para `authenticated`; o que importa é que NÃO deu 400)
```

**Evidência 4 — nada de infraestrutura barra o caminho:**

| Objeto | RLS | Policy | `authenticated` SELECT | Exposto no PostgREST |
|---|---|---|---|---|
| `compras_requisicoes` | on | `ALL … using(true)` p/ `authenticated` | ✅ | ✅ 200 |
| `compras_lideres_cc` | on | `lideres_cc_select` `SELECT using(true)` p/ `authenticated` | ✅ | ✅ 200 |
| `compras_pedidos` / `_itens` / `_itens_rateio` | on | `ALL … using(true)` | ✅ | ✅ 200 |

**Evidência 5 — a Ana tem tudo o que a tela exige.**
`get_user_permissions('e96876e1…')` devolve, entre outras, **`compras.requisicoes.aprovar`**,
`compras.requisicoes.access`, `create`, `reenviar_own`, `view_own`, `compras.pedidos.access`,
`compras.pedidos.view_own`. Papéis ativos: `lider_departamento`, `requisitante`, `responsavel_projeto`.
→ o item de menu (`AppSidebar.tsx:119`, gate `compras.requisicoes.aprovar`), o grupo Suprimentos
(`AppSidebar.tsx:277`, gate `suprimentos_requisicoes` → traduzido para `compras.requisicoes.access` em
`usePermissions.ts:16`) e a rota (`App.tsx:279-283`, `PermissionRoute permKey="compras.requisicoes.aprovar"`)
**abrem para ela**. `is_admin=false`, `is_active=true`, `must_change_password=false`.

ℹ️ Anotação lateral: a pendência ⚠️ do `ESTADO §1` (`lider_departamento` sem `create`/`reenviar_own`)
**já foi resolvida no banco** — o papel hoje tem os 4 códigos. O SQL do §10.2 foi executado em algum
momento entre 11/08 e hoje. Vale atualizar o `ESTADO`.

**Evidência 6 — o app PUBLICADO tem o código da Fase 3, e é idêntico ao HEAD.**
Baixado `https://finance-pf.lovable.app/assets/index-CuCWHf63.js` (5,4 MB) e comparado. A função
publicada é byte-equivalente à do repo:

```js
async function HAe(e,t,r){const a=Math.min(200,1e3);let s=je.from("compras_requisicoes")
 .select("id, numero_alvo, …").eq("status","pendente_aprovacao").order("created_at",{ascending:!0})
 .range(0,0+a-1);if(!t){const d=await jB(e);if(d.length===0)return[];s=s.in("codigo_centro_ctrl",d)}…}
```
(`jB` = `listarCentrosDeCustoDoLider`, idêntica.) Marcadores encontrados no bundle publicado:
`"Aprovações de Requisições"`, `"Nenhum centro de custo sob sua liderança"`,
`"requisicoes_pendentes_aprovacao"`, `"/suprimentos/aprovacoes"`, `"atribuir_lider_cc"`.
**Não é build velho.**

### A1.4 🔴 O defeito que EXISTE e está em produção — `SuprimentosRequisicaoDetalhe.tsx`

`src/pages/SuprimentosRequisicaoDetalhe.tsx:143-165`:

```ts
queryFn: async () => {
  const { data } = await supabase.from("compras_requisicoes").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  if (!podeVerTodas) {                                   // ← :154  (view_all, useHasPermission :121)
    const isOwner       = data.requisitante_user_id === user?.id;
    const isFuncionario = profile?.funcionario_alvo_codigo &&
                          data.codigo_funcionario === profile.funcionario_alvo_codigo;
    if (!isOwner && !isFuncionario) return null;         // ← :159  LÍDER NÃO ESTÁ AQUI
  }
  return data;
}
```
`:336` → `if (!req)` → tela **"Requisição não encontrada"** (`:344`).

E o teste de liderança existe no arquivo — **mas depende do resultado que o gate acabou de anular**
(`:242-256`):

```ts
const { data: isLiderDoCC = false } = useQuery({
  queryKey: ["requisicao_lider_cc", req?.codigo_centro_ctrl, user?.id],
  queryFn: … .from("compras_lideres_cc").eq("codigo_centro_ctrl", req.codigo_centro_ctrl) …,
  enabled: !!user && !!req?.codigo_centro_ctrl && ["aprovada","pendente_aprovacao"].includes(req?.status),
});
```

**A dependência é circular:** `req` é `null` para a líder → `enabled` é `false` → `isLiderDoCC` nunca
consulta → os cards de decisão e os botões Aprovar/Rejeitar do detalhe (Fase 3, §10.1) ficam mortos
para ela. É literalmente *"escopo `view_own` aplicado antes do teste de liderança"*, como a espec
suspeitou — no detalhe.

**Confirmado no bundle PUBLICADO** (mesma lógica, minificada):
```js
if(!o){const Oe=me.requisitante_user_id===(r==null?void 0:r.id),
        Ue=(n==null?void 0:n.funcionario_alvo_codigo)&&me.codigo_funcionario===n.funcionario_alvo_codigo;
       if(!Oe&&!Ue)return null}
```

**Efeito prático para a Ana, hoje:** a fila lista a requisição do Diego, mas
- clicar no card (`SuprimentosAprovacoes.tsx:241`) ou em **"Ver detalhe"** (`:286`) → *"Requisição não encontrada"*;
- ela não consegue ler **o que** está aprovando (itens, quantidades, data de necessidade, anexos);
- ela só consegue decidir "às cegas", pelos botões da própria fila.

**Por que nunca apareceu antes** — é a armadilha do `CLAUDE.md` ("um caminho feliz que nunca rodou
não é caminho validado"), medida:

```sql
select a.created_at, a.evento, a.user_nome, r.codigo_centro_ctrl, a.payload_enviado
from compras_requisicoes_auditoria a join compras_requisicoes r on r.id=a.requisicao_id
where a.evento in ('aprovada_lider','rejeitada_lider') order by 1 desc;
```
| quando | quem | CC | `automatica` |
|---|---|---|---|
| 14/08 11:17 | guilherme.oliveira | `00010.00002.00008` | **true** |
| 13/08 17:57 | guilherme.oliveira | `00010.00002.00008` | **true** |
| 12/08 16:33 | guilherme.oliveira | `00010.00002.00008` | **true** |
| 11/08 18:26 | guilherme.oliveira | `00010.00002.00008` | **true** |
| 11/08 17:10 | Pedro Scrignoli | `00007.00001.00002` | false |
| 11/08 17:10 | Pedro Scrignoli | `00007.00001.00002` | false |

**Zero decisões da Ana.** As 4 do Guilherme são `AUTO_APROVADA` (ele é líder do próprio CC e criou as
requisições — nunca abriu documento alheio). As 2 do Pedro são `is_admin`, que tem
`podeVerTodas = true` por bypass (`useHasPermission.ts:18`). **Nenhum líder sem `is_admin` jamais abriu
a requisição de outra pessoa.** A Ana é o primeiro caso da história do módulo.

### A1.5 O que NÃO consegui fechar daqui, e o teste que fecha

Não consigo, sem a sessão da Ana, provar qual das duas telas ela olhou. O que está medido:

| Afirmação | Estado |
|---|---|
| A fila **lista** a requisição para a Ana | ✅ provado no banco (`fila_visivel = 1`) e no bundle publicado |
| O **detalhe** recusa a requisição para a Ana | ✅ provado no código do repo **e** no bundle publicado |
| A **lista** `/suprimentos/requisicoes` nunca mostra a requisição do Diego para a Ana | ✅ provado (A3) — é `view_own`, por construção |

Hipóteses restantes para o relato "a fila dela não mostra", em ordem de probabilidade:
1. **Ela olhou a tela errada.** "Requisições de Compra" é `view_own` e nunca mostrará documento alheio;
   e ao abrir o detalhe pelo link/pela fila, o que aparece é **"Requisição não encontrada"** — o que se
   descreve exatamente como "não vejo a requisição".
2. **Ninguém a avisou.** `ESTADO §14.5` registra que não há e-mail: o líder só descobre pelo badge.
   A sessão dela em `auth.sessions` foi criada em **11/05/2026** e o último refresh de token é de
   **13/08/2026 15:29** — ela usa o app, mas **nunca fez login novo desde maio**
   (`auth.users.last_sign_in_at = 2026-05-11`); uma aba aberta há muito tempo pode estar rodando um
   bundle anterior à Fase 3, em que o item "Aprovações" **não existe**.
3. Defeito na fila que não aparece em leitura estática nem no banco — **descartado até prova em
   contrário** pelas evidências 1–6.

**Teste de 2 minutos que decide (pedir à Ana, com ela na tela):**
1. `Ctrl+Shift+R` (hard refresh) em `finance-pf.lovable.app`;
2. o menu **Suprimentos → Aprovações** aparece? tem **badge "1"**?
3. abrir Aprovações: a requisição *"COMPRA DE DOMINIO DRYPATCH"* está listada?
4. clicar em **"Ver detalhe"**: aparece *"Requisição não encontrada"*? → **confirma o A1.4**.

---

## A2 — O badge usa o mesmo filtro?

**Sim, o mesmo — e por isso badge e lista não podem divergir no caso da Ana.**

| | Badge | Lista |
|---|---|---|
| Hook / página | `src/hooks/useAprovacoesPendentes.ts:23-29` | `SuprimentosAprovacoes.tsx:70-78` |
| Função | `contarRequisicoesPendentes` (`requisicoesService.ts:1114-1129`) | `listarRequisicoesPendentes` (`:1135-1162`) |
| Filtro de status | `.eq("status","pendente_aprovacao")` | idem |
| Escopo | `.in("codigo_centro_ctrl", listarCentrosDeCustoDoLider(userId))` | **idem, mesma função** |
| Admin | conta todas | lista todas |

**As três divergências reais (nenhuma explica o caso, mas ficam registradas):**

1. **Teto de linhas.** A contagem não tem `.range()` (conta tudo no servidor com `head:true`); a lista
   trunca em **200** (`:1142`). Acima de 200 pendentes o badge diz mais do que a lista mostra, **sem
   aviso na tela** — e não há paginação na fila (`opts` existe no service, mas a página nunca passa
   `offset`). Hoje é inócuo (1 pendente).
2. **Gate de permissão.** O badge só consulta quem tem `compras.requisicoes.aprovar`
   (`useAprovacoesPendentes.ts:26`); a query da página não checa permissão nenhuma — quem protege é a
   rota (`App.tsx:281`). Comportamento equivalente, origens diferentes.
3. **Cache.** Badge com `staleTime: 60_000` + `refetchOnWindowFocus`; a lista usa o default do
   `QueryClient` (`App.tsx:81`, `new QueryClient()` sem opções ⇒ `staleTime: 0`). O badge pode ficar até
   1 minuto atrás da lista.

---

## A3 — Como o app resolve `view_own` / `view_all` hoje

### A3.1 De onde vem a resposta

| Camada | Arquivo:linha | O que faz |
|---|---|---|
| Carga | `src/contexts/AuthContext.tsx:53-65` | RPC **`get_user_permissions(p_user_id)`** → array de códigos em `AuthContext.permissions` |
| Leitura fina | `src/hooks/useHasPermission.ts:14-22` | `is_admin === true` ⇒ **true para tudo**; senão `permissions.includes(code)` |
| Leitura de módulo/rota | `src/hooks/usePermissions.ts:78-95` (`hasAccess`) | admin bypass; `MENU_TO_PERMISSION` (`:14-21`) traduz `suprimentos_requisicoes` → `compras.requisicoes.access`; chave com ponto vai direto ao RBAC; senão cai na tabela legada `user_permissions` |
| Gate de rota | `src/App.tsx:126-148` (`PermissionRoute`) | spinner enquanto `loading`; senão "Acesso Restrito" |

### A3.2 Onde o escopo é **aplicado**, documento por documento

| Tela | Permissão lida | Arquivo:linha do gate | Regra quando **não** tem `view_all` |
|---|---|---|---|
| **Requisições — lista** | `compras.requisicoes.view_all` | `SuprimentosRequisicoes.tsx:80` → aplicado em **`:162-169`** | `.or(requisitante_user_id.eq.<user>, codigo_funcionario.eq.<profile.funcionario_alvo_codigo>)`; sem `funcionario_alvo_codigo`, só `.eq(requisitante_user_id)` |
| **Requisições — detalhe** | `compras.requisicoes.view_all` | `SuprimentosRequisicaoDetalhe.tsx:121` → aplicado em **`:154-160`** | dono **ou** funcionário vinculado; **senão `return null` → "Requisição não encontrada"** 🔴 (A1.4) |
| **Fila do líder** | — **nenhuma** | `SuprimentosAprovacoes.tsx` / `requisicoesService.ts:1135-1162` | escopo é só `codigo_centro_ctrl in (CCs liderados)` |
| **Pedidos — lista** | `compras.pedidos.view_all` | `SuprimentosPedidos.tsx:202` → aplicado em **`:351-364`** | busca os `numero_alvo` das requisições **dele** e filtra `.in("numero_req_comp", …)`; **sem requisição ⇒ retorna `{pedidos: [], total: 0}` (`:359-361`)** |
| **Pedidos — detalhe** | `compras.pedidos.view_all` | `SuprimentosPedidoDetalhe.tsx:183` → aplicado em **`:205-227`** | "defesa em profundidade": o pedido precisa vir de requisição criada pelo usuário; senão `throw new Error("Você não tem permissão para ver este pedido.")` |
| Botão Reenviar (detalhe req) | `compras.requisicoes.reenviar_own` + ramo do líder | `SuprimentosRequisicaoDetalhe.tsx:242-256, :363` | Ajuste 1.2 §9.2 — **único lugar do frontend que já consulta `compras_lideres_cc`** |

**Fato estrutural:** a RLS **não participa de nada disso**. Todas as tabelas do módulo estão
`ALL … using(true)` para `authenticated` (`compras_requisicoes`, `_itens`, `compras_pedidos`, `_itens`,
`_itens_rateio`, `compras_lideres_cc`, `compras_requisicoes_auditoria`, `cost_centers`, `profiles`).
**Todo o escopo do módulo `compras` é frontend.** (É a DÍVIDA-RLS-COMPRAS-REQ, `ESTADO §7.1`.)

---

## A4 — A menor correção possível (descrição, **não** implementação)

### A4.1 Na fila: **nada a corrigir**

A query já faz o certo. Qualquer mudança ali seria mexer no que está medido como correto — e a
regra 10 do PROMPT 7.0 é explícita sobre o risco. **Recomendo não tocar** até o teste do A1.5 rodar.

### A4.2 No detalhe da requisição: **4 linhas dentro da queryFn que já existe**

Arquivo único: `src/pages/SuprimentosRequisicaoDetalhe.tsx`, bloco `:154-160`.

Hoje:
```ts
if (!podeVerTodas) {
  const isOwner = …; const isFuncionario = …;
  if (!isOwner && !isFuncionario) return null;
}
```
Proposta — **dentro da mesma `queryFn`**, onde `data.codigo_centro_ctrl` já está em mãos:
```ts
if (!podeVerTodas) {
  const isOwner = …; const isFuncionario = …;
  let isLider = false;
  if (!isOwner && !isFuncionario && data.codigo_centro_ctrl && user) {
    const { data: l } = await supabase.from("compras_lideres_cc").select("id")
      .eq("codigo_centro_ctrl", data.codigo_centro_ctrl)
      .eq("lider_user_id", user.id).eq("ativo", true).maybeSingle();
    isLider = !!l;
  }
  if (!isOwner && !isFuncionario && !isLider) return null;
}
```

**Por que esta e não outra:**

- **Zero código novo de acesso a dados.** É a mesma leitura de `compras_lideres_cc` que já existe no
  arquivo em `:245-251` — mudam o lugar e o gatilho, não a consulta.
- **Resolve a circularidade** sem reestruturar a renderização: a decisão acontece *dentro* da
  `queryFn`, com o `codigo_centro_ctrl` da linha recém-lida, e não depende de `req` já existir. Uma
  alternativa "mais limpa" (calcular `podeVer` fora, depois do `useQuery` de liderança) exigiria
  tratar o estado de carregamento da segunda query, senão pisca "Requisição não encontrada" —
  **mais superfície, mais risco.**
- **Uma ida extra ao banco só no caso raro:** a consulta só dispara quando o usuário **não** é dono,
  **não** é o funcionário e **não** tem `view_all`. Para dono, funcionário e admin, custo zero.
- **Não afrouxa nada para quem não é líder.** O universo liberado é exatamente
  `compras_lideres_cc (ativo=true)` — a **mesma tabela** que as RPCs `aprovar_requisicao`/
  `rejeitar_requisicao` usam no servidor para devolver `FORA_DO_SEU_CC`. A UI passa a espelhar uma
  autoridade que o banco **já** concede; nenhuma decisão nova fica possível. Quem não lidera o CC
  continua com `return null`, byte por byte.
- **Efeito colateral positivo e pretendido:** `isLiderDoCC` (`:242-256`) volta a rodar, porque `req`
  deixa de ser `null` — os cards e os botões Aprovar/Rejeitar do detalhe (Fase 3) ganham vida para o
  líder sem `is_admin` pela primeira vez.
- **Rollback:** `git revert` de um commit de um arquivo. Sem SQL, sem RPC, sem RLS, sem migration,
  sem mudança de permissão no RBAC.

**Validação obrigatória (a armadilha do CLAUDE.md):** testar **com a Ana**, ou com qualquer usuário
sem `is_admin` e sem `compras.requisicoes.view_all`. Com o Pedro o teste é inútil — o bypass do
`useHasPermission.ts:18` faz `podeVerTodas = true` e o ramo nem executa.

**Ainda em aberto depois desta correção** (não é regressão, é o mesmo buraco em outra tela): o líder
continua sem enxergar a requisição na **lista** `/suprimentos/requisicoes` — isso é a Parte B.

---

# PARTE B — A VISÃO AMPLIADA (§4.2)

## B1 — As queries das duas listagens e onde caberia o escopo "meus CCs"

### Requisições — `src/pages/SuprimentosRequisicoes.tsx:142-210`

| Aspecto | Como é hoje |
|---|---|
| Query | `.from("compras_requisicoes").select("*").order("created_at", desc)` (`:160`) |
| Escopo | `:162-169` — ver A3.2 |
| Filtros | status (`:171-179`, com 2 casos especiais: `convertida_pedido` = `numero_pedido_compra_alvo not null`; `sincronizada` = status + `numero_pedido_compra_alvo is null`), funcionário (`:181-183`), busca `ilike` OR em `numero_alvo`/`descricao`/`funcionario_nome` (`:186-192`), período sobre **`updated_at`** (`:194-203`) |
| Paginação | **NENHUMA.** Sem `.range()`, sem `count` — a tela traz a base inteira e ordena no cliente (`:212-229`). Hoje 323 requisições; o teto silencioso do PostgREST (1000) ainda não foi atingido |
| **Onde entra "meus CCs"** | **`:162-169`**. O bloco já é o único ponto de escopo. A forma segura é **aditiva**: `.or(requisitante_user_id.eq.X, codigo_funcionario.eq.Y, codigo_centro_ctrl.in.(…))` — nunca substituir, senão o líder **perde** as próprias requisições fora dos CCs que lidera |

⚠️ Armadilha do `.or()` do PostgREST: `in` dentro de `or` usa a sintaxe
`codigo_centro_ctrl.in.(a,b,c)` e a lista **não pode** conter `,` `(` `)` — os códigos de CC são
`[0-9.]`, então é seguro. Mas o `.or()` de busca textual (`:189`) e este seriam **dois `.or()` na mesma
query**, que o PostgREST combina com **AND** entre eles — o que é o comportamento desejado, mas precisa
ser testado, não presumido.

### Pedidos — `src/pages/SuprimentosPedidos.tsx:331-...`

| Aspecto | Como é hoje |
|---|---|
| Query | `.from("compras_pedidos").select("*", { count: "exact" })` (`:335`) |
| Ordenação | server-side, default `data_pedido desc nullsFirst:false` (`:343-348`) |
| Paginação | **server-side, `PAGE_SIZE = 30`** (`:261`, `.range(inicio, fim)` em `:350`) |
| Escopo | `:351-364` — ver A3.2. **Duas idas ao banco**: primeiro os `numero_alvo` das requisições do usuário, depois `.in("numero_req_comp", numerosReqs)` |
| Filtros | status efetivo via `aplicarFiltroStatusPedido` (`statusPedido.ts`), origem hub/alvo (`criado_no_hub`), comprador (`codigo_usuario`), busca `ilike` OR em 8 campos, período em `data_pedido` (só com De **e** Até) |
| **Onde entra "meus CCs"** | `:351-364` — mas **não dá para resolver no cliente** (ver B4): o CC do pedido mora em tabela **neta** |

## B2 — 🔴 A estrutura real do rateio **não é a que a espec descreve**

> **PROMPT 7.0 §2.2 e §4.3 dizem `compras_pedidos_itens.codigo_centro_ctrl` + `centro_ctrl_label`.
> Essas colunas NÃO existem nessa tabela.**

`information_schema.columns`:

| Tabela | Colunas relevantes |
|---|---|
| `compras_pedidos_itens` | `id, pedido_id, sequencia, item_servico, codigo_produto, codigo_alternativo_produto, codigo_prod_unid_med, produto_nome, produto_unidade, quantidade, valor_unitario, valor_total_item, observacao, created_at, updated_at` — **sem CC** |
| **`compras_pedidos_itens_rateio`** | `id, item_id, codigo_classe_rec_desp, classe_rec_desp_label, **codigo_centro_ctrl**, **centro_ctrl_label**, **percentual**, created_at` |
| `compras_pedidos` (cabeçalho) | tem **`centro_custo` text** — um CC único no cabeçalho |

**Cadeia:** `compras_pedidos` ←(FK `pedido_id`)— `compras_pedidos_itens` ←(FK `item_id`)—
`compras_pedidos_itens_rateio`. **Duas FKs, tabela neta.** As duas FKs existem
(`compras_pedidos_itens_pedido_id_fkey`, `compras_pedidos_itens_rateio_item_id_fkey`).

**Boa notícia:** existe `percentual`, e ele **fecha 100% em todos os itens**:

```sql
select round(soma_pct,4), count(*) from (select item_id, sum(percentual) soma_pct
  from compras_pedidos_itens_rateio group by item_id) t group by 1;
```
→ **`100.0000` · 125 itens** — linha única. Rateio proporcional exato é possível **onde existe rateio**.

### 🔴 …mas o rateio quase não existe

```sql
select (select count(*) from compras_pedidos_itens)                                  as itens,
       (select count(*) from compras_pedidos_itens_rateio)                           as rateios,
       (select count(codigo_centro_ctrl) from compras_pedidos_itens_rateio)          as rateio_com_cc,
       … itens_sem_rateio, pedidos_sem_rateio;
```

| itens | linhas de rateio | rateio com CC | **itens sem rateio** | **pedidos sem rateio** |
|---:|---:|---:|---:|---:|
| 2.599 | **139** | 139 (**100%**) | **2.474** | **1.772 de 1.863** |

`codigo_centro_ctrl` e `percentual` são **sempre** preenchidos quando a linha existe (139/139) — mas
**só 91 dos 1.863 pedidos têm qualquer rateio**. A leitura: o rateio Classe+CC é gravado pelo
**wizard do Hub** (`pedidosService.ts:1290`); pedido que veio do **sync do Alvo** não traz rateio.

O cabeçalho `compras_pedidos.centro_custo` cobre **1.328 de 1.863** (71%), com 74 valores distintos, no
mesmo formato de código (`00007.00001.00002`, e há `00010.00002.00007.00002` com 4 níveis — o
`DISCOVERY-FASE6 §12.1-3` já avisava: **validar por existência, nunca por regex**). Muitos são do bloco
morto `00001.*` (renumeração de 17/05/2026).

## B3 — Quantos pedidos têm rateio em mais de um CC

```sql
with por_pedido as (select i.pedido_id, count(distinct x.codigo_centro_ctrl) ccs
  from compras_pedidos_itens i join compras_pedidos_itens_rateio x on x.item_id=i.id group by 1)
select count(*) pedidos_com_rateio, count(*) filter (where ccs>1) multi_cc, max(ccs) from por_pedido;
```

| pedidos com rateio | **multi-CC** | máximo de CCs num pedido |
|---:|---:|---:|
| 91 | **4** | **7** |

O caso multi-líder **já existe em pedidos** (4 pedidos, um deles com 7 CCs) — ao contrário das
requisições. A regra do §2.2 ("documento visto inteiro, nunca recortado por percentual") vale: esses 4
pedidos aparecerão para os líderes de todos os CCs do rateio.

**Revalidação da medição de requisições da espec** (§2.2 diz "zero"):

```sql
select count(*) from compras_requisicoes r where exists (select 1 from compras_requisicoes_itens i
  where i.requisicao_id=r.id and i.codigo_centro_ctrl is not null
    and i.codigo_centro_ctrl is distinct from r.codigo_centro_ctrl);
```
→ **1**, não zero: requisição `37df7272-…` (nº `0001157`, 11/06/2026, `convertida_pedido`),
cabeçalho `00007.00001.00002`, item em **`00001.00003.00001`** — código do **bloco morto** da
renumeração. **Não é um caso real de rateio entre departamentos**, é resíduo de dado antigo. A
conclusão da espec (frente B pode esperar) **continua válida**; o número é que precisa de asterisco.

## B4 — Cliente × RPC/RLS: avaliação e recomendação

### Requisições → **cliente** (query com `.or(... , codigo_centro_ctrl.in.(…))`)

| Critério | Avaliação |
|---|---|
| max-rows 1000 | 323 requisições no total hoje. Mesmo liberando **todos** os 43 CCs já usados, o teto não é atingido. ✅ (mas a tela **não tem paginação** — ver B1; entrar em 1000 é questão de tempo, e hoje truncaria **em silêncio**) |
| Tamanho da URL | pior caso 80 CCs × 18 chars ≈ 1,5 KB — muito abaixo de qualquer limite |
| Regra 10 (vazamento) | o `.or()` é **aditivo**; ninguém perde nem ganha além dos CCs em que é líder ativo |
| RLS | **não mexer.** `using(true)` hoje; fechar RLS em `compras_requisicoes` é a DÍVIDA-RLS-COMPRAS-REQ (`ESTADO §7.1`) e afeta **todo** o módulo. Missão própria |
| Custo | 1 query extra (`listarCentrosDeCustoDoLider`, que já existe e já é usada pela fila) |

### Pedidos → **RPC** (`SECURITY DEFINER`, gate `auth.uid()`, lê `compras_lideres_cc` no servidor)

O cliente **não consegue** expressar o filtro:

1. O CC está em tabela **neta** (`…_itens_rateio`). PostgREST só filtra pai por neto com embedding
   `!inner` encadeado (`compras_pedidos_itens!inner(compras_pedidos_itens_rateio!inner(...))`), que
   **duplica linhas do pai** e **quebra o `count: "exact"`** — e a tela pagina server-side com
   `PAGE_SIZE = 30` (`:261`). A contagem e a paginação sairiam erradas.
2. O critério tem de ser um **OR entre três fontes** (rateio do neto **ou** `centro_custo` do
   cabeçalho **ou** CC da requisição de origem — ver C1): `.or()` do PostgREST **não atravessa
   embedding**.
3. O escopo tem de permanecer **aditivo** ao atual (pedidos das requisições próprias), que já custa
   uma pré-consulta (`:353-356`) sujeita ao teto de 1000.
4. max-rows: `max(pedidos por CC) = 178`, mas um líder de vários CCs pode passar de 1000 num filtro
   client-side sem paginação — no servidor isso é `limit/offset`, resolvido.

**Recomendação:** uma RPC de leitura, no molde já provado da Fase 6.1
(`listar_mapa_lideres`), com `p_offset`/`p_limit` e devolvendo também o `count` total. Nasce
`SECURITY DEFINER` + `set search_path=public`, gate `auth.uid() is null → 0 linhas`, e **com os DOIS
revokes** (`from anon` **e** `from public`) — a receita medida em `ESTADO §14.3`, que o `CLAUDE.md`
ainda registra pela metade.

⚠️ E, no `CREATE FUNCTION`, **tag nomeada** (`$p1$`), nunca `$$` (regra 3 do PROMPT 7.0).
⚠️ E `RETURNS TABLE`: aliases próprios nos CTEs, senão `column reference is ambiguous` em **tempo de
execução** (`ESTADO §12.5-3` — passou por todo o gate da Fase 6 e só apareceu na 1ª chamada real).

**Não mexer em RLS em nenhum dos dois casos.**

## B5 — Linha de base: o que um líder **sem `view_all`** vê hoje

Medido para a Ana (`e96876e1…`, `funcionario_alvo_codigo = '0000007'`, 12 CCs liderados):

| Tela | Hoje (`view_own`) | Com escopo "meus CCs" | Ganho |
|---|---:|---:|---:|
| Requisições | **7** | **44** | +37 |
| Pedidos | **3** | **37** | +34 |

(Pedidos "meus CCs" = união das três fontes de CC: rateio, `centro_custo` do cabeçalho e CC da
requisição de origem.)

É contra estes 4 números que a mudança deve ser medida. **Nenhum deles pode diminuir.**

## B6 — Tela de detalhe do pedido: sim, tem gate próprio 🔴

`src/pages/SuprimentosPedidoDetalhe.tsx:205-227` — a "defesa em profundidade":

```ts
if (!podeVerTodos && user) {
  const { data: pedMeta } = await supabase.from("compras_pedidos")
      .select("numero_req_comp, codigo_empresa_filial_req_comp").eq("id", id).single();
  if (!pedMeta?.numero_req_comp) throw new Error("Você não tem permissão para ver este pedido.");
  const { data: req } = await supabase.from("compras_requisicoes").select("requisitante_user_id")
      .eq("numero_alvo", pedMeta.numero_req_comp)
      .eq("codigo_empresa_filial", pedMeta.codigo_empresa_filial_req_comp).maybeSingle();
  if (!req || req.requisitante_user_id !== user.id) throw new Error("Você não tem permissão para ver este pedido.");
}
```

**Se o pedido passar a aparecer na lista sem este gate ser ampliado, o líder clica e leva um erro** —
o mesmo defeito do A1.4, em outro módulo, e desta vez **previsto antes de acontecer**. Dois detalhes
que endurecem o caso:

- `if (!pedMeta?.numero_req_comp) throw` — **todo pedido criado direto no Alvo (sem requisição) é
  invisível** para quem não tem `view_all`, independentemente de CC. São a maioria.
- A rota é `PermissionRoute permKey="compras.pedidos.access"` (`App.tsx:311-316`) — a Ana **tem** essa
  permissão, então ela chega na tela e o erro aparece **dentro** dela, não como "Acesso Restrito".

Nada na RLS atrapalha: `compras_pedidos`, `compras_pedidos_itens` e `compras_pedidos_itens_rateio`
estão todas `ALL … using(true)` para `authenticated`.

---

# PARTE C — RELATÓRIO DE GESTÃO (§4.3)

## C1 — Gasto por centro de custo, com líder e marca de "sem líder"

### C1.1 Primeiro, a reconciliação da referência

A espec cita "agosto/2026 (01→12) = 92 pedidos, R$ 1.642.742,28". **Medido: esse número não é 01→12.**

| Janela sobre `data_pedido` | pedidos | soma `valor_total` |
|---|---:|---:|
| 01/08 → 12/08 | 69 | 1.277.996,14 |
| 01/08 → 13/08 | 91 | 1.587.742,28 |
| **01/08 → 31/08 (mês inteiro)** | **92** | **1.642.742,28** ✅ |

A diferença é o dia **13/08** (22 pedidos) mais **um pedido com `data_pedido = 2026-08-25`** (futuro,
R$ 55.000,00). Bate **ao centavo** com o mês fechado. `data_pedido`, `data_cadastro` e
`data_digitacao_alvo` dão o mesmo resultado; `created_at` **não** (1.316.181,86 no mesmo intervalo) —
é a data de chegada no Hub, não a competência. **A consulta usa `data_pedido`.**
Cancelado: **1 pedido, R$ 213,00** ✅ (confere com a espec).

### C1.2 O critério de rateio adotado — e por que

Três decisões, cada uma com a medição que a sustenta:

1. **A base monetária é `compras_pedidos.valor_total` (cabeçalho), nunca a soma dos itens.**
   Nos 42 pedidos de agosto com rateio, `sum(valor_total_item) = 723.343,95` contra
   `sum(valor_total) = 525.339,83`. Três pedidos explicam quase tudo:

   | nº | `valor_total` | soma dos itens |
   |---|---:|---:|
   | 0004586 | 48.750,00 | **191.795,42** |
   | 0004495 | 55.000,00 | **110.000,00** |
   | 0004625 | 1.092,90 | 1.051,60 (diferença = frete 41,30) |

   Somar item não reconcilia com nada. **Item serve de peso, não de valor.**

2. **O rateio usa `percentual` como peso, normalizado por pedido:**
   `peso_cc = Σ(valor_total_item × percentual/100) / Σ(mesmo, sobre o pedido inteiro)`, e
   `valor_cc = valor_total × peso_cc`. Como `percentual` fecha 100 em **todos** os itens (B2), os
   pesos somam 1 e **as partes de cada pedido somam exatamente o seu `valor_total`**. Rateio
   proporcional exato, sem contar o pedido inteiro para cada CC.

3. **Cascata de fontes do CC, do mais específico ao menos:**
   `rateio dos itens` → `centro_custo` do cabeçalho → CC da requisição de origem
   (`numero_alvo = numero_req_comp`) → **`(SEM CENTRO DE CUSTO)`**. Cada pedido entra por
   **exatamente uma** fonte, então não há dupla contagem.

### 🔴 C1.3 O que a consulta NÃO consegue dizer — e isso é o achado principal do C

Distribuição de agosto/2026 por **fonte do CC**:

| origem do CC | pedidos | valor | % do mês |
|---|---:|---:|---:|
| `rateio_itens` (exato) | 42 | 525.339,83 | 32,0% |
| `cabecalho_pedido` | 14 | 179.982,20 | 11,0% |
| `requisicao_origem` | 0 | 0,00 | 0,0% |
| **`sem_centro_de_custo`** | **36** | **937.420,25** | **57,1%** |
| **TOTAL** | **92** | **1.642.742,28** | 100% ✅ |

**57% do gasto de agosto não tem centro de custo algum no Hub** — nem rateio, nem cabeçalho, nem
requisição de origem. São, na maioria, pedidos criados direto no Alvo e trazidos pelo sync.

> **Portanto: o relatório reconcilia com R$ 1.642.742,28, mas o "gasto por CC" só explica
> R$ 705.322,03 (43%). O restante aparece numa linha própria, `(SEM CENTRO DE CUSTO)`, e essa linha
> não pode ser escondida nem distribuída — seria número errado.** Fechar essa lacuna é levantamento
> de dado (ou mudança no sync do Alvo), não SQL.

### C1.4 A consulta — pronta para o Pedro colar no SQL Editor

Só `select`. Altere as duas datas do CTE `params`.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- GASTO POR CENTRO DE CUSTO × LÍDER RESPONSÁVEL
-- Período: informado no CTE `params` (competência = compras_pedidos.data_pedido)
-- Rateio  : proporcional exato por `percentual` onde há rateio; cascata de
--           fontes quando não há. Base monetária = valor_total do cabeçalho.
-- Confere : a soma da coluna `valor` = soma de valor_total dos pedidos do período.
-- ═══════════════════════════════════════════════════════════════════════════
with params as (
  select date '2026-08-01' as p_de,
         date '2026-08-31' as p_ate
),
ped as (
  select p.id, p.numero, p.data_pedido, p.valor_total, p.status,
         p.centro_custo, p.numero_req_comp
  from public.compras_pedidos p cross join params
  where p.data_pedido >= params.p_de and p.data_pedido <= params.p_ate
),
-- peso bruto de cada CC dentro do pedido (Σ item × percentual)
peso_rateio as (
  select i.pedido_id,
         x.codigo_centro_ctrl                         as cc,
         max(x.centro_ctrl_label)                     as cc_label,
         sum(i.valor_total_item * x.percentual / 100.0) as base
  from public.compras_pedidos_itens i
  join public.compras_pedidos_itens_rateio x on x.item_id = i.id
  where i.pedido_id in (select id from ped)
  group by 1, 2
),
-- normaliza para somar 1 por pedido (blinda contra item cujo valor não bate com o total)
peso_norm as (
  select pedido_id, cc, cc_label,
         base / nullif(sum(base) over (partition by pedido_id), 0) as peso
  from peso_rateio
),
atribuido as (
  -- (1) tem rateio: divide o valor_total do CABEÇALHO pelos pesos do rateio
  select p.id, p.numero, p.status, n.cc, n.cc_label,
         'rateio_itens'::text as origem, p.valor_total * n.peso as valor_cc
  from ped p join peso_norm n on n.pedido_id = p.id

  union all
  -- (2) sem rateio, mas com CC no cabeçalho do pedido
  select p.id, p.numero, p.status, p.centro_custo, null,
         'cabecalho_pedido', p.valor_total
  from ped p
  where not exists (select 1 from peso_norm n where n.pedido_id = p.id)
    and p.centro_custo is not null

  union all
  -- (3) sem rateio e sem CC no cabeçalho: herda o CC da requisição de origem
  select p.id, p.numero, p.status, r.codigo_centro_ctrl, r.centro_ctrl_nome,
         'requisicao_origem', p.valor_total
  from ped p
  cross join lateral (
    select r2.codigo_centro_ctrl, r2.centro_ctrl_nome
    from public.compras_requisicoes r2
    where r2.numero_alvo = p.numero_req_comp
      and r2.codigo_centro_ctrl is not null
    limit 1
  ) r
  where not exists (select 1 from peso_norm n where n.pedido_id = p.id)
    and p.centro_custo is null

  union all
  -- (4) nenhuma fonte de CC — NÃO distribuir, NÃO esconder
  select p.id, p.numero, p.status, null, null,
         'sem_centro_de_custo', p.valor_total
  from ped p
  where not exists (select 1 from peso_norm n where n.pedido_id = p.id)
    and p.centro_custo is null
    and not exists (select 1 from public.compras_requisicoes r3
                    where r3.numero_alvo = p.numero_req_comp
                      and r3.codigo_centro_ctrl is not null)
),
lid as (
  select l.codigo_centro_ctrl,
         string_agg(coalesce(pr.full_name, pr.email), ', ' order by pr.email) as lideres
  from public.compras_lideres_cc l
  left join public.profiles pr on pr.user_id = l.lider_user_id
  where l.ativo
  group by 1
)
select
  coalesce(a.cc, '(SEM CENTRO DE CUSTO)')                                   as centro_custo,
  coalesce(cc.name, max(a.cc_label), '(fora do espelho cost_centers)')      as nome_cc,
  coalesce(lid.lideres, '*** SEM LIDER ***')                               as lider,
  count(distinct a.id)                                                      as pedidos,
  round(sum(a.valor_cc), 2)                                                 as valor,
  round(sum(a.valor_cc) filter (where a.status ilike '%cancel%'), 2)        as valor_cancelado,
  string_agg(distinct a.origem, ' + ')                                      as origem_do_cc
from atribuido a
left join public.cost_centers cc on cc.erp_code = a.cc
left join lid                    on lid.codigo_centro_ctrl = a.cc
group by a.cc, cc.name, lid.lideres
order by 5 desc;
```

**Conferência que deve acompanhar o relatório** (a linha `TOTAL` tem de bater com o bruto do período):

```sql
-- cole junto: total do período, para reconciliar com a soma da coluna `valor`
select count(*) as pedidos, sum(valor_total) as bruto,
       count(*) filter (where status ilike '%cancel%')      as cancelados,
       sum(valor_total) filter (where status ilike '%cancel%') as valor_cancelado
from public.compras_pedidos
where data_pedido >= date '2026-08-01' and data_pedido <= date '2026-08-31';
-- esperado em agosto/2026: 92 · 1642742.28 · 1 · 213.00
```

### C1.5 Resultado real de agosto/2026 (a consulta acima, executada)

| centro de custo | nome | líder | pedidos | valor |
|---|---|---|---:|---:|
| **(SEM CENTRO DE CUSTO)** | — | *** SEM LIDER *** | 36 | **937.420,25** |
| 00010.00002.00007.00002 | ALMOXARIFADO/EXPEDICAO | *** SEM LIDER *** | 5 | 214.200,00 |
| 00008.00001.00006 | LAB PESQUISA | *** SEM LIDER *** | 1 | 114.639,99 |
| 00010.00002.00002 | RECURSOS HUMANOS | *** SEM LIDER *** | 11 | 81.693,62 |
| 00008.00001.00005 | PESQUISA E DESENVOLVIMENTO | *** SEM LIDER *** | 1 | 55.000,00 |
| **00007.00001.00002** | MARKETING E COMUNICACAO | **ana.sanches** | 8 | 51.508,44 |
| 00008.00002.00018 | DD001 DRYPATCH | *** SEM LIDER *** | 1 | 48.750,00 |
| 00008.00002.00019 | ENDOPROTESE | *** SEM LIDER *** | 2 | 41.846,01 |
| 00008.00002.00005 | HV-05 MITRAL VALVE SE | *** SEM LIDER *** | 1 | 33.650,00 |
| 00010.00002.00001 | ADMINISTRATIVO | *** SEM LIDER *** | 4 | 26.689,00 |
| 00008.00001.00003 | DESIGN E DESENVOLVIMENTO | *** SEM LIDER *** | 3 | 13.747,90 |
| 00008.00001.00002 | LABORATORIO | *** SEM LIDER *** | 1 | 4.600,00 |
| 00007.00006.00001 | PF USA (TRICAV) | *** SEM LIDER *** | 1 | 4.000,00 |
| 00010.00004.00001 | ASSUNTOS REGULATORIOS | *** SEM LIDER *** | 2 | 3.213,67 |
| 00008.00002.00020 | PROJETO DEVIE | *** SEM LIDER *** | 1 | 2.600,00 |
| 00010.00003.00002 | CONTROLE DA QUALIDADE | *** SEM LIDER *** | 2 | 2.429,99 |
| 00007.00001.00003 | CORELAB | *** SEM LIDER *** | 2 | 2.292,65 |
| **00010.00002.00008** | TI - TECNOLOGIA DA INFORMACAO | **guilherme.oliveira** | 3 | 1.495,87 |
| **00010.00002.00003** | CONTROLADORIA/FINANCEIRO | **Pedro Scrignoli** | 4 | 1.188,00 |
| 00008.00001.00001 | PROTOTIPAGEM | *** SEM LIDER *** | 2 | 1.182,89 |
| 00010.00002.00007.00001 | COMPRAS | *** SEM LIDER *** | 1 | 594,00 |

**Total: 92 pedidos · R$ 1.642.742,28** ✅ reconcilia com a referência.

**Leitura de gestão:** dos R$ 1,64 M de agosto, **apenas R$ 54.192,31 (3,3%) estão sob um CC com líder
mapeado**. O gate de aprovação, hoje, cobre uma fração mínima do dinheiro — não por defeito, mas porque
**14 CCs de 80 estão mapeados** (3 líderes: Ana 12, Guilherme 1, Pedro 1).

---

# GATE DE SAÍDA (§5)

| # | Exigência | Estado |
|---|---|---|
| 1 | `DISCOVERY-FASE7A.md` na raiz com A1–A4, B1–B6, C1, cada achado com evidência | ✅ |
| 2 | Nenhum arquivo de código alterado · nenhuma escrita no banco | ✅ `git status` limpo em `src/`; MCP `read_only`, só `select` (mais um `begin … rollback` para emular a identidade da Ana) e três `GET` HTTP com a chave anon pública |
| 3 | `git add` só deste arquivo + commit `"docs(suprimentos): discovery fase 7a — visao do lider por CC"`, **sem push** | ✅ |
| 4 | Resumo executivo, contradições da espec, perguntas para o Pedro | abaixo |

## Resumo executivo

1. **A fila do líder não tem o defeito.** Medida sob a identidade da Ana no Postgres, ela devolve a
   requisição do Diego (`fila_visivel = 1`). O bundle publicado é idêntico ao HEAD.
2. **O defeito está no detalhe da requisição** (`SuprimentosRequisicaoDetalhe.tsx:154-160`): o escopo
   `view_own` não tem ramo de líder, então a Ana recebe **"Requisição não encontrada"** ao abrir o
   documento que precisa decidir. Pior: o teste de liderança existe no arquivo (`:242-256`) mas
   **depende de `req`**, que o gate acabou de zerar — dependência circular. Nunca apareceu porque
   **nenhum líder sem `is_admin` jamais abriu requisição alheia** (auditoria: 4 auto-aprovações do
   Guilherme, 2 do Pedro com bypass, **zero** da Ana).
3. **A correção é de 4 linhas dentro da `queryFn` que já existe**, reusando a leitura de
   `compras_lideres_cc` que o próprio arquivo já faz. Sem SQL, sem RPC, sem RLS, sem RBAC.
4. **A estrutura de rateio dos pedidos não é a da espec:** o CC vive em
   `compras_pedidos_itens_rateio` (tabela **neta**, com `percentual`), não em `compras_pedidos_itens`.
5. **A visão ampliada precisa de RPC para pedidos** (tabela neta + OR de três fontes + paginação
   server-side) e de query no cliente para requisições. **RLS não se toca.**
6. **O relatório de gestão reconcilia (R$ 1.642.742,28) mas só explica 43% por CC:** 57% do gasto de
   agosto não tem centro de custo algum no Hub. E só **3,3%** está sob CC com líder mapeado.
7. **Se o pedido passar a aparecer para o líder, o detalhe do pedido também trava**
   (`SuprimentosPedidoDetalhe.tsx:205-227`) — mesmo defeito do item 2, previsto antes de acontecer.

## O que contradiz a especificação

| # | A espec diz | O medido |
|---|---|---|
| 1 | §2.1: "o filtro está na query do frontend — `view_own` aplicado antes do teste de liderança" (na fila) | ✅ mecanismo certo, ❌ lugar errado. A fila não tem `view_own`; **o detalhe tem**, e lá o `view_own` está mesmo antes do teste de liderança |
| 2 | §2.2 e §4.3: CC do pedido em `compras_pedidos_itens.codigo_centro_ctrl` + `centro_ctrl_label` | ❌ essas colunas **não existem** nessa tabela. Vivem em **`compras_pedidos_itens_rateio`** (neta), que também tem **`percentual`** |
| 3 | §4.3: "verificar se há coluna de percentual/valor no item" | ✅ há (`percentual`), e fecha **100,0000 em todos os 125 itens** — rateio exato é possível **onde há rateio**. Mas só **91 de 1.863 pedidos** têm rateio |
| 4 | §4.3: "o total por CC deve reconciliar com 92 pedidos / R$ 1.642.742,28 (agosto 01→12)" | ⚠️ esse número é o **mês inteiro** (inclui 13/08 e um pedido datado 25/08), não 01→12. 01→12 dá 69 pedidos / R$ 1.277.996,14. Com o mês fechado a conta bate **ao centavo** |
| 5 | §2.2: "medido: **zero** requisições com itens em CCs diferentes" | ⚠️ hoje há **1** (`0001157`), e o CC do item é do **bloco morto `00001.*`** — resíduo da renumeração, não rateio real. A conclusão (frente B pode esperar) segue válida |
| 6 | §2.2: "vínculo do pedido por qualquer CC presente no rateio" | ⚠️ insuficiente sozinho: **1.772 de 1.863 pedidos não têm rateio**. Sem incluir `compras_pedidos.centro_custo` (cabeçalho, 1.328 preenchidos) o líder não veria quase nada |
| 7 | §1: "13 CCs mapeados de 80" / `ESTADO §1`: `lider_departamento` sem `create`/`reenviar_own` | ⚠️ desatualizado: hoje são **14 CCs / 3 líderes** (Guilherme entrou 11/08 16:40) e o papel **já tem** as 4 permissões — o SQL do `ESTADO §10.2` foi executado |

## Perguntas que só o Pedro pode responder

1. **O teste do A1.5 com a Ana** (hard refresh → menu Aprovações → badge → lista → "Ver detalhe"). É o
   que separa "ela olhou a tela errada" de "há algo na fila que a leitura estática não pega". **Bloqueia
   fechar o A1 com certeza**, embora não bloqueie a correção do A4.2, que é necessária de qualquer jeito.
2. **O líder passa a ver os documentos dos seus CCs em qualquer status — inclusive `rascunho` e
   `rejeitada` de outras pessoas.** Confirma? (O §2.2 diz "em qualquer status"; vale registrar que
   rascunho alheio é o caso mais sensível.)
3. **Pedido sem CC nenhum (57% do valor de agosto):** o líder deve vê-lo? Hoje ninguém sem `view_all`
   vê. Sugestão: **não** — mas então o relatório e a tela contarão histórias diferentes, e isso precisa
   de texto na tela.
4. **`(SEM CENTRO DE CUSTO)` no relatório** fica como linha visível (recomendo) ou o relatório se
   restringe ao que tem CC, com o total declarado como parcial?
5. **Vale abrir uma missão para o CC dos pedidos do Alvo?** Enquanto 57% do gasto não tiver CC, nem a
   visão do líder nem o relatório cobrem o dinheiro de verdade.
6. **Corrigir a regra de `revoke` no `CLAUDE.md`** (`ESTADO §7.0`): a RPC de pedidos do B4 vai precisar
   dos **dois** revokes. Enquanto o doc-mãe estiver pela metade, toda RPC nova nasce com o buraco.
7. **A `data_pedido = 2026-08-25`** (R$ 55.000,00, pedido `0004495`, cujos itens somam o dobro do
   cabeçalho) é dado correto ou erro de digitação no Alvo? Ela entra no fechamento de agosto.
