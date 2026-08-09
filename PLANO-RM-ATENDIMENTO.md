# PLANO-RM-ATENDIMENTO.md
## Fase 4 do módulo OP — Atendimento de RM pelo Almoxarifado

**P&F Brasil · Controladoria · 08/08/2026 · v1.0**

> **Fonte de verdade do módulo:** `PLANO-OP.md`. Este plano é um recorte executável de uma fase;
> onde houver conflito, o `PLANO-OP.md` vence.
> **Governança:** prompts deste plano são **imutáveis**. Ajustes entram como cards numerados na
> seção "Ajustes" ao final, mantendo o original intacto.

---

## 0. Protocolo de sessão (obrigatório)

Antes de qualquer coisa, em toda sessão nova:

1. `git pull` — reportar o resultado.
2. Fingerprint: `select count(*) from compras_pedidos;` — era **1820** em 08/08/2026.
3. Ler o `PLANO-OP.md`: **§11.3** (retomada vigente), **§10.19 e §10.20** (atendimento e
   genealogia de lote), **§6.3-N** (armadilhas).
   ⚠ As §11, §11.1 e §11.2 são **HISTÓRICO**.
4. Reportar a working tree. Há `.md` untracked de outras frentes (Suprimentos, Projetos, Moeda) —
   **não são desta missão, seguir**.

**Como trabalhamos:**

- **Validar antes de construir.** Ler o schema e o código reais antes de escrever. Medir, não
  deduzir.
- **O agente escreve o código; o Pedro aplica o SQL e publica.** Nunca pular essa cadeia.
- DDL vai para `sql/OP-x.y.sql`. **`supabase db push` é proibido.**
- MCP do Supabase é **read-only**, escopado ao `hbtggrbauguukewiknew`.
- Frontend entra por commit em `main`; **Publish é pelo Lovable**, pelo Pedro.
- Permissões e papéis são **aditivos** — o app tem 100+ usuários.
- Perguntas **inline no texto**, nunca em caixa de diálogo. Português do Brasil.
- Rodadas de **duas partes**: LER E PROPOR → PARAR → CONSTRUIR.

---

## 1. O que esta fase entrega

**Uma tela onde o almoxarifado atende requisições de material**, escolhendo lote, sem abrir o
ERP.

O papel **`almoxarifado`** já existe e concede exatamente três permissões:
`producao.access` · `producao.rm.access` · `producao.rm.atender`. **Ele não cria OP, não cria RM
e não edita RM. Só vê e atende.**

`producao.rm.atender` está declarada desde 07/08 e **nunca teve consumidor** — esta fase é o
consumidor.

### 1.1 Decisão de processo (do Pedro, 08/08)

**O almoxarifado pode atender no Hub OU no Alvo.** As duas portas ficam abertas.

⚠ **Consequência que o desenho tem de tratar:** duas pessoas — ou a mesma, em duas abas —
atendendo a mesma RM em telas diferentes. O Hub monta o objeto a partir de uma leitura de
segundos atrás; se alguém atendeu no Alvo nesse meio-tempo, o Hub manda quantidade já consumida.
**E o Alvo aceita atendimento acima do pedido** (é como o `QuantidadeAtendidaMaior` nasce), então
**não haveria erro — haveria baixa em dobro.** É o BL-18 por outro caminho.

⇒ **Releitura obrigatória imediatamente antes de finalizar**, com recusa se as quantidades
mudaram desde a abertura da tela. Não é opcional.

### 1.2 O que esta fase NÃO faz

- Não cria nem edita RM (isso é a Fase 2, já entregue).
- Não estorna (⚠ ver BL-22: o estorno pode não devolver tudo — 1 galão de 9 não voltou).
- Não trata reprova nem devolução (Fases 3 e 4 do plano-mãe).
- Não mexe no módulo Recebimento — **inspeção é feita no Alvo pela Qualidade, e isso não muda**.

---

## 2. O que já está provado em campo

**Não reinvestigar nada desta seção.** Tudo foi medido entre 05 e 08/08/2026.

### 2.1 O ciclo de atendimento funciona por API

Provado na RM `0000002273` (criada, atendida e excluída em 05/08), **sem tocar a tela do Alvo**:

```
1. POST ReqMat/ValidarAtendimento    ← objeto ReqMat INTEIRO, SEM envelope
                                     ← devolve o objeto carimbado
2. POST ReqMat/FinalizarAtendimento  ← O MESMO objeto que o Validar devolveu
                                     → {AtendimentoRealizado, ReqMat, Messages}
```

