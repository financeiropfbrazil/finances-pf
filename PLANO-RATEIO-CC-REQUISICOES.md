# PLANO-RATEIO-CC-REQUISICOES — v1.0 (24/08/2026)
## Rateio de centro de custo em requisições, espelhamento e aprovação múltipla

> **Objetivo final: orçamento por centro de custo.** A requisição é o documento que
> dispara o gasto; o CC correto nela é o que sustenta o abatimento de budget por
> departamento. A aprovação é mecanismo de controle — o **dado de CC íntegro é o
> requisito**, e por isso o espelhamento vem antes do gate.
>
> **Base factual:** testes controlados no ERP em 24/08 (requisições 0001445 e 0001446) +
> discovery consolidado do Codex (24/08, 10:40 BRT, leitura pura). Onde este plano e o
> discovery divergirem, este plano prevalece — ele carrega as decisões do Pedro.

---

## 0. Regras de negócio decididas (24/08/2026)

| # | Regra |
|---|---|
| R1 | **Líder é líder.** Não existe papel de suplente/substituto no sistema. Um CC pode ter mais de um líder; qualquer um deles aprova por aquele CC. É assim que férias e afastamentos são cobertos. |
| R2 | **Uma aprovação por CC.** Cada CC envolvido exige exatamente uma decisão. Uma pessoa que lidera vários CCs da mesma requisição aprova **uma vez** e fecha todos os grupos dela. |
| R3 | **Sem limiar de percentual.** CC que aparece no rateio com 1% exige aprovação igual ao que aparece com 99%. |
| R4 | **CC único + autor é líder daquele CC → passa sem aprovação** (o `AUTO_APROVADA` atual). |
| R5 | **Com rateio multi-CC não há auto-aprovação.** Todos os grupos exigem decisão explícita, **inclusive o do CC que o próprio autor lidera**. O gasto sai de mais de um orçamento; cada área se manifesta. |
| R6 | **Rejeição de qualquer líder é terminal.** |
| R7 | **CC sem líder não bloqueia** (fail-open). A requisição segue com as aprovações que existirem, e a auditoria **registra** que o CC X não tinha líder no momento. |
| R8 | **Conjunto de CCs congelado na submissão; líderes resolvidos dinamicamente.** O que a requisição onera é fato dela; quem lidera é fato do mapa. Se um CC ganhar líder depois, ele passa a ser exigido — desde que a requisição ainda esteja pendente. |
| R9 | **Admin aprova a requisição inteira**, de uma vez. |
| R10 | **Requisição criada direto no Alvo NÃO passa pelo gate** — o Hub não tem como impedir. Mas **deve ser espelhada integralmente**, com CC de cabeçalho, CC de item e rateio, porque consome orçamento igual. |

---

## 1. Estado atual medido (24/08/2026, 10:40 BRT)

- **349 requisições**; 81 CCs folha ativos; **14 com líder (17,3%)**; **3 líderes distintos**, com concentração 12/1/1.
- Dos **29 CCs** que movimentaram requisição em 90 dias, **3 têm líder**. Projetando o mapa atual, 177 de 258 requisições recentes cairiam em SEM_GATE.
- **O "rateio" que já existe no Hub NÃO é rateio de CC:** `compras_requisicoes_itens_classe_rec_desp` (283 linhas) é divisão por **classe contábil** do item, sem nenhum CC. A UI já usa a palavra "rateio" para isso.
- **O CC do item hoje é cópia do cabeçalho:** `ItemInput` não tem o campo; o serviço replica `input.codigo_centro_ctrl` para todos os itens. A única divergência existente (req. 0001157) veio de importação do Alvo.
- **O Hub nunca enviou rateio:** os 226 payloads auditados têm `ReqCompClasseRecDespChildList: []`.
- **Requisição nativa do Alvo chega quase vazia:** o Job 4 traz só cabeçalho leve; o Job 1 atualiza só status; os itens só entram quando alguém abre o detalhe (e apenas se ainda não houver itens). **O rateio nunca é lido.**
- Não existe notificação ao líder. A fila é o único aviso.

**Contrato do Alvo, confirmado em teste:**
`ReqCompClasseRecDespChildList[]` (classe, `Percentual`) → `RateioReqCompChildList[]`
(`CodigoClasseRecDesp`, `CodigoCentroCtrl`, `Percentual`). O Alvo **valida 100% em cada
nível** (erro 412 com `BrokenRulesException`). O `CodigoCentroCtrl` do cabeçalho **coexiste**
com o rateio. O CC do item **pode divergir** do cabeçalho.

---

## 2. Sequência mestre

