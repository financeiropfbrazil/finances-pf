# BLOCO PARA ACRESCENTAR AO ESTADO-REVISAO-SUPRIMENTOS.md
### Sessão de 24/08/2026 — rateio de requisições, normalização e ACLs

> **Instrução de merge:** o `ESTADO-REVISAO-SUPRIMENTOS.md` estava carimbado em 20/08 e
> declarava a frente de sync **encerrada**. Ela foi **reaberta** em 24/08 por uma frente
> nova (orçamento por centro de custo). Acrescente as seções abaixo e ajuste a §1 e a §9
> conforme indicado no fim deste documento.

---

## 1-BIS. Cards concluídos em 24/08

| Card | O que foi feito | Validação |
|---|---|---|
| **R1.1** | Tabelas `compras_requisicoes_rateio_classes` / `_cc` + RPC `req_replace_rateio` (SECURITY DEFINER, EXECUTE só para service_role). `ItemInput` ganhou `codigo_centro_ctrl` próprio (commit `37852c3`) | VERIFY de assinatura, ACL e RLS ok; tabelas vazias como esperado |
| **R1.2** | O cron passa a espelhar rateio de CC e CC de item das requisições vindas do Alvo (commit `04aa5bf`, deployado) | Itens no Hub subiram de **330 → 430**; requisições sem itens caíram de **94 → 42** |
| **C3.3** | Normalização de rateio: `null` deixa de virar `0`; tolerância ±0,01 com residual; reconstrução de percentual por valor (commit `d767457` + RPC substituída) | 0004371 e 0004471 destravados, com soma fechando exata |
| **SEC-1** | `suprimentos_requisicoes_para` dividida em wrapper + `_impl`; `anon` revogado das **15** RPCs `*_para` | `anon_pode = false` nas quinze; `authenticated` e `service_role` preservados |

---

## 2-BIS. Correções de fato (acrescentar à §2 existente)

8. **A âncora de valores tem prazo de validade curto.** A `C3-t0` (20/08) acusou 9
   alterações em 24/08 — três benignas (null→0) e **seis por edição legítima no ERP**
   (0004635, 0004685, 0004533, 0004704, 0003766, 0004582). Provado contra o Alvo: o
   0004582 foi de R$ 50.504,85 para R$ 51.799,85 no ERP, e o Hub espelhou certo.
   **A âncora serve para conferir imediatamente após uma intervenção, não como referência
   permanente.** Vigente agora: **`C3.3-t0`** (24/08 18:45 UTC, 1.924 pedidos).
9. **Lote de comandos no SQL Editor pode falhar em silêncio.** 14 revokes colados juntos
   não surtiram efeito nenhum, sem mensagem de erro (o primeiro da lista provavelmente
   abortou o bloco). Já havia acontecido no R1.1, com 3 blocos perdidos.
   **Regra: conferir o EFEITO com um VERIFY, nunca confiar no "Success".**
10. **`compras_pedidos_itens_rateio.percentual` tem DUAS semânticas históricas.** No legado
    anterior ao C3 o percentual é achatado (classe de 50% gravada como um CC de 50%); nas
    linhas novas é o percentual do CC **dentro** da classe. 10 grupos em 5 pedidos
    (0004026, 0004060, 0004228, 0004269) somam ≠ 100 por isso.
    **Qualquer relatório de orçamento que some essa coluna hoje mistura as duas.**
11. **`sync_runs.total_erros` NÃO conta as falhas de rateio** — o catch registra em
    `detalhes` mas não incrementa o contador. Ciclos aparecem com "0 erros" tendo falhas
    dentro. Para varrer erros: `jsonb_array_elements(detalhes)`.
12. **"Cabeçalho e itens somam o mesmo total" NÃO é regra universal** — 98 contraexemplos
    em 996 Loads comparáveis. A afirmação estava na documentação como fato.

---

## 5-BIS. A varredura de formas (24/08) — e por que ela existiu

As duas normalizações anteriores (C3.2 e a tentativa de correção do 0004471) nasceram de
**um caso cada**. Em 24h isso quase produziu uma correção errada. Uma varredura sistemática
sobre 1.211 Loads auditados mostrou que os 10 pedidos "presos" **não tinham causa comum**:

- 3 eram problema de percentual (0004371, 0004471, 0004691);
- 4 (0002931, 0002990, 0003047, 0003095) estão **fora da janela de 180 dias** do Job 2 e
  nunca serão visitados — o jsonb deles está íntegro;
- 2 (0004271, 0004441) estão `excluido_alvo`;
- 1 (0004019) tem audit `not_found` com status `sincronizada` — inconsistência própria.

**As quatro famílias** (detalhadas em `AJUSTE-RS-C3.3.md`, com Loads ao vivo):
F1 arredondamento · F2 percentual ausente com valor recuperável · F3 sem informação
(0004500: 6 CCs todos nulos — **deve falhar**) · F4 item mutilado com cabeçalho íntegro
(0004098, 0004495 — esperam o fallback de cabeçalho).

🔴 **O contraexemplo que salvou a correção:** nos pedidos **0004052 e 0004053** existem CCs
a **0% dentro de rateio que já soma 100** — são deliberados. A regra "CC zero vira 100" só
vale quando a linha é a **única** do grupo.