⚠ No payload do `Finalizar`, `Status` ainda vem `"Aberta"`, `BaixouEstoque` `"Não"` e
`TipoFormulario` `"Normal"`. **Quem muda é o servidor. Não "corrigir" esses campos.**

**O que preencher no cabeçalho:**
`CodigoTipoLanc: "E0000023"` · `CodigoFuncionarioAtendente: "0000165"` · `DataEntrega` ·
`DataConferencia` · `DataRecebimento` · e, opcionalmente,
`CodigoFuncionarioEntregou` / `Retirou` / `Conferiu`.

**No item:** `QuantidadeAtendida*` preenchida, `QuantidadeSaldo*` ajustada, `DataAtendimento`, e a
`CtrlLoteItemReqMatChildList`.

### 2.2 🟢 BL-21 — FECHADO em 08/08. O endpoint de lotes

```
POST https://pef.it4you.inf.br/api/CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz
```

⚠ **NÃO está na whitelist do `erp-proxy`** — hoje responde 403 no passthrough. Entra nesta fase.

**Payload:** o item da RM inteiro dentro de `ClassInstance`, mais campos de contexto no topo:

```json
{
  "Origem": 7,
  "Data": "2026-08-07T14:46:34.507-03:00",
  "DataMovimentacao": "2026-08-07T14:46:34.507-03:00",
  "EspecieDocumento": "RM",
  "NumeroDocumento": "0000002283",
  "SerieDocumento": "0",
  "SequenciaDocumento": null,
  "OperacaoLote": "Saída",
  "OperacaoRM": "Retirada",
  "CodigoTipoLanc": "",
  "ClassInstance": { "…o item completo do ReqMat/Load…" }
}
```

⚠ **`Origem: 7`** é constante mágica do Alvo — não se sabe o que significa, mas tem de ir.
⚠ O `ClassInstance` traz `ControlaLote`, `CodigoProduto`, `CodigoLocArmaz`,
`CodigoProdUnidMed`, `PosicaoProdUnidMed` — é por eles que o Alvo resolve a lista.

**Resposta** — `{ "ListaCtrlLoteLocArmaz": [ … ] }`, com os campos que importam:

| Campo | Uso |
|---|---|
| `NumeroCtrlLote` | identificação |
| `DataValidadeCtrlLote` | **ordem FEFO** |
| `DataFabricacao` | contexto (a tela do Alvo nem mostra) |
| `QuantidadeSaldoProdUnidMedPrincipal` | **saldo do lote** |
| `CodigoLocArmaz` · `CodigoProduto` · `CodigoProdUnidMed` · `PosicaoProdUnidMed` | eco do contexto |

Espécime real (`001.003.00059`, local `001`, 08/08):

| Lote | Validade | Fabricação | Saldo |
|---|---|---|---|
| `0002467` | 30/04/2028 | 30/04/2026 | 184 |
| `0002547` | 21/05/2028 | 21/05/2026 | 140 |
| `0002652` | 30/06/2028 | 30/06/2026 | 350 |

🟢 **Vem ordenada por validade** — o Alvo já entrega em ordem FEFO.

⚠ `QuantidadeReservaLote` e `QuantidadeEmpenhoLote` vêm **nulos**: o saldo é **bruto**, sem
descontar reserva ou empenho. Como `GeraEmpenho` é sempre `"Não"` aqui, hoje não morde — mas o
número não é "disponível", é "saldo".

⚠ `Deletar: false` e `Mensagem: null` sugerem que o mesmo objeto volta ao Alvo com a seleção —
provavelmente o que o **`RelacionarCtrlLoteLocArmaz`** faz. **Não capturado.** Ver §5.1.

### 2.3 Genealogia de lote — a estrutura de escrita

`CtrlLoteItemReqMatChildList`, dentro do item, **uma linha por lote**:

