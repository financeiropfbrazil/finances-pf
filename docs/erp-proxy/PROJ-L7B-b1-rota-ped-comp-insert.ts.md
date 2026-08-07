# L7-B · b1 — rota `POST /ped-comp/insert` do **erp-proxy**

> **Este arquivo é entrega para colar no OUTRO repo** (`erp-proxy`, `src/routes/ped-comp.ts`).
> Fica versionado aqui só como referência do que foi entregue e quando — o agente não escreve no erp-proxy.
> Data: 07/08/2026 · Plano: `PLANO-PROJETOS.md` seção 12 (L7-B, item b1).

## ⚠️ Premissas — confira ao colar

O `erp-proxy` é privado e o ambiente não tem `gh`, então **não foi possível ler o `/update` real**. O código abaixo foi escrito a partir das assinaturas levantadas pelo Pedro no GitHub Web. Quatro pontos precisam bater com o arquivo:

1. O objeto de rota se chama `router` (padrão `express.Router()`).
2. `requireSupabaseAuth` é aplicado **por rota** — se no arquivo ele estiver aplicado no router inteiro (`router.use(requireSupabaseAuth)`), **remova** o middleware da linha do `router.post`.
3. Os helpers `callAlvo` e `alvoMessage` já estão importados no topo do arquivo (o `/update` os usa). **Nenhum import novo é necessário.**
4. O helper de log — abaixo está `console.log`/`console.error` com prefixo `[ped-comp/insert]`. Se o arquivo usar um logger próprio (`log.info`, `req.log`, etc.), troque para o mesmo.

## Onde inserir

Em `src/routes/ped-comp.ts`, **imediatamente após o bloco do `router.post("/update", …)`** e antes do `export default router;`. Ficar ao lado do `/update` é de propósito: são gêmeas e devem ser lidas juntas.

## Código

```ts
/**
 * POST /ped-comp/insert
 *
 * Gêmea da /update: mesmo endpoint do Alvo (PedComp/SavePartial), só muda
 * action=Insert. Existe para o módulo de Projetos parar de autenticar direto no
 * ERP com credenciais do localStorage do navegador — o que fazia todo pedido
 * sair carimbado com o usuário de quem configurou as credenciais,
 * independentemente de quem clicou (achado A-8 do PLANO-PROJETOS).
 *
 * Não confundir com /insert-multipart: aquela usa SaveMultiPart + FormData e
 * exige campos que Projetos não monta. Esta manda JSON puro, exatamente como o
 * front já mandava direto ao Alvo (foi assim que o pedido 0004626 foi criado).
 */
router.post("/insert", requireSupabaseAuth, async (req, res) => {
  const body = req.body;

  // ── Validações mínimas (equivalentes às do /update, adaptadas ao insert) ──
  // No insert NÃO se valida Numero: ele é gerado pelo Alvo. O front manda
  // Numero: "" de propósito.
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Body ausente ou inválido" });
  }

  if (!body.CodigoEmpresaFilial) {
    return res.status(400).json({ error: "CodigoEmpresaFilial é obrigatório" });
  }

  if (!body.CodigoEntidade) {
    return res.status(400).json({ error: "CodigoEntidade (fornecedor) é obrigatório" });
  }

  if (!Array.isArray(body.ItemPedCompChildList) || body.ItemPedCompChildList.length === 0) {
    return res.status(400).json({ error: "ItemPedCompChildList não pode ser vazio" });
  }

  console.log(
    `[ped-comp/insert] filial=${body.CodigoEmpresaFilial} entidade=${body.CodigoEntidade} ` +
      `itens=${body.ItemPedCompChildList.length} usuario=${body.CodigoUsuario ?? "-"} ` +
      `valorTotal=${body.ValorTotal ?? "-"}`,
  );

  try {
    const data = await callAlvo("PedComp/SavePartial?action=Insert", "POST", body);

    const numero = data?.Numero ?? data?.numero ?? data?.NumeroPedComp ?? null;

    if (!numero) {
      // ATENÇÃO — diferente do GET, aqui 200-sem-Numero NÃO vira 502.
      // No GET, resposta sem Numero é resposta vazia e não há efeito colateral,
      // então o 502 protege contra "wipe". No INSERT o pedido pode já ter sido
      // criado no ERP: transformar isso em erro faria o Hub registrar falha de
      // algo que existe lá — exatamente a divergência Hub × ERP que este lote
      // veio corrigir. Então: alerta no log e devolve o corpo para o chamador.
      console.error(
        "[ped-comp/insert] ALERTA: Alvo respondeu OK sem Numero. " +
          "Conferir manualmente se o pedido foi criado. Resposta:",
        JSON.stringify(data)?.slice(0, 500),
      );
    } else {
      console.log(`[ped-comp/insert] OK — pedido ${numero} criado`);
    }

    return res.json(data);
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    const mensagem = alvoMessage(err);

    console.error(`[ped-comp/insert] FALHA status=${status ?? "-"} msg=${mensagem}`);

    if (status && status >= 400 && status < 600) {
      return res.status(status).json({ error: mensagem, details: err?.details ?? err?.response?.data });
    }

    return res.status(502).json({ error: mensagem || "Falha ao criar pedido no Alvo" });
  }
});
```

## Conferência: o payload de Projetos passa nas validações?

Verificado em `src/services/alvoProjetoPedidoService.ts` → `buildPayload()` (o mesmo payload que criou o pedido `0004626`):

| Validação | Campo no payload | Passa? |
|---|---|---|
| `CodigoEmpresaFilial` presente | `"1.01"` (literal, linha 210) | ✅ |
| `CodigoEntidade` presente | `req.fornecedor_codigo` — o front já barra antes com "Fornecedor não informado" (`validar()`, linha 40) | ✅ |
| `ItemPedCompChildList` array não-vazio | `itemChildList`, montado de `req.itens`; o front barra "Requisição sem itens" antes (linha 44) | ✅ |
| `Numero` **não** é validado | payload manda `Numero: ""` | ✅ (por isso a validação de `Numero` foi deliberadamente omitida) |

Campos que o `/insert-multipart` exigiria e que **não** são validados aqui de propósito — o payload de Projetos até os tem, mas validá-los criaria acoplamento desnecessário: `ParcPagPedCompChildList`, `CondPagPedCompObject.CodigoCondPag`, `PedCompClasseRecDespChildList`.

## Depois do deploy no Render

Seguem b2/b3/b4 no `finances-pf`:
- **b2** — `alvoProjetoPedidoService.ts` passa a chamar `POST {ERP_PROXY_URL}/ped-comp/insert` com `Authorization: Bearer <JWT do Supabase>`, no lugar de `authenticateAlvo()` + `fetch` direto ao `ERP_BASE_URL`.
- **b3** — `CodigoComprador: null` (decisão de 22/06, registrada em `pedidosService.ts:281`).
- **b4** — `CodigoUsuario` via `resolverUsuarioAlvo` **importado** (não copiado); remover o fallback `PEDRO.SCRIGNOLI` da linha 86.
- **b5** (Pedro) — preencher `profiles.alvo_usuario` de `ana.sanches@pfbrazil.com` e `nfe@pfbrazil.com` com o login **real** do Alvo, confirmado por ele.
