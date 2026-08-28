# Card F — retry automático nos caminhos de CRIAÇÃO do `erp-proxy`

> **Diffs preparados, NÃO aplicados.** O `erp-proxy` é editado exclusivamente pelo Pedro, via GitHub Web.
> Medido em 28/08/2026 sobre `origin/main` do `erp-proxy` (`fc5d549`, lido por `git show`) e sobre o banco
> `hbtggrbauguukewiknew` pelo MCP em modo leitura.
>
> **v2 — 28/08/2026.** O escopo do card mudou por decisão do Pedro: *"você achou que o buraco é maior
> que o card. Reescreva o card F com o escopo real."* A v1 tratava só `/ped-comp/insert`, que é a
> **menor** das superfícies — 4 envios contra 134 do caminho multipart.

---

## 1. O que está no ar hoje

`src/alvo-client.ts` tem **duas** funções de chamada ao Alvo, e elas tratam o retry de forma diferente:

```ts
const NAO_REPETIR = new Set<string>([
  "ReqMat/ValidarAtendimento",
  "ReqMat/FinalizarAtendimento",
]);

// callAlvo  (JSON)
if (isAuthError(firstAttempt.status) && !NAO_REPETIR.has(endpoint.split("?")[0])) { … repete … }

// callAlvoMultipart
if (isAuthError(firstAttempt.status)) { … repete … }     // ← NÃO consulta o Set
```

`isAuthError` = **401, 403 ou 409**. O comentário do próprio Set diz por que ele existe:
*"a primeira chamada pode ter baixado estoque antes de o erro voltar, e o retry baixaria de novo"*.

### 🔴 O escopo real, por exposição medida

**`callAlvoMultipart` não consulta a lista em momento nenhum** — então acrescentar endpoints ao Set,
que é o que o card original pedia, **não alcança o lado multipart**. E é por ali que passa o caminho
de criação mais usado do Hub.

| # | Rota do gateway | Endpoint do Alvo | Cliente no Hub | Por onde repete | Exposição |
|---|---|---|---|---|---|
| **1** | `/ped-comp/insert-multipart` | `pedComp/SaveMultiPart?action=Insert&…` | **Suprimentos** (criação de pedido) | `callAlvoMultipart` — **sem Set** | **134 pedidos** |
| **2** | `/req-comp/insert-multipart` | `ReqComp/SaveMultiPart?action=Insert` | Suprimentos (requisição com anexo) | `callAlvoMultipart` — **sem Set** | parte dos **226** envios |
| **3** | `/mov-estq/save` | `MovEstq/SaveMovEstqMultPart?action=Insert` | Notas de serviço | `callAlvoMultipart` — **sem Set** | **não medida** — ver §7 |
| **4** | `/req-comp/insert` | `ReqComp/SavePartial?action=Insert` | Suprimentos (requisição sem anexo) | `callAlvo`, fora do Set | resto dos **226** |
| **5** | `/ped-comp/insert` | `PedComp/SavePartial?action=Insert` | **Projetos** | `callAlvo`, fora do Set | **4 envios** |
| **6** | `/cartao` (1 site), `/intercompany` (3 sites) | `DocFin/SavePartial?action=Insert` | Cartões, Intercompany | `callAlvo`, fora do Set | não medida |
| **7** | `/alvo/passthrough` | `ReqMat/SaveReqMat` com `{Action:"Insert"}` | Ordem de Produção | `callAlvo`, fora do Set | não medida · **caso especial, §8** |

⚠️ **A rota do card original é a #5 — a menor de todas.**

⚠️ `MovEstq/SaveMovEstqMultPart` é **literalmente o caso que o comentário do Set descreve** (baixa de
estoque) e está do lado que não consulta o Set.

⚠️ Grafia: o endpoint do pedido multipart é **`pedComp`** com `p` minúsculo, contra `PedComp/SavePartial`.
`Set.has` é sensível a caixa. **Copie as strings deste documento, não as digite.**

ℹ️ **Terceiro caminho de escrita, fora do `alvo-client.ts`:** `src/services/alvo-anexar-pdf.ts` faz
`fetch` cru para `DocFin/SaveMultiPart?action=Update&savePartial=false`, sem passar por `callAlvo` nem
por `callAlvoMultipart`. É **Update**, não criação, então não muda a conclusão — mas o Set **não cobre
toda escrita ao ERP**, e quem ler este documento depois precisa saber disso.