```json
{
  "CodigoEmpresaFilial": "1.01",
  "CodigoProduto": "001.003.00032",
  "NumeroReqMat": "0000002273",
  "SequenciaItemReqMat": 1,
  "CodigoLocArmaz": "001",
  "NumeroCtrlLote": "0002312",
  "DataValidadeCtrlLote": "2028-03-02T00:00:00-03:00",
  "QuantidadeProdUnidMedPrincipal": 1,
  "Operacao": "Saída",
  "CodigoProdUnidMed": "GALAO",
  "PosicaoProdUnidMed": 1,
  "Quantidade2": 1,
  "QuantidadeBruta": 2,
  "QuantidadeUnidadeItem": 1,
  "QuantidadeAtendidaProdUnidMedPrincipal": 0,
  "QuantidadeAtendida2": 0
}
```

🔴 **REGRA DE FECHAMENTO:** a soma de `QuantidadeProdUnidMedPrincipal` das linhas de lote tem de
bater **exatamente** com a quantidade atendida do item. A tela do Alvo mostra
`Quantidade Item / Quantidade Utilizada / Diferença` e **não deixa salvar com diferença ≠ 0**.

⚠ **NÃO SOMAR `QuantidadeBruta`.** Significado não fechado: 5 para 1 galão numa RM, 4 para 4
galões noutra. **Usar sempre `QuantidadeProdUnidMedPrincipal`.**

⚠ `QuantidadeAtendida*` da linha de lote vem **zero** — a atendida vive no item.

⚠ **Item não atendido tem ZERO linhas de lote.** A lista é escrita no atendimento.

⚠ **Rateio entre lotes funciona por API** — provado: 1 galão do `0002312` + 1 do `0002696`.

### 2.4 O que o Alvo pergunta e a tela precisa replicar

**Pendência.** Quando há saldo não atendido, o `ValidarAtendimento` faz a tela perguntar
*"Alguns itens não foram atendidos, deseja gerar pendência deles?"*. É o campo `GeraPendencia` do
item.

**Atendimento parcial por item.** A quantidade é **digitada por item**, e nada impede digitar
mais que o pedido — é assim que o `QuantidadeAtendidaMaior` nasce.

**Tipo de lançamento.** Vem preenchido com `E0000023` (SAÍDA BAIXA REQUISIÇÃO DE MATERIAL), mas o
dropdown tem **244 opções**. A tela do Hub **fixa `E0000023`** — não oferece escolha.

**Atendente travado.** `CodigoFuncionarioAtendente` vem sempre `0000165` (Maria Alves), que é o
padrão do local `001`, **independentemente de quem atende**. Não é editável no Alvo.
⇒ **A rastreabilidade real de pessoas vem dos campos de Entrega** (`Entregou` / `Retirou` /
`Conferiu`), que são editáveis e **provadamente gravam**, e que hoje **ficam vazios na operação**.

### 2.5 Produto sem controle de lote

`ControlaLote = "Não"` (ex.: sapólio, papel) ⇒ **não abre seleção de lote nenhuma**, e a
`CtrlLoteItemReqMatChildList` fica vazia. A tela precisa tratar os dois casos na mesma RM.

Medição: **110 de 175** produtos requisitados no ano têm lote registrado.

### 2.6 🟢 `RelacionarCtrlLoteLocArmaz` — o alocador FEFO do servidor (AT-2, 09/08)

```
POST https://pef.it4you.inf.br/api/CtrlLoteLocArmaz/RelacionarCtrlLoteLocArmaz
```

**Não é conveniência da tela: é o Alvo alocando.**

**Request:** o mesmo envelope do `ListaCtrlLoteLocArmaz` (§2.2), com dois acréscimos —
`Lista` (o array devolvido pela lista) e o `ClassInstance` com a **quantidade a atender** já
preenchida.

**Response:** o **item de volta**, com a `CtrlLoteItemReqMatChildList` **já montada**. Espécime
(RM `0000002277`, item `001.003.00047`, 20 a atender): uma linha, lote `0002467`, quantidade 20 —
**o de validade mais próxima**. O usuário não alocou nada.

⇒ **O Hub NÃO precisa implementar FEFO.** Chama o `Relacionar` e recebe a alocação pronta.
E continua podendo montar à mão — a RM `0000002273` (§2.1) foi atendida com rateio manual entre
dois lotes, **sem** passar por ele.

⇒ Isso muda a AT-4: o passo 3 do ciclo deixa de ser "o usuário aloca" e passa a ser "o Hub
propõe (via `Relacionar`) e o usuário ajusta".

⇒ E explica o episódio de 05/08 no teste da RM `2272`: a quantidade do modal de lote vinha
**pré-preenchida**, e foi preciso ajustá-la. Era este endpoint.

