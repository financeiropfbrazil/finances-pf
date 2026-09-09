# CARD — Falha por licença esgotada no Alvo (Prime Back Office)
## Tratamento no Hub de um limite externo · 09/09/2026

> Missão Aprovação de Requisições. **Não é defeito do Hub** — é limite de licenças concorrentes
> do ERP. Este card trata o que o Hub pode fazer a respeito; a negociação com a Riosoft corre em
> paralelo (Pedro já abriu).

---

## 1. O fato

Quatro requisições falharam no envio ao Alvo em **52 minutos** na manhã de 09/09:

| horário (UTC) | requisicao_id |
|---|---|
| 12:02:38 | `0d87cb3e-d8ee-4446-bd9e-f49aecd39a95` |
| 12:06:44 | `d5152e6f-91ff-4129-9d5a-bce73200dea7` |
| 12:12:10 | `463f5f4e-e7e8-451f-889c-9cfc457a684f` |
| 12:54:11 | `d4a58205-a57d-41b3-bf4a-be2f20eff7f6` |

Mensagem, literal do ERP:

> Você tentou acessar uma transação do módulo Prime Back Office mas todas as licenças estão em uso.

**O que já está bom:** a trilha registrou `envio_pos_aprovacao_falha` **com a mensagem** — o buraco
de observabilidade que deixava requisição pendurada sem rastro não se repetiu aqui.

**O que está ruim:** a mensagem chega **crua** ao usuário (a Nathalia leu "Prime Back Office" e
"licenças em uso", que não significam nada para ela), e o caminho de recuperação não é óbvio.

**Tendência:** cada envio abre sessão no Alvo. Quanto mais gente usar o Hub, mais concorrência —
e o Pedro está expandindo o número de requisitantes. Isso piora, não melhora, sozinho.

---

## 2. Investigar primeiro (decide o resto)

⚠️ **S1. A requisição chega a ser criada no Alvo quando esse erro ocorre?**

Tudo depende disso. Se o Alvo recusa **antes** de gravar (hipótese provável — a sessão nem abre),
o reenvio é **seguro** e a correção é simples. Se ele grava e falha depois, é o cenário de
"documento fantasma" dos incidentes de 08/09, e o reenvio **duplica**.

Como verificar: as quatro requisições acima estão com `numero_alvo` nulo? Alguma delas aparece no
ERP por descrição/requisitante? O erro vem do gateway antes do POST, ou é resposta do Alvo a um
POST já enviado? Olhar o ponto do código onde a mensagem é capturada.

**S2.** Frequência histórica: `mensagem_erro ilike '%licen%'` em toda a auditoria de requisições
**e de pedidos**. Distribuição por hora do dia e por dia da semana. Quatro em 52 minutos é
concentração — é sempre no mesmo horário?

**S3.** O erro também atinge **pedidos** e o **cron**? Se o cron competir pelas mesmas licenças,
o efeito é mais amplo que o envio de requisição.

**S4.** Quantas sessões o Hub abre por envio, e por quanto tempo as mantém? Há reuso de sessão ou
cada operação abre a sua? (Se houver desperdício, é o item de maior alavancagem — reduz a
concorrência sem depender da Riosoft.)

---

## 3. O que corrigir (condicionado ao S1)

### 3.1 Mensagem traduzida — sempre

Reconhecer a assinatura da mensagem ("licenças estão em uso" / "Prime Back Office") e mostrar algo
acionável, no lugar do texto do ERP:

> **O ERP está sem licença disponível no momento.** A requisição **não foi criada** — nada foi
> enviado. Aguarde alguns minutos e clique em Reenviar.

⚠️ A frase "não foi criada" **só entra se o S1 confirmar**. Se não confirmar, o texto vira o do
ramo conservador ("desfecho incerto — não reenvie, reconcilie"), como nos demais casos.

### 3.2 Reenvio liberado (se S1 confirmar que nada é criado)

