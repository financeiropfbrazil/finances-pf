# ADENDO-ERP-PROXY-REQCOMP.md — rotas `/req-comp` do gateway

> Adendo produzido na **Fase 0 (PROMPT 0)** da missão *Aprovação de Requisições pelo Líder de Departamento*.
> Complementa o `DISCOVERY-APROVACAO-REQ.md` (item **D8**).
> Data: **06/08/2026** · Gateway: `https://erp-proxy.onrender.com` (repo separado `erp-proxy`, deploy no Render).

## 0. Origem da informação e limite de confiança

⚠️ **Este adendo foi levantado 100% a partir do lado cliente** (o repo `finances-pf`), sem inspecionar `src/routes/req-comp.ts` do `erp-proxy`. Tudo aqui é **o contrato observado em uso** — as rotas, os verbos, os payloads e os campos de resposta que o Hub realmente envia e consome, todos em produção há meses. Não descreve rotas que existam no proxy e não sejam usadas pelo Hub, nem validações internas do gateway.

O plano previa (§4.2, etapa 2) parar e pedir ao Pedro os arquivos `req-comp.ts`, `alvo.ts` e `index.ts`. **Não foi necessário:** as cinco rotas se revelaram pelo frontend. Se a Fase 2 precisar de detalhe interno (ex.: como o proxy trata `Observacao > 255`, ou se há retry), aí sim vale pedir os arquivos.

Nota: o guia cita um `relatorio-erp-proxy.md` para receber este adendo — **esse arquivo não existe neste repo** (o mais próximo é `SPEC-D001-erp-proxy.md`). Daí o arquivo próprio.

---

## 1. As cinco rotas `/req-comp` em uso

| # | Rota | Verbo | Chamador | Autenticação |
|---|---|---|---|---|
| 1 | `/req-comp/insert` | POST (JSON) | `requisicoesService.ts:399` (envio), `:843` (reenvio) | `Authorization: Bearer <JWT Supabase>` |
| 2 | `/req-comp/insert-multipart` | POST (multipart/form-data) | `requisicoesService.ts:630` (envio c/ anexos), `:841` (reenvio) | `Authorization: Bearer <JWT Supabase>` |
| 3 | `/req-comp/{codigoEmpresaFilial}/{numero}` | GET | `requisicoesService.ts:1103`, `pedidosService.ts:356`, cron `index.ts:739` | JWT (browser) · `X-System-Secret` (cron) |
| 4 | `/req-comp/update` | POST (JSON) | `pedidosService.ts:385` — baixa da req após virar pedido | `Authorization: Bearer <JWT Supabase>` |
| 5 | `/req-comp/list?dataInicio=&dataFim=&apenasAbertas=` | GET | cron Job 4, `sync-compras-status-cron/index.ts:448` | `X-System-Secret` |

**Dois esquemas de autenticação, por origem:**
- **Browser** → `Bearer <access_token>` da sessão Supabase (`getSupabaseJWT`, `requisicoesService.ts:73-81`). Todo acesso do frontend ao Alvo passa pelo gateway — chamada direta dá CORS.
- **Edge Function (cron)** → header `X-System-Secret` (`callErpProxy`, `sync-compras-status-cron/index.ts:328-340`).

---

## 2. Rota 1 — `POST /req-comp/insert` (envio sem anexos)

**Body**: o objeto `ReqComp` montado por `montarPayloadReqComp` (`requisicoesService.ts:188-239`):

```jsonc
{
  "CodigoEmpresaFilial": "1.01",
  "CodigoEmpresaFilialOrigem": "1.01",
  "CodigoUsuario": "PEDRO.SCRIGNOLI",      // ⚠️ hardcoded (requisicoesService.ts:5)
  "Numero": "",                             // vazio = insert
  "CodigoCentroCtrl": "00010.00002.00003",
  "CodigoFinalidadeCompra": "…",
  "CodigoFuncionario": "0000149",
  "DataNecessidade": "2026-08-20T00:00:00-03:00",   // formatarDataISO (:145)
  "Descricao": "…",
  "Texto": "[Hub] Requisitante: Fulano | 06/08/2026 14:30 | ID: 0b52e262\n<observação livre>",
  "ItemReqCompChildList": [
    {
      "CodigoEmpresaFilial": "", "NumeroReqComp": "", "Sequencia": 1,
      "ItemServico": "Sim" | "Não",
      "CodigoProduto": "…", "CodigoAlternativoProduto": "",
      "DataNecessidade": "2026-08-20T00:00:00-03:00",
      "CodigoCentroCtrl": "00010.00002.00003",
      "Quantidade2": 10, "QuantidadeProdUnidMedPrincipal": 10,
      "CodigoProdUnidMed": "…",
      "Observacao": "…"                     // ⚠️ limite do Alvo: 255 chars (dívida §28.3 → Fase 4)
    }
  ],
  "ReqCompClasseRecDespChildList": [],       // ⚠️ sempre vazio: o rateio fica só no Hub
  "MensagemRetorno": null, "TextoHistoricoNovo": null,
  "TipoFormulario": "Normal", "UploadIdentify": "",
  "UsuarioLogado": "PEDRO.SCRIGNOLI"
}
```

