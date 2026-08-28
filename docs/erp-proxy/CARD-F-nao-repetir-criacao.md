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
| `/cartao`, `/intercompany` (3 sites) | `DocFin/SavePartial?action=Insert` | Cartões, Intercompany | `callAlvo` — fora do Set | — |

⚠️ `MovEstq/SaveMovEstqMultPart` é **literalmente o caso que o comentário do Set descreve** — baixa de
estoque — e está do lado que não consulta o Set.

⚠️ Atenção à grafia: o endpoint do pedido multipart é **`pedComp`** com `p` minúsculo
(`pedComp/SaveMultiPart`), enquanto o JSON é `PedComp/SavePartial`. `Set.has` é sensível a caixa.

---

## 2. Existe caso histórico compatível com duplicata por retry?

### **NÃO.** Zero casos.

A pergunta que decide a prioridade em §14.10 foi respondida com a **série completa**, não com amostra.

**O teste.** Um retry do gateway acontece **dentro da mesma requisição HTTP**: o segundo pedido nasceria
com o **mesmo payload** — logo mesmo `DataPedido`, mesmo `CodigoUsuario`, mesmo `Texto` — e o Hub
registraria **um único** `envio_sucesso`. O discriminador forte é o cabeçalho que o Hub carimba em
`Texto`:

```
[Hub] Operador de Compras: <pessoa> | dd/mm/aaaa hh:mm | ID: <8 chars do user_id>
```

Ele é gerado **uma vez por envio**, no momento de montar o payload. Dois pedidos no ERP com o cabeçalho
**idêntico** vieram do mesmo payload — ou de uma cópia dele.

**Cobertura do teste** *(medida 28/08/2026 ~11:0x UTC)*: **134 de 134** pedidos criados no Hub carregam
o fingerprint (100% do caminho de criação); 171 pedidos no total o carregam. Do lado das requisições,
238 de 363 — e os 125 sem fingerprint são exatamente os que **vieram do espelho** e nunca passaram pelo
payload do Hub, então não estão no universo da pergunta.

**Resultado — 2 cabeçalhos repetidos em toda a base de pedidos, e os dois são refutados:**

| Cabeçalho | Pedidos | Por que NÃO é retry |
|---|---|---|
| `elisangela.silva \| 11/08/2026 20:33 \| ID: 8f758989` | `0004642` (hub, `DataPedido` 11/08, `ELISANGELA.SILVA`, Aberto) e `0004644` (nativo, **`DataPedido` 12/08**, **`GUSTAVO.GOULART`**, Cancelado) | **Dia diferente e usuário do ERP diferente.** Um retry não muda nem um nem outro — os dois vêm do payload. Assinatura de **cópia manual dentro do ERP** no dia seguinte, depois cancelada. |
| `bianca.goncalves \| 14/07/2026 15:31 \| ID: e4c1149d` | `0004443` (nativo, 16/07, `RYAN.PAGANOTTO`) e `0004728` (nativo, **21/08**, `ELISANGELA.SILVA`) | **36 dias de intervalo**, usuários diferentes, e **os dois são `criado_no_hub = false`**: o cabeçalho veio do `Texto` da *requisição*, herdado pelo ERP ao gerar os pedidos. |

Do lado das **requisições**, o mesmo teste devolve **zero** cabeçalhos repetidos.

⚠️ **Limite declarado.** O gêmeo criado por um retry seria um documento que o Hub nunca registrou: ele
só aparece aqui se o cron o **descobrir** e preservar o `Texto`. A descoberta de pedidos (Job 3) roda de
hora em hora e traz `texto` — foi assim que os 37 pedidos nativos com fingerprint apareceram —, então a
janela cega é pequena, mas não é zero. **A afirmação é "nenhum caso compatível encontrado", não
"nunca aconteceu".**

### ⇒ Conclusão de prioridade

Pela regra registrada em §14.10: **não há caso histórico ⇒ risco LATENTE, entra depois do 4º da ordem
de execução (§14.9).** Não sobe.

Contrapeso honesto, porque latente não é inofensivo: o custo por ocorrência é **um pedido a mais no
ERP que o Hub não conhece** — a mesma classe de divergência Hub × ERP que o L7-B veio matar, e mais
cara de descobrir do que o `UQ_PK` do D4 (aquele falha ruidosamente; este passa em silêncio).

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

⚠️ **Contrapartida a declarar:** hoje um 401 por token vencido se resolve sozinho. Depois disto, ele
vira erro visível no INSERT. Se o token do Alvo vencer com frequência, isso aparece como falha de envio.
O `alvo-auth.ts` renova o token proativamente, então o cenário é o de expiração inesperada — mas vale
acompanhar o log `[alvo-client]` na primeira semana.

### Como conferir depois do deploy

1. Nos logs do Render, procurar `invalidando token e tentando de novo`. Depois da mudança, essa linha
   **não pode mais aparecer** com um endpoint `action=Insert`.
2. Refazer a varredura de fingerprint do §2 (a query está lá) — ela tem de continuar devolvendo os
   mesmos 2 casos explicados, e nenhum novo.

---

## 5. O que este card NÃO resolve

O retry é a causa *mecânica*. A defesa estrutural continua sendo o **D3** (idempotência do envio: uuid
do Hub em campo livre de `PedCompUserFieldsObject` + reconciliação antes de qualquer retry), que segue
bloqueado pela pendência §7.9 — falta provar que o Alvo preserva o campo livre. Sem D3, qualquer
duplicata (por retry, por duplo clique ou por cópia manual no ERP) continua invisível para o Hub até
alguém reparar no número.