🔴 **Falso-negativo, pior que os que falham:** 8 documentos com item ativo **passam pela
validação sem erro** porque nenhuma linha chega à RPC (3 itens sem classe, 5 classes sem
CC). São marcados como completos e ficam invisíveis.

---

## 6-BIS. Requisições — estado e contrato do Alvo

**Provado em teste controlado (24/08):** o Alvo **aceita rateio de CC em requisição**, na
estrutura de dois níveis
`ReqCompClasseRecDespChildList[]` (classe, `Percentual`) →
`RateioReqCompChildList[]` (`CodigoClasseRecDesp`, `CodigoCentroCtrl`, `Percentual`),
**sem campo de valor**. Valida 100% por nível (erro 412 `BrokenRulesException`).
O `CodigoCentroCtrl` do **item pode divergir** do cabeçalho e é preservado.
Requisições de teste: **0001445** (classe 11.05, 60/40) e **0001446** (item divergente).

**O que já existia e NÃO é rateio de CC:** `compras_requisicoes_itens_classe_rec_desp` é
divisão por **classe contábil** do item, sem CC. A UI já chama isso de "rateio" —
⚠️ **conflito de vocabulário a resolver antes do wizard (card R3.3)**.

**Medido em 24/08:** 353 requisições · 42 sem itens (54 estavam ao alcance da fila, as
demais são do R1.3) · 0 com rateio nas tabelas novas · 309 com CC igual ao cabeçalho ·
2 divergentes (0000775, 0001157) · **0 requisições nativas do Alvo com rateio** — não há
exemplo real, só o teste controlado.

**Cobertura de líderes (24/08):** 81 CCs folha ativos, **14 com líder (17,3%)**, 3 líderes
distintos (concentração 12/1/1). Dos **29 CCs que movimentaram requisição em 90 dias, só 3
têm líder**. A implantação organizacional ainda não começou.

---

## 7-BIS. Pendências acrescentadas

13. **Passos 4–6 do `AJUSTE-RS-C3.3`:** fallback de cabeçalho com coluna `origem_rateio`
    (destrava 0004098 e 0004495, só para pedido de item único) · estrutura incompleta parar
    de passar em silêncio · **contador de tentativas** (contém 0004500 e o 0004370, que
    reentra desde julho).
14. **Semântica dupla do `percentual`** (§2-BIS.10) — bloqueia a visão por CC.
15. **RPC de requisições mais estrita que a de pedidos** — decidir se as regras do C3.3
    valem lá (a reconstrução por valor **não**, porque requisição não tem valor).
16. **As 13 RPCs `*_para` ainda confiam em `p_user_id` do chamador** em vez de `auth.uid()`.
    O acesso anônimo foi fechado (SEC-1), mas um usuário autenticado ainda pode passar o
    uuid de outro. Dívida de desenho.
17. **RPC e itens não compartilham transação no R1.2** — se a gravação de itens falhar
    após a RPC, o rateio fica certo e os itens não; o `updated_at` não rotaciona e o
    próximo ciclo refaz.
18. **Corrida entre open-load e cron** na inserção de itens de requisição — não há UNIQUE
    por `(requisicao_id, sequencia)`.
19. **R1.2 não remove filhos excedentes** — em 9 de 221 Loads o conjunto de CCs dos itens
    divergia do Hub.
20. **17 itens com valores positivos** não fecham contra `ValorTotal+IPI` nem contra
    `ValorFinal`.
21. **29 pedidos e 31 requisições** sem detalhe utilizável em nenhuma fonte local.

---

## 9-BIS. Ajustes à §1 e à §9 do documento original

- **§1:** a linha "Frente de sync ENCERRADA em 20/08/2026" passa a: *"Frente de sync
  encerrada em 20/08 e **reaberta em 24/08** pela missão de orçamento por centro de custo —
  ver `PLANO-RATEIO-CC-REQUISICOES.md`. Cards R1.1, R1.2, C3.3 e SEC-1 entregues em 24/08."*
- **§9 ("Se esta frente for retomada"):** acrescentar o `PLANO-RATEIO-CC-REQUISICOES.md`
  como frente ativa, com os blocos **R1.3** (backfill de 42 requisições), **R2** (visão por
  CC — entrega valor imediato), **R3** (criação com rateio no Hub) e **R4** (aprovação
  múltipla). As decisões de negócio R1–R10 estão na §0 daquele plano e **não devem ser
  reabertas**.
- **§8 (regras valiosas):** acrescentar *"Conferir o efeito, não o 'Success'"* e
  *"Varredura de formas antes de normalizar — caso isolado gera regra errada"*.

---

## Documentos criados em 24/08

`PLANO-RATEIO-CC-REQUISICOES.md` (plano da missão, com as 10 regras de negócio) ·
`PROMPTS-DISCOVERY-RATEIO-REQ.md` · `PROMPTS-VARREDURA-RATEIO.md` ·
`AJUSTE-RS-C3.3.md` (as 7 regras de normalização, com evidência e contraexemplo) ·
`SQL-R1.1-RATEIO-REQUISICOES.md`.

---

*Bloco de atualização — 24/08/2026, fim da sessão.*
