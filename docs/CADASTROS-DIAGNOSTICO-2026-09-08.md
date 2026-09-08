# Cadastros (Produtos / Fornecedores) — diagnóstico da tela "Atualizar cadastros"

> Levantado em **08/09/2026**, 14h15–15h10 BRT, em modo **LEITURA**. Nenhuma escrita no banco,
> nenhuma alteração de código, nenhum deploy.
>
> Origem: dois sintomas relatados pelo Pedro — (a) o card de Produtos acusando "a sincronização
> automática pode ter falhado" com o cron aparentemente rodando; (b) o botão "Atualizar
> fornecedores" que "não atualizou nem o dado nem o carimbo".
>
> ⚠️ **A investigação inverteu os dois sintomas.** (a) não é alarme falso — é alarme verdadeiro
> sobre uma execução que morreu. (b) não é botão quebrado — é botão lento sem feedback, e o
> carimbo foi gravado durante a própria investigação. O que está de fato quebrado é outra coisa,
> e está na §5.

---

## 1. De onde cada card lê "Última atualização"

Fontes **distintas**, mas em ambos os casos quem lê é quem escreve — não há descolamento entre
executor e carimbo.

| card | lê de | quem grava | arquivo |
|---|---|---|---|
| **Produtos** | `sync_runs` — `job_type='produtos'`, `finished_at` não nulo, **`total_erros = 0`** | o próprio cron, ao concluir | `SuprimentosCadastros.tsx:41-56` |
| **Fornecedores** | `compras_config`, chave `sync_entidades_ts` | o próprio `syncEntidades`, no último passo | `SuprimentosCadastros.tsx:58-71` |

O filtro `total_erros = 0` é o detalhe que define o comportamento de Produtos: só conta execução
**concluída E sem erro**. Execução órfã (`finished_at` nulo) nunca conta — corretamente, mas
**silenciosamente**.

---

## 2. Produtos: o carimbo está certo; quem falhou foi o cron de 07/09

Cron `sync-produtos-cron-diario`, `0 23 * * 1-5` (**20h BRT, seg–sex**), `active = true`;
`sync_settings.sync-produtos-cron` com `enabled = true`.

| início (BRT) | fim | registros | erros | conta p/ a tela |
|---|---|---:|---:|---|
| **07/09 20:00** | **— nunca terminou** | 0 | 0 | **não** |
| 04/09 20:00 | 04/09 20:03 | 2.888 | 0 | sim ← *o que a tela mostra* |
| 03/09 20:00 | 03/09 20:03 | 2.886 | 0 | sim |
| 02/09 20:00 | 02/09 20:03 | 2.885 | 0 | sim |
| 01/09 20:00 | 01/09 20:03 | 2.877 | 0 | sim |

- 05 e 06/09 foram **sábado e domingo** — o cron é `1-5`, não roda.
- O de **hoje** só dispara às 20h.
- **O run de 07/09 é o único órfão em 53 execuções históricas** (`finished_at` nulo, duração nula,
  zero registros). Nenhum mecanismo detectou; ninguém foi avisado.

**Conclusão: a tela está correta e o aviso é verdadeiro.** O sintoma (a) — "o cron roda e traz
2.885 registros em 02/09" — confundiu uma execução antiga bem-sucedida com a mais recente: houve
runs melhores depois (03 e 04/09), e o carimbo aponta justamente para o último completo.

Hipótese não confirmada para a morte do run: 07/09 foi o dia da implantação multi-CC, com deploys
do gateway ao longo do dia (o `fc505e2` ficou Live às 21h04 BRT). O run começou às 20h00. Plausível,
**não verificado** — os logs do Render não foram consultados.

---

## 3. Fornecedores: o botão funciona; leva ~6 minutos

Caminho completo (`src/services/alvoEntidadeService.ts`), todo via gateway com JWT do Supabase:

| fase | o que faz | rota |
|---|---|---|
| 0 | catálogo de cidades, **só se** houver entidade com `codigo_cidade_alvo` e sem uf/município | `POST /entidade/cidade-list` |
| 1 | sync amplo, sem filtro, upsert em `compras_entidades_cache` | `POST /entidade/list` |
| 2 | identifica fornecedores (`CodigoCategoria like '002%'`) e chama a RPC | `POST /entidade/list` + `marcar_fornecedores` |
| — | grava `sync_entidades_ts`, `sync_entidades_count`, `sync_fornecedores_count` | `compras_config` |

