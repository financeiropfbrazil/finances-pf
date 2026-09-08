# DISCOVERY — Pedidos de Compra: criação, conexão com o Alvo e sincronização

> Investigação read-only de **08/09/2026**, 11h30–12h55 BRT. Projeto `hbtggrbauguukewiknew`.
> Nenhuma escrita no banco, nenhuma alteração de código, nenhum pedido de teste criado,
> sem push e sem deploy. Todo achado tem query+resultado ou `arquivo:linha`.

## Resposta curta

**A sincronização é confiável. A criação está quebrada.** O boicote tem base — mas a causa não é
o sync, é o caminho de criação: hoje **3 de 3 tentativas falharam (100%)**, e uma delas
**duplicou um pedido de R$ 7.548 no ERP**. O defeito entrou com a implantação multi-CC de
07/09 e ninguém tinha usado a criação desde então.

O padrão que você mandou procurar **se repete em pedidos**, mas por outro mecanismo: não é
trigger de anexo, é o trigger de proteção das **requisições** recusando a escrita que o wizard
de pedidos faz nelas. E o desfecho para o usuário é pior que nas requisições, porque em pedidos
o tratamento de erro **apaga o número do documento** e a tela **convida a tentar de novo**.

| | Requisições (incidentes de hoje) | Pedidos (este discovery) |
|---|---|---|
| Trigger equivalente ao ANEXO_CONGELADO | sim, corrigido hoje | **não existe** — zero triggers nas 8 tabelas |
| Auditoria registra a falha | **não** (para em `envio_reivindicado`) | **sim** (`envio_tentado` → `envio_falha`) |
| Chave única sujeita a reciclagem | sim | **sim** — `UNIQUE (codigo_empresa_filial, numero)` |
| Retry duplica no ERP | bloqueado hoje pelo texto novo | **não bloqueado — duplicou hoje** |

---

# (a) O QUE ESTÁ QUEBRADO AGORA

## A1. Criar pedido a partir de requisição falha sempre, desde 07/09 15h42

**Impacto: máximo.** É o fluxo principal do módulo — 73% dos pedidos criados no Hub nos últimos
30 dias vêm de requisição (59 de 81). Hoje foi o primeiro dia de uso pós-implantação: **3 de 3
tentativas falharam**.

O wizard, depois de o ERP criar o pedido, grava `numero_pedido_compra_alvo` na requisição com um
**`upsert`** (`src/services/pedidosService.ts:2076-2092`):

```js
await supabase.from("compras_requisicoes").upsert(
  { id: reqRow.id, status: reqRow.status, /* ... */ numero_pedido_compra_alvo: numeroAlvo },
  { onConflict: "id" },
);
```

`upsert` do PostgREST gera `INSERT ... ON CONFLICT DO UPDATE`, e o PostgreSQL dispara os triggers
**BEFORE INSERT** antes de detectar o conflito. Cai no ramo INSERT de `fn_req_protege_aprovacao`
(`SQL-INTEGRAL.sql:363-368`), cuja primeira condição é:

```sql
new.status is distinct from 'rascunho'
  and not exists (select 1 from compras_requisicoes r
                   where r.id = new.id and r.numero_alvo is not null
                     and r.numero_alvo = new.numero_alvo and r.status not in (...))
```

O payload manda `status` da requisição real (`sincronizada` / `convertida_pedido`) e **não manda
`numero_alvo`** — então `new.numero_alvo` é NULL, o `not exists` dá TRUE, as duas partes batem e
o trigger levanta `PROTEGIDO_APROVACAO`. A função tem uma cláusula que existe justamente para
tolerar upsert de requisição já numerada, mas ela exige `numero_alvo` no payload; o chamador não
o envia. É um contrato implícito quebrado entre função e chamador.

**Evidência (banco):**

