# Boleto da NFS-e: ler com IA e gravar nas parcelas do DocFin — investigação (20/10/2026)

Pedido do Pedro: *"Investigue profundamente como eu poderia ler, com IA, os boletos e lançar no DocFin das
parcelas geradas pelo lançamento da NFS/Pedido."* **Nada foi construído.** Só leitura no banco
(`hbtggrbauguukewiknew`, fingerprint 2.312 pedidos) e no código.

## 1. Resposta curta

Dá para fazer, em três peças independentes:

1. **Ler** o PDF do boleto (etapa 5 do detalhe) com o Claude numa Edge Function — o projeto já faz isso com
   DANFE na `extrair-nfe`.
2. **Conferir por regra, sem confiar na IA**: a linha digitável carrega banco, valor e vencimento com dígitos
   verificadores. A IA lê; a matemática confirma.
3. **Gravar** na parcela do DocFin por uma rota nova do erp-proxy (`DocFin/SaveMultiPart?action=Update`, o
   mesmo tipo de escrita que o Intercompany já usa para anexar PDF em DocFin existente).

Mas o dado mais importante da investigação muda o *porquê*: **hoje o Alvo não é usado para pagar boleto**
(§2). Antes de gravar código de barras no DocFin, o Pedro precisa decidir *para que* ele vai lá (§8).

## 2. O que foi medido

| Pergunta | Resultado |
|---|---|
| A parcela do DocFin tem campos de boleto? | **Sim.** `ParcDocFinChildList[]` traz `LinhaDigitavel`, `CodigoBarras`, `NossoNumero`, `NumeroBanco`, `NumeroBancoCobrador`, `NumeroAgBancariaCobradora`, `PixCopiaCola`, `CodigoQR`, `ObservacaoBoleto`, `SegmentoPagamento`, `CodigoTipoCobranca`, `DataVencimento`, `DataProrrogacao` (DocFin/Load guardados em `desp_docfin_doc`) |
| Alguém preenche hoje? | **Não.** ~2.100 parcelas guardadas, de 12 tipos de cobrança (inclusive 211 DDA e 156 "Boleto outros bancos"): **0** com código de barras, linha digitável, nosso número ou PIX; `SegmentoPagamento` sempre `Nenhum` |
| Como se pagam as NFS-e (2026, ~1.190 parcelas) | **DDA 46,8%** · PIX transferência 24,2% · baixa de adiantamento 18,1% · cartão 6,1% · boleto outros bancos 2,0% · "-------" 1,3% · TED 0,8% · boleto Itaú 0,6% |
| Parcelas por título de NFS-e | 1.063 de 1.094 títulos (97%) têm **1 parcela**; 31 têm de 2 a 10 |
| Volume | ~114 NFS-e lançadas/mês em 2026; ~55/mês com cobrança por boleto/DDA |
| O Hub já grava em DocFin? | **Sim, pelo erp-proxy:** `DocFin/SavePartial?action=Insert` (Cartões, Intercompany) e `DocFin/SaveMultiPart?action=Update&savePartial=false` em `src/services/alvo-anexar-pdf.ts` do erp-proxy (anexa PDF em DocFin existente) — `docs/erp-proxy/CARD-F-nao-repetir-criacao.md` §1 |
| O Hub já usa IA em PDF? | **Sim:** Edge `extrair-nfe` (v13, `claude-sonnet-4-6`, PDF em base64, JSON + conferência determinística de chave/aritmética/destinatário) |
| Onde testar escrita no Alvo | Lab de API do Alvo (o mesmo da Fase 0 da OP, PLANO-OP §6.2) |

**Leitura dos números:** o pagamento acontece no banco (DDA aprovado no internet banking, PIX, TED) e depois
se dá baixa no Alvo. O código de barras no DocFin hoje não seria usado por ninguém — a não ser que o Pedro
queira (a) a prova e a conferência guardadas no título, (b) pagar pelo Alvo no futuro (remessa CNAB de
pagamento), ou (c) o boleto como pré-requisito do "Lançar" (etapa 3).

## 3. O que se lê sem IA (e onde a IA entra)

**Boleto bancário** — linha digitável de 47 dígitos (código de barras de 44):
- dígitos 1–3 = **banco**; 4 = moeda (9 = real);
- campos 1, 2 e 3 têm DV **módulo 10**; o DV geral do código de barras é **módulo 11**;
- campo 5 = **fator de vencimento** (4 dígitos) + **valor** (10 dígitos, em centavos).
  Fator → data: 07/10/1997 + fator dias, até o fator 9999 (21/02/2025); **desde 22/02/2025 o fator recomeçou
  em 1000** (regra Febraban) → data = 22/02/2025 + (fator − 1000). Fator 0000 = sem vencimento; valor zero =
  valor definido no pagamento.

**Arrecadação (concessionária/tributo)** — 48 dígitos começando por `8`, 4 blocos de 11 + DV; o 3º dígito diz
o módulo (6/7 → 10; 8/9 → 11). Normalmente sem vencimento no código.