---

## 2. Existe caso histórico compatível com duplicata por retry?

### **NÃO.** Nenhum caso compatível, nas duas rotas de criação de pedido.

> ⚠️ **CORREÇÃO DE 28/08/2026.** A primeira versão respondeu com um método que tinha **dois furos**,
> achados por revisão adversarial e confirmados. A **conclusão não mudou**; o método e os números, sim.
>
> **Furo 1 — predicado ancorado.** A varredura usou `texto LIKE '[Hub]%'`, mas o cabeçalho **nem sempre
> está no início**: quando o ERP gera o pedido a partir de uma requisição, ele copia o `Texto` dela para
> depois de blocos como `FORMA DE PAGAMENTO : BOLETO`. Medido: ancorado = **171**, não ancorado = **241**.
> **70 pedidos ficaram de fora**, e é neles que moravam os casos que faltavam — eram **2** cabeçalhos
> repetidos, são **7**.
> **Furo 2 — o teste não cobria a rota do card.** Os pedidos de `/ped-comp/insert` **não têm o cabeçalho
> `[Hub]`**: o `Texto` deles é `Projeto: <nome> | Req #<n>`, e entram com `criado_no_hub = false`. A frase
> "134 de 134 pedidos criados no Hub carregam o fingerprint (100% do caminho de criação)" era verdadeira
> sobre `criado_no_hub = true` e **falsa** como cobertura: poder **zero** sobre a rota denunciada.

### Método

Um retry acontece **dentro da mesma requisição HTTP**: o segundo documento nasceria do **mesmo payload**
— mesmo `DataPedido`, mesmo `CodigoUsuario`, milissegundos depois — e o Hub registraria **um único**
`envio_sucesso`. São dois fingerprints, um por rota, ambos gerados **uma vez por envio**:

| Rota | Fingerprint | Predicado |
|---|---|---|
| multipart (Suprimentos) e requisições | `[Hub] <papel>: <pessoa> \| dd/mm/aaaa hh:mm \| ID: <8 hex>` | **não ancorado** — casa `[Hub]` em qualquer posição |
| `/ped-comp/insert` (Projetos) | `Projeto: <nome> \| Req #<n>` | ancorado no início |

### Resultado A — rota `/ped-comp/insert`, fingerprint de Projetos

**10 pedidos** com o fingerprint *(medido 28/08/2026 ~11:40 UTC)* — os 8 do incidente §13.4 do
`PLANO-PROJETOS` mais os 2 do A/B de 27/08. **Zero fingerprints repetidos.** `0004798` e `0004799` são
R$ 100, mesmo fornecedor, mesmo dia e mesmo usuário, mas têm `Req #65` e `Req #66`: deliberados, com 9
minutos de intervalo.

### Resultado B — rota multipart e requisições, fingerprint `[Hub]`

**241 pedidos** com o fingerprint; **7** cabeçalhos repetidos, e **nenhum** com assinatura de retry. O
mecanismo dominante explica por que o cabeçalho aparece no meio do texto: **o ERP gera vários pedidos a
partir de UMA requisição e copia o `Texto` dela em cada um** (fan-out), ou alguém re-gera dias depois.

| Cabeçalho | Pedidos | Por que NÃO é retry |
|---|---|---|
| `bianca.goncalves \| 10/08 09:28` | 0004702 (19/08) · 0004724 (21/08) · 0004727 (21/08) | Todos `criado_no_hub=false` — **o Hub nunca criou nenhum**. Geração no ERP a partir da req 0001397. |
| `nathalia.richele \| 16/06 15:27` | 0004441 · 0004444 · 0004445 (todos 16/07) | **Fan-out**: mesma req 0001241, **2 fornecedores e 3 valores diferentes**. |
| `elisangela.silva \| 11/08 20:33` | 0004642 (hub, 11/08, ELISANGELA) · 0004644 (nat, **12/08**, **GUSTAVO.GOULART**, Cancelado) | **Dia diferente e usuário do ERP diferente** — um retry não muda nem um nem outro. |
| `diego.amancio \| 15/06 13:58` | 0004209 (15/06) · 0004313 (**24/06**) | 9 dias de intervalo. |
| `isabela.catanoze \| 29/06 11:04` | 0004777 · 0004778 (ambos 26/08) | **Fan-out**: mesma req 0001274, 2 fornecedores e 2 valores. |
| `bianca.goncalves \| 14/07 15:31` | 0004443 (16/07, RYAN.PAGANOTTO) · 0004728 (**21/08**, ELISANGELA) | **36 dias**, usuários diferentes, os dois `criado_no_hub=false`. |
| `bharguan.nogueira \| 23/06 14:13` | 0004331 (26/06, R$ 6.985,60) · 0004672 (**14/08**, R$ 1.522,40) | **Valores diferentes** — recompra parcial. |