#### 🟢 `QuantidadeBruta` — mistério resolvido

A §2.3 registrava o campo como de significado não fechado. **É a quantidade ORIGINAL do lote**,
não o total do atendimento:

| RM | Lote | Saldo hoje | `QuantidadeBruta` |
|---|---|---|---|
| `2275` | `0002696` | 5 | 5 |
| `2272` | `0002311` / `0002312` | 1 e 4 | 4 e 4 |
| `2277` | `0002467` | 154 | **350** |

⇒ **A regra prática não muda** — o quanto sai de cada lote é `QuantidadeProdUnidMedPrincipal`.
Mas o campo ganha uso legítimo: dá para mostrar **"154 de 350"** na tela, informação de estoque
que o Alvo não exibe.

#### ⚠ Campo novo: classificação contábil no item

O item devolvido pelo `Relacionar` traz `ItemReqMatClasseRecdespChildList` preenchida —
`{ "CodigoClasseRecDesp": "11.03", "Percentual": 100 }`. **Não aparecia em nenhum `ReqMat/Load`
anterior.** É rateio por classe de receita/despesa. Ver **BL-30** no `PLANO-OP.md`: se a RM
criada pelo Hub nascer sem isso, pode ficar sem classificação contábil.

---

## 3. Tarefas

| # | Tarefa | Entregável | Estado |
|---|---|---|---|
| **AT-1** | Whitelist: `CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz` · `ReqMat/ValidarAtendimento` · `ReqMat/FinalizarAtendimento` | commit no `erp-proxy` | ✅ **09/08** |
| **AT-2** | Capturar `RelacionarCtrlLoteLocArmaz` (§2.6) | registro neste plano | ✅ **09/08** |
| **AT-3** | RPC de escrita do atendimento + livro | `sql/AT-1.sql` | ⬜ |
| **AT-4** | Serviço de atendimento (Load → lotes → Validar → Finalizar → semear) | `src/services/` | ⬜ |
| **AT-5** | Tela / modal de atendimento | `src/pages/` | ⬜ |
| **AT-6** | Registro no `PLANO-OP.md` | — | ⬜ |

### AT-1 — Whitelist do `erp-proxy` ✅ FEITA em 09/08/2026

**Deploy verde no Render e provado no console:** 403 → **417** (`ListaCtrlLoteLocArmaz`), **200** (`ValidarAtendimento`), **200** (`FinalizarAtendimento`).

🔴 **Armadilha descoberta no teste:** `FinalizarAtendimento` com payload vazio responde **200 com um objeto ReqMat em branco** (`Numero: ""`, `Status: "Aberta"`, `BaixouEstoque: "Não"`), **não erro**. ⇒ **O Hub não pode tratar 200 como sucesso.** Exigir a âncora — `ReqMat.Numero` presente, não-nulo e não-vazio — antes de aceitar a resposta (mesma guarda do `analisarRespostaReqMat`).

Repo **separado** (`financeiropfbrazil/erp-proxy`), arquivo `src/routes/alvo.ts`, deploy
automático no Render ao push.

⚠ **A checagem é case-sensitive.** Grafias exatas:

```ts
  // ─── Atendimento de RM (Fase 4 do módulo OP, AT-1) ─────────────────────────
  "CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz",  // lotes disponíveis por produto/local (POST)
  "ReqMat/ValidarAtendimento",               // ESCRITA — passo 1 do atendimento
  "ReqMat/FinalizarAtendimento",             // ESCRITA — passo 2, baixa estoque
```

⚠ **É gargalo compartilhado** (Suprimentos 100+ usuários, Despesas, Intercompany, NF-e). Commit
mínimo, aditivo. Canário depois do deploy.

⚠ Enquanto essas linhas existirem, **qualquer autenticado pode chamá-las pelo console** — o
passthrough valida só JWT, sem gate de papel (é o BL-5). Registrar como dívida.

### AT-3 — Escrita

Molde: as RPCs da OP-2.7/2.9 (`op_rm_criar`, `op_rm_marcar_enviado`,
`op_reqmat_semear_criacao`). `SECURITY DEFINER`, `SET search_path`, gate
**`producao.rm.atender`** por `_user_has_perm`.

🔴 **`revoke execute … from anon`, com assinatura completa.** O projeto tem
`ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO anon` para funções em `public` ⇒ **toda função
nova nasce aberta a `anon`**, e `revoke … from public` **não alcança grant nominal**.