```
BLOCO R1 — ESPELHAMENTO (a base de tudo)
  R1.1 estrutura de dados · R1.2 sync do rateio e do CC de item · R1.3 backfill dirigido
BLOCO R2 — VISÃO POR CC (valor imediato, independe de líderes)
  R2.1 consulta por CC · R2.2 tela do líder/gestor
BLOCO R3 — CRIAÇÃO COM RATEIO NO HUB
  R3.1 persistência · R3.2 envio ao Alvo · R3.3 wizard
BLOCO R4 — APROVAÇÃO MÚLTIPLA
  R4.1 modelo de decisões · R4.2 RPCs e trigger · R4.3 fila e detalhe · R4.4 KPIs
```

**Por que esta ordem:** sem R1 o orçamento tem buraco silencioso (requisição do Alvo não
espelhada). R2 entrega valor com os líderes que já existem. R3 é pré-requisito de R4 (não
há aprovação múltipla sem multi-CC criado no Hub). R4 é o mais complexo e o que menos
morde hoje — 3 líderes cobrindo 3 CCs ativos.

---

## BLOCO R1 — Espelhamento

### R1.1 — Estrutura de dados

**Decisão: tabelas novas, espelhando os dois níveis do Alvo** (Opção 1 do discovery).
Motivo: `compras_requisicoes_itens_classe_rec_desp` é outra entidade (classe por item, sem
CC); sobrecarregá-la com um `escopo` faria uma tabela representar duas coisas e obrigaria
todos os leitores atuais a filtrar.

```
compras_requisicoes_rateio_classes
  id · requisicao_id (FK cascade) · codigo_classe_rec_desp · classe_rec_desp_label
  · percentual numeric(9,4) · origem ('hub' | 'alvo') · created_at

compras_requisicoes_rateio_cc
  id · rateio_classe_id (FK cascade) · codigo_centro_ctrl · centro_ctrl_label
  · percentual numeric(9,4) · created_at
```

A soma 100% **não cabe em CHECK de linha** — vai em RPC transacional, no padrão do
`sync_replace_filhos_pedido` (C3): valida → apaga os filhos daquela requisição → reinsere,
tudo na mesma transação, restrita a `service_role`. **Sem UNIQUE de negócio** (mesma lição
do C3: repetição pode ser legítima).

O `origem` distingue rateio criado no Hub do importado do Alvo — útil para diagnóstico e
para o backfill.

**Também neste card:** `ItemInput` ganha `codigo_centro_ctrl` próprio, e o serviço **para
de copiar** o CC do cabeçalho para todos os itens (passa a usar o do item, com o cabeçalho
como default).

### R1.2 — Sync: o cron passa a trazer rateio e CC de item

Hoje o Job 1 faz o Load completo e usa **só o status**. Passa a extrair
`ReqCompClasseRecDespChildList[].RateioReqCompChildList[]` e o `CodigoCentroCtrl` de cada
item, chamando a RPC do R1.1.

⚠️ **Lições do C3 que valem aqui, sem repetir os erros:**
- "Ausente" inclui **array vazio**, não só nulo.
- O Alvo pode **omitir o percentual no nível da classe**; classe única → assumir 100.
- Flag de completude que mente é pior que ausência: só marcar carregado no sucesso total.
- Âncora antes de qualquer intervenção (aqui não há campos monetários, mas há `status` e
  `codigo_centro_ctrl` de cabeçalho a proteger).

### R1.3 — Backfill dirigido

As requisições existentes não têm rateio no Hub — e podem ter no Alvo (o discovery alerta:
ausência local **não prova** ausência no ERP). Medir quantas, e decidir o recorte.
Diferente do caso de pedidos, **aqui o backfill provavelmente importa**: sem ele, o
orçamento do período corrente fica incompleto.

**Gate de saída do R1:** requisição criada no Alvo com rateio aparece completa no Hub em
um ciclo; requisição com CC de item divergente preserva os dois; nenhum status alterado.

---

## BLOCO R2 — Visão por CC

### R2.1 / R2.2 — "Quais requisições afetam meu CC"

Com o R1 no ar, o dado existe. Falta expor: consulta por CC (com percentual e a fatia
correspondente), e uma tela onde o gestor vê o que está onerando o orçamento dele.

Este bloco **não depende de líderes mapeados** e entrega valor imediato — inclusive para
convencer as áreas a nomear seus líderes.

Ponto aberto para decisão futura: a requisição **não tem valor monetário**. O que abate
budget é o pedido. A visão por CC precisa deixar claro que a requisição é **previsão** e o
pedido é **realização** — e o elo entre os dois já existe (`numero_pedido_compra_alvo`).

---

## BLOCO R3 — Criação com rateio no Hub

### R3.1 — Persistência
`criarRequisicao` passa a gravar o rateio nas tabelas do R1.1, validando 100% por nível
**antes** de tocar o banco.

### R3.2 — Envio ao Alvo
O payload passa a montar `ReqCompClasseRecDespChildList` aninhado. **Validação prévia
obrigatória**: o Alvo devolve 412 se a soma não fechar, e o frontend hoje **perde a
mensagem** quando ela vem só em `details` — o usuário veria um erro opaco.