**Nenhum par compartilha `DataPedido` E `CodigoUsuario` com números adjacentes** — a assinatura mínima
de um retry.

### Cobertura, e o que ela NÃO cobre

- `criado_no_hub = true`: **134 de 134** carregam o fingerprint `[Hub]` — caminho multipart 100% coberto.
- `/ped-comp/insert`: **10 de 10** pedidos do módulo carregam o fingerprint de Projetos.
- Requisições: 238 de 363 têm o cabeçalho; os 125 sem ele **vieram do espelho** e nunca passaram pelo
  payload do Hub — fora do universo da pergunta. **Zero** repetidos.

⚠️ **Três limites declarados:**
1. O gêmeo de um retry é um documento que o Hub nunca registrou — só aparece aqui se o cron o
   **descobrir**. O Job 3 roda de hora em hora e traz `texto`; a janela cega é pequena, não é zero.
2. **Premissa não testada:** que o Alvo persista o `Texto` quando devolve 401/403/409 num Insert. Se
   gravou o pedido **sem** o `Texto`, o gêmeo nasce sem fingerprint e o teste tem poder zero.
3. **Fonte direta não consultada:** os logs do Render (`[alvo-client] … invalidando token e tentando de
   novo`) são a única evidência de quantos retries já ocorreram em endpoint de criação.

⇒ A afirmação é **"nenhum caso compatível encontrado"**, não "nunca aconteceu".

### ⇒ Prioridade

Pela regra do §14.10: **não há caso histórico ⇒ risco LATENTE.** Não sobe na ordem.
O custo por ocorrência, porém, é **um documento a mais no ERP que o Hub não conhece** — a mesma
divergência Hub × ERP que o L7-B veio matar, e mais cara de descobrir que o `UQ_PK` do D4: aquele falha
ruidosamente, este passa em silêncio.

---

## 3. Os quatro patches, na ordem de aplicação

Todos em **`src/alvo-client.ts`**, e **só nele**. Aplique em ordem — o **PATCH 0 é pré-requisito dos
outros três** e, sozinho, **não muda comportamento nenhum**.

| Patch | O que faz | Muda comportamento? | Fecha |
|---|---|---|---|
| **0** | Extrai `naoRepetir()` e faz as **duas** funções consultarem a lista | **Não** — a lista continua com os mesmos 2 endpoints | nada (habilita) |
| **1** | Acrescenta o pedido e a requisição multipart/JSON | Sim | **134 pedidos** + as requisições |
| **2** | Acrescenta o pedido JSON (o card original) | Sim | **4 envios** |
| **3** | Acrescenta a baixa de estoque | Sim | notas de serviço |

**Se for aplicar um só:** aplique **0 + 1**. É a maior superfície e a que o card original não via.

### ⛔ LIMITAÇÃO CONHECIDA DOS QUATRO PATCHES — leia antes de dar o card por fechado

**`ReqMat/SaveReqMat` NÃO é coberto por nenhum dos patches, e continua sendo repetido em
401/403/409 depois de todos eles aplicados.** Não é esquecimento: a `action` desse endpoint vai
**no BODY** (`{Action:"Insert"|"Update"}`), então `endpoint.split("?")[0]` devolve
`ReqMat/SaveReqMat` para os dois casos e **não há chave que os separe**.

Consequências práticas, para ninguém achar que está coberto:
- Depois dos patches, **criar Ordem de Produção continua com retry**. O que o Hub documenta sobre
  isso (`src/services/alvoReqMatSaveService.ts`): *"Quando o Insert passa e o Update falha, a RM
  existe no ERP e está morta — e o reflexo do operador ('não funcionou, vou de novo') DUPLICARIA
  a RM."*