```sql
select p.numero, p.status_local, r.status as req_status, r.numero_alvo
  from compras_pedidos p
  left join compras_requisicoes r on r.numero_alvo = p.numero_req_comp
 where p.erro_envio is not null;
```
| pedido | status_local | req_status | req.numero_alvo |
|---|---|---|---|
| RASCUNHO-a28ae319 | erro_envio | **sincronizada** | 0001481 |
| 0004865 | erro_envio | **convertida_pedido** | 0001473 |

Ambas com `status ≠ 'rascunho'` → condição satisfeita → exceção. E `numero_pedido_compra_alvo`
ficou **null** nas duas: a requisição não sabe que virou pedido.

**Existe o mecanismo certo e não está sendo usado:** `vincular_pedido_requisicao(p_pedido_id,
p_requisicao_id, p_origem)` é `SECURITY DEFINER` com EXECUTE para `authenticated` — dentro dela
`current_user` é `postgres`, e o trigger (que só age sobre `authenticated`/`anon`) não dispara.

**Por que só estourou hoje:** entre 05/09 e 07/09 ninguém criou pedido no Hub. A implantação foi
07/09 15h42. O primeiro uso foi hoje.

```
dia    criados_no_hub  erro
11/08–04/09 (16 dias)      81     0
08/09                       2     2   ← 100%
```

## A2. O tratamento de erro APAGA o número do pedido criado no ERP

**Impacto: alto.** É o que transforma uma falha recuperável em documento fantasma.

`marcarPedidoComErro` (`src/services/pedidosService.ts:1628-1660`) começa com

```js
let numero = `RASCUNHO-${pedidoId.substring(0, 8)}`;
if (modoEdicao) { /* só aqui lê o número real do banco */ numero = pedidoAtual.numero || numero; }
// ... upsert({ id, numero, status_local: "erro_envio", erro_envio })
```

Em **criação nova** (`modoEdicao = false`) ele nunca lê o banco e grava `RASCUNHO-<id>` por cima
do número que o passo anterior (`:1980-1996`) já havia gravado com a resposta do ERP. O Hub perde
a única referência ao documento real.

**Evidência:** o pedido `0004867` **existe no Alvo** (a própria mensagem de erro o nomeia) e
**não existe no Hub** — a linha guardou `RASCUNHO-a28ae319`:

```sql
select numero, status_local, numero_req_comp from compras_pedidos
 where numero in ('0004866','0004867') or numero like 'RASCUNHO%';
-- 0004866            | sincronizado | (null)   ← descoberto pelo sync
-- RASCUNHO-a28ae319  | erro_envio   | 0001481  ← o 0004867 sumiu do Hub
```

Em modo edição o número sobrevive — por isso `0004865` manteve o dele. A inconsistência entre os
dois casos é acidente do `if`, não desenho.

## A3. A tela mostra o erro cru e convida ao retry — e o retry duplica no ERP

**Impacto: alto — é o que gera o boicote.** Aconteceu hoje, medido.

`src/pages/SuprimentosPedidos.tsx:1004-1009` renderiza `ped.erro_envio.message` literalmente
(dentro de um `line-clamp-2`, que ainda trunca em duas linhas). O usuário lê:

> `Erro ao vincular o pedido 0004867 à requisição: PROTEGIDO_APROVACAO`

Não há uma palavra dizendo que **o pedido foi criado no ERP**. E logo abaixo,
`SuprimentosPedidos.tsx:541` e `:906` marcam o pedido como editável
(`isEditavel = status_local === 'rascunho' || 'erro_envio'`), oferecendo o botão que leva a nova
tentativa. Não existe, em nenhum lugar do módulo de pedidos, aviso de "pode ter sido criado / não
reenvie" — `grep` por `resposta_200_sem_numero|não reenvie|duplic` nas duas telas retorna só um
comentário interno.

**Evidência da duplicata (trilha de auditoria de uma única linha do Hub):**