**Medição durante a própria investigação:**

| momento | `sync_entidades_ts` | entidades tocadas hoje |
|---|---|---:|
| 14h19 | 01/09 15:53 | **0** |
| 15h09 | **08/09 15:07:22** ✅ | **1.852** (entre 15:01 e 15:04) |

As três fases rodaram, e há prova independente da Fase 2: o **default de `e_fornecedor` é
`false`**, e as entidades cadastradas hoje no ERP (`0002009 DEMP`, `0002008 PET CENTER`,
`0002007 ZARPEL`, `0002006 ELASTIM MABORIN`) estão com `e_fornecedor = true`. Só a RPC de marcação
poderia ter feito isso.

**Por que parece que não funcionou:** a execução leva ~6 minutos (15:01 → 15:07) e o carimbo só é
gravado no último passo. Durante todo esse tempo o card exibe a data antiga. Quem clica, espera um
pouco e olha o card conclui que nada aconteceu.

Se o clique relatado ocorreu **antes das 14h19**, ele de fato não gravou nada — e **não deixou
rastro algum**. Ver §5.

---

## 4. Não falta fornecedor

| | |
|---|---:|
| entidades no cache | **1.973** |
| marcadas `e_fornecedor` | **1.772** |
| cadastro mais novo do ERP presente no Hub | `0002009`, **cadastrado em 08/09** |

Não há como estimar faltantes porque não há faltantes: o sync das 15h07 alcançou o topo da
numeração do ERP.

O impacto relatado (fornecedor novo não aparece no pedido) **era real enquanto o carimbo estava em
01/09** — sete dias de cadastros novos invisíveis, incluindo o `ELASTIM MABORIN`, que é o
fornecedor do pedido `0004866` criado hoje. Está resolvido.

**Histórico de execuções reais:** hoje 15h07, e antes 01/09 15h53 (1.845 entidades). O
`updated_at` por linha só preserva as datas de quem **não** veio no sync mais recente (1 entidade
de 21/05, 120 de 14/04) — cada execução sobrescreve. Não é defeito; é consequência de o payload
incluir `updated_at`.

---

## 5. 🔴 O que está de fato quebrado: nada disso deixa rastro

Dois buracos de observabilidade, e são a razão de os dois sintomas terem sido diagnosticados
errado por quem olhou a tela:

**(a) Execução órfã do cron de produtos não é detectada.** O run de 07/09 morreu e o único efeito
visível foi o carimbo parar de avançar. Não há carimbo de "iniciada e não concluída" como a S1.1
implementou para o cron de compras (`ESTADO-SYNC-PEDIDOS` §9.1(b)) — aqui o mesmo padrão de falha
existe, sem a mesma instrumentação.

**(b) O sync de entidades não tem registro nenhum.** Não existe `job_type='entidades'` em
`sync_runs`. Se falhar, o erro aparece como toast na tela e `console.warn` no navegador — e
desaparece quando a aba fecha. Pior: **quatro `upsert` não verificam `error`** —
`alvoEntidadeService.ts:273-275` (Fase 1, que ao menos loga com `console.warn`) e as três
gravações de carimbo em `:361`, `:367` e `:373`, que não checam nem logam.
O supabase-js **resolve** a promise com `{ data, error }` em vez de rejeitar, então
`await supabase.from(...).upsert(...)` sem desestruturar `error` engole qualquer falha em silêncio
absoluto — inclusive a do próprio carimbo.

Permissões foram descartadas como causa: `compras_config` tem RLS com policy `ALL` para
`authenticated` e ACL `authenticated=arwdDxtm`, igual às demais tabelas do módulo.

---

## 6. ⭐ O aviso é só carimbo — e mente toda segunda-feira

Este é o item que corrói a confiança na tela, e é independente dos dois sintomas relatados.