**Resposta esperada**: objeto com **`Numero`** — é o único campo consumido (`respData?.Numero || ""`, `:401`) e vira `compras_requisicoes.numero_alvo`.

**Erro**: `resp.ok === false` → o helper lança `Error(data?.error || "HTTP <status>")` com `err.status` e `err.details` anexados (`:103-109`). A mensagem crua vai para `erro_ultimo_envio` e para a auditoria (`evento='envio_falha'`).

---

## 3. Rota 2 — `POST /req-comp/insert-multipart` (envio com anexos, máx. 3)

**Content-Type**: definido pelo browser (boundary automático) — o código **não** seta o header (`:118`).

**FormData** (`montarFormDataMultipart`, `:289-296`):
- campo **`obj`** = `JSON.stringify(payload)` — mesmo payload da rota 1, **mais**:
  ```jsonc
  "ReqCompDocChildList": [
    { "CodigoEmpresaFilial": "-1", "NumeroReqComp": "-1", "Sequencia": 0, "UploadIdentify": "<guid>" }
  ],
  "filesToUpload": [ { "key": "<guid>#Arquivo", "file": {} } ]
  ```
- um campo por arquivo, nomeado **`<guid>#Arquivo`**, com o blob e o nome original.

O `guid` é gerado no frontend (`crypto.randomUUID()`) e é a mesma chave gravada em `compras_requisicoes_arquivos.upload_identify_guid`. Após o sucesso, cada anexo é marcado via RPC `marcar_arquivo_req_enviado(p_guid, p_numero_alvo)` (`:654`, `:869`) — **RPC porque `.update()` via PostgREST é bloqueado por CORS**.

**Resposta**: idêntica à rota 1 (`Numero`).

---

## 4. Rota 3 — `GET /req-comp/{filial}/{numero}` (Load)

Ex.: `/req-comp/1.01/0012345`. Ambos os segmentos passam por `encodeURIComponent`.

**Consumido em três lugares, com propósitos diferentes:**

| Chamador | Campos usados |
|---|---|
| `sincronizarStatusRequisicao` (`requisicoesService.ts:1165-1199`) | `Status`, `GerouPedComp`, `NumeroPedComp`, **`ItemReqCompChildList`** (persistido em `compras_requisicoes_itens` pelo `persistirItensRequisicao`, `:1023-1084`) |
| Cron Job 1 (`index.ts:757` → `mapReqAlvoToHub`) | `Status`, `GerouPedComp` |
| `baixarRequisicaoAlvo` (`pedidosService.ts:355-359`) | o objeto **inteiro** — é lido, mutado e devolvido na rota 4 |

**Mapeamento Alvo → Hub** (`mapReqAlvoToHub`, `index.ts:361-384`; espelhado no front em `:1171-1180`):

| Condição no Alvo | status Hub |
|---|---|
| `Status = "Pedido"` **ou** `GerouPedComp ∈ {Total, Parcial}` | `convertida_pedido` |
| `Status ∈ {Cancelado, Cancelada}` | `cancelada` |
| HTTP **404** (req sumiu do ERP) | `cancelada` |
| qualquer outro | `sincronizada` |

⚠️ **404 é semântico, não é falha**: o cliente trata `err.status === 404` como "deletada no ERP" e usa `err.details` como corpo (`requisicoesService.ts:1111-1114`). O gateway precisa continuar propagando o 404 do Alvo tal como está.

