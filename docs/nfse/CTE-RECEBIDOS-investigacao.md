# CT-e recebidos junto da lista de NFS-e — investigação (20/10/2026)

Pedido do Pedro: "verificar a possibilidade de importar, junto com a lista de NF Serviços, os CT-e", com base no relatório
*Captura automática de XML de CT-e como tomador — SEFAZ, APIs, MCP e arquitetura recomendada (out/2026)*.
Só leitura: nada foi aplicado, nenhuma chamada à SEFAZ foi feita.

## Resposta curta

**É viável, e mais barato do que o relatório supõe.** O relatório recomenda contratar a Focus NFe principalmente porque
o mTLS com certificado ICP-Brasil é instável no Edge Runtime do Supabase. O Hub não depende disso. As duas peças
difíceis já existem:

1. **Certificado A1 com mTLS funcionando contra o governo, no erp-proxy (Node, Render).** O mesmo `CERT_PFX_BASE64`
   já fala com o ADN da NFS-e (job 35 ligado desde 20/10) e já consultou a SEFAZ de NF-e (`/nfe/sync-batch`: 23 runs
   em jun/2026, 2 NF-e baixadas, 0 consumo indevido).
2. **O molde completo do coletor**, com Edge, `sync_runs`, kill-switch, cron, espelho, view, tela e conferência de NSU
   sem buraco. É o da NFS-e (PLANO-NFSE Fase 0 + 1).

Recomendação: **construir pela rota do erp-proxy** (opção 3 do relatório, sem o risco do mTLS no Supabase), sem
contratar terceiro e sem entregar o certificado a ele. **Uma pergunta bloqueia o início:** quem mais consulta CT-e da
P&F na SEFAZ (ver Decisões, item 1).

## O que o relatório diz × o que vale para o Hub

| Ponto do relatório | Situação no Hub |
|---|---|
| mTLS ICP-Brasil no Edge Runtime é instável (plano B: worker Node) | O plano B **já é o caminho em produção**: o mTLS mora no erp-proxy. |
| Comprar Focus (R$ 94,90–572/mês, certificado com terceiro) | Custo e custódia evitáveis. A operação (monitorar NSU, coletor parado, renovar certificado) já é feita para o ADN. |
| Um só consumidor por CNPJ, senão rejeição 656 | **Confirmado** nas regras da NF-e (NT 2014.002): aplicações diferentes que consultam por NSU o mesmo CNPJ precisam seguir a mesma sequência crescente, senão 656 e bloqueio de 1 h. No CT-e **não há consulta por chave** (só `distNSU`/`consNSU`), então não existe o atalho que o `/nfe/sync-batch` usa (consulta por chave, que não disputa NSU). |
| Janela de 3 meses; NSU interrompido após ~60 dias parado | Cron diário e alerta de coletor parado, no mesmo padrão do ADN. A 1ª drenagem só alcança os últimos 3 meses (≈ desde 20/07/2026); o que é anterior fica só no espelho do Alvo. |
| Tomador recebe o XML completo sem manifestação | Remetente e destinatário também recebem, então a fila traz CT-e em que a P&F **não paga** o frete (compra CIF, venda FOB). A lista filtra pelo papel da P&F (`toma3`/`toma4`). |
| Reforma Tributária (IBS/CBS) | Guardar o XML bruto e tratar os grupos novos como opcionais, como já se faz com a NFS-e. |
| Endpoint `www1.cte.fazenda.gov.br/CTeDistribuicaoDFe` | Não testado daqui: o ambiente da sessão bloqueia o host (403 no proxy). O teste de conexão fica para a rota do erp-proxy em modo `teste`, como foi a NFSE-0.4 do ADN. |

## Medido no banco (20/10/2026)

- **Volume:**
  - CT-e lançados no Alvo em 2026: **~55 por mês** (entre 43 e 68), de R$ 83 mil a R$ 161 mil por mês, com 2 a 6 transportadoras por mês.
  - **Só 4 de 509 estão ligados a pedido.**
  - Títulos de CT-e no contas a pagar com vencimento em 2026: 536, R$ 1,19 milhão, 13 transportadoras: J V de Brito 276, DHL Express 226, NKK 14, Rodonaves 5, Bessa 3.
