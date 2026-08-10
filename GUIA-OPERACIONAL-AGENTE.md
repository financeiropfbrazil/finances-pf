# GUIA-OPERACIONAL-AGENTE.md
## Como achar as coisas sozinho no Financial Hub

**P&F Brasil · Controladoria · 10/08/2026**

> Este documento existe porque perguntas do tipo *"como sei se o produto controla lote?"* têm
> resposta no próprio ambiente. Antes de perguntar ao Pedro, **procure aqui e depois no banco**.
> Perguntar é caro: cada ida e volta custa minutos e tira o Pedro do que ele estava fazendo.
>
> **A regra:** pergunte só o que é **decisão** (o que ele quer que aconteça) ou **medição no
> Alvo** (que exige o navegador dele). Tudo que é **fato do banco ou do código, procure.**

---

## 1. O que você alcança sozinho, e como

| Precisa saber | Onde | Como |
|---|---|---|
| Schema, dados, RLS, RPCs, grants | **Supabase, via MCP** | read-only, direto |
| Código, histórico, planos | **repo `finances-pf`** | `git` e leitura de arquivo |
| Contrato dos endpoints do Alvo | **`Endpoints_Alvo.md`** + `PLANO-OP.md` §6, §10 | leitura |
| Decisões e armadilhas já mapeadas | **`PLANO-OP.md`** §6.3-N, §7 (diário), §8 (backlog) | leitura |
| **Chamada nova ao Alvo** | ⚠ só pelo Pedro | ver §4 |
| **Aplicar SQL** | ⚠ só pelo Pedro | você escreve `sql/*.sql` |
| **Deploy / Publish** | ⚠ só pelo Pedro | — |

⚠ **O MCP do Supabase esteve SEM `read_only=true` até 09/08/2026.** Verificado nessa data:
`read_only=true` na URL, e o agente lendo 690 RMs / 1.820 pedidos, batendo com o SQL Editor.
Um controle que já falhou uma vez merece constar.

---

## 2. Perguntas frequentes que o banco responde

### 2.1 O produto controla lote?

🟢 **`stock_products.controla_lote`** — não precisa chamar o Alvo.

```sql
select codigo_produto, controla_lote, unidade_medida
from stock_products where codigo_produto = '001.003.00059';
```

Medido em 10/08/2026: **258 produtos `true`, 2.568 `false`**. Conferido contra quatro espécimes
validados em campo (`001.003.00032`, `001.003.00047`, `001.003.00059` = true;
`001.004.00021` = false). **A fonte é confiável.**

A tabela tem ainda `permite_lote_vencido`, `lote_verificado_em` e `gera_num_lote`.

⚠ Por que isso importa: o `ControlaLote` **não vem** no `ReqMat/Load` (§6.3-N). Aparece só na
resposta do atendimento e do `Relacionar`. O `stock_products` resolve sem ida ao ERP.

🟢 **Molde pronto no repo:** `src/components/compras/LancarNfeItensTable.tsx` lê `controla_lote`
(l. 214), carrega em `it.controlaLote` (l. 691), abre o painel de lote só para item com a flag
(l. 885) e bloqueia o envio enquanto houver lote pendente (l. 730).

### 2.2 Quais lotes existem e com que saldo?

⚠ **Só o Alvo sabe** — o Hub não espelha saldo por lote. Dois caminhos:

- `CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz` (§10.30/§10.31) — lotes com validade e saldo;
- `Produto/FiltrarSaldoProduto` — saldo por produto/local, **não por lote**, mas devolve
  `ProdutoControlaLote` explicitamente.

O que o Hub tem é **histórico de lotes já consumidos**, em `op_reqmat_lotes` — útil para saber
quais lotes já saíram, não quanto resta.

🟢 **Medido em 09/08/2026 (RM `0000002278`, item UNID):** a lista de lotes **respeita a unidade
do item** (`CodigoProdUnidMed` e `PosicaoProdUnidMed` do lote = os do item) e vem **ordenada por
validade**. Fecha a §5.4 do `PLANO-RM-ATENDIMENTO.md` para o caso de unidade única.

### 2.3 Qual o de-para do usuário para o funcionário do Alvo?

```sql
select email, full_name, alvo_usuario, funcionario_alvo_codigo
from profiles where is_active and funcionario_alvo_codigo is not null;
```