**A resposta pode vir embrulhada.** `pedidosService.ts:304-335` (`desembrulharReq`) tenta, nesta ordem: objeto direto com `ItemReqCompChildList` + `Numero`; `data`/`Data`; as chaves `listaReqComp`, `ReqComp`, `result`, `Result`; e array na raiz. Ou seja, **o formato do envelope não é estável** — quem consumir essa rota deve desembrulhar defensivamente.

---

## 5. Rota 4 — `POST /req-comp/update` (baixa da requisição)

Usada **só** por `baixarRequisicaoAlvo` (`pedidosService.ts:346-396`), depois que o Hub cria um pedido a partir da req:

1. `GET /req-comp/{filial}/{numero}` → desembrulha;
2. **idempotência**: se já `Status="Pedido"` e `GerouPedComp="Total"`, retorna sem chamar o update;
3. muta o objeto: `Status="Pedido"`, `GerouPedComp="Total"` e, em cada item, `GerouPedComp="T"` + `NumeroPedComp=<número do pedido>`;
4. `POST /req-comp/update` com o **objeto ReqComp completo** no body.

É **best-effort**: nunca lança — o pedido já foi criado e não é afetado pela falha da baixa (`:390-395`). v1 sempre marca "Total" (nunca baixa parcial).

---

## 6. Rota 5 — `GET /req-comp/list` (descoberta — Job 4)

`/req-comp/list?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD&apenasAbertas=false` (`index.ts:442-448`).

- Datas em `YYYY-MM-DD` (`toISOString().slice(0,10)`).
- Janela: **30 dias** no ciclo normal; **1095 dias** no primeiro disparo (backfill), decidido pelo cursor `req-comp-last-numero-1.01` em `sync_cursors`.
- `apenasAbertas=false` é deliberado (comentário `:446-447`): traz também convertidas e canceladas, senão reqs que fecham entre ciclos nunca seriam reconciliadas.

**Resposta**: array de cabeçalhos leves (`interface RequisicaoLeve`, `index.ts:196-209`): `CodigoEmpresaFilial`, `Numero`, `Status`, `Data`, `Descricao`, `CodigoFuncionario`, `CodigoCentroCtrl`, `Aprovada`, `Reprovada`, `CodigoFinalidadeCompra`, `CodigoLocArmaz`, `CodigoEmpresaFilialEntrega`, `EspecieDocumento`, …

> 🔎 **Achado com valor direto para esta missão:** o cabeçalho do Alvo **já traz `Aprovada` e `Reprovada`** — ou seja, o ERP tem um conceito nativo de aprovação de requisição, hoje **não lido pelo Hub** (nenhum dos dois campos é consumido em lugar nenhum do repo). O gate que a missão vai construir vive **inteiramente no Hub, antes do ERP** — as duas coisas não conversam. Vale uma decisão consciente do Pedro (fora do escopo do PROMPT 0): ignorar de vez ou, no futuro, refletir a decisão do Hub nesses campos. O mesmo vale para `PedCompUserFieldsObject.UserProximoAprovador` / `UserEnviouAprovacao` no lado dos pedidos (`index.ts:188-192`).

---

## 7. Implicações para a missão (Fases 2 e 3)

1. **Nada muda no gateway.** O gate é 100% Hub: `submeter_requisicao` decide **se** a chamada às rotas 1/2 acontece. Rotas, payloads e autenticação seguem idênticos.
2. **`enviarRequisicaoAlvo(reqId)` precisa nascer da quebra de `enviarRequisicao`** — hoje criação e envio moram na mesma função, e o roteamento exige um `p_req_id` que só existe depois de persistir. A parte "envio" é justamente o bloco que chama a rota 1 ou 2 e grava o desfecho.
3. **O reenvio pós-aprovação usa as mesmas rotas** — a escolha JSON × multipart é feita por presença de anexos (`requisicoesService.ts:825`), não pelo status. O que precisa mudar é só a guarda de status (`:754`) e o rebaixamento para `rascunho` em caso de falha (que apagaria a aprovação).
4. **Falha nº 1 esperada continua sendo `Observacao > 255`** por item — o erro vem do Alvo através do gateway como `data.error`/`details`, e passará a estourar na tela do **líder**. Reforça a Fase 4 (validação na digitação).
5. **404 e envelope variável** (§4) são armadilhas conhecidas: qualquer código novo que leia a rota 3 deve tratar 404 como "cancelada" e desembrulhar como `desembrulharReq`.