- A verificação de log do §10 **não detecta**: como a action não está na query, ele nunca apareceu
  como `action=Insert`. Um log limpo de `action=Insert` **não significa** que o `SaveReqMat` parou
  de repetir.
- Fechar exige uma decisão (§8) e, na opção mais completa, uma mudança maior no `alvo-client`
  (levar a `action` do body para a chave). **Card próprio.**

---

## 4. PATCH 0 — pré-requisito · `naoRepetir()` nas duas funções

Muda a chave de busca para aceitar **caminho puro OU endpoint completo com query**, e faz
`callAlvoMultipart` — que hoje ignora a lista — passar a consultá-la. **Comportamento idêntico ao
atual**, porque a lista ainda só tem os dois `ReqMat/*`.

```diff
--- a/src/alvo-client.ts
+++ b/src/alvo-client.ts
@@
-/** Endpoints que NUNCA podem ser repetidos automaticamente: a primeira chamada
- *  pode ter baixado estoque antes de o erro voltar, e o retry baixaria de novo. */
+/** Endpoints que NUNCA podem ser repetidos automaticamente: a primeira chamada
+ *  pode ter tido efeito no ERP antes de o erro voltar, e o retry repetiria o efeito. */
 const NAO_REPETIR = new Set<string>([
   "ReqMat/ValidarAtendimento",
   "ReqMat/FinalizarAtendimento",
 ]);
+
+/** Um endpoint não se repete se a lista tiver o CAMINHO PURO (vale para todas as
+ *  actions) ou o ENDPOINT COMPLETO com query (vale só para aquela action).
+ *
+ *  A distinção existe porque criar e atualizar compartilham endpoint no Alvo:
+ *  `PedComp/SavePartial?action=Insert` cria e `?action=Update` altera. Barrar o
+ *  caminho puro mataria o retry dos dois; o Update é idempotente (regrava campos)
+ *  e ali o retry resolve sozinho falhas de token que hoje ninguém vê. */
+function naoRepetir(endpoint: string): boolean {
+  return NAO_REPETIR.has(endpoint.split("?")[0]) || NAO_REPETIR.has(endpoint);
+}
@@ export async function callAlvo<T = any>(
-  if (isAuthError(firstAttempt.status) && !NAO_REPETIR.has(endpoint.split("?")[0])) {
+  if (isAuthError(firstAttempt.status) && !naoRepetir(endpoint)) {
     console.log(
       `[alvo-client] ${endpoint} retornou ${firstAttempt.status}, invalidando token e tentando de novo`
     );
     invalidateAlvoToken();
     return doCall<T>(endpoint, method, body, true);
   }
@@ export async function callAlvoMultipart<T = any>(
-  // Se falhou por token inválido / sessão em conflito, invalida cache e tenta de novo
-  if (isAuthError(firstAttempt.status)) {
+  // Se falhou por token inválido / sessão em conflito, invalida cache e tenta de novo.
+  // 🔴 A consulta ao `naoRepetir` FALTAVA aqui: esta função repetia TUDO, inclusive
+  // `MovEstq/SaveMovEstqMultPart` — que é literalmente o caso que o comentário da
+  // NAO_REPETIR descreve — e a criação de pedido do Suprimentos, 134 documentos.
+  if (isAuthError(firstAttempt.status) && !naoRepetir(endpoint)) {
     console.log(
       `[alvo-client-multipart] ${endpoint} retornou ${firstAttempt.status}, invalidando token e tentando de novo`
     );
     invalidateAlvoToken();
     return doCallMultipart<T>(endpoint, formData, true);
   }
```

**Como verificar que o PATCH 0 não mudou nada:** depois do deploy, a linha
`[alvo-client-multipart] … invalidando token e tentando de novo` **ainda pode aparecer**, porque nenhum
endpoint multipart está na lista. Se ela sumir logo após o PATCH 0, algo mais mudou junto.

---

## 5. PATCH 1 — a maior superfície (134 pedidos + as requisições)