Ou seja: **banco, valor e vencimento saem da linha digitável** — mas atenção (achado no teste de 20/10): o DV
geral do boleto bancário **não pega toda troca de dígito no fator ou no valor**, porque a regra Febraban leva os
restos 0, 1 e 10 ao mesmo DV (1). Por isso a linha só vale como "perfeita" com o DV certo **e** o valor e o
vencimento impressos (lidos à parte) iguais aos tirados da linha. A IA serve para:
- achar e transcrever a linha digitável (inclusive em boleto escaneado) — um erro de leitura quebra o DV e é
  pego na hora;
- ler o que **não** está no código: **beneficiário (nome e CNPJ)**, pagador (deve ser a P&F), nosso número,
  número do documento (costuma ser o da NF), vencimento e valor impressos (conferem com o código), multa/juros,
  **PIX copia-e-cola** dos "bolepix".

Precedente do próprio Pedro: o sistema IBBIC tem `ler_boleto` com conferência dos dígitos — a mesma ideia.

## 4. Conferência boleto × parcela (o valor de verdade, já na 1ª fase)

Para a nota em que o PDF foi anexado: título(s) pela `v_nfse_recebida` → parcelas abertas em
`fin_parcelas_pagar` (`data_pagamento` nula).

| Regra | Se falhar |
|---|---|
| DVs da linha digitável | ❌ leitura inválida — pedir outro arquivo |
| **Beneficiário = prestador** (CNPJ igual ou mesma raiz) | ⛔ alerta forte (cessão para FIDC/factoring ou **boleto adulterado**) — bloqueia gravação |
| Pagador = P&F (26.602.204/0001-96) | ⛔ boleto de outra empresa |
| Valor do código = valor da parcela (±R$ 0,01) | ⚠️ divergência (juros, retenção, valor bruto × líquido) |
| Vencimento do código = vencimento/prorrogação da parcela | ⚠️ divergência — decisão humana |
| Valor e vencimento impressos = os do código | ⚠️ PDF suspeito |
| Título agrupado (`Agrupamento`) ou já pago | ⏸ não grava |

Isso sozinho já entrega: alerta de fraude de boleto, divergência de valor/vencimento antes de pagar, e o
boleto como prova anexada — sem tocar no Alvo.

## 5. Leitura com IA — desenho

- **Onde:** Edge Function nova `nfse-ler-boleto`, disparada pela tela depois do upload. Lê o PDF da pasta
  `nfse-boleto-pdf` com a service role (o navegador não manda o arquivo de novo).
- **Acesso:** `verify_jwt = true` **e** checagem de `compras.nfse.access` (ao contrário da `extrair-nfe` — §9).
- **Chamada:** SDK oficial (`npm:@anthropic-ai/sdk` no Deno), PDF como bloco `document` base64 (limite da API
  32 MB / 600 páginas; a pasta já limita a 10 MB), saída com **structured outputs** (`output_config.format`
  com JSON Schema) — JSON garantido, sem o "tirar cercas de markdown" da `extrair-nfe`.