| hora | evento | mensagem |
|---|---|---|
| 10:06:53 | envio_tentado | |
| 10:07:01 | envio_falha | Erro ao vincular o pedido **0004864** …: PROTEGIDO_APROVACAO |
| 10:07:40 | **editado_hub** | (a pessoa tentou de novo) |
| 10:07:43 | envio_tentado | |
| 10:07:51 | envio_falha | Erro ao vincular o pedido **0004865** …: PROTEGIDO_APROVACAO |

Dois documentos no ERP para uma intenção de compra. Ambos existem no Hub hoje, com o mesmo valor
e o mesmo fornecedor:

```sql
select numero, valor_total, nome_entidade, criado_no_hub from compras_pedidos
 where numero in ('0004864','0004865');
-- 0004864 | 7548 | THIAGO RUITHER VILAS BOAS | false  ← descoberto pelo sync às 10:30
-- 0004865 | 7548 | THIAGO RUITHER VILAS BOAS | true
```

**R$ 7.548,00 duplicados no ERP.** `0004864` é a duplicata órfã.

## A4. Rateio com CC repetido: o Hub aceita, o Alvo recusa e queima número

**Impacto: alto quando ocorre, e continua aberto.** É o card D4, documentado em
`docs/D4-EVIDENCIA-UQ-PK.md` desde 26/08 — e a validação **ainda não existe**.

A validação de rateio (`src/services/pedidosService.ts:186-227`) exige classe preenchida,
percentual > 0, soma de CCs = 100% e soma de classes = 100%. **Não há nenhuma checagem de
`codigo_centro_ctrl` repetido dentro da mesma classe** — dois CCs iguais de 50% somam 100% e
passam. O Alvo rejeita com violação de chave e, a cada tentativa, **consome um número**:

| tentativa | número queimado |
|---|---|
| 13:50:22 … 13:56:06 | 0004770, 0004771, 0004772, 0004773, 0004774, 0004775 |
| 14:21:39 | 0004781 — sucesso |

Seis números em seis minutos, todos com a mesma mensagem:
`Friendly_Message_UQ_PK, 1.01 - 00047XX - 001.014.001 - 1 - 18.05 - 00010.00004.00003`
(filial · número · produto · sequência · classe · centro de custo).

**Nenhum dos seis existe no Hub hoje** (`select … where numero between '0004770' and '0004776'`
devolve só o `0004776`, de outro fornecedor). Duas leituras possíveis, e eu não consigo separá-las
daqui: ou o Alvo recusou o Insert consumindo apenas a numeração, ou criou e alguém excluiu depois.
Ver "o que só você pode responder".

---

# (b) FRÁGIL, MAS FUNCIONA

## B1. Zero triggers e zero proteção nas tabelas de pedidos

As 8 tabelas `compras_pedidos*` têm **nenhum trigger**:

```sql
select c.relname, (select count(*) from pg_trigger t
                    where t.tgrelid=c.oid and not t.tgisinternal) as triggers
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname like 'compras_pedidos%';
-- compras_pedidos 0 · _anchor 0 · _arquivos 0 · _auditoria 0
-- _emails_log 0 · _itens 0 · _itens_rateio 0 · _parcelas 0
```

**Consequência boa:** o padrão ANEXO_CONGELADO **não existe aqui** — não há trigger de
congelamento nem de `updated_at` competindo por ordem alfabética. Você não precisa procurar o
equivalente: ele não existe.

**Consequência ruim:** não há congelamento, não há proteção de conteúdo pós-envio, não há guarda
de permissão no banco. Um pedido já enviado ao ERP pode ser reescrito por qualquer caminho
autenticado que o RLS permita. Hoje isso não produziu dano medível, mas é assimetria grande em
relação a requisições — e é o tipo de coisa que só aparece quando alguém usa.

## B2. A chave única de pedidos tem o mesmo risco de reciclagem de número

`compras_pedidos_empresa_numero_unique = UNIQUE (codigo_empresa_filial, numero)` — mesma forma da
chave que travou a requisição 0001480. E existem **6 pedidos em `excluido_alvo`** segurando
números de documentos que não existem mais no ERP. Se o Alvo reatribuir um desses números, o
`upsert` do envio colide na constraint, cai no handler do A2 e o número é perdido.