- **A espécie "CT" no contas a pagar não é CT-e.** São contratos (DocuSign, CIEE, Delbem…: 87 títulos, R$ 845 mil). O casamento deve usar só `CT-e`/`Ct-e`, sem diferenciar maiúsculas (armadilha 15 do PLANO-DESPESAS).
- **O MovEstq do Alvo quase nunca guarda a chave do CT-e** (1 de 537). Por isso "lançado no Alvo" casa por CNPJ do emitente + número, como na NFS-e (`fin_parcelas_pagar`). É um indício fraco de que o Alvo não importa XML de CT-e, mas **não prova** que ele não consulte a SEFAZ.
- **Caixa de e-mail de NF** (`email_notas_fiscais`, desde 06/04/2026): **0 CT-e**. O e-mail não é fonte hoje.

## O que a lista passaria a mostrar

Para cada CT-e:
- número e série, transportadora (CNPJ), modelo (57 ou 67), emissão e UF de início → fim;
- valor da prestação (`vTPrest`), valor a receber (`vRec`) e ICMS;
- o **papel da P&F** (tomadora ou não);
- as **NF-e transportadas** (`infNFe/chave`). Elas ligam o frete à NF de compra ou de venda e, por ela, ao pedido. É a peça que falta para ter "frete como linha própria" (PLANO-DESPESAS, Backlog da Fase 2: frete hoje some dentro do custo da mercadoria);
- a situação no fisco (cancelamento pelo evento 110111);
- a situação no Alvo (lançado / não lançado / sem dado);
- o prazo do evento de desacordo (45 dias da autorização).

## Desenho proposto (molde da NFS-e)

| Tarefa | O quê | Onde |
|---|---|---|
| CTE-0.1 | Rota `/cte-dist` no erp-proxy: SOAP 1.2 `cteDistDFeInteresse` (`distNSU` e `consNSU`), mTLS com o PFX atual, gunzip dos `docZip`, resposta JSON `{cStat, ultNSU, maxNSU, docs[]}`, modo `teste` (1 chamada), restrita a `X-System-Secret` | erp-proxy (Pedro cola pelo GitHub Web) |
| CTE-0.2 | Tabela `cte_dfe_doc` (NSU como PK, chave, schema, tipo, XML, campos extraídos) + `job_type 'cte_dfe'` na `sync_runs` + kill-switch | SQL |
| CTE-0.3 | Edge `cte-dfe-sonda` (modos `teste` e `drenar`): avança o `ultNSU` só depois de gravar; em 137 para e não volta antes de 1 h; em 656 para sem insistir | Edge |
| CTE-0.4 | 1ª drenagem em produção (últimos 3 meses) + conferência contra os CT-e lançados no Alvo | — |
| CTE-1.x | View `v_cte_recebido` (fisco e Alvo), RPC de lista, **aba "CT-e" em Notas de Serviço**, cron 2×/dia (nunca menos de 1 h depois de um 137), alerta de coletor parado | SQL + tela |
| CTE-2.x (depois) | CT-e ↔ NF-e ↔ pedido; alerta de desacordo (45 dias) | — |

Esforço parecido com a Fase 0 + 1 da NFS-e.

## Decisões do Pedro antes de começar

1. **Quem mais consulta CT-e da P&F na SEFAZ por NSU?**
   - Perguntar à **Riosoft**: o Alvo tem distribuição de CT-e ligada com o certificado?
   - Perguntar à **contabilidade**: usa SIEG, Qive, Domínio ou outro com o certificado da P&F?
   - Se alguém consulta, há dois caminhos: usar o dado dele ou ele deixa de consultar. Dois consumidores no mesmo CNPJ geram 656.
2. **Construir pelo erp-proxy** (recomendado) **ou contratar** a Focus?
3. **Escopo da lista:** só os CT-e em que a P&F é tomadora (paga o frete), ou também os de remetente/destinatário?
4. **Lugar na tela:** aba "CT-e" em Notas de Serviço (recomendado: mesmo público, mesma régua de etapas) ou página própria?

## Fontes

- Relatório anexado pelo Pedro (out/2026).
- NT 2015.002 (CTeDistribuicaoDFe) — resumo TecnoSpeed: <https://blog.tecnospeed.com.br/ct-e-nota-tecnica-2015-002-web-service-de-distribuicao-de-df-e-de-interesse-dos-atores-do-ct-e-o-ctedistribuicaodfe/>
- Regras de uso indevido da NFeDistribuicaoDFe (NT 2014.002): <https://documentacao.senior.com.br/exigenciaslegais/noticias/federal/2022/2022-03-10-nt-2014-002-atualizacao-das-regras-de-uso-indevido-do-web-service-nfedistribuicaodfe> · <https://oobj.com.br/nota-tecnica/alteracoes-na-classificacao-de-uso-indevido/> · <https://ajuda.alterdata.com.br/prosofterp/e1594-cstat-656-motivo-rejeicao-consumo-indevido-do-dfe-gerenciador-149127714.html>