Este erro é **transitório e não ambíguo** — é o caso em que o retry é seguro e desejável. O helper
`avisoFalhaEnvioPosAprovacao` (criado em 08/09) usa lista positiva: só libera com prova de que nada
chegou ao ERP. **A assinatura de licença esgotada passa a ser uma dessas provas** — desde que o S1
confirme. Nada de afrouxar o padrão: acrescentar um caso comprovado à lista positiva.

### 3.3 Retry automático com espera (se S1 confirmar)

Falha conhecida, transitória e que se resolve sozinha em minutos não deveria virar tarefa do
usuário. Duas ou três tentativas, espaçadas (ex.: 60s, 180s), **só para esta assinatura de erro** —
nunca genérico, nunca em erro ambíguo. Se todas falharem, cai em 3.1 com o reenvio manual liberado.

**Guardas:** o retry não pode reabrir token já consumido, não pode rodar em erro de outra natureza,
e cada tentativa registra na auditoria (para a frequência real do problema ficar visível).

### 3.4 Não fazer

Aumentar timeout · retry genérico para qualquer erro · esconder a mensagem original (ela vai no
detalhe técnico) · mexer no gateway ou no cron nesta rodada.

---

## 4. Para a conversa com a Riosoft (Pedro)

Dados a levar, que o S2/S3/S4 produzem: quantas licenças concorrentes o contrato prevê; quantas o
Hub consome por envio; distribuição horária das recusas; e se o cron compete com os usuários. A
pergunta objetiva: **o número de licenças suporta o Hub somado ao uso direto do ERP, com a
expansão de requisitantes em curso?**

---

## 5. Gate de saída

1. S1 respondido com evidência — é ele que autoriza 3.2 e 3.3.
2. Mensagem traduzida aparece para a assinatura de licença; a original fica no detalhe técnico.
3. Reenvio liberado **apenas** para esta assinatura; todos os outros casos inalterados
   (não-regressão do helper de 08/09).
4. Retry automático não dispara em erro de outra natureza e registra cada tentativa.
5. `bun run build` e `tsc` limpos. Commit com staging explícito, sem push.

---

## 6. PROMPT — colar na sessão do Claude Code

```
CARD — Falha por licença esgotada no Alvo (Prime Back Office)

Leia: CLAUDE.md (protocolo de início) → ESTADO-APROVACAO-REQ.md → CARD-LICENCA-ALVO.md
(ESTE MANDA; é o escopo da sessão).

Fato: 4 requisições falharam no envio ao Alvo em 52 minutos hoje (09/09, 12:02–12:54 UTC), todas
com "Você tentou acessar uma transação do módulo Prime Back Office mas todas as licenças estão em
uso". Não é defeito nosso — é limite de licenças do ERP. Já acionei a Riosoft.
IDs: 0d87cb3e-…, d5152e6f-…, 463f5f4e-…, d4a58205-… (completos na §1 do card).

FASE 1 — INVESTIGAÇÃO (read-only, sem código). Responda S1 a S4 da §2 do card.
⚠️ O S1 é bloqueante: a requisição chega a ser criada no Alvo quando esse erro ocorre? Se sim,
reenviar duplica e os itens 3.2/3.3 estão CANCELADOS. Se não, o reenvio é seguro. Traga evidência
— não presuma pela mensagem.

FASE 2 — CORREÇÃO, condicionada ao S1: §3.1 sempre; §3.2 e §3.3 só se o S1 confirmar que nada é
criado. Não afrouxe o helper avisoFalhaEnvioPosAprovacao — acrescente um caso comprovado à lista
positiva, mantendo todo o resto no ramo conservador.

Não tocar: gateway (erp-proxy), crons/Edge Functions, types.ts, módulo de pedidos, arquivos de
outras missões. Sem escrita no banco, sem push, sem deploy.

Gate: §5 do card. Commit "feat(suprimentos): trata licenca esgotada do Alvo com mensagem clara e
retry". Atualize o ESTADO-APROVACAO-REQ.md. Termine com: resposta do S1 com evidência, os números
do S2/S3/S4 para eu levar à Riosoft, e o que contradisse a espec.
```

---

*Fim do card. A correção reduz o atrito; ela não resolve a escassez de licenças — isso é contrato.*
