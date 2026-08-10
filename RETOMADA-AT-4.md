# RETOMADA-AT-4.md
## Onde a AT-4 parou — 09/08/2026, fim de sessão

> Leia este arquivo **antes** do `PLANO-RM-ATENDIMENTO.md`. Ele é o delta que ainda não está
> em plano nenhum.

---

## 1. Estado, em uma frase

**A AT-4 está escrita e compilando; nunca rodou contra o ERP** — nada nela foi exercitado em
campo, porque exercitar significa baixar material de verdade. Falta a AT-5 (tela), a AT-6
(registro no plano) e o commit/redeploy, que são do Pedro.

---

## 2. Arquivos tocados

| Arquivo | Estado |
|---|---|
| `src/services/alvoReqMatAtendimentoService.ts` | **NOVO, completo.** Abertura, realocação, as sete validações, envio de cinco passos, guardas. Sem `TODO`, sem função pela metade. ⚠ **Zero execução real** — ver §7. |
| `supabase/functions/_shared/reqmatMapper.ts` | **1 linha aditiva** em `mapearCabecalho`: `codigo_funcionario_conferiu`. Fora de `COLUNAS_LISTA`, no molde de `codigo_tipo_lanc`. ⚠ Arquivo **Deno** — exige redeploy da Edge. |

**Nada commitado.** `git status` mostra os dois modificados/novos mais os 5 `.md` untracked de
outras frentes, que não são desta missão.

**Verificação rodada, com resultado:**

| Comando | Saída |
|---|---|
| `tsc --noEmit --noResolve --skipLibCheck supabase/functions/_shared/reqmatMapper.ts` | **exit 0** |
| `tsc --noEmit -p tsconfig.app.json` | **exit 0** |
| `bun run build` | **exit 0**, `✓ built in 16.61s` |

⚠ Rodar `--noResolve` num arquivo de `src/` dá `TS2307` no alias `@/…` — é artefato da flag, não
defeito. O `--noResolve` serve para o `_shared` (Deno, sem alias); para `src/` vale o `-p
tsconfig.app.json`.

---

## 3. Decisões desta sessão que não estão em plano nenhum

1. **Âncora do Finalizar = `AtendimentoRealizado === true` + `ReqMat.Numero` preenchido e igual à
   RM enviada** — e **não** o `analisarRespostaReqMat` completo. Motivo: ele também exige
   `ItemReqMatChildList` não-vazio, que é requisito de *semeadura*, não de *sucesso*. Se o
   Finalizar devolvesse o ReqMat sem child list, um atendimento **bem-sucedido** seria lido como
   falho, a tela ofereceria retry e o material baixaria duas vezes. A análise completa ficou onde
   pertence: decidir se dá para semear daquele corpo.
2. **`QuantidadeAtendida` é ACUMULADA** (`jaAtendida + atender`), e `QuantidadeSaldo` do payload é
   `saldo − atender`. Medido, não suposto — §6.
3. **Campos "2" seguem um fator derivado do próprio item** (`Quantidade2 /
   QuantidadeProdUnidMedPrincipal`), aplicado a atendida e saldo. Fator não finito ⇒ 1:1.
4. **Sentinela de data NÃO é normalizada no payload de volta.** A regra "`0001-01-01` vira null" é
   da **leitura**; reescrever campo que ninguém pediu para mexer é como se perdem tentativas no
   `NullReferenceException`.
5. **Produto fora do `stock_products` bloqueia o item, com mensagem** — nunca assume
   `controlaLote = false`. Hoje a cobertura é 411/411, mas a falha tem de ser explícita quando
   aparecer.
6. **Falha de lote é por item, não por RM.** Um produto sem lote não derruba a abertura inteira;
   vira `avisoLotes` e a validação 4 barra só aquele item.
7. **Abertura com concorrência limitada a 4.** Uma RM chega a 14 itens lotáveis ⇒ 28 chamadas; o
   gateway é compartilhado com Suprimentos (100+ usuários), Despesas, Intercompany e NF-e.
8. **`GeraPendencia = "Não"`**, em constante no topo com o racional. A tela **informa** o saldo
   (`resumoDoSaldoRemanescente`), não pergunta.
9. ⚠ **Incerteza assumida:** qual campo do `ClassInstance` o `RelacionarCtrlLoteLocArmaz` lê como
   "quantidade a atender" **não foi capturado do Network** — o espécime da AT-2 tinha zero
   atendido, então acumulado e diferença coincidiam. Preenchi
   `QuantidadeAtendidaProdUnidMedPrincipal` com o acumulado. Risco contido: a proposta é sugestão
   e a validação nº 1 roda localmente antes de qualquer POST.

