# Card F — retry automático nos caminhos de CRIAÇÃO do `erp-proxy`

> **Diff preparado, NÃO aplicado.** O `erp-proxy` é editado exclusivamente pelo Pedro, via GitHub Web.
> Medido em 28/08/2026 sobre `origin/main` do `erp-proxy` (`fc5d549`, lido por `git show`) e sobre o banco
> `hbtggrbauguukewiknew` pelo MCP em modo leitura.

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

### 🔴 O achado é maior do que o card

O card §14.10 aponta `PedComp/SavePartial` fora da lista. Correto — mas ao ler o arquivo inteiro:
**`callAlvoMultipart` não consulta a lista em momento nenhum**, então nem adiantaria acrescentar
endpoints multipart ao Set. E é por ali que passa o caminho de criação mais usado do módulo.

Inventário completo dos caminhos de **criação** que hoje são repetidos automaticamente:

| Rota do gateway | Endpoint do Alvo | Cliente no Hub | Por onde repete | Exposição medida |
|---|---|---|---|---|
| `/ped-comp/insert` | `PedComp/SavePartial?action=Insert` | **Projetos** | `callAlvo` — fora do Set | **4 envios** (`projeto_requisicoes.numero_pedido_alvo` não nulo) |
| `/ped-comp/insert-multipart` | `pedComp/SaveMultiPart?action=Insert&…` | **Suprimentos** (criação de pedido) | `callAlvoMultipart` — **não consulta o Set** | **134 pedidos** |
| `/req-comp/insert` | `ReqComp/SavePartial?action=Insert` | Suprimentos (requisição sem anexo) | `callAlvo` — fora do Set | parte dos **226** envios |
| `/req-comp/insert-multipart` | `ReqComp/SaveMultiPart?action=Insert` | Suprimentos (requisição com anexo) | `callAlvoMultipart` — **não consulta o Set** | idem |
| `/mov-estq/save` | `MovEstq/SaveMovEstqMultPart?action=Insert` | Notas de serviço | `callAlvoMultipart` — **não consulta o Set** | — |
| `/cartao` (1 site) e `/intercompany` (3 sites) | `DocFin/SavePartial?action=Insert` | Cartões, Intercompany | `callAlvo` — fora do Set | — |
| **`/alvo/passthrough`** | **`ReqMat/SaveReqMat` com `{Action:"Insert"}`** | Ordem de Produção (`alvoReqMatSaveService.ts`) | `callAlvo` — fora do Set | — |

⚠️ `MovEstq/SaveMovEstqMultPart` é **literalmente o caso que o comentário do Set descreve** — baixa de
estoque — e está do lado que não consulta o Set.

