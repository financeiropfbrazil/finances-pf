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

## 11. Investigação de 21/10/2026 — onde o DocFin guarda a linha digitável e como casar boleto × parcela

Pedido do Pedro: "como o Alvo pede, no DocFin, para inserir a linha digitável" e "como garantir que o boleto seja da
parcela correta quando houver mais de uma". Só leitura (payloads do Alvo guardados no Hub, código do erp-proxy,
espelho `fin_parcelas_pagar`); nenhuma chamada ao Alvo.

### 11.1 O que o DocFin tem (medido em 2.123 parcelas de `desp_docfin_doc.payload_alvo->ParcDocFinChildList`)

A linha digitável é **da parcela**, não do documento: cada item de `ParcDocFinChildList` (chave = `ChaveDocFin` +
`Sequencia`, e `Parcial` quando há pagamento parcial) tem os campos abaixo — **todos vazios nas 2.123 parcelas**:

| Campo da parcela | Para quê | Preenchido |
|---|---|---|
| `LinhaDigitavel` | a linha do boleto | 0 |
| `CodigoBarras` | os 44 dígitos | 0 |
| `NossoNumero` | identificação do boleto no banco | 0 |
| `NumeroBanco`, `NumeroAgBancaria` (+ `…Cobrador`/`…Cobradora`) | banco/agência do boleto | 0 |
| `PixCopiaCola`, `CodigoQR` | PIX do boleto híbrido | 0 |
| `ObservacaoBoleto` | texto livre | 0 |
| `UsoLeitor` | provavelmente "como o código entrou" (leitor) | sempre "Nenhum" |
| `SegmentoPagamento` | provavelmente o segmento do CNAB de pagamento | sempre "Nenhum" |
| `CodigoTipoCobranca` | forma de pagamento | sempre preenchido |
| `DataHoraCtrlConcorrencia`, `UsuarioCtrlConcorrencia` | controle de concorrência do Alvo | 1.472 |

Formas de pagamento (tabela do Alvo, `fin_parcelas_pagar.tipo_cobranca`) que importam aqui: `0000003 DDA` (570
parcelas de NFS-e), `0000021 BOLETO OUTROS BANCOS` (25), `0000011 BOLETO ITAU` (7), `0000022 BOLETOS CONTAS CONSUMO`
(1), `0000009 AGUARDANDO BOLETO` (1), `0000025 PIX QRCODE`. Existe, portanto, o estado "aguardando boleto" — é o
ponto natural para a leitura do boleto entrar.

**Como gravar (padrão já provado no erp-proxy, `services/alvo-anexar-pdf.ts`):** `DocFin/Load` (DocFin completo,
com as listas filhas) → alterar só a parcela → `DocFin/SaveMultiPart?action=Update&savePartial=false` com o objeto
inteiro (e o PDF, se for anexar) → `DocFin/Load` de novo e comparar. O objeto inteiro volta junto, por isso o Load
imediatamente antes e a comparação depois.

**Não há documentação pública da Riosoft sobre esses campos** (busca na web sem resultado). O que só o Lab (B0) ou
a Riosoft respondem:
1. Formato aceito em `LinhaDigitavel`: só os 47/48 dígitos, ou formatada (`74891.12628 …`)? Tamanho máximo?
2. O Alvo valida o DV? Preenche `CodigoBarras` sozinho a partir da linha (e o que muda em `UsoLeitor`)?
3. DocFin de **origem Estoque** (gerado pelo MovEstq) aceita `Update` pela API nesses campos?
4. `SegmentoPagamento` precisa ser preenchido para boleto? Quais valores existem?
5. Trocar `CodigoTipoCobranca` (ex.: AGUARDANDO BOLETO → BOLETO OUTROS BANCOS / BOLETO ITAU pelo banco da linha) é
   permitido e desejado?
6. O controle de concorrência recusa um Save com `DataHoraCtrlConcorrencia` velho (alguém alterou entre o Load e o
   Save)? É a proteção que se quer.

**Roteiro do teste no Lab (1 título de teste com 2+ parcelas, origem Estoque):** Load e guardar o JSON → mudar só
`LinhaDigitavel` da parcela 2 (47 dígitos) → Save → Load e comparar campo a campo (formato guardado, `CodigoBarras`,
`UsoLeitor`, `DataHoraCtrlConcorrencia`, parcela 1 intacta) → repetir com a linha formatada e com DV errado → Save
com `DataHoraCtrlConcorrencia` velho → ver onde a linha aparece na tela do DocFin.

### 11.2 Boleto × parcela quando há mais de uma (medido em `fin_parcelas_pagar`, vencimentos de 2026)

- A parcela tem número próprio no Alvo, no formato `documento/parcela-total` (`131/2-3`, `5645/ 2-36`), e duas
  datas: **`data_vencimento`** (a do fornecedor) e **`data_prorrogacao`** (a que a P&F programou para pagar —
  ex.: 24/09 → 28/09, 08/10 → 06/10). O boleto traz o vencimento do fornecedor.