⚠ **`hub_user_roles.user_id` casa com `profiles.user_id`, NÃO com `profiles.id`.** Consulta com
o join errado devolve "zero papéis para todos" e parece RBAC não usado.

Cobertura em 08/08: **47 de 52** têm `funcionario_alvo_codigo`; só 5 têm `alvo_usuario`.

O catálogo de funcionários do Alvo está em **`funcionarios_alvo_cache`** (código, nome, status,
centro de custo padrão). Filtre por `status = 'Trabalhando'` — 109 em 09/08/2026.

### 2.4 Quem pode o quê?

```sql
-- permissões de um papel
select r.codigo, p.codigo from hub_roles r
join hub_role_permissions rp on rp.role_id = r.id
join hub_permissions p on p.id = rp.permission_id
where r.modulo = 'producao' order by 1,2;

-- teste real de permissão
select public.user_has_permission(p.user_id, 'producao.rm.atender')
from profiles p where p.email = 'maria.santos@pfbrazil.com';
```

⚠ **`profiles.is_admin = true` dá bypass total.** O Pedro é o **único** de 52 ⇒ **erro de
permissão não aparece para ele.** Toda tela nova precisa de teste com usuário sem a flag.

### 2.5 Centro de custo

🔴 **Use `cost_centers`, NÃO `rh_centros_custo`.** As duas existem e **têm dados
contraditórios**: a `rh_centros_custo` chama `00001.00005.00002` de "PRODUCAO PERICARDIO" e o
marca **ativo**; a `cost_centers` chama o mesmo código de "PRODUCAO VALVULAS" e o marca
**inativo**.

⚠ Cinco centros históricos de produção estão `is_active = false` — filtrar ativos some com eles,
e é o correto, mas RMs antigas os referenciam.

### 2.6 O estado do espelho e dos syncs

```sql
select started_at, triggered_by, duracao_ms, observacao
from sync_runs where job_type = 'reqmat' order by started_at desc limit 5;

select jobid, jobname, schedule, active from cron.job order by jobid;
```

O `sync-reqmat` roda `25 12,15,18,21 * * 1-5` (UTC) = 09h25, 12h25, 15h25 e 18h25 BRT, dias
úteis. **Janela segura para DDL compartilhado: `:05`, `:20`, `:35`, `:50`** — os outros minutos
têm cron.

### 2.7 Quem chama uma RPC / quais grants ela tem

```sql
select proname, prosecdef, pg_get_function_identity_arguments(oid) as args,
       array_to_string(proacl, ' | ') as grants
from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
where proname like 'op_%' order by proname;
```

🔴 **REGRA DO PROJETO:** o Supabase tem `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO anon`
para funções em `public`. ⇒ **Toda função nova nasce aberta a `anon`**, e
`revoke … from public` **não alcança grant nominal**. Só
`revoke execute on function public.nome(assinatura completa) from anon;` funciona.
**Sempre incluir, e sempre verificar depois.**

---

## 3. Onde está escrito o que já se sabe

| Documento | O que tem |
|---|---|
| **`PLANO-OP.md`** | Fonte de verdade do módulo. §11.3 é o ponto de retomada **vigente** (§11, §11.1, §11.2 são HISTÓRICO) |
| **`PLANO-OP.md` §6.3-N** | **Catálogo de armadilhas do Alvo.** Leia antes de qualquer integração |
| **`PLANO-OP.md` §7** | Diário — por que cada decisão foi tomada |
| **`PLANO-OP.md` §8** | Backlog, BL-1 a BL-30 |
| **`PLANO-OP.md` §10.16 a §10.31** | Fase 2 e 4: receitas medidas de criação, atendimento e lote |
| **`Endpoints_Alvo.md`** | Contratos, payloads e exemplos de todos os endpoints já usados |
| **`PLANO-RM-ATENDIMENTO.md`** | Plano executável da fase atual |

**Antes de propor qualquer coisa, procure no §7 e no §8** — a chance de o assunto já ter sido
decidido, medido ou registrado como dívida é alta.

---

## 4. Como o Pedro executa chamadas ao Alvo

Não há CLI nem acesso direto. O Alvo só é alcançável pelo **`erp-proxy`**, que exige JWT de
usuário do Supabase. O caminho é o **console do navegador**, na aba do Hub **logado**
(`finance-pf.lovable.app`, F12 → Console).

