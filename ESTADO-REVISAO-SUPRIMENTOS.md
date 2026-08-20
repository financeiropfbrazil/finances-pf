# ESTADO-REVISAO-SUPRIMENTOS
### Estado vivo da missão · última atualização: 20/08/2026, após o C3.2

> **Leia este arquivo ANTES de qualquer coisa nesta missão.** Ele registra o que foi
> executado, o que foi medido e — principalmente — **onde a documentação está errada**.
> Vários fatos abaixo contradizem o `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` e a
> `MISSAO-SYNC-PEDIDOS.md`; quando houver conflito, **este arquivo e os `AJUSTE-RS-*`
> prevalecem**.
>
> Ordem de leitura para sessão nova: `CLAUDE.md` → **este arquivo** →
> `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` → os `AJUSTE-RS-*` do card em questão.

---

## 1. Cards concluídos

| Card | O que foi feito | Validação |
|---|---|---|
| **F0** | `Produto/SavePartial` fora da whitelist do passthrough; routers MCP auditados (fechados: JWKS + lookup em `profiles`); `cost_centers` sincronizado à mão | — |
| **A1** | Open-load migrado para `GET /ped-comp/:filial/:numero` com JWT Supabase (`80bf323`) | Operadora sem credenciais locais abriu pedidos sem erro |
| **B1** | Detalhe da requisição liberado ao líder do CC, exceto rascunho alheio (`f40029c`) | Guilherme (líder de TI, sem `is_admin`) abriu e **rejeitou** pela tela |
| **B3** | `EXECUTE` revogado de `public`+`anon` nas 5 RPCs; `_req_evento` fechada também para `authenticated` | V1: `anon_pode=false` nas cinco |
| **B4** | Auditoria append-only pela **Seção 3-ALT** (mantém INSERT, revoga UPDATE/DELETE) | V3/V4/V5 conferidos |
| **C1** | `compras_pedidos_anchor` criada; rodadas `S1-t0`, `S1-t1` e **`C3-t0`** (esta com os 7 valores em colunas) | 1.898 → 1.902 pedidos |
| **C2 + B2** | Fila do cron alinhada à contagem (`not.is.true`); `'rejeitada'` em `STATUS_TERMINAIS` | 6+ ciclos, zero erros; drenagem 415 → 57 |
| **C3** | Cron passa a gravar rateio por item + parcelas + completar cabeçalho; RPC transacional `sync_replace_filhos_pedido` | Ver §5 |
| **C3.2** | Percentual de classe única ausente + gate de reprocesso (`105e1fb`) | Ver §5 |

**Frente de sync ENCERRADA em 20/08/2026** com os cards **A1, B1, B3, B4, C1, C2, C3 e
C3.2**. Nenhum card em aberto. O Bloco E (backfill histórico) foi **dispensado por decisão
do Pedro** — ver §6. O que restou do plano v1.1 e nunca foi executado está catalogado na
**§9**, para quem eventualmente retomar.

---

## 2. 🔴 Correções de fato — a documentação está errada nestes pontos

1. **O cron de compras se chama `bicephalous`** no `job_type` de `sync_runs`. Job pg_cron:
   `sync-compras-status-cron-hourly`.
2. **Roda DE HORA EM HORA**, 11h–20h UTC em dias úteis (8h–17h BRT), ~10 ciclos/dia. As
   janelas "07h30 / 12h30 / 16h30 BRT" do plano **são de outros jobs**.
3. **`excluido_alvo` NÃO é coluna** — é **valor do enum `status_local`**, gravado por
   `avaliarExclusaoPedido` só com o cross-check completo (lista OK, data na janela,
   número ausente). *(Corrigido: a versão anterior deste arquivo dizia que a marcação não
   existia.)*
4. **`compras_pedidos_auditoria` NÃO registra valores** — só status, aprovação, comprado e
   próximo aprovador.
5. **`sync_runs` não tem coluna `job`** — é `job_type`. E **`detalhes` é um ARRAY na raiz**:
   para varrer erros use `jsonb_array_elements(detalhes)`. O `elegiveis_sem_limit` aparece
   no texto de `observacao`.