- **Modelo:** `claude-opus-5-5` com `effort: "low"` (extração simples; o padrão do modelo é `medium`), e o
  parâmetro `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) + tratamento de
  `stop_reason = "refusal"`. Alternativas mais baratas, se o Pedro preferir: `claude-sonnet-5-5` (~metade) ou
  `claude-haiku-5-5` (~1/40) — a conferência por DV protege a escolha.
- **Custo estimado (a medir em 10 boletos reais pelo `usage`):** 1 página ≈ 2–3 mil tokens de entrada + ~1–2 mil
  de saída → **~US$ 0,03–0,06 por boleto** no Opus 5.5 → **~US$ 2–4/mês** para ~55 boletos (ler todas as ~114
  NFS-e/mês: ~US$ 6). Preços de tabela: Opus 5.5 US$ 4 / 20 por milhão de tokens (entrada/saída).
- **Guarda:** tabela nova `nfse_boleto_leitura` (anexo, modelo, tokens, JSON lido, resultado de cada regra da
  §4, parcela casada, situação: lido · conferido · divergente · gravado no Alvo), fechada como a `nfse_anexo`
  (só RPC), com o antes/depois de qualquer gravação.
- **Tela (etapa 5):** o que foi lido + ✅/⚠️/⛔ por regra + a parcela casada; botão de gravação só na fase 4.

## 6. Gravação no DocFin — desenho e o que falta provar

**Rota nova no erp-proxy** (repo separado; Pedro cola pelo GitHub Web, deploy fora das janelas do cron):
`POST /docfin/parcela-boleto { chaveDocFin, sequencia, linhaDigitavel, ... , pdf }`

1. `DocFin/Load` (com as listas filhas) — confere que a parcela está **aberta**, **não agrupada**, e que os
   campos de boleto estão vazios ou iguais ao que vai gravar (senão para e devolve o que achou).
2. Monta o Update só com a parcela alterada: `LinhaDigitavel`, `CodigoBarras` (os 44 dígitos derivados),
   `NossoNumero`, `NumeroBanco`, `PixCopiaCola` quando houver. **Nunca valor.** Data de vencimento/prorrogação
   e tipo de cobrança só se o Pedro decidir (§8).
3. `DocFin/SaveMultiPart?action=Update` com o PDF do boleto anexado (padrão do Intercompany).
4. `DocFin/Load` de novo e compara campo a campo; devolve antes/depois para o Hub registrar.

**Travas:** botão humano com confirmação (nada automático no começo); idempotente (se já está igual, não
regrava); permissão própria (ex.: papel `financeiro`); kill-switch em `sync_settings`; teste com usuário
**sem** `is_admin`; o "Lançar" (etapa 3) continua separado.

**Perguntas para o Lab de API (fase 0 — antes de qualquer código de escrita):**
1. O `Update` aceita mudar esses campos num DocFin de **origem Estoque** (gerado pelo MovEstq) — ou o Alvo
   trava a edição fora do MovEstq?
2. Precisa mandar o DocFin inteiro (`savePartial=false`, como o anexar-PDF) ou dá para mandar só a parcela?
   (Mandar inteiro = risco de sobrescrever alteração feita no meio — por isso o passo 1 e o 4.)
3. O Alvo valida o DV da linha digitável? Recalcula alguma coisa (retenções, rateio, situação) ao salvar?
4. Quais são os valores de `SegmentoPagamento` e de `CodigoTipoCobranca` que o financeiro usaria para boleto?
5. Anexar PDF funciona em DocFin de origem Estoque?

## 7. Riscos

| Risco | Tratamento |
|---|---|
| IA lê um dígito errado | DV módulo 10/11 recusa; valor e vencimento conferem com o impresso |
| Boleto adulterado / beneficiário trocado | Regra beneficiário = prestador bloqueia; DDA no banco é a segunda linha |
| Gravar por cima de mudança feita no Alvo | Load antes e depois; só grava se os campos estão vazios/iguais |
| Escrever em DocFin errado | Chave e sequência vêm do espelho; conferidas no Load (CNPJ, número, valor) |
| Nota com várias parcelas | Hoje 1 boleto ativo por nota (`nfse_anexo`) — fase 3 muda para 1 por parcela |
| Gasto de IA | Centavos por boleto; Edge com login e permissão; leitura só sob demanda |

## 8. Decisões do Pedro (antes de construir)

1. **Para que o boleto vai para o DocFin?** (a) registro + PDF anexado no título; (b) também acertar
   vencimento/prorrogação quando o boleto diverge; (c) preparar pagamento pelo Alvo (remessa CNAB) — projeto
   maior; (d) só a conferência no Hub, sem gravar no Alvo.
2. **Quem grava?** Operador de Compras, financeiro, ou só depois de aprovação?
3. **Modelo:** Opus 5.5 (padrão) ou um mais barato?
4. **Como os boletos chegam hoje** (e-mail? portal do fornecedor?) — define se depois vale ler da caixa de
   e-mail em vez de upload.
5. Para os 47% em **DDA**: o banco tem API de DDA? Se sim, o dado do boleto viria pronto do banco, sem PDF.

## 9. Achado lateral — `extrair-nfe` aberta

A Edge `extrair-nfe` (v13) está com `verify_jwt = false`, CORS `*` e **sem checagem de usuário**, e chama a
API da Anthropic com a chave do projeto. Qualquer pessoa com a URL (o ref do projeto é público no app) pode
mandar PDFs e **gastar créditos**. Não expõe dado. Nenhuma tela do Hub chama essa função hoje (grep em `src/`).
Correção simples (ligar `verify_jwt` ou exigir permissão, ou desativá-la) — **aguarda ordem do Pedro**.

> **Corrigido em 21/10/2026 (ordem do Pedro: "corrija"), Edge v14:** a função exige usuário logado com
> `compras.nfe.access` (admin passa). `verify_jwt` segue `false` de propósito — a chave pública (anon) do app também é
> um JWT válido e passaria pelo gateway; o controle real é o usuário + permissão no código. Provas pelo banco
> (`net.http_post`): antes, POST sem login → 400 "pdfBase64 obrigatório" (a função rodava); depois, sem login,
> token falso e chave pública → **401**. Caminho de usuário com permissão não testado daqui (não há como gerar o
> JWT de um usuário pelo banco); nenhuma tela chama a função hoje.

## 10. Fases propostas (cada uma com OK)

| Fase | O quê | Toca o Alvo? |
|---|---|---|
| B0 | Provas no Lab de API (§6, perguntas 1–5) com 1 título real escolhido | Lab |
| B1 | `nfse_boleto_leitura` + Edge `nfse-ler-boleto` + conferência §4 + tela da etapa 5 | Não |
| B2 | Medir em 10–20 boletos reais: acerto, custo, divergências achadas | Não |
| B3 | Boleto por parcela (notas com 2+ parcelas) | Não |
| B4 | Rota `/docfin/parcela-boleto` no erp-proxy + botão "Gravar no DocFin" com as travas da §6 | **Sim** |