```diff
--- a/src/alvo-client.ts
+++ b/src/alvo-client.ts
@@
 const NAO_REPETIR = new Set<string>([
   "ReqMat/ValidarAtendimento",
   "ReqMat/FinalizarAtendimento",
+  // ── CRIAÇÃO de documento. `?action=Insert` explícito de propósito: o Update
+  //    dos mesmos endpoints é idempotente e mantém o retry.
+  //    ⚠️ `pedComp` com p MINÚSCULO — é a string que o ped-comp.ts passa.
+  "pedComp/SaveMultiPart?action=Insert&savePartial=true&savePartial=true", // pedido — Suprimentos
+  "ReqComp/SaveMultiPart?action=Insert",                                   // requisição com anexo
+  "ReqComp/SavePartial?action=Insert",                                     // requisição sem anexo
 ]);
```

⚠️ A string do pedido tem `savePartial=true` **duas vezes**, e o comentário do `ped-comp.ts` diz que é
de propósito (*"savePartial duplicado replica comportamento do front nativo do Alvo"*). **Ela precisa
bater caractere a caractere** com a passada em `callAlvoMultipart`. Copie daqui.

As duas linhas de `ReqComp` entram junto porque cobrem **as duas metades do mesmo fluxo** — requisição
com e sem anexo. Deixar uma de fora fecharia o caminho só para quem anexa arquivo.

---

## 6. PATCH 2 — `PedComp/SavePartial?action=Insert` · o card original (4 envios)

```diff
--- a/src/alvo-client.ts
+++ b/src/alvo-client.ts
@@
   "ReqComp/SavePartial?action=Insert",                                     // requisição sem anexo
+  "PedComp/SavePartial?action=Insert",                                     // pedido — módulo Projetos
 ]);
```

Sem o PATCH 0, a única forma de fazer isto seria pôr `PedComp/SavePartial` (caminho puro) no Set — o que
**mataria também o retry do `/ped-comp/update`**, que é o envio para aprovação. Com o PATCH 0, o Update
mantém o retry.

---

## 7. PATCH 3 — `MovEstq/SaveMovEstqMultPart?action=Insert` · a baixa de estoque

```diff
--- a/src/alvo-client.ts
+++ b/src/alvo-client.ts
@@
   "PedComp/SavePartial?action=Insert",                                     // pedido — módulo Projetos
+  "MovEstq/SaveMovEstqMultPart?action=Insert",                             // baixa de estoque (nota de serviço)
 ]);
```

⚠️ **Exposição não medida** — não achei no Hub uma tabela que registre esses envios com fingerprint,
então não sei quantas notas de serviço passaram por aqui. **Isso não enfraquece o patch, e sim o
contrário:** o comentário que justifica a existência da `NAO_REPETIR` descreve exatamente esta chamada
(*"pode ter baixado estoque antes de o erro voltar"*), e ela está do lado que nunca consultou a lista.
É o item em que a ausência de medição **não** deve virar motivo para adiar.

---

## 8. O que fica FORA, e por quê

### `ReqMat/SaveReqMat` — **decisão sua**, não incluí em patch nenhum

Cria RM no ERP (`{Action:"Insert"}`), está na whitelist do passthrough, e é repetido hoje. **Nenhum dos
patches o alcança**, porque a `action` vem **no BODY**, não na query string: `endpoint.split("?")[0]` dá
`ReqMat/SaveReqMat` e não há como distinguir Insert de Update pela chave.

- **Opção A** — pôr `"ReqMat/SaveReqMat"` (caminho puro) no Set: fecha a criação **e** tira o retry do
  Update da RM.
- **Opção B** — deixar como está e tratar em card próprio, com uma mudança maior (levar a `action` do
  body para a chave de decisão).

A omissão era conspícua e vale registrar: **as duas entradas que já estavam no Set são `ReqMat/*`, da
mesma família e do mesmo passthrough.** E o próprio Hub documenta o dano em
`src/services/alvoReqMatSaveService.ts`: *"Quando o Insert passa e o Update falha, a RM existe no ERP e
está morta — e o reflexo do operador ('não funcionou, vou de novo') DUPLICARIA a RM."*

### `DocFin/SavePartial?action=Insert` (cartões, intercompany) — fora por escopo

Mesma classe, 4 call sites, mas outros módulos e outro dono de risco. Se quiser incluir, é uma linha a
mais no PATCH 1: `"DocFin/SavePartial?action=Insert",`.

---