6. **`compras_pedidos_itens` usa `valor_total_item`**, não `valor_total`.
7. **A auditoria de REQUISIÇÕES é escrita majoritariamente pelo frontend** (887 de 933) —
   ver `AJUSTE-RS-B4.md`.
8. 🔴 **Todo número de população neste documento envelhece a cada ciclo do cron.**
   O cron roda de hora em hora e move as contagens de fila, rateio, parcelas e passivo.
   **Remedir antes de citar** — e **nunca reconciliar por aritmética**. O exemplo é a
   decomposição dos 464 fora da fila, escrita como `450 + 14` para fechar a conta: a
   medição real é **457 terminais + 4 pelo corte de 180 dias + 3 `excluido_alvo`**, e a
   terceira causa nem aparecia no texto. Número ajustado para fechar soma vira
   investigação perdida na sessão seguinte. Por isso cada medição abaixo leva a data e a
   hora em que foi tirada.

---

## 3. Âncora — como usar

**Vigente: `C3-t0`** (20/08 12:26 UTC, 1.902 pedidos, **com os 7 valores em colunas**).
`S1-t0` e `S1-t1` são hash-only e estão queimadas — só registro histórico.

**Verificação campo a campo (sucesso = zero linhas):**

```sql
select p.numero, p.valor_total, a.valor_total as anc_total,
       p.valor_ipi, a.valor_ipi as anc_ipi,
       p.valor_outras_despesas, a.valor_outras_despesas as anc_outras, p.updated_at
from public.compras_pedidos p
join public.compras_pedidos_anchor a on a.pedido_id = p.id and a.rodada = 'C3-t0'
where p.valor_total is distinct from a.valor_total
   or p.valor_mercadoria is distinct from a.valor_mercadoria
   or p.valor_servico is distinct from a.valor_servico
   or p.valor_frete is distinct from a.valor_frete
   or p.valor_desconto is distinct from a.valor_desconto
   or p.valor_ipi is distinct from a.valor_ipi
   or p.valor_outras_despesas is distinct from a.valor_outras_despesas;
```

⚠️ **Linha não-zero NÃO é corrupção por si só.** `NULL` virando valor legítimo também
conta. Padrão já visto duas vezes: pedido novo/nunca visitado entra com `valor_ipi` e
`valor_outras_despesas` nulos e o Load preenche com zero. **Com a `C3-t0` isso se
diagnostica em segundos** — as colunas mostram qual campo mudou e de quanto. Se o
`valor_total` mudar sem correspondência no Alvo, aí sim é problema.

ℹ️ A âncora cobre **1.902** pedidos; o Hub já tem **1.904** (medido 20/08 13:20 UTC).
Pedido descoberto depois da captura não tem linha na âncora e, portanto, não é coberto
pela verificação — não é falha, é o recorte da rodada.

---

## 4. Estado medido (todas as linhas: **medido 20/08 13:20 UTC**)

- **1.904 pedidos** no Hub *(medido 20/08 13:20 UTC)*.
- **Fila do Job 2: 407 elegíveis**, `PED_BATCH_SIZE = 100`, ordem `synced_at asc`
  *(medido 20/08 13:20 UTC)*.
- **`compras_pedidos_itens_rateio`: 637 linhas** em **296 pedidos**, dos quais **46** com
  `valor_derivado = true`. Estava **vazia** em 19/08 *(medido 20/08 13:20 UTC)*.
- **`compras_pedidos_parcelas`: 708 linhas.** Estava **vazia** em 19/08
  *(medido 20/08 13:20 UTC)*.
- **Terminais sem detalhe: 57**, parados — 56 fora do corte de ~180 dias; 1 é o `0004370`,
  padrão de Load 404 permanente *(medido 20/08 13:20 UTC)*.
- **1.164 pedidos** com `classe_rateio` jsonb cheio e relacional vazio — a geração antiga,
  **invisível ao cron**. É o Bloco E *(medido 20/08 13:20 UTC)*.
- **8 pedidos com `status` NULL** *(medido 20/08 13:20 UTC)*.

---

## 5. C3 e C3.2 — o que foi aprendido