**Nenhuma policy de INSERT/UPDATE para `authenticated`.**

⚠ **Reusar a `op_reqmat_aplicar_load`** para semear o resultado — ela faz delete+insert dos
filhos **em transação**, de propósito, para fechar a janela em que a RM apareceria com "atendido
0". Não reabrir essa janela.

### AT-4 — O ciclo

```
1. Load          ReqMat/Load?numero=X&loadChild=All   ← a verdade de AGORA
2. Lotes         ListaCtrlLoteLocArmaz, por item com ControlaLote="Sim"
3. Relacionar     RelacionarCtrlLoteLocArmaz  ← o Alvo ALOCA em FEFO (§2.6)
   [usuário ajusta, se quiser]
4. RELEITURA     Load de novo  🔴 se as quantidades mudaram → RECUSA
5. Validar       ReqMat/ValidarAtendimento
6. Finalizar     ReqMat/FinalizarAtendimento (o objeto que o Validar devolveu)
7. Semear        do corpo do Finalizar/Load, pela RPC
```

🔴 **O passo 4 é o que impede a baixa em dobro** (§1.1). Sem ele a tela é insegura.

**Validações do Hub antes de enviar** — o Alvo responde `NullReferenceException` **sem dizer qual
campo falta** (§6.3-N; quatro tentativas perdidas assim em 05/08):

1. soma dos lotes = quantidade atendida do item (por item);
2. quantidade de cada lote ≤ saldo daquele lote;
3. quantidade atendida > 0 em ao menos um item;
4. produto com `ControlaLote="Sim"` **exige** ao menos um lote;
5. produto com `ControlaLote="Não"` **não pode** ter lote;
6. quantidades numéricas;
7. RM não está `Atendida Total` nem `ausente_desde`.

### AT-5 — A tela

Entrada pela fila (`/producao/rm`) e pelo detalhe, gateada por `producao.rm.atender`.

**Modal por RM**, com uma linha por item:

- pedido · já atendido · **saldo** · campo de quantidade a atender
- produto com lote: bloco de alocação com **nº, validade, fabricação e saldo**, ordenado por
  validade
- **contador `Alocado / A atender / Diferença`**, com confirmação travada até zerar
- campos de **Entrega** — `Entregou`, `Retirou`, `Conferiu` — do
  `funcionarios_alvo_cache` (`status='Trabalhando'`)
- pergunta de **pendência** quando houver saldo

🟢 **Onde o Hub pode ser melhor que o Alvo** (a lista já vem ordenada por validade):

- **pré-preencher FEFO** — alocar automaticamente do lote que vence antes, deixando o operador só
  confirmar ou ajustar. No Alvo é 100% manual;
- **alertar lote vencido ou perto do vencimento** — o Alvo mostra a data e não avisa;
- **bloquear alocação acima do saldo do lote** antes de mandar;
- **preencher os campos de Entrega**, que hoje ficam vazios.

---

## 4. Regras que não se negociam

1. **Nada é escrito no Alvo por leitura.** A tela lê o quanto quiser; escreve só no Finalizar.
2. **A releitura antes de finalizar é obrigatória** (§1.1).
3. **`quantidade_saldo` é espelhado, nunca recalculado** — o Alvo entrega pronto.
4. **`quantidade_atendida_maior` é carimbado**, nunca derivado de `atendida − pedida`.
5. **Na tabela de lotes, usar `quantidade`, NUNCA `quantidade_bruta`** (§2.3).
6. **Conferência é por item**, nunca pelo status do cabeçalho — a `0000002251` provou que ele
   mente nos dois sentidos (2.850 pedidas, 2.918 atendidas, e ainda um item inteiro em aberto).
7. **Erro de usuário não pode virar exceção de ERP** — o Hub valida antes.
8. **O atendimento não estorna.** Se errou, o estorno é no Alvo (e ⚠ o BL-22 mostra que ele pode
   não devolver tudo).

---

## 5. Incógnitas — medir antes de codificar

### 5.1 ~~`RelacionarCtrlLoteLocArmaz` — não capturado~~ ✅ RESOLVIDO em 09/08 — ver §2.6

Aparece no Network entre a lista de lotes e o `ValidarAtendimento` (5,2 kB). Provavelmente aplica
a seleção ao item.