**Bloco de setup** — cola-se antes de qualquer chamada:

```js
var key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
var jwt = (() => { const s = JSON.parse(localStorage.getItem(key)); return s.access_token ?? s?.currentSession?.access_token; })();

async function alvo(endpoint, method = 'GET', payload) {
  const r = await fetch('https://erp-proxy.onrender.com/alvo/passthrough', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, method, payload }),
  });
  return r.json();
}
```

Depois: `await alvo('ReqMat/Load?numero=0000002283&loadChild=All', 'GET')`.

### 4.1 Como pedir um teste

**Entregue o snippet pronto para colar, com o `console.log` do que interessa.** Nunca peça para
"inspecionar o JSON" — o console trunca e o Pedro precisa expandir à mão.

🔴 **E SEMPRE logue o CORPO em caso de erro, nunca só o status.** Um `417` sem corpo não
distingue `BrokenRulesException` (regra de negócio, com nome) de `NullReferenceException`
(payload incompleto) — e a §4.2 inteira depende dessa distinção. Snippet que loga só o status
desperdiça a ida ao console. Aprendido em 09/08/2026, no M1 da AT-4.

✅ Assim:

```js
var r = await alvo('ReqMat/Load?numero=0000002283&loadChild=All', 'GET');
var it = r.data?.ItemReqMatChildList?.[0];
console.log('status:', r.status, '| ControlaLote:', it?.ControlaLote, '| corpo:', r.data);
```

❌ Não assim: *"rode o Load e me diga o que tem no item"*.

### 4.2 O que dá errado, e o que significa

| Sintoma | Causa | Solução |
|---|---|---|
| `alvo is not defined` | a página recarregou | recolar o bloco de setup |
| **401** | JWT expirado (dura ~1h) | recarregar a página e recolar |
| **403** com corpo do proxy | endpoint fora da whitelist | pedir ao Pedro para acrescentar em `erp-proxy/src/routes/alvo.ts` |
| **404** com corpo ASP.NET | **o Alvo respondeu** — action inexistente ou parâmetro faltando | não é whitelist |
| **412** | registro não encontrado (ex.: RM excluída) | ⚠ o `/alvo/passthrough` repassa puro; o `/ped-comp` mascara como 404 |
| **417** + `BrokenRulesException` | regra de negócio, **com nome** | ler a mensagem |
| **417** + `NullReferenceException` | **payload incompleto** — o ERP não diz qual campo | ver §4.3 |
| **200 com corpo vazio ou de exceção** | 🔴 não é sucesso | ver §4.4 |

### 4.3 🔴 `NullReferenceException` = payload incompleto. Não adivinhe.

É a forma de falha mais silenciosa, porque parece bug do servidor. **Quatro tentativas foram
perdidas em 05/08 tentando completar payload por dedução.**

⇒ **A receita é capturar do Network**, não deduzir: o Pedro abre a tela do Alvo com F12 →
Preserve log → Fetch/XHR, executa a ação, e copia o payload que a tela monta.

⚠ **Ao pedir captura em tela de ESCRITA, mande fechar no X antes do OK.** No BL-29 a captura foi
até o fim e **atendeu 30 unidades de verdade** — material baixou do estoque sem intenção.

### 4.4 🔴 200 não é sucesso

Casos medidos:

- `FinalizarAtendimento` com payload vazio → **200 com objeto ReqMat em branco**;
- vários endpoints → 200 com envelope de exceção .NET no corpo.

⇒ **Sempre validar a âncora:** o campo-chave (`Numero`, geralmente) presente, não-nulo e
não-vazio. É o que o `analisarRespostaReqMat` faz, em quatro degraus.

### 4.5 A whitelist é case-sensitive

`reqMat/GetListForComponents` (minúsculo) e `ReqMat/Load` (maiúsculo) convivem, e a diferença é
**intencional e verificada em campo**. Não uniformizar.

⚠ **O gateway NÃO repete mais chamadas de escrita.** Até 09/08/2026 o `alvo-client.ts`
reautenticava e **repetia a chamada idêntica** em 401/403/409 — o que, no `FinalizarAtendimento`,
seria baixa em dobro. Corrigido com o `NAO_REPETIR`. ⚠ Mesmo assim, **erro no Finalizar não é
prova de que nada aconteceu**: consultar antes de oferecer retry continua obrigatório.