- NFS-e: **1.126 títulos, 32 parcelados** (máx. 10 parcelas). **Só o valor** separa as parcelas em 6 dos 32 (é
  comum parcelas iguais: 3 × R$ 3.900, 4 × R$ 154,16); **valor + `data_vencimento` separa em todos os 32 (0
  ambíguos)**; com `data_prorrogacao` no lugar haveria 1 ambíguo — por isso o casamento usa o vencimento original.
- Os 28 títulos de NFS-e pagos por boleto comum (BOLETO OUTROS BANCOS/ITAU/CONTAS CONSUMO/AGUARDANDO) têm **todos
  parcela única**; os parcelados de hoje são DDA (10), PIX (10), cartão (7) e outros (5). O caso "vários boletos"
  é raro, mas acontece (ex.: Lucipharma, NF-e, 3 boletos num PDF só).
- NF-e (para quando a leitura se estender): 194 parcelados de 1.402; 3 ambíguos mesmo com valor + data.

**Regra proposta (a IA só lê; quem casa é a regra):**
1. Escopo: parcelas do título da nota no Alvo **abertas** (sem pagamento), **não agrupadas**, não projeção.
2. De cada boleto com DV válido, usar o **valor e o vencimento do próprio código** (fator de vencimento) — não o
   texto impresso, que só serve para conferir.
3. **Casa sozinho** só quando exatamente 1 parcela aberta tem valor = valor da linha (±R$ 0,01) **e**
   `data_vencimento` = vencimento da linha (aceitar `data_prorrogacao` só como 2ª opção), e essa parcela não está
   casada com outro boleto.
4. Desempate: o "Nº do documento" impresso (`131/2` → sequência 2, comparado com o `Numero` da parcela `131/2-3`) e
   o nosso número, se a parcela já tiver um.
5. Sem casamento único, ou com valor/data divergentes (2ª via com juros, boleto pelo bruto e parcela pelo líquido,
   data diferente como no caso TOTVS 08/09 × 29/09): **nada automático** — a tela mostra as parcelas abertas lado a
   lado e a pessoa escolhe; fica registrado quem escolheu.
6. Travas: 1 boleto ↔ 1 parcela; a mesma linha não vai para duas parcelas (nem de títulos diferentes); parcela que já
   tem linha diferente → para e mostra; parcela paga ou agrupada → não grava; PDF com vários boletos → casa o
   conjunto de uma vez (1 para 1) e só segue se todos casarem.
7. Gravação no Alvo (fase B4) só com botão e confirmação, com o antes/depois guardado.

### 11.3 Captura do Network da tela do Alvo (Pedro, 22/10/2026) — DocFin 33962 (NFS-e 142255 MEDLAB)

Salvamento de um DocFin pela tela web do Alvo, com o F12 > Network (só o que foi colado; nenhuma chamada feita daqui):

- **A tela usa `POST {ALVO}/api/DocFin/SavePartial?action=Update`**, com JSON, sem multipart. O erp-proxy usa outra
  rota hoje (`SaveMultiPart?action=Update&savePartial=false`, objeto inteiro), por causa do PDF.
- **O corpo é parcial:** as chaves do DocFin (`CodigoEmpresaFilial`, `Chave`), as flags de controle que a tela sempre
  manda (`OkFinanceiro`, `OkFiscal`, `OkContabil`, `PermiteAlterarContabil`, `TipoFormulario`, `IsHistorico`,
  `IsRegistrarPagamento`, `DistribuicaoParcelas`, `AlteracaoEmLote`, `AlterouFonte`, `CONFCRECCALPARCIRRF`,
  `UploadIdentify`…) e as listas filhas. **A parcela foi só com as chaves**: `{CodigoEmpresaFilial, ChaveDocFin,
  Sequencia, Parcial}`. O rateio de classe foi com mais campos. Ou seja, o Alvo aceita um "delta". Gravar a linha
  digitável seria mandar a parcela com as 4 chaves + os campos do boleto, **sem reenviar o DocFin inteiro** — menos
  risco de sobrescrever alguma coisa (a confirmar com a captura em que a linha é de fato digitada).
- **A resposta traz o DocFin inteiro já salvo:** o "depois" para comparar vem na mesma chamada. Vêm também
  `InformationResult: []` (mensagens), `parcDocFin: []` e `itemCobBanc: []` (itens de cobrança bancária).
- **DocFin gerado pelo estoque aceitou o Update:** `ModuloOrigem = "Estoque"`, `ChaveMovEstq = 21371`, "Documento
  integrado pelo estoque", e o Save passou (`DataUltimaAtualizacao` do documento mudou para 21/10 21:55). Isso
  responde, em parte, a pergunta 3 do Lab. Falta ver se vale também para os campos da parcela.