**A dúvida real:** o atendimento por API da RM `0000002273` funcionou **sem** ele — a
`CtrlLoteItemReqMatChildList` foi montada à mão e o Alvo aceitou. ⇒ Ou ele é só conveniência da
tela, ou faz algo a mais (reserva? validação de saldo?) que não notamos.

**Como medir:** abrir uma RM com lote no Alvo, Network com Preserve log **ligado antes**, chegar à
seleção de lote, marcar um lote e dar OK — **e fechar sem finalizar**. Copiar `Payload` e
`Response`.

### 5.2 Concorrência real

O passo 4 protege contra o que muda **entre a abertura da tela e o envio**. Não protege contra
duas finalizações no mesmo segundo. **Medir** se o Alvo tem trava própria — tentar finalizar duas
vezes a mesma RM em sequência rápida, num ambiente controlado.

### 5.3 A quem pertence o atendimento

O papel `almoxarifado` está criado e **sem nenhum usuário**. A pergunta *"quem realmente
atende?"* é uma das nove do almoxarifado (§8.2 do relatório de 31/07) e **os dados não
respondem** — o `CodigoFuncionarioAtendente` é sempre `0000165`.

⚠ Não é bloqueio de código: a tela pode ser construída e atribuída depois.

### 5.4 Unidade de medida

~4% dos itens divergem entre a RM e o catálogo. Na criação a decisão foi usar a primeira do
catálogo (§9.8). **No atendimento a unidade vem da RM**, não do catálogo — mas vale conferir se a
lista de lotes respeita a mesma unidade do item.

---

## 6. Critérios de aceite

1. Almoxarife com o papel abre a fila, vê as RMs e o botão de atender. **Testado com usuário sem
   `is_admin`** — o Pedro é o único de 52, e erro de permissão não aparece para ele.
2. Item com lote mostra os lotes com validade e saldo, ordenados por validade.
3. Item sem lote atende sem pedir lote.
4. Alocar acima do saldo do lote é bloqueado **no Hub**, com mensagem.
5. Diferença ≠ 0 trava a confirmação.
6. Atendimento parcial funciona e a RM fica `Atendida Parcial` com o saldo certo.
7. Rateio entre dois lotes grava duas linhas em `op_reqmat_lotes`.
8. A RM atendida aparece atualizada **na hora**, sem esperar o sync.
9. **Releitura:** se a RM mudou no Alvo entre a abertura e o envio, a tela recusa e explica.
10. Saldo do produto no Alvo cai exatamente pela quantidade atendida.
11. Os campos de Entrega gravam e aparecem no detalhe.

---

## 7. Diário

| Data | Item | Registro |
|---|---|---|
| 08/08/2026 | BL-21 | **Fechado.** `CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz` capturado com payload e resposta. Lista vem ordenada por validade; traz `DataFabricacao`, que a tela do Alvo não mostra. `QuantidadeReserva/EmpenhoLote` nulos ⇒ saldo é bruto. ⚠ A captura custou o atendimento real da RM `0000002283`: **30 unidades de `001.003.00059` baixaram do estoque** (lote `0002467`, 674 → 644). Verificar com o almoxarifado se o material foi fisicamente entregue. |
| 09/08/2026 | AT-1 · AT-2 | **A Fase 4 perde a última incógnita.** Whitelist liberada e provada (403 → 417/200/200). 🔴 `FinalizarAtendimento` com payload vazio responde **200 com objeto em branco**, não erro ⇒ exigir âncora. 🟢 O `RelacionarCtrlLoteLocArmaz` é **o alocador FEFO do servidor** — devolve a lista de lotes montada; o Hub não precisa implementar FEFO. 🟢 `QuantidadeBruta` = quantidade **original** do lote (fecha nos três espécimes). ⚠ **BL-30**: `ItemReqMatClasseRecdespChildList` (`11.03`, 100%) aparece no item e não vinha em `Load` nenhum. Captura sem efeito colateral — fechada no X, sem Validar/Finalizar. |
| 08/08/2026 | Processo | Decisão do Pedro: **o almoxarifado pode atender no Hub ou no Alvo**. ⇒ Releitura antes de finalizar vira requisito, não refinamento. |

---

## Ajustes (cards)

> Nada aqui ainda. Correções ao plano entram como `Ajuste A1`, `A2`… mantendo o texto original
> intacto (disciplina da §6.3-N do `PLANO-OP.md`).