---

## 4. O que falta, em ordem

1. **Commit** dos dois arquivos (Pedro).
2. **Redeploy da Edge `sync-reqmat`** (Pedro) — sem isso o `conferiu` só tem o histórico do
   backfill; o sync não passa a preencher.
3. **AT-5 — a tela.** Consome este serviço. Duas coisas já decididas e ainda não escritas em
   plano: pré-preencher `Conferiu` com o valor de `Entregou`; informar o saldo em vez de perguntar
   sobre pendência.
4. **AT-6 — registro no `PLANO-OP.md`**, mais os três cards da §8 abaixo.
5. **Teste com usuário SEM `is_admin`** — o papel `almoxarifado` existe, tem as três permissões
   corretas e **zero usuários ativos** (medido). Sem atribuí-lo a alguém, o critério de aceite 1
   não pode ser exercitado: o Pedro é o único `is_admin` de 52 e tem bypass.

---

## 5. O que depende do Pedro — nada disto eu faço

- [ ] `git commit` dos dois arquivos
- [ ] **Redeploy da Edge `sync-reqmat`** (o mapper é Deno)
- [ ] Publish no Lovable, quando a AT-5 estiver pronta
- [ ] Atribuir o papel `almoxarifado` a um usuário real (hoje: 0)
- [ ] **Medição no console** — a única que ficou em aberto: qual campo do `ClassInstance` o
      `Relacionar` usa como quantidade a atender. Espécime seguro: RM `0000002278`, item seq 1
      (`001.003.00087`, saldo 12, COM lote). Chamar o `Relacionar` com
      `QuantidadeAtendidaProdUnidMedPrincipal = 5` e conferir se a soma alocada volta **5** ou
      **12**. ⚠ `Relacionar` não escreve — foi assim que a AT-2 o capturou.
- [ ] Nenhum SQL pendente. A AT-3.1 já está aplicada e verificada.

---

## 6. Medições feitas nesta sessão, com números

**Todas rodaram.** Nenhuma ficou pendente.

**F4 · `GeraPendencia` — o campo não decide o saldo, e nunca aparece sozinho.**

| GeraPendencia | GeraEmpenho | itens | RMs |
|---|---|---|---|
| Não | Não | 2.182 | 499 |
| Não | Sim | 174 | 33 |
| **Sim** | **Sim** | **66** | **21** |

- Comparação de **chaves** do `raw` entre os dois grupos: **nenhuma chave exclusiva** de um lado.
- Comparação de **valores**: o único campo que difere sistematicamente é **`GeraEmpenho`** —
  `GeraPendencia = "Sim"` **nunca** ocorre sem `GeraEmpenho = "Sim"` (66/66). O contrário não vale.
- Entre os 56 itens atendidos parcialmente sem excedente, o saldo ficou de pé em **100% nos dois
  valores** (`Sim` 22/22, `Não` 34/34).
- ⇒ `"Não"` é seguro, inclusive nas RMs com empenho (a combinação já existe 174 vezes).
- 🔴 **Efeito colateral que retifica o plano:** a §2.2 diz "como `GeraEmpenho` é sempre `Não`
  aqui, hoje não morde". **Morde:** 240 itens em 54 RMs têm empenho, e **66 dos 411 itens
  atendíveis hoje (21 RMs de 123, 45 deles com lote)**. Como o saldo do lote vem **bruto** (reserva
  e empenho nulos), a validação "quantidade ≤ saldo do lote" pode aprovar alocação sobre material
  empenhado.

**F8 · campos "2" — existe segunda unidade real; o fator é do item.**

- 2.422 itens com `raw`; **53** com `Quantidade2 ≠ QuantidadeProdUnidMedPrincipal`; **81** com
  `PosicaoProdUnidMed ≠ 1`; 14 unidades distintas.
- Os divergentes são `001.003.00015` e `001.003.00016`, unidade **MILHEI**, posições 2 e 3, fator
  **0,001** (mil unidades = 1 milheiro). `Peso = 0`, `PesoFatorDivisor = null` — não é peso.
- O fator se conserva em `QuantidadeAtendida2` (34/35) e `QuantidadeSaldo2` (20/21).
- A única exceção é **lixo de dado**, não regra: RM `0000001886` item 5 (`001.007.00020`, `UNID`
  pos 1) tem `Quantidade2 = 126` contra pedido 100, com 99 atendidos + 27 de saldo = 126 —
  resíduo de edição do item.