```
{diasProdutos !== null && diasProdutos >= 2 && ( ... "a sincronização automática pode ter falhado" )}
{diasEnt      !== null && diasEnt      >= 3 && ( ... "Fornecedores cadastrados … não aparecem" )}
```
`SuprimentosCadastros.tsx:184-188` e `:228-236`, sobre `diasDesde()` (`:86-92`), que é aritmética
pura de data. **O aviso não olha execução órfã, não olha `total_erros`, não olha a saúde do dado.**

**O raciocínio do falso positivo de segunda-feira:**

O cron roda `1-5` — **não roda sábado nem domingo**. Então, em qualquer segunda-feira normal, com
tudo funcionando perfeitamente, a última execução é de **sexta às 20h03**:

| momento | última execução | idade | aviso? |
|---|---|---:|---|
| segunda 08h00 | sexta 20h03 | 2,5 dias | 🔴 **SIM — falso** |
| segunda 19h00 | sexta 20h03 | 2,96 dias | 🔴 **SIM — falso** |
| segunda 20h05 | segunda 20h03 | 0 dias | não |
| terça 08h00 | segunda 20h03 | 0,5 dia | não |

**Toda segunda-feira, das 00h às 20h, o card acusa falha com o sistema íntegro.** São ~20% dos dias
úteis exibindo um alarme que não corresponde a nada.

**Por que isso é pior do que parece:** o aviso treina a equipe a ignorá-lo. Quem vê "pode ter
falhado" toda segunda aprende, corretamente, que o aviso não significa nada — e então, quando o
alarme é **verdadeiro** (como o de hoje, apontando a morte do run de 07/09), ele passa
despercebido pelo mesmo motivo. **Um alarme que mente com frequência previsível é pior que a
ausência de alarme**, porque consome a atenção sem entregar informação.

A correção não é subir o limiar — isso só atrasaria o alarme verdadeiro. É comparar com a
**última janela esperada do cron** (dias úteis, 20h), não com "há N dias corridos": se a última
execução completa é posterior à janela esperada anterior, está tudo em dia; se não é, houve falha
— e aí o aviso pode inclusive dizer *qual* execução falhou, porque a linha órfã está em
`sync_runs`.

---

## 7. Ordem de correção recomendada

| # | O quê | Por quê nesta ordem | Onde |
|---|---|---|---|
| 1 | **Detectar execução órfã no cron de produtos** — carimbar iniciada-e-não-concluída, visível em `sync_runs`, no mesmo padrão da S1.1 | É o único item em que houve **dado faltando** de verdade. Sem isso a próxima morte silenciosa também passa | Edge do sync de produtos |
| 2 | ⭐ **Limiar do aviso ciente do calendário** — comparar com a última janela esperada (dias úteis, 20h), não com dias corridos | Elimina o falso positivo garantido de toda segunda e devolve credibilidade ao aviso. Enquanto ele mentir, o item 1 não será notado por ninguém | `SuprimentosCadastros.tsx:86-92`, `:184`, `:228` |
| 3 | **Registro persistente do sync de entidades** — uma linha em `sync_runs` com `job_type='entidades'`, como todos os outros jobs têm | Resolve §3 e §5(b) de uma vez: passa a existir histórico, e passa a existir evidência quando falha | `alvoEntidadeService.ts` |
| 4 | **Verificar `error` nos quatro `upsert`** de `alvoEntidadeService` | Hoje uma falha de gravação — inclusive a do carimbo — é invisível | `alvoEntidadeService.ts:273-275` e `:361`/`:367`/`:373` |
| 5 | **Feedback de duração no botão** — avisar que leva minutos; considerar concluído quando o carimbo mudar | Cosmético, mas foi o que gerou este chamado | `SuprimentosCadastros.tsx` |

**Rollback:** os cinco passos são independentes e locais; `git revert` do commit correspondente.
Nada de schema, nada de RPC, nada de migration — **não há escrita em banco neste card**.

**Teste que fecha o item 2:** simular a leitura numa segunda-feira às 09h com o cron íntegro
(última execução na sexta às 20h03) e conferir que **nenhum aviso** aparece; e, no mesmo cenário,
com o run de segunda morto (órfão), conferir que o aviso **aparece** e nomeia a execução que
falhou. O caso de hoje serve de fixture real: 04/09 completo, 07/09 órfão.