---

## 5. Armadilhas de dados do Alvo

Estão todas na §6.3-N do `PLANO-OP.md`. As que mais mordem:

| Campo | Armadilha |
|---|---|
| `item.BaixaEstoque` × `cabecalho.BaixouEstoque` | O do item é **regra** ("baixa quando atendido" — vem "Sim" mesmo em RM aberta); o do cabeçalho é **fato** |
| Campos `…2` | Quantidade na **segunda unidade de medida**, não duplicata |
| `"0001-01-01T00:00:00-02:00"` | `DateTime.MinValue` do .NET — **vira null** (o `toTimestamp` do `reqmatMapper` já trata) |
| `QuantidadeBruta` (lote) | Quantidade **original** do lote, não o total do atendimento. Nunca somar; usar `QuantidadeProdUnidMedPrincipal` |
| `CodigoFuncionarioAtendente` | **Não é quem atendeu** — é o padrão do local (`0000165`). A rastreabilidade real é `Entregou`/`Retirou`/`Conferiu` |
| `Sequencia` do item | 🔴 **O Alvo renumera na CRIAÇÃO.** Enviado `1`, devolvido `2` ⇒ **semear sempre do Load, nunca do payload** |
| Status do cabeçalho | Mente nos dois sentidos. **Conferência é por item** (a `2251` tem 2.850 pedidas, 2.918 atendidas **e** um item inteiro em aberto) |
| `TipoAtendimento` | `"Automático"` **nunca atende sozinho** e o campo **não existe na tela do Alvo**. RM criada por API nasce assim ⇒ o passo 2 (Update para `"Manual"`) é obrigatório |
| `ItemReqMatClasseRecdespChildList` | Classificação contábil. Vem do **cadastro do produto** (só 36 de 232 produtos têm) e aparece na resposta do `Relacionar` ⇒ **preservar, não montar do zero** |

⚠ **Retificação de 09/08/2026 — os campos de Entrega NÃO ficam vazios na operação.** A §2.4 do
plano da fase e a §6.3-N afirmavam isso. Medido no `raw` do espelho:
`Atendida Total` 315/381 (83%) e `Atendida Parcial` 112/122 (92%) com
`CodigoFuncionarioConferiu` preenchido. O padrão é estável: **Entregou == Conferiu** (o
almoxarife) e **Retirou** variando (quem foi buscar). A origem do erro é a família dos dois
eixos: o Hub **não espelhava** `Conferiu`, e quem olhou o espelho concluiu que a operação não
preenchia.

---

## 6. O que NÃO fazer

1. **Não aplicar SQL.** Escreva `sql/AT-x.sql`; o Pedro aplica no SQL Editor. `supabase db push`
   é proibido — o histórico de migrations não reflete o schema real.
2. **Não criar RM nem atender no Alvo** para testar. É produção: material baixa de verdade.
3. **Não fazer deploy nem Publish.**
4. **Não alterar prompt/plano já registrado.** Correções entram como card novo (§6.3-N: nada é
   apagado; retificação se apenda).
5. **Não abrir escrita a `authenticated`** em tabela ou RPC sem gate. É a classe do BL-5.
6. **Não confiar em "build limpo"** como evidência para Edge Functions — o `tsconfig` só inclui
   `src`. Use `tsc --noEmit --noResolve --skipLibCheck` no arquivo.
7. **Não perguntar o que o banco responde.** Meça.

---

## 7. O ritmo de trabalho

**Rodadas de duas partes.** Primeiro **LER E PROPOR** — ler o schema e o código reais, reportar o
que encontrou, propor em texto e **PARAR**. Depois, com o aval do Pedro, **CONSTRUIR**.

Isso não é formalidade: três vezes nesta semana a medição mudou a implementação **antes** de uma
linha ser escrita — o aviso de lote que viraria ruído em 597 itens, o `CodigoFuncionario` que não
é quem cria, e a inanição da fila do sync.

**Ao propor, diga o que NÃO sabe.** A seção "o que eu mediria antes de codificar" é a mais útil
do relatório.

**Reporte medições, não impressões.** "679 RMs, 0 erros, fila 520 → 501" vale mais que "está
funcionando bem".