**CC do cabeçalho quando há rateio (decisão do plano):** mantém-se preenchido (o Alvo
aceita), com o **CC principal escolhido pelo usuário**, obrigatoriamente **um dos que estão
no rateio**. Evita que o cabeçalho aponte para uma área que não paga nada.

### R3.3 — Wizard
Captura de rateio: classe → CCs → percentuais fechando 100%. CC por item no modal do item,
herdando o do cabeçalho por default.

⚠️ **Cuidado de vocabulário:** o wizard **já chama de "rateio"** a divisão por classe
contábil do item. Duas coisas diferentes com o mesmo nome na mesma tela é receita de erro
de operação. Definir os rótulos antes de implementar.

---

## BLOCO R4 — Aprovação múltipla

### R4.1 — Modelo (Opção B do discovery: grupos + candidatos + decisões)

```
compras_requisicoes_aprovacao_grupos
  id · requisicao_id · codigo_centro_ctrl · created_at
  (um grupo por CC distinto envolvido — congelado na submissão, R8)

compras_requisicoes_aprovacao_decisoes
  id · requisicao_id · user_id · decisao ('aprovada'|'rejeitada')
  · motivo_codigo · observacao · decidido_em
  (uma linha por pessoa que decidiu)
```

A requisição avança quando **todo grupo com líder ativo** tem pelo menos uma decisão de
aprovação de alguém que lidera aquele CC. Grupos **sem líder** não bloqueiam (R7) e ficam
registrados. Uma decisão satisfaz **todos** os grupos que a pessoa lidera (R2).

Os campos escalares atuais (`aprovada_por_user_id`, `aprovada_em`, `aprovacao_automatica`)
**permanecem** como resumo da decisão final — há muitos consumidores, e quebrá-los seria
uma migração à parte.

### R4.2 — RPCs e trigger
`submeter_requisicao` passa a montar os grupos. `aprovar_requisicao` grava a decisão e
**só finaliza** quando o conjunto fecha — devolvendo `PARCIAL` ou `FINAL`. O `FOR UPDATE`
já existente serializa decisões concorrentes.
⚠️ O `trg_req_protege_aprovacao` **não protege as tabelas novas** — elas precisam de guarda
própria.
⚠️ Hoje a UI **envia ao ERP logo após a primeira aprovação** (fila e detalhe). Isso passa a
acontecer **só na decisão final**.

### R4.3 — Fila e detalhe
A fila diferencia "aguardando você" de "você já aprovou, aguardando outros". O detalhe
mostra o mapa: cada CC, quem lidera, quem já decidiu, o que falta.

### R4.4 — KPIs
`suprimentos_requisicoes_para` inclui pendentes e rejeitadas nos totais e tem um texto
**hardcoded de "244 requisições"** (o banco tem 349). Corrigir junto.

---

## 3. Dependências e riscos

1. **R3 antes de R4** — não há aprovação múltipla sem multi-CC criado no Hub.
2. **R1 antes de tudo** — sem espelhamento correto, qualquer visão de orçamento mente.
3. **Cobertura de líderes é trabalho organizacional**, paralelo e fora deste plano: 3 de 29
   CCs ativos têm líder. O R4 só morde de verdade quando isso mudar.
4. **Requisições históricas sem rateio** — decidir recorte do backfill (R1.3).
5. **Vocabulário "rateio"** — resolver antes do R3.3.

---

## 4. Achados de segurança do discovery (fora desta missão, registrar)

- `suprimentos_requisicoes_para` é `SECURITY DEFINER`, **aceita `p_user_id` do chamador** e
  tem `EXECUTE` para PUBLIC/anon. Permite consultar dados como outro usuário. **P0
  independente deste plano.**
- RLS de `compras_requisicoes` e filhas segue `ALL USING(true)` para qualquer autenticado.
- O CHECK de `compras_requisicoes_auditoria.evento` **não inclui** `descoberta_alvo` nem
  `sync_status`, embora o cron tente inseri-los — auditoria de sync provavelmente falhando
  em silêncio.
- O serviço de requisição aceita **200 sem `Numero`** como sucesso (mesma dívida que o D1
  corrigiu em pedidos).
- `CLAUDE.md` afirma que o MCP está em modo escrita; a configuração efetiva é `--read-only`.

---

## 5. Higiene

Cancelar/excluir no Alvo as requisições de teste **0001445** e **0001446**. Elas não estão
em `compras_requisicoes` — se o cron as descobrir, viram caso de teste involuntário do R1.

---

*Plano v1.0 — 24/08/2026. Ordem: R1 → R2 → R3 → R4. Cada bloco vira prompt próprio,
imutável; ajustes viram AJUSTE-RQ-x.md.*