### O que a RPC faz
`sync_replace_filhos_pedido(p_pedido_id, p_rateios, p_parcelas)` — `SECURITY DEFINER`,
`search_path=public`, EXECUTE só para `service_role`. Valida percentual (100,0000 por
(item,classe) e por item), apaga os filhos **daquele pedido** e reinsere, na mesma
transação. Sem UNIQUE e sem upsert: repetição (item, classe, CC) é legítima.
Valor: usa o do Alvo quando existe; deriva pelo percentual quando vem null/0, marcando
`valor_derivado = true`, com residual na última linha de cada item.

### Defeito 1 (corrigido no C3.2) — percentual de classe omitido
O Alvo às vezes manda `Percentual: null` **no nível da classe do item**, com os CCs
completos e o cabeçalho preenchido. Caso real: 0004602 (classe 16.17, CCs
33.34/33.33/33.33). A extração virava 0 e a validação reprovava.
Correção: **classe única com percentual null/0 → assumir 100** (aritmeticamente
necessário). Múltiplas classes → não adivinhar; aviso nomeado.
*Medido: os 2 casos multiclasse da base têm uma classe em 100% e outra em 0%, então a soma
fecha e a RPC aceita. Nenhum caso exige inferir divisão.*

### Defeito 2 (corrigido no C3.2) — falha silenciosa que se auto-encobria
Quando a RPC falhava, `completarCamposAusentes` **preenchia os jsonb assim mesmo**. Como o
gate usa os jsonb como proxy do relacional, o pedido passava a parecer completo e **nunca
mais seria reprocessado**, nem após a correção. Foi o que aconteceu com o 0004602.
Correção: `filhosOk` controla o preenchimento dos jsonb, e a falha grava
`detalhes_carregados = false`.

### Validação (20/08, ciclo manual)
`0004602` → 3 linhas, classe 16.17, 33.34/33.33/33.33, valores derivados
17.153,43 + 17.148,29 + 17.148,28 = **51.450,00** = `valor_total`. ✅
`0004640` → 2 linhas, classe 19.02, CC 00008.00001.00006, 100% em cada,
69.353,42 + 45.286,57 = **114.639,99** = `valor_total`, `valor_derivado = false`. ✅
*(o item 1 tem rateio 69.353,42 contra `valor_total_item` 60.307,32 — a diferença é o IPI
de 9.046,10. Validar rateio contra o valor do item **sem** impostos rejeitaria este pedido
indevidamente.)*
Âncora `C3-t0`: 3 pedidos acusados, **todos benignos** (0004707/08/09, descobertos após a
captura, `valor_ipi` e `valor_outras_despesas` de null → 0).

### Truque operacional
`synced_at = null` joga o pedido para o **topo** da fila (ordem `asc`, nulo primeiro).
Combinado com `detalhes_carregados = false`, força o reprocesso imediato de um pedido
específico — usado para validar o 0004602 e o 0004640 sem esperar vários ciclos.
Não toca status nem valores, então a âncora segue protegida.

---

## 6. Bloco E — DECISÃO REGISTRADA: backfill histórico dispensado

> **Decisão do Pedro, 20/08/2026.** O backfill histórico está **DISPENSADO**. O foco é
> para frente. O C3 garante que **pedido novo entra completo**; o passivo abaixo
> **permanece sem rateio no relacional, e isso é aceito** — não é pendência, não é dívida
> a cobrar, não é trabalho pendurado. Nenhum card do Bloco E (E1/E2/E3) será executado.

*(toda a medição desta seção: **medido 20/08 13:20 UTC**)*

**O que fica como está.** **492 pedidos** com filhos ausentes; destes o cron ainda alcança
**28** pela drenagem normal, e **464 estão fora da fila**, decompostos assim:

| Causa de bloqueio | Pedidos |
|---|---:|
| Terminal (`Encerrado`/`Cancelado`/`Cancelado Parcial`) com `detalhes_carregados = true` | **457** |
| Fora do corte de ~180 dias | **4** |
| `status_local = 'excluido_alvo'` | **3** |
| **Total fora da fila** | **464** |

> ⚠️ A versão anterior deste documento decompunha os 464 como `450 + 14`, número ajustado
> para fechar a soma. Não era medição. A decomposição acima foi medida; a terceira causa
> não constava. Ver §2 item 8.