🔴 **`ReqMat/SaveReqMat` é o caso mais traiçoeiro, e nenhum dos dois diffs abaixo o alcança sozinho.**
A `action` dele vem **no BODY**, não na query string — então `endpoint.split("?")[0]` dá
`ReqMat/SaveReqMat` e **não há como distinguir Insert de Update pela chave**. Pôr o caminho puro no Set
mata o retry das duas actions. A omissão é conspícua: as **duas** entradas que já existem no Set
(`ReqMat/ValidarAtendimento`, `ReqMat/FinalizarAtendimento`) são da mesma família e do mesmo
passthrough. E o próprio Hub documenta o dano em `src/services/alvoReqMatSaveService.ts`: *"Quando o
Insert passa e o Update falha, a RM existe no ERP e está morta — e o reflexo do operador ('não
funcionou, vou de novo') DUPLICARIA a RM."*
**Decisão do Pedro:** aceitar perder o retry no `Update` da RM (provavelmente inócuo, regrava campos)
ou deixar `SaveReqMat` de fora e tratá-lo em card próprio. Os diffs abaixo o incluem **comentado**.

⚠️ Atenção à grafia: o endpoint do pedido multipart é **`pedComp`** com `p` minúsculo
(`pedComp/SaveMultiPart`), enquanto o JSON é `PedComp/SavePartial`. `Set.has` é sensível a caixa.

ℹ️ **Terceiro caminho de escrita, fora do `alvo-client.ts`:** `src/services/alvo-anexar-pdf.ts` faz
`fetch` cru para `DocFin/SaveMultiPart?action=Update&savePartial=false`, sem passar por `callAlvo` nem
por `callAlvoMultipart`. É **Update**, não criação, então não muda a conclusão — mas o Set **não cobre
toda escrita ao ERP**, e quem ler este documento no futuro precisa saber disso.

---

## 2. Existe caso histórico compatível com duplicata por retry?

### **NÃO.** Nenhum caso compatível, nas duas rotas de criação de pedido.

> ⚠️ **CORREÇÃO DE 28/08/2026, no mesmo dia.** A primeira versão desta seção respondeu a
> pergunta com um método que tinha **dois furos**, achados por revisão adversarial e
> confirmados por mim. A **conclusão não mudou**; o método e os números, sim. Os dois erros
> ficam registrados porque cada um teria feito o próximo leitor confiar num teste sem poder.
>
> **Furo 1 — predicado ancorado.** A varredura usou `texto LIKE '[Hub]%'`, mas o cabeçalho
> **nem sempre está no início**: quando o ERP gera o pedido a partir de uma requisição, ele
> copia o `Texto` da requisição para depois de blocos como `FORMA DE PAGAMENTO : BOLETO`.
> Medido: ancorado = **171** pedidos, não ancorado = **241**. **70 pedidos ficaram de fora**,
> e é justamente neles que moram os casos que faltavam: eram **2** cabeçalhos repetidos pelo
> predicado errado, e são **7** pelo certo.
> **Furo 2 — o teste não cobria a rota do card.** Os pedidos criados por `/ped-comp/insert`
> (módulo Projetos) **não têm o cabeçalho `[Hub]`**: o `Texto` deles é
> `Projeto: <nome> | Req #<n> - <descrição>`, e eles entram com `criado_no_hub = false`
> (quem materializa a linha é o Job 3). A frase "134 de 134 pedidos criados no Hub carregam o
> fingerprint (100% do caminho de criação)" era verdadeira sobre `criado_no_hub = true` e
> **falsa** como cobertura: o teste tinha poder **zero** sobre a rota que o card denuncia.

### Método

Um retry do gateway acontece **dentro da mesma requisição HTTP**: o segundo documento nasceria
do **mesmo payload** — mesmo `DataPedido`, mesmo `CodigoUsuario`, milissegundos depois — e o Hub
registraria **um único** `envio_sucesso`. São dois fingerprints, um por rota:

| Rota | Fingerprint | Regex |
|---|---|---|
| `/ped-comp/insert-multipart` (Suprimentos) e requisições | `[Hub] <papel>: <pessoa> \| dd/mm/aaaa hh:mm \| ID: <8 hex>` | não ancorado — casa `[Hub]` em qualquer posição, seguido de `\| ID:` e 8 hex |
| `/ped-comp/insert` (Projetos) | `Projeto: <nome> \| Req #<n>` | `'^Projeto: .*\| Req #'` |

Ambos são gerados **uma vez por envio**, então cabeçalho idêntico ⇒ mesmo payload (ou cópia dele).

### Resultado A — rota `/ped-comp/insert` (a do card), fingerprint de Projetos

**10 pedidos** com o fingerprint no Hub *(medido 28/08/2026 ~11:40 UTC)* — os 8 do incidente
§13.4 do `PLANO-PROJETOS` mais os 2 do A/B de 27/08. **Zero fingerprints repetidos.**
`0004798` e `0004799` são R$ 100, mesmo fornecedor, mesmo dia e mesmo usuário, mas têm
`Req #65` e `Req #66` — pedidos deliberados, criados com 9 minutos de intervalo, não gêmeos.

### Resultado B — rota multipart e requisições, fingerprint `[Hub]`

**241 pedidos** com o fingerprint; **7** cabeçalhos repetidos. Os 7 estão abaixo, e **nenhum**
tem a assinatura de retry. O mecanismo dominante é outro, e explica por que o cabeçalho aparece
no meio do texto: **o ERP gera vários pedidos a partir de UMA requisição e copia o `Texto` dela
em cada um** (fan-out), ou alguém re-gera o pedido dias depois.

| Cabeçalho | Pedidos | Por que NÃO é retry |
|---|---|---|
| `bianca.goncalves \| 10/08 09:28` | 0004702 (19/08) · 0004724 (21/08) · 0004727 (21/08) | Todos `criado_no_hub=false` — **o Hub nunca criou nenhum deles**. Geração no ERP a partir da req 0001397, dois dias depois. |
| `nathalia.richele \| 16/06 15:27` | 0004441 · 0004444 · 0004445 (todos 16/07) | **Fan-out**: mesma req 0001241, **2 fornecedores e 3 valores diferentes**. |
| `elisangela.silva \| 11/08 20:33` | 0004642 (hub, 11/08, ELISANGELA) · 0004644 (nat, **12/08**, **GUSTAVO.GOULART**, Cancelado) | **Dia diferente e usuário do ERP diferente** — um retry não muda nem um nem outro. Cópia manual no ERP. |
| `diego.amancio \| 15/06 13:58` | 0004209 (15/06) · 0004313 (**24/06**) | 9 dias de intervalo. |
| `isabela.catanoze \| 29/06 11:04` | 0004777 · 0004778 (ambos 26/08) | **Fan-out**: mesma req 0001274, **2 fornecedores e 2 valores diferentes**. |
| `bianca.goncalves \| 14/07 15:31` | 0004443 (16/07, RYAN.PAGANOTTO) · 0004728 (**21/08**, ELISANGELA) | **36 dias**, usuários diferentes, os dois `criado_no_hub=false`. |
| `bharguan.nogueira \| 23/06 14:13` | 0004331 (26/06, R$ 6.985,60) · 0004672 (**14/08**, R$ 1.522,40) | **Valores diferentes** — recompra parcial. |

**Nenhum par compartilha `DataPedido` E `CodigoUsuario` com números adjacentes**, que é a
assinatura mínima de um retry.

### Cobertura declarada, e o que ela NÃO cobre

- `criado_no_hub = true`: **134 de 134** carregam o fingerprint `[Hub]` — o caminho multipart
  do Suprimentos está 100% coberto.
- `/ped-comp/insert`: **10 de 10** pedidos do módulo carregam o fingerprint de Projetos.
- Requisições: 238 de 363 têm o cabeçalho `[Hub]`; os 125 sem ele **vieram do espelho** e nunca
  passaram pelo payload do Hub — fora do universo da pergunta. **Zero** cabeçalhos repetidos.

⚠️ **Três limites, declarados:**
1. O gêmeo criado por um retry é um documento que o Hub nunca registrou — ele só aparece aqui se
   o cron o **descobrir**. O Job 3 roda de hora em hora e traz `texto`, então a janela cega é
   pequena, mas não é zero.
2. **Premissa não testada:** que o Alvo persista o `Texto` quando devolve 401/403/409 num Insert.
   Se a primeira chamada gravou o pedido **sem** o `Texto`, o gêmeo nasce sem fingerprint e o
   teste tem poder zero. Só um teste contra o Alvo responde.
3. **Fonte direta não consultada:** os logs do Render (`[alvo-client] … invalidando token e
   tentando de novo`) são a única evidência de quantos retries de 401/403/409 já ocorreram em
   endpoint de criação. Não foram lidos.

⇒ A afirmação é **"nenhum caso compatível encontrado"**, não "nunca aconteceu".

### Teste estrutural complementar (não depende do `Texto` sobreviver)

Pares com números a ≤ 3 de distância, **mesma `data_pedido`, mesmo `codigo_usuario`, mesmo
fornecedor e mesmo `valor_total`**. Ele enxerga o que o fingerprint não vê. Encontra clusters —
o maior é 0004650/51/52/53 (13/08, ELISANGELA, R$ 297, todos `criado_no_hub=true`) — mas os
quatro têm **carimbos de minuto diferentes** no cabeçalho (07:09, 07:11, 07:12, 07:14): é
**duplo clique / reenvio humano**, não retry de gateway, que é de milissegundos.
**Vale como o guard permanente**, porque não depende de o `Texto` sobreviver ao Alvo.

### ⇒ Conclusão de prioridade

Pela regra registrada em §14.10: **não há caso histórico ⇒ risco LATENTE, entra depois do 4º da
ordem de execução (§14.9).** Não sobe.

Contrapeso honesto, porque latente não é inofensivo: o custo por ocorrência é **um documento a
mais no ERP que o Hub não conhece** — a mesma classe de divergência Hub × ERP que o L7-B veio
matar, e mais cara de descobrir do que o `UQ_PK` do D4 (aquele falha ruidosamente; este passa em
silêncio).

---

## 3. Diff — opção MÍNIMA (só o que o card pediu)

Uma linha. Fecha `/ped-comp/insert`.

```diff
--- a/src/alvo-client.ts
+++ b/src/alvo-client.ts
@@
 const NAO_REPETIR = new Set<string>([
   "ReqMat/ValidarAtendimento",
   "ReqMat/FinalizarAtendimento",
+  // Criação de pedido de compra (módulo Projetos). Se a primeira tentativa criou o
+  // pedido no ERP antes de devolver 401/403/409, o retry cria um SEGUNDO pedido —
+  // e o Hub nunca fica sabendo do gêmeo.
+  "PedComp/SavePartial",
 ]);
```

⚠️ **Esta opção NÃO fecha o lado multipart** (`callAlvoMultipart` não consulta o Set) nem
`ReqMat/SaveReqMat`. Ela resolve os **4 envios** de `/ped-comp/insert` e deixa os **134 pedidos**
do caminho multipart do Suprimentos como estão. Se a escolha for esta, é bom saber que ela cobre
a menor das seis superfícies.

⚠️ **Efeito colateral aceito nesta opção:** a chave é `endpoint.split("?")[0]`, então
`PedComp/SavePartial` alcança **`action=Insert` E `action=Update`** de uma vez. O `/ped-comp/update`
(envio para aprovação) **perde o retry junto**. Ali o retry é provavelmente inócuo — setar um flag duas
vezes dá o mesmo resultado — mas perdê-lo pode reintroduzir falhas de token que hoje se resolvem
sozinhas. **Se o Pedro aceitar esse efeito, esta opção basta e é a de menor risco de edição.**

---

## 4. Diff — opção RECOMENDADA (separa Insert de Update e fecha o lado multipart)

Duas mudanças em `src/alvo-client.ts`. Nenhuma outra rota é tocada; nenhum comportamento de sucesso
muda — só deixa de existir a **segunda** chamada depois de um 401/403/409.

```diff
--- a/src/alvo-client.ts
+++ b/src/alvo-client.ts
@@
-/** Endpoints que NUNCA podem ser repetidos automaticamente: a primeira chamada
- *  pode ter baixado estoque antes de o erro voltar, e o retry baixaria de novo. */
-const NAO_REPETIR = new Set<string>([
-  "ReqMat/ValidarAtendimento",
-  "ReqMat/FinalizarAtendimento",
-]);
+/** Endpoints que NUNCA podem ser repetidos automaticamente: a primeira chamada
+ *  pode ter tido efeito no ERP antes de o erro voltar, e o retry repetiria o efeito.
+ *
+ *  A entrada pode ser o caminho SEM query (vale para todas as actions) ou o
+ *  endpoint COMPLETO com query (vale só para aquela action) — ver `naoRepetir()`.
+ *  Toda CRIAÇÃO entra aqui: um 401/403/409 depois de o documento já ter sido
+ *  gravado faz o retry criar um SEGUNDO documento, que o Hub nunca registra. */
+const NAO_REPETIR = new Set<string>([
+  "ReqMat/ValidarAtendimento",
+  "ReqMat/FinalizarAtendimento",
+  // ── Criação de documento. `?action=Insert` explícito de propósito: o Update
+  //    dos mesmos endpoints é idempotente (regrava campos) e mantém o retry,
+  //    que hoje resolve sozinho falhas de token.
+  "PedComp/SavePartial?action=Insert",                                  // pedido — módulo Projetos
+  "pedComp/SaveMultiPart?action=Insert&savePartial=true&savePartial=true", // pedido — Suprimentos (p minúsculo!)
+  "ReqComp/SavePartial?action=Insert",                                  // requisição sem anexo
+  "ReqComp/SaveMultiPart?action=Insert",                                // requisição com anexo
+  "DocFin/SavePartial?action=Insert",                                   // cartões e intercompany
+  "MovEstq/SaveMovEstqMultPart?action=Insert",                          // baixa de estoque (nota de serviço)
+  // ⚠️ DECISÃO DO PEDRO — descomentar mata o retry do Insert E do Update da RM,
+  //    porque a action deste endpoint vai no BODY e não dá para separar pela chave:
+  // "ReqMat/SaveReqMat",                                               // cria RM (OP) — ver §1
+]);
+
+/** Um endpoint não se repete se a lista tiver o caminho puro OU o endpoint completo. */
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
+  // 🔴 O `naoRepetir` FALTAVA aqui: esta função repetia TUDO, inclusive
+  // `MovEstq/SaveMovEstqMultPart` — que é literalmente o caso que o comentário da
+  // NAO_REPETIR descreve — e a criação de pedido do Suprimentos.
+  if (isAuthError(firstAttempt.status) && !naoRepetir(endpoint)) {
     console.log(
       `[alvo-client-multipart] ${endpoint} retornou ${firstAttempt.status}, invalidando token e tentando de novo`
     );
     invalidateAlvoToken();
     return doCallMultipart<T>(endpoint, formData, true);
   }
```

### O que muda para quem usa

Nada, no caminho feliz. A diferença aparece **só** quando o Alvo devolve 401/403/409 num INSERT: em vez
de uma segunda tentativa silenciosa, o gateway devolve o erro ao Hub, que já sabe tratá-lo
(`/ped-comp/insert` e `/req-comp/insert` propagam o status; `enviarRequisicaoAlvo` grava `envio_falha`).
A pessoa reenvia — conscientemente, e vendo o resultado.

### 🔴 Contrapartida — e a primeira versão deste documento a subestimou

*Corrigido em 28/08/2026.* A versão anterior dizia que *"o `alvo-auth.ts` renova o token
proativamente, então o cenário é o de expiração inesperada"*. **Isso é falso.** Li o arquivo:
`getAlvoToken` é renovação **preguiçosa por expiração** —
`if (!forceRefresh && cachedToken && now - cachedToken.obtainedAt < TOKEN_TTL_MS) return …`, com
`TOKEN_TTL_MS = 25 min`. Não há timer de fundo, não há refresh antecipado, não há margem de skew.
E o próprio comentário do arquivo admite que os 25 min são *"o mesmo valor usado no Hub atual"*, isto
é, **um palpite do cliente sobre a vida da sessão do lado do Alvo**.

Some-se que `isAuthError` inclui **409**, documentado no próprio código como *sessão conflitante*: com
**uma** conta de serviço (`ALVO_USER`) servindo todo mundo e três janelas de cron, 409 concorrente não
é acidente raro — é a razão de 409 estar na lista.

⇒ **Depois do diff, cada 401/409 de borda num INSERT vira falha visível de envio.** A frequência é
desconhecida e o documento não deve fingir que é baixa. **Antes de aplicar, leia os logs do Render**
e conte quantas vezes `[alvo-client] … invalidando token e tentando de novo` apareceu com um endpoint
de criação nos últimos 30 dias. Esse número é a contrapartida, e ele existe hoje.

ℹ️ Achado colateral (bug pré-existente, **não** introduzido pelo diff): em `getAlvoToken`, o guard
`if (authInFlight) return authInFlight;` vem depois do teste de cache mas **ignora `forceRefresh`**.
Um retry que chama `getAlvoToken(true)` durante outra autenticação em voo recebe a promise em voo — que
pode ser justamente a que produziu o token recém-rejeitado. Ou seja, **o retry de hoje nem sempre usa
token novo**, o que enfraquece o próprio benefício que se teme perder.

### Como conferir depois do deploy

1. Nos logs do Render, procurar `invalidando token e tentando de novo`. Depois da mudança, essa linha
   **não pode mais aparecer** com um endpoint `action=Insert`.
   ⚠️ **Esta verificação NÃO cobre `ReqMat/SaveReqMat`**: a action dele vai no BODY, então ele nunca
   apareceu como `action=Insert` no log, e continuará repetindo em silêncio se ficar de fora do Set.
   Para ele, procure o endpoint pelo nome.
2. Refazer as duas varreduras de fingerprint do §2. Baseline a bater:
   **10 pedidos de Projetos com 0 repetidos** e **241 pedidos com `[Hub]` e 7 cabeçalhos repetidos**,
   os 7 já explicados na tabela. Um oitavo grupo é que seria sinal.
   ⚠️ **Não use "2 casos" como baseline** — era o número do predicado ancorado, que estava errado.
3. Rodar o **teste estrutural** do §2 (mesma data, usuário, fornecedor e valor, números adjacentes).
   É o único que não depende de o `Texto` sobreviver ao Alvo, e por isso é o guard que deve ficar.

---

## 5. O que este card NÃO resolve

O retry é a causa *mecânica*. A defesa estrutural continua sendo o **D3** (idempotência do envio: uuid
do Hub em campo livre de `PedCompUserFieldsObject` + reconciliação antes de qualquer retry), que segue
bloqueado pela pendência §7.9 — falta provar que o Alvo preserva o campo livre. Sem D3, qualquer
duplicata (por retry, por duplo clique ou por cópia manual no ERP) continua invisível para o Hub até
alguém reparar no número.