Hoje **não há dano**: `select count(*) from (select codigo_empresa_filial, numero from
compras_pedidos group by 1,2 having count(*)>1)` → **0**. É risco latente, não incidente.

## B3. `status_local` nunca migra de `enviado_alvo` para `sincronizado`

**140 pedidos** criados no Hub estão em `enviado_alvo`, o mais antigo há **85 dias**, e
**todos os 140 já têm `detalhes_carregados`**. Só 1 pedido criado no Hub está `sincronizado` —
e é de 25/05. O dado está correto e completo; o rótulo é que nunca conclui. Para quem olha a
lista, o pedido parece eternamente "em trânsito". Não sei se é intencional (ver perguntas).

## B4. O detalhe do pedido leva ~18 h para carregar

Medido sobre os 149 pedidos descobertos pelo sync nos últimos 30 dias:

| métrica | valor |
|---|---|
| mediana até aparecer no Hub | **40,8 min** |
| p90 até aparecer | 871 min (14,5 h) |
| máximo | 3.780 min (63 h — fim de semana) |
| % que ganham detalhe | **96,6%** |
| mediana até o detalhe carregar | **1.080 min (18 h)** |

Aparecer em ~40 min é coerente com um cron de hora em hora. Mas o pedido fica ~18 h **sem itens e
sem rateio** na tela. Parte da percepção de "não é confiável" mora aqui: o usuário vê o pedido
incompleto e conclui que o sync falhou, quando ele só ainda não chegou naquele pedido.

## B5. Em pedidos, a falha É registrada (ao contrário de requisições)

O buraco que você mandou procurar **não existe aqui**. O caminho de erro grava
`envio_tentado` → `envio_falha` em `compras_pedidos_auditoria`, com `mensagem_erro`, e preenche
`erro_envio` no pedido (`pedidosService.ts:2117-2137`). Foi graças a isso que consegui reconstruir
a duplicata de hoje minuto a minuto. **A instrumentação de pedidos é melhor que a de requisições.**

---

# (c) RUÍDO / PERCEPÇÃO — o que NÃO está quebrado

## C1. O cron `bicephalous` é confiável para pedidos

90 dias, ~686 ciclos:

| semana | ciclos | ciclos com erro | órfãos |
|---|---|---|---|
| 14 semanas | 34–62 por semana | **0 a 2** (0–2%) | **3 no total** |

Os dois únicos picos de volume de erro (152 em 24/08 e 154 em 07/09) são **indisponibilidade do
Alvo/gateway** — erros de leitura (`Falha na autenticação do Alvo`, HTTP 502 em `/ped-comp/list`),
não defeito do sync, e não afetam Insert. Duração média ~50 s, máximo 131 s. **Se alguém disser
que "o sync perde pedido", os números não sustentam.**

## C2. Anexos de pedido funcionam

100 anexos, **100 com `numero_alvo_ao_enviar` preenchido**, 92 pedidos distintos, 62 criados nos
últimos 30 dias. Zero pendências. A tabela tem `updated_at` mas nenhum trigger — o problema das
requisições não tem contraparte aqui.

## C3. Parte das falhas históricas é validação legítima do ERP

Das 15 falhas dos últimos 30 dias, 5 são recusas corretas e acionáveis: 3× "O Produto
`001.012.004` está desativado. Operação não permitida" e 3× "Validade final é menor que a data
atual". O Alvo está certo; a pessoa precisa corrigir o dado. Mensagens claras.

## Taxa de falha real (30 dias)

```sql
select evento, count(*) from compras_pedidos_auditoria
 where evento in ('envio_sucesso','envio_falha') and created_at >= now() - interval '30 days'
 group by 1;
-- envio_sucesso 81 · envio_falha 15
```

**15,6% das tentativas falharam** — mas a distribuição importa mais que a média:

| causa | falhas | natureza |
|---|---|---|
| `Friendly_Message_UQ_PK` (26/08, um episódio) | 6 | A4 — defeito do Hub |
| `PROTEGIDO_APROVACAO` (08/09) | 3 | A1 — defeito novo |
| Produto desativado | 3 | validação legítima |
| Validade final | 3 | validação legítima |

Ou seja: **9 das 15 falhas são defeito do Hub, e concentradas em dois episódios**. Fora deles, 16
dias úteis seguidos com 81 pedidos e zero erros. O módulo não falha "sempre" — ele falha em
rajadas, e cada rajada custa números do ERP e confiança.

---

# O que só você pode responder

1. **Os seis números de 26/08 (0004770–0004775): existem documentos no ERP?** Se existirem, são
   seis pedidos fantasmas a cancelar. Se não, o Alvo apenas consumiu numeração. Nenhuma
   informação no Hub separa os dois casos.
2. **`0004864` é duplicata a cancelar no ERP?** É idêntico ao `0004865` em valor e fornecedor, e
   nasceu do retry das 10:07. Cancelar é decisão sua, não minha.
3. **`0004867` — como reconciliar?** Existe no Alvo, não existe no Hub, e o ciclo das 13:00 vai
   descobri-lo como pedido avulso (criado_no_hub=false), sem vínculo com a requisição 0001481 e
   sem o rascunho `RASCUNHO-a28ae319`, que ficará órfão.
4. **`enviado_alvo` que nunca vira `sincronizado` é intencional?** Se for rótulo de "nasceu aqui",
   tudo bem; se for ciclo de vida incompleto, são 140 pedidos parados há até 85 dias.
5. **A vinculação deve passar a usar `vincular_pedido_requisicao`?** A RPC existe e resolve o A1,
   mas eu não li a semântica dela a fundo (auditoria, idempotência, o que faz com o status da
   requisição) — isso precisa de revisão antes de virar correção.

# Ordem de correção recomendada

| # | O quê | Por quê nesta ordem | Onde |
|---|---|---|---|
| 1 | **Destravar A1** — trocar o `upsert` pela RPC `vincular_pedido_requisicao`, ou incluir `numero_alvo` no payload | O módulo está 100% quebrado no fluxo principal. Tudo o mais é secundário enquanto ninguém consegue criar pedido | `pedidosService.ts:2076` |
| 2 | **Parar a perda de número (A2)** — ler o número atual do banco sempre, não só em `modoEdicao` | Enquanto isso existir, toda falha pós-Insert produz documento fantasma. Corrigir antes de qualquer coisa que gere nova tentativa | `pedidosService.ts:1637-1648` |
| 3 | **Mensagem + travar retry (A3)** — quando o erro ocorre depois do Insert, dizer que o pedido pode existir no ERP e **não** oferecer reenvio | É o que converte um defeito em duplicata de R$ 7,5 mil. Mesmo padrão do texto que corrigimos hoje em requisições | `SuprimentosPedidos.tsx:1004`, `:541`, `:906` |
| 4 | **Validar CC repetido (A4/D4)** — recusar ou consolidar antes de enviar | Defeito conhecido desde 26/08, ainda aberto, e cada ocorrência queima números do ERP | `pedidosService.ts:186-227` |
| 5 | **Reconciliar os casos abertos** — 0004865, 0004867, `RASCUNHO-a28ae319` e a duplicata 0004864 | Depois de 1–3, senão a reconciliação compete com novas falhas | SQL dedicado, com o mesmo cuidado dos casos de hoje |
| 6 | **Ciclo de vida do `status_local` (B3)** e **latência do detalhe (B4)** | Não bloqueiam ninguém; são percepção e higiene | a definir |

**Nada disso foi implementado nesta sessão, por decisão sua.** Os itens 1 a 4 são mudanças de
código e devem passar pelo ciclo de revisão — os dois incidentes de hoje vieram exatamente de
mudança publicada sem ele.