Somam-se a eles os **1.164 pedidos** com `classe_rateio` jsonb cheio e relacional vazio —
a geração antiga, invisível ao cron. **Também ficam como estão.**

**Por que a decisão é defensável — o C3 estancou o fluxo.** Na medição do dia anterior o
universo era de **717** pedidos com filhos ausentes, dos quais **253** alcançáveis pelo
cron. Em poucas horas caiu para **492 / 28**: o C3 drenou **~225 pedidos vivos** sozinho,
sem intervenção. Ou seja, o que entra novo entra completo, e o que sobra é exclusivamente
passivo histórico — quase todo terminal com a flag já ligada, documento que não muda mais.

### 🔴 Consequência prática — leia antes de usar qualquer relatório por CC

**Relatórios de gasto por centro de custo só são confiáveis a partir de 20/08/2026.**
O **primeiro semestre de 2026 aparecerá vazio ou incompleto** em qualquer visão que leia
`compras_pedidos_itens_rateio`, porque para aqueles pedidos a tabela nunca foi populada e
não será. Quem montar relatório, dashboard ou fechamento a partir dessa base precisa
declarar o corte — um total histórico "baixo" ali **não é queda de gasto, é ausência de
dado**. Vale também o alerta do `AJUSTE-RS-C3` (C3-E): `compras_pedidos.centro_custo`
**não** substitui o rateio, é a primeira fatia do primeiro rateio.

### Se um dia a comparação histórica for necessária

A porta continua aberta e é barata — por isso a descrição fica registrada:

- **Trilha 1 — jsonb → relacional (a que interessa).** Os **1.164** pedidos da geração
  antiga têm `classe_rateio` e `itens` cheios no jsonb, já no formato de dois níveis que a
  tabela relacional precisa. **Zero chamadas ao Alvo**, migração SQL pura, roda em minutos,
  sem risco de rate limit. Cobre a maior parte do passivo.
- **Trilha 2 — Load → tudo.** Só a geração nova com jsonb vazio; exige chamada ao gateway,
  em lotes de ~25 com pausa. É a cara, e é a menor.

Referência do desenho: `AJUSTE-RS-C3.1-C`. **Nada disso está agendado.**

---

## 7. Pendências registradas

1. **RPC transacional derruba parcelas junto com rateio.** No 0004602, a falha do rateio
   impediu também as 6 parcelas. Talvez valha separar em duas chamadas — uma classe mal
   formada não deveria bloquear as parcelas. Card próprio.
2. **Pedido cronicamente inválido reentra todo ciclo** (agora com `detalhes_carregados =
   false` na falha). Visível pelo mesmo número repetindo em `detalhes`. Remédio: contador
   de tentativas. Mesma família do item 3.
3. ~~**`0004370`**~~ (02/07, R$ 100, Encerrado): único terminal sem detalhe dentro dos 180
   dias; padrão de Load 404 permanente, reentra para sempre. **NÃO SERÁ TRATADA — ver §6.**
   Fica o registro do padrão, útil se ele aparecer em volume.
4. ~~**57 terminais sem detalhe**~~ (56 fora do corte de 180 dias + o `0004370`).
   **NÃO SERÁ TRATADA — ver §6.** Dependia do Bloco E, que foi dispensado.
5. **8 pedidos com `status` NULL** — entram na fila desde o C2; origem desconhecida.
6. **Nome do CC na tela** — detalhe da requisição mostra só o código. Cosmético, Bloco F;
   depende do espelho `cost_centers` atualizado (F3).
7. **`funcionario_alvo_codigo` do Ryan** — banco `0000063` × roster `0000153`.
8. **`IntegradoFinanceiro`** — 0004705 voltou `"Sim"` e 0004706 `"Não"`, pedidos quase
   idênticos, campo não enviado pelo Hub. Entender o critério do Alvo.
9. **`PedCompUserFieldsObject`** — o Alvo devolve preenchido pelo workflow dele; testar se
   preserva campo livre gravado pelo Hub (necessário para a idempotência do card D3).