**Outras, todas novas:**

- `QuantidadeAtendida` é **acumulada**: `atendida + saldo = pedida` em **56 de 56** itens parciais.
- Universo atendível: **123 RMs**, **411 itens** com saldo, **211 com `controla_lote`**; média 1,7
  itens lotáveis por RM, **máximo 14**; **0 produtos fora do `stock_products`**.
- `funcionarios_alvo_cache`: **109 `Trabalhando`**, 46 `Demitido`, 2 `Afastado`.
- Papel `almoxarifado`: as 3 permissões corretas, **0 usuários ativos**.
- AT-3.1 aplicada e conferida: as duas guardas carimbam, `anon = false`, `auth = true`, backfill
  **427 de 690**.

---

## 7. O que eu faria diferente

- **Teria medido `GeraEmpenho` na PARTE 1.** Ele estava a uma coluna de distância dos números que
  eu já tinha, e é o que explica o `GeraPendencia`. Perdi uma rodada tratando como mistério algo
  que o banco respondia.
- **Teria pedido a medição do campo do `Relacionar` junto com a M1**, na mesma ida ao console.
  Agora é uma ida a mais, sozinha.
- **Não teria escrito `void variavel` para calar o linter** em dois pontos. Removi antes de fechar,
  mas é o cheiro exato do "parece pronto e não está" — se eu não tivesse revisado, ficariam.
- O serviço tem ~900 linhas com comentário denso. **Continuo achando certo** neste repo — o custo
  aqui é uma tentativa perdida no ERP, não um scroll a mais.

---

## 8. Cards prontos para colar — o Pedro aplica, eu não edito plano

### 8.1 → `PLANO-RM-ATENDIMENTO.md`, seção "Ajustes"

> **Ajuste A1 (09/08/2026) — os campos de Entrega NÃO ficam vazios na operação.**
> A §2.4 afirma que `Entregou`/`Retirou`/`Conferiu` "hoje ficam vazios na operação". Medido no
> `raw` do espelho: `Atendida Total` **315/381 (83%)** e `Atendida Parcial` **112/122 (92%)** com
> `CodigoFuncionarioConferiu` preenchido; nas `Aberta`, 0 — coerente, o preenchimento é no
> atendimento. O padrão é estável: **`Entregou == Conferiu`** (o almoxarife, `0000136` ou
> `0000063`) e **`Retirou`** variando (quem foi buscar) — 169 RMs no par `0000136/0000098/0000136`.
> **Origem do erro:** o Hub não **espelhava** `Conferiu` (a coluna existia, o mapper não emitia a
> chave), e quem leu o espelho concluiu que a operação não preenchia. **Família dos dois eixos,
> quarta ocorrência:** "o espelho não tem" lido como "a operação não faz".
> ⇒ Na AT-5, **pré-preencher `Conferiu` com o valor de `Entregou`**, e **remover** "preencher os
> campos de Entrega, que hoje ficam vazios" da lista "onde o Hub pode ser melhor que o Alvo"
> (§3/AT-5).
>
> **Ajuste A2 (09/08/2026) — `GeraEmpenho` não é sempre "Não".**
> A §2.2 usa "como `GeraEmpenho` é sempre `Não` aqui, hoje não morde" para justificar que o saldo
> bruto do lote basta. Medido: **240 itens em 54 RMs** têm `GeraEmpenho = "Sim"`, sendo **66 em 21
> RMs entre os atendíveis de hoje** (45 com controle de lote). Como o Alvo devolve
> `QuantidadeReservaLote` e `QuantidadeEmpenhoLote` **nulos**, a validação "quantidade ≤ saldo do
> lote" pode aprovar alocação sobre material empenhado. Não bloqueia a AT-4 — quem decide é o
> Alvo — mas deixa de ser hipótese.
>
> **Ajuste A3 (09/08/2026) — `GeraPendencia` não decide o saldo, e não aparece sozinho.**
> Entre 56 itens atendidos parcialmente sem excedente, o saldo foi preservado em **100% nos dois
> valores** (`Sim` 22/22, `Não` 34/34). E **`GeraPendencia = "Sim"` nunca ocorre sem `GeraEmpenho
> = "Sim"`** (66/66) — o "Sim" acompanha a configuração de empenho, não a resposta ao diálogo.
> ⇒ A v1 fixa **`"Não"`** (padrão medido em massa, e a combinação `pendência Não + empenho Sim` já
> existe 174 vezes). A tela **informa** o saldo remanescente; não pergunta.