## 9. 🔴 A contrapartida — e a v1 deste documento a subestimou por uma afirmação falsa

*Corrigido em 28/08/2026.* A v1 dizia que *"o `alvo-auth.ts` renova o token proativamente, então o
cenário é o de expiração inesperada"*. **É falso.** `getAlvoToken` é renovação **preguiçosa por
expiração**:

```ts
if (!forceRefresh && cachedToken && now - cachedToken.obtainedAt < TOKEN_TTL_MS) return cachedToken.token;
// TOKEN_TTL_MS = 25 * 60 * 1000
```

Sem timer de fundo, sem refresh antecipado, sem margem de skew. E o próprio comentário do arquivo admite
que os 25 min são *"o mesmo valor usado no Hub atual"* — **um palpite do cliente sobre a vida da sessão
do lado do Alvo**. Some-se que `isAuthError` inclui **409**, documentado no código como *sessão
conflitante*: com **uma** conta de serviço (`ALVO_USER`) servindo todo mundo e três janelas de cron, 409
concorrente não é acidente raro — é a razão de 409 estar na lista.

⇒ **Depois dos patches, cada 401/409 de borda num INSERT vira falha visível de envio.**

**Antes de aplicar, meça:** nos logs do Render, quantas vezes
`[alvo-client] … invalidando token e tentando de novo` apareceu com um endpoint de criação nos últimos
30 dias. **Esse número é a contrapartida, e ele existe hoje.** Se for perto de zero, os patches são
gratuitos; se for alto, o card muda de natureza — vira *"o token está vencendo demais"*, e o retry está
mascarando isso.

ℹ️ Achado colateral (**bug pré-existente**, não introduzido pelos patches): em `getAlvoToken`, o guard
`if (authInFlight) return authInFlight;` vem depois do teste de cache mas **ignora `forceRefresh`**. Um
retry que chama `getAlvoToken(true)` durante outra autenticação em voo recebe a promise em voo — que
pode ser a que produziu o token recém-rejeitado. **O retry de hoje nem sempre usa token novo**, o que
enfraquece o benefício que se teme perder.

---

## 10. Como conferir depois de cada deploy

1. **Logs do Render.** Depois do PATCH 1, a linha `invalidando token e tentando de novo` não pode mais
   aparecer com `pedComp/SaveMultiPart` nem `ReqComp/*`. Depois do 2, nem com
   `PedComp/SavePartial?action=Insert` — mas **pode** com `?action=Update`, e isso é o esperado. Depois
   do 3, nem com `MovEstq/*`.
   ⚠️ **Esta verificação NÃO cobre `ReqMat/SaveReqMat`**: a action dele vai no BODY, então ele nunca
   apareceu como `action=Insert` no log. Procure pelo nome do endpoint.
2. **As duas varreduras de fingerprint do §2.** Baseline a bater: **10 pedidos de Projetos com 0
   repetidos** e **241 pedidos com `[Hub]` e 7 cabeçalhos repetidos**, os 7 já explicados na tabela.
   Um oitavo grupo é que seria sinal.
   ⚠️ **Não use "2 casos" como baseline** — era o número do predicado ancorado, que estava errado.
3. **O teste estrutural**, que não depende de o `Texto` sobreviver ao Alvo e por isso é o guard que
   deve ficar: pares com números a ≤ 3 de distância, **mesma `data_pedido`, mesmo `codigo_usuario`,
   mesmo fornecedor e mesmo `valor_total`**. Hoje ele acusa clusters que são **duplo clique humano** —
   0004650/51/52/53 (13/08, ELISANGELA, R$ 297) têm carimbos de minuto **diferentes** no cabeçalho
   (07:09, 07:11, 07:12, 07:14). Retry de gateway é de milissegundos: se aparecer um cluster com o
   **mesmo minuto**, é ele.

---

## 11. O que este card NÃO resolve

O retry é a causa *mecânica*. A defesa estrutural continua sendo o **D3** (idempotência do envio: uuid
do Hub em campo livre de `PedCompUserFieldsObject` + reconciliação antes de qualquer retry), que segue
bloqueado pela pendência §7.9 — falta provar que o Alvo preserva o campo livre. Sem D3, qualquer
duplicata — por retry, por duplo clique ou por cópia manual no ERP — continua invisível para o Hub até
alguém reparar no número.