- **Na parcela, `LinhaDigitavel`, `CodigoBarras`, `NossoNumero` e `NumeroBanco` seguiram `null`; `UsoLeitor` e
  `SegmentoPagamento` seguiram "Nenhum".** A `DataUltimaAtualizacao` da parcela não mudou (17:25), então este
  salvamento não alterou a parcela. Os campos `UsuarioCtrlConcorrencia`/`DataHoraCtrlConcorrencia` da parcela vieram
  `null`.
- **A forma de pagamento já era `0000011 BOLETO ITAU`** (venc. 29/10, prorrogação 27/10).
- **Valor:** a parcela tem `ValorOriginal` **544,29** (líquido) e `ValorBruto` **570,83**. A diferença são as retenções
  de PIS 3,71 + COFINS 17,12 + CSLL 5,71. Nas NFS-e de 2026, **227 de 1.223 parcelas (18,6%)** têm bruto ≠ líquido.
  Por isso o casamento precisa aceitar o boleto pelo **líquido** (o normal) **ou** pelo **bruto**, com aviso de
  "retenção não descontada no boleto" — no pagamento isso significa pagar a retenção ao fornecedor.

**Ainda falta (uma 2ª captura):** digitar a linha digitável na parcela e salvar, e copiar o **Payload em "view
source"** (JSON bruto, sem o resumo do Chrome) e a Response. Isso responde o formato aceito, se o Alvo calcula o
`CodigoBarras`/`NossoNumero`/`NumeroBanco` sozinho, o que muda em `UsoLeitor` e se ele valida o DV.

### 11.4 Teste com a linha digitável (Pedro, 22/10/2026) — DocFin 33962, parcela 1

Linha **de teste** montada no Hub com DV válido (banco 341, R$ 544,29, venc. 29/10/2026, nosso número `99999999`,
agência e conta zeradas — não registrada na CIP, impagável), colada na tela do Alvo e salva com o F12 aberto:

- **Payload:** a tela mandou na parcela só `{CodigoEmpresaFilial, ChaveDocFin, Sequencia, Parcial, LinhaDigitavel}`.
  **`LinhaDigitavel` foi com o código de barras de 44 dígitos** (`34199161400000544291099999999970000000000000`),
  não com a linha de 47 colada: a tela converte linha → código de barras antes de enviar.
- **Response:** `LinhaDigitavel` gravado exatamente assim (44 dígitos, sem formatação); `CodigoBarras`,
  `NossoNumero` e `NumeroBanco` seguiram `null`; `UsoLeitor` e `SegmentoPagamento` seguiram "Nenhum";
  `DataUltimaAtualizacao` da parcela mudou (22:01:07); `InformationResult: []`. Parcela de DocFin **origem
  Estoque** aceitou a alteração.
- Se o servidor confere o DV não deu para ver (a tela converte antes). Para o Hub não importa: a linha só segue para o
  Alvo depois da conferência por DV, valor e vencimento.

**Desenho da gravação (B4) revisto com isso:** `DocFin/Load` (antes) → `POST DocFin/SavePartial?action=Update` com o
corpo da tela (chaves do DocFin + flags de controle + `DocFinClasseRecDespChildList` como veio do Load) e
**só a parcela casada** com as 4 chaves + `LinhaDigitavel` = os 44 dígitos (`conferirLinhaDigitavel().codigo_barras`)
→ a resposta já é o "depois" (comparar campo a campo; nenhum outro campo da parcela pode mudar). Não preencher
`CodigoBarras`/`NossoNumero`/`NumeroBanco`, porque a tela também não preenche. Comparar boleto lido × o que está no
Alvo sempre pelo código de barras (44).

**Limpeza (Pedro, 22/10/2026):** a linha de teste foi apagada na tela e salva. O Payload mandou a parcela com as 4 chaves
+ **`LinhaDigitavel: ""`** (string vazia, não `null`), com o mesmo corpo de controle do DocFin e o
`DocFinClasseRecDespChildList` de novo. A Response desse salvamento não foi copiada, então não se sabe se o Alvo guarda
`""` ou converte para `null`. Consequências para o B4:

- **desfazer** uma linha gravada pelo Hub = o mesmo `SavePartial` com `LinhaDigitavel: ""`, como a tela faz;
- **"parcela sem linha"** = `null` **ou** `""` (ou só espaços). A trava "parar se a parcela já tem outra linha" não
  pode tratar `""` como linha existente.

Com isso o roteiro desta investigação fecha: formato de escrita, corpo parcial, origem Estoque e limpeza estão vistos
na tela. Continuam sem prova o DV conferido pelo servidor (a tela converte antes) e o comportamento de
`CodigoBarras`/`NossoNumero`/`PixCopiaCola`, que a tela não preenche e o B4 também não vai preencher.