10. **Job `nfe` parado desde 11/06/2026** — fora do escopo, mas suspeito.
11. **Pedidos de teste 0004705 e 0004706** — cancelar/excluir no Alvo se ainda não foi feito.
12. **jsonb `classe_rateio`**: o cron grava **cabeçalho-primeiro, item como fallback**,
    igual ao open-load — contraria o C3-A na letra, mas mantém um formato único no jsonb
    (duas telas o leem e o open-load também escreve). **A tabela relacional usa o item, que
    é o que o C3-A exige.** Decisão ratificada em 20/08.

---

## 8. Regras que se mostraram valiosas

- **"Rodar Agora"** na tela de Cron Requisições é seguro e acelera validação (7 ciclos em
  ~10 minutos, zero erros).
- **Antes de concluir corrupção, provar contra o Alvo.** O susto dos 116 pedidos virou
  alarme falso com um Load e um teste de soma dos componentes.
- **Âncora com valores em colunas > âncora com hash.** O hash diz *que* mudou; as colunas
  dizem *o quê*. Diferença entre 10 segundos e uma investigação inteira.
- **Aplicar o SQL na ordem certa:** colunas antes da RPC. O Postgres cria função plpgsql
  que referencia coluna inexistente **sem reclamar** — o erro só aparece na primeira
  execução, em massa.
- **O terminal do Windows trunca saída larga.** Peça SQL em arquivo, ou um comando por
  bloco sem molduras.
- **A Seção de rollback de qualquer SQL não deve ser executada** — é só para guardar.
- **Número sem data não vale.** Ver §2 item 8: as contagens deste módulo mudam a cada
  ciclo do cron; citar sem remedir induz a decisão errada de dimensionamento.

---

## 9. Se esta frente for retomada — o que sobrou do plano v1.1

Catálogo do que **nunca foi executado**, para não obrigar ninguém a reler o plano inteiro.
Nada aqui está agendado; a frente está encerrada (§1).

**Bloco D — endurecimento da criação** (o envio Hub → Alvo, que o C3 não tocou):
- **D1** — invariantes no `enviarPedido` e erros que gritam em vez de falhar em silêncio.
- **D2** — anexos na retomada (pedido reenviado perde os arquivos já anexados).
- **D3** — idempotência do envio: uuid do Hub em campo livre de `PedCompUserFieldsObject` +
  reconciliação antes de qualquer retry. **Depende da pendência §7.9** — falta provar que o
  Alvo preserva o campo livre.
- **D4** — normalização de parcelas e rateio no payload de envio (residual também no rateio
  interno do item; só se manifesta com múltiplos itens).
- **D5** — limite de 255 caracteres na digitação.

**Bloco F — dívidas** (F0 já foi feito, ver §1):
- **F1** — escrita direta em Notas de Serviço (`MovEstq/SaveMultiPart` a partir do
  navegador) → migrar para rota no proxy. Era o **P0 da migração**.
- **F2** — ApiTester admin-only via passthrough.
- **F3** — `cost_centers`: fase 1 passthrough (`CentroCusto/GetRegistros` já está na
  whitelist), fase 2 Edge + cron + `sync_runs` + alerta de idade. É pré-requisito do
  item §7.6 (nome do CC na tela).
- **F4** — migração por etapas dos demais consumidores diretos do Alvo: NF Entrada →
  Contas a Pagar → Sales.
- **F5** — descomissionar credenciais do `localStorage`: remover campos de senha e
  `alvoService.ts`, limpar chaves locais e **rotacionar a senha do ERP**. Só depois que o
  inventário zerar — inclui download de anexos, que ainda não tem rota.
- **F6** — higiene: aposentar as 5 Edges fósseis, remover `SYNC_TEST.md`, KPIs no bloco
  "No gate" (recriando a RPC a partir do `pg_get_functiondef`, nunca da especificação).

**Bloco E** — dispensado por decisão, ver §6. Não retomar sem reler aquela seção.

**A2** (validação com a operação) não tem card próprio em aberto: a validação prevista
— operadora sem credenciais locais abrindo pedidos — foi cumprida e está registrada na
linha do **A1**, §1.

---

*Atualizar este arquivo ao fim de cada card concluído.*