### 8.2 → `PLANO-OP.md` §6.3-N (retificações) e BL-30

> **Retificação de 09/08/2026 — `ItemReqMatClasseRecdespChildList` VEM no `ReqMat/Load`.**
> O BL-30 e a §2.6 do plano da fase registram que a lista "não aparecia em nenhum `Load`
> anterior" e só vinha pelo `Relacionar`. Medido no console (RM `0000002277`, item
> `001.003.00047`, seq 4): a lista vem **no item do próprio `Load`**, com `CodigoClasseRecDesp
> 11.03` a 100%. O `Relacionar` apenas a devolve. **Ninguém tinha olhado o campo no Load.**
> ⇒ Item **sem** controle de lote **não fica sem classificação** — basta preservar o que veio.
> ⇒ **Não chamar o `Relacionar` para item sem lote:** não há lote a alocar e a classificação já
> está em mãos.
> ⇒ Ausência continua **normal** (só 36 de 232 produtos têm) e **nunca** pode virar erro de
> validação.
>
> **Retificação — campos "2" têm fator real, e ele é do item.**
> A §6.3-N diz que os campos "2" são "a quantidade na segunda unidade de medida". Preciso:
> `…Principal` é na unidade-**base** do produto e o "2" é na unidade **escolhida no item**
> (`CodigoProdUnidMed`/`PosicaoProdUnidMed`). Medido: 53 de 2.422 itens divergem — `001.003.00015`
> e `001.003.00016` em **MILHEI**, fator **0,001**, conservado em atendida e saldo (52/53; a
> exceção é resíduo de edição). ⇒ Quem ajustar quantidade no payload tem de aplicar o fator do
> próprio item, não espelhar 1:1 cegamente.
>
> **Retificação — os campos de Entrega não ficam vazios.** (mesmo texto do Ajuste A1 acima; a
> §6.3-N repete a afirmação original.)

### 8.3 → `PLANO-OP.md` §8, backlog

> **BL-31 — `buildMovEstqPayloadService.ts:468` erra o dia depois das 21h BRT.**
> O padrão `d.toISOString().split("T")[0] + "T00:00:00-03:00"` (também na l. 696) monta a data a
> partir do **UTC**: entre 21h e meia-noite de Brasília a data UTC já virou, e o payload sai com o
> dia seguinte. Módulo de Estoque/MovEstq, **fora do escopo da Fase 4** — não corrigido de
> propósito. A AT-4 usa helper próprio (`agoraNoAlvo`), que desloca o epoch e formata em UTC
> carimbando `-03:00` à mão, correto em qualquer fuso (o Hub é usado no Brasil **e na Áustria**).

---

## 9. Primeiro comando de amanhã

```bash
git pull origin main
git log -3 --oneline
git status --short
```

Depois, pelo MCP do Supabase (read-only, `hbtggrbauguukewiknew`):

```sql
select (select count(*) from op_reqmat) as rms, (select count(*) from compras_pedidos) as pedidos;
-- 09/08/2026: rms = 690 · pedidos = 1820. Divergência grande = PARE e avise.
```

**Reler, nesta ordem:**

1. **este arquivo** (é o delta que não está em plano nenhum);
2. `GUIA-OPERACIONAL-AGENTE.md` §2, §4, §5, §6;
3. `PLANO-RM-ATENDIMENTO.md` inteiro — sobretudo §3/AT-5 e §6 (critérios de aceite);
4. `PLANO-OP.md` §11.3 (retomada **vigente**; §11, §11.1 e §11.2 são HISTÓRICO), §10.19, §10.20,
   §6.3-N;
5. `src/services/alvoReqMatAtendimentoService.ts` — o cabeçalho do arquivo explica o ciclo inteiro;
6. `sql/AT-3.sql` e `sql/AT-3.1.sql`, para os contratos das três RPCs.

⚠ Os 5 `.md` untracked na raiz (`AJUSTE-1.1-APROVACAO-REQ`, `CLAUDE_APROVACAO_REQ`,
`CLAUDE_MOEDA_PEDIDOS`, `Relatorio_Modulo_OP`, `especies-docfin-canonical.csv`) são de outras
frentes. Não são desta missão.

⚠ **Nada de `ValidarAtendimento` ou `FinalizarAtendimento` para testar.** É produção: material
baixa de verdade. O BL-29 custou 30 unidades de `001.003.00059`.
