# MEDICAO-AT5.md
## Os quatro blocos para colar no console — uma ida só

**P&F Brasil · Controladoria · 10/08/2026 · Fase 4 do módulo OP, antes da AT-5**

> Cada bloco é **independente e numerado**. Cole um, leia a saída, cole o próximo.
> O bloco 0 é pré-requisito de todos os outros — se a página recarregar, recole o 0.
> A leitura de cada saída está na seção **"Como ler os resultados"**, no fim.

---

## Antes de começar

**Onde:** aba do Hub **logada** (`finance-pf.lovable.app`), F12 → Console.
**Quanto dura:** o JWT vale ~1 h. Se aparecer **401**, recarregue a página e recole o bloco 0.

### O que estes blocos fazem, e o que NÃO fazem

| Bloco | Endpoint / RPC | Escreve? |
|---|---|---|
| 1 e 2 | `ReqMat/Load` · `ListaCtrlLoteLocArmaz` · `RelacionarCtrlLoteLocArmaz` | **Não.** Nenhum toca estoque — foi assim que a AT-2 capturou o `Relacionar`, fechando no X |
| 3 | `op_rm_atender_iniciar` · `op_rm_atender_marcar` · `select` no livro | **Sim, no Hub** — cria linhas de teste em `op_rm_atendimentos`. **Nada no ERP** |

🔴 **Nenhum bloco chama `ReqMat/ValidarAtendimento` nem `ReqMat/FinalizarAtendimento`.**
🔴 **Nenhum bloco chama `op_rm_atender_concluir`** — ela semeia o espelho e só faz sentido depois
de um Finalizar real.

### ⚠ O bloco 3 pode travar uma RM por 15 minutos

O `op_rm_atender_iniciar` abre uma tentativa **em voo**, e o índice único parcial
`ux_op_rm_atend_em_voo` impede uma segunda na mesma RM. O roteiro fecha o que abre — mas
**se você parar no meio ou fechar a aba**, a RM `0000002053` fica travada até o expurgo
automático de 15 min. O **bloco 3.9** destrava na hora, se precisar.

### Espécimes, conferidos no espelho hoje às 08h44 BRT

| Papel | RM | Seq | Produto | Pedido / Atendido / Saldo | `GeraEmpenho` |
|---|---|---|---|---|---|
| **A** — o campo do `ClassInstance` | `0000002095` | 7 | `001.007.00009` HALF SCREW | **200 / 99 / 101** | Não |
| **B** — reserva e empenho | `0000002096` | 1 | `001.003.00087` KIT INSTRUMENTAL | **126 / 112 / 14** | **Sim** |
| **Smoke** — RM atendível | `0000002053` | — | (24 itens, 2 com saldo) | status `Atendida Parcial` | — |
| **Smoke** — RM fechada | `0000002283` | — | (a do BL-29) | status `Atendida Total` | — |

Os quatro números do espécime A — **200, 101, 104 e 5** — são todos distintos de propósito: seja
qual for o campo que o Alvo lê, a soma alocada diz **qual** sem ambiguidade.

---

## Bloco 0 · Setup

```js
// ── SETUP (§4 do GUIA-OPERACIONAL-AGENTE.md) ────────────────────────────────
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

// 🔴 O CORPO em caso de erro, nunca só o status: um 417 sem corpo não distingue
//    BrokenRulesException (regra de negócio, com nome) de NullReferenceException
//    (payload incompleto) — e o diagnóstico inteiro depende dessa distinção.
var ok    = r => r && r.ok !== false && Number(r.status) < 400;
var corpo = r => ok(r) ? '(ok)' : (r?.error || r?.data?.Message || r?.data?.ExceptionMessage || r?.data?.MessageDetail || r?.data || '(sem corpo)');

// Instante em horário de Brasília, no formato que o Alvo devolve.
var agora = () => new Date(Date.now() - 180 * 60000).toISOString().replace('Z', '-03:00');

// Envelope comum de ListaCtrlLoteLocArmaz e RelacionarCtrlLoteLocArmaz (§10.31).
// ⚠ `Origem: 7` é constante mágica do Alvo — sem ela a chamada não resolve.
var envLote = (numero, classInstance, extra) => {
  const t = agora();
  return { Origem: 7, Data: t, DataMovimentacao: t, EspecieDocumento: 'RM',
    NumeroDocumento: numero, SerieDocumento: '0', SequenciaDocumento: null,
    OperacaoLote: 'Saída', OperacaoRM: 'Retirada', CodigoTipoLanc: '',
    ClassInstance: classInstance, ...(extra || {}) };
};

console.log('setup ok · jwt:', jwt ? `${jwt.slice(0, 12)}…` : '🔴 NÃO ENCONTRADO — faça login');
```

---

## Bloco 1 · Espécime A — qual campo do `ClassInstance` o `Relacionar` lê

**RM `0000002095`, seq 7** (`001.007.00009`) — 200 pedidos, 99 já atendidos, 101 de saldo.
Responde a incógnita da §5 do `RETOMADA-AT-4.md` **e** dá de graça o `Object.keys()` da linha de
lote, que é o candidato ao `Saldo Calc` da §10.20.

```js
// ═══ BLOCO 1 — ESPÉCIME A · leitura pura, nada escreve ══════════════════════
var RM = '0000002095', SEQ = 7, ATENDER = 5;

var load = await alvo(`ReqMat/Load?numero=${RM}&loadChild=All`, 'GET');
console.log('1.0 Load status:', load.status, '| corpo:', corpo(load));

var item = (load.data?.ItemReqMatChildList || []).find(i => i.Sequencia === SEQ);
if (!item) {
  console.log('🔴 seq', SEQ, 'não encontrada. Sequências existentes:',
    (load.data?.ItemReqMatChildList || []).map(i => i.Sequencia).join(', '));
} else {
  var PEDIDO = Number(item.QuantidadeProdUnidMedPrincipal);
  var JA     = Number(item.QuantidadeAtendidaProdUnidMedPrincipal);
  var SALDO  = Number(item.QuantidadeSaldoProdUnidMedPrincipal);
  console.log('1.1 item:', item.CodigoProduto,
    '| pedido:', PEDIDO, '| já atendida:', JA, '| saldo:', SALDO,
    '| GeraEmpenho:', item.GeraEmpenho, '| GeraPendencia:', item.GeraPendencia,
    '| ControlaLote:', item.ControlaLote,
    '| unid:', item.CodigoProdUnidMed, 'pos', item.PosicaoProdUnidMed,
    '| local:', item.CodigoLocArmaz);

  // ── 1.2 A LISTA DE LOTES + as CHAVES que ninguém olhou ───────────────────
  var r1 = await alvo('CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz', 'POST', envLote(RM, item));
  var lista = r1.data?.ListaCtrlLoteLocArmaz || [];
  console.log('1.2 LISTA status:', r1.status, '| lotes:', lista.length, '| corpo:', corpo(r1));
  console.log('🔑 1.3 CHAVES da linha de lote:', lista[0] ? Object.keys(lista[0]).join(' · ') : '(lista vazia)');
  console.table(lista.map(l => ({
    lote: l.NumeroCtrlLote, validade: l.DataValidadeCtrlLote, fabricacao: l.DataFabricacao,
    saldo: l.QuantidadeSaldoProdUnidMedPrincipal, bruta: l.QuantidadeBruta,
    reserva: l.QuantidadeReservaLote, empenho: l.QuantidadeEmpenhoLote,
  })));

  // ── 1.4 O RELACIONAR, em três configurações ──────────────────────────────
  // ⚠ Leitura. O Relacionar devolve o item com a alocação montada; não grava.
  var soma = r => (r.data?.CtrlLoteItemReqMatChildList || [])
    .reduce((s, l) => s + Number(l.QuantidadeProdUnidMedPrincipal || 0), 0);
  var lotesDe = r => (r.data?.CtrlLoteItemReqMatChildList || [])
    .map(l => `${l.NumeroCtrlLote}:${l.QuantidadeProdUnidMedPrincipal}`).join(' + ') || '(nenhum)';
  var rel = ci => alvo('CtrlLoteLocArmaz/RelacionarCtrlLoteLocArmaz', 'POST', envLote(RM, ci, { Lista: lista }));

  // T1 = exatamente o que o Hub faz HOJE ao abrir o modal (acumulado, saldo intacto)
  var T1 = await rel({ ...item, QuantidadeAtendidaProdUnidMedPrincipal: JA + SALDO });
  // T2 = só a diferença no campo da atendida
  var T2 = await rel({ ...item, QuantidadeAtendidaProdUnidMedPrincipal: ATENDER });
  // T3 = acumulado na atendida E o saldo ajustado para o que se quer atender agora
  var T3 = await rel({ ...item, QuantidadeAtendidaProdUnidMedPrincipal: JA + ATENDER,
                                QuantidadeSaldoProdUnidMedPrincipal: ATENDER });

  console.log(`1.5 T1  atendida=${JA + SALDO}  saldo=${SALDO}  → ALOCADO ${soma(T1)}  [${lotesDe(T1)}]  status ${T1.status}`);
  console.log(`1.6 T2  atendida=${ATENDER}  saldo=${SALDO}  → ALOCADO ${soma(T2)}  [${lotesDe(T2)}]  status ${T2.status}`);
  console.log(`1.7 T3  atendida=${JA + ATENDER}  saldo=${ATENDER}  → ALOCADO ${soma(T3)}  [${lotesDe(T3)}]  status ${T3.status}`);
  console.log('1.8 corpos (só se algum status ≠ 200):', { T1: corpo(T1), T2: corpo(T2), T3: corpo(T3) });

  // Guardado para o caso de precisarmos olhar de novo sem repetir as chamadas.
  window.__AT5_A = { item, lista, T1, T2, T3 };
}
```

---

## Bloco 2 · Espécime B — reserva e empenho num item que gera empenho

**RM `0000002096`, seq 1** (`001.003.00087`) — **`GeraEmpenho = "Sim"`**, 126 pedidos, 112
atendidos, 14 de saldo. Os dois espécimes que fundaram o "reserva e empenho vêm nulos"
(`0000002283` e `0000002277`) eram itens `GeraEmpenho = "Não"` — este é o primeiro com empenho.

```js
// ═══ BLOCO 2 — ESPÉCIME B · leitura pura, nada escreve ══════════════════════
var RMB = '0000002096', SEQB = 1;

var loadB = await alvo(`ReqMat/Load?numero=${RMB}&loadChild=All`, 'GET');
console.log('2.0 Load status:', loadB.status, '| corpo:', corpo(loadB));

var itemB = (loadB.data?.ItemReqMatChildList || []).find(i => i.Sequencia === SEQB);
if (!itemB) {
  console.log('🔴 seq', SEQB, 'não encontrada. Sequências:',
    (loadB.data?.ItemReqMatChildList || []).map(i => i.Sequencia).join(', '));
} else {
  console.log('2.1 item:', itemB.CodigoProduto,
    '| pedido:', itemB.QuantidadeProdUnidMedPrincipal,
    '| já atendida:', itemB.QuantidadeAtendidaProdUnidMedPrincipal,
    '| saldo:', itemB.QuantidadeSaldoProdUnidMedPrincipal,
    '| GeraEmpenho:', itemB.GeraEmpenho, '| ControlaLote:', itemB.ControlaLote,
    '| local:', itemB.CodigoLocArmaz);

  var rB = await alvo('CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz', 'POST', envLote(RMB, itemB));
  var listaB = rB.data?.ListaCtrlLoteLocArmaz || [];
  console.log('2.2 LISTA status:', rB.status, '| lotes:', listaB.length, '| corpo:', corpo(rB));
  console.log('🔑 2.3 CHAVES (B):', listaB[0] ? Object.keys(listaB[0]).join(' · ') : '(lista vazia)');
  console.table(listaB.map(l => ({
    lote: l.NumeroCtrlLote, validade: l.DataValidadeCtrlLote,
    saldo: l.QuantidadeSaldoProdUnidMedPrincipal, bruta: l.QuantidadeBruta,
    reserva: l.QuantidadeReservaLote, empenho: l.QuantidadeEmpenhoLote,
  })));

  // A pergunta do A2, respondida em uma linha:
  var temLiquido = listaB.some(l => l.QuantidadeReservaLote != null || l.QuantidadeEmpenhoLote != null);
  console.log(temLiquido
    ? '🟢 2.4 RESERVA/EMPENHO VÊM PREENCHIDOS em item com empenho ⇒ existe saldo LÍQUIDO nativo por lote.'
    : '⚠ 2.4 reserva e empenho NULOS mesmo com GeraEmpenho = "Sim" ⇒ não há líquido nativo aqui; a tela sinaliza.');

  // 2.5 Objeto cru da primeira linha — para caçar à mão qualquer campo de saldo
  //     que não esteja na tabela acima (o candidato a "Saldo Calc" da §10.20).
  console.log('2.5 linha crua:', listaB[0]);
  window.__AT5_B = { item: itemB, lista: listaB };
}
```

---

## Bloco 3 · Smoke das RPCs da AT-3 / AT-3.1

**As três RPCs nunca rodaram fora de um Postgres sintético, e não dependem do Alvo.** Este bloco
as exercita em produção com sessão real: travas de estado, índice único parcial, RLS de leitura
e o registro do diff. **Não toca no ERP e não toca em estoque.**

### 3.1 · Helpers (cole primeiro)

```js
// ═══ BLOCO 3.1 — helpers do PostgREST ═══════════════════════════════════════
// A `apikey` é a chave ANÔNIMA do projeto — pública por design, já vai no bundle
// do app. A autorização real é o `jwt` do bloco 0, com a sessão do usuário.
var SB   = 'https://hbtggrbauguukewiknew.supabase.co';
var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhidGdncmJhdWd1dWtld2lrbmV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTk5NTMsImV4cCI6MjA5MDQ3NTk1M30.zC8QizNyFYndr7wLObdcAR_OkYJkkbVVCPfJunnEvrY';

async function rpc(nome, params) {
  const r = await fetch(`${SB}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  let body = null; try { body = await r.json(); } catch { /* sem corpo JSON */ }
  // 🔴 O corpo SEMPRE: um 404 aqui significa "PostgREST não recarregou o schema",
  //    e um 403 significa RLS/grant — o status sozinho não distingue.
  return { http: r.status, body };
}

async function sel(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
  let body = null; try { body = await r.json(); } catch { /* sem corpo JSON */ }
  return { http: r.status, body };
}

console.log('3.1 helpers ok');
```

### 3.2 · Abrir uma tentativa numa RM atendível

```js
// ═══ BLOCO 3.2 — nasce a linha `pendente` ═══════════════════════════════════
var RM_SMOKE = '0000002053';   // Atendida Parcial, 2 itens com saldo

var s1 = await rpc('op_rm_atender_iniciar', {
  p_numero: RM_SMOKE,
  p_payload: { smoke: 'AT-3', observacao: 'SMOKE DAS RPCs — nada foi enviado ao ERP', quando: new Date().toISOString() },
  p_filial: '1.01',
});
console.log('3.2 iniciar →', s1.http, s1.body);

var LIVRO_ID = s1.body?.id;
console.log('3.2 LIVRO_ID =', LIVRO_ID, LIVRO_ID ? '' : '🔴 sem id — PARE e me mande o corpo acima');
```

### 3.3 · A trava de concorrência (a mesma RM, de novo)

```js
// ═══ BLOCO 3.3 — deve RECUSAR: atendimento_em_voo ═══════════════════════════
var s2 = await rpc('op_rm_atender_iniciar', { p_numero: RM_SMOKE, p_filial: '1.01' });
console.log('3.3 iniciar de novo →', s2.http, s2.body);
```

### 3.4 · RM já fechada e RM inexistente

```js
// ═══ BLOCO 3.4 — as duas guardas de estado da RM ════════════════════════════
var s3 = await rpc('op_rm_atender_iniciar', { p_numero: '0000002283', p_filial: '1.01' });
console.log('3.4a RM Atendida Total →', s3.http, s3.body);

var s4 = await rpc('op_rm_atender_iniciar', { p_numero: '0000000000', p_filial: '1.01' });
console.log('3.4b RM inexistente →', s4.http, s4.body);
```

### 3.5 · Fechar a tentativa com recusa de releitura (com o diff)

```js
// ═══ BLOCO 3.5 — desfecho `recusado_releitura`, com o diff gravado ══════════
var s5 = await rpc('op_rm_atender_marcar', {
  p_id: LIVRO_ID,
  p_status: 'recusado_releitura',
  p_resposta: null,
  p_erro: 'SMOKE AT-3 (10/08/2026): teste das RPCs pelo console. Nada foi enviado ao ERP.',
  p_releitura: {
    smoke: true,
    relido_em: new Date().toISOString(),
    divergencias: [{ campo: 'Item 24 · saldo', naAbertura: '5', agora: '3' }],
  },
});
console.log('3.5 marcar recusado_releitura →', s5.http, s5.body);
```

### 3.6 · Ler o livro (prova a RLS de SELECT e o diff guardado)

```js
// ═══ BLOCO 3.6 — a linha no livro ═══════════════════════════════════════════
var s6 = await sel(`op_rm_atendimentos?numero_reqmat=eq.${RM_SMOKE}` +
  '&select=id,status,criado_em,validado_em,desfecho_em,erro_mensagem,releitura,payload_enviado,criado_por' +
  '&order=criado_em.desc&limit=5');
console.log('3.6 livro →', s6.http, s6.body);
console.table((Array.isArray(s6.body) ? s6.body : []).map(l => ({
  id: String(l.id).slice(0, 8), status: l.status, criado: l.criado_em, desfecho: l.desfecho_em,
  temDiff: !!l.releitura, erro: (l.erro_mensagem || '').slice(0, 60),
})));
```

### 3.7 · Estado terminal não se reabre

```js
// ═══ BLOCO 3.7 — deve RECUSAR: transicao_invalida ═══════════════════════════
var s7 = await rpc('op_rm_atender_marcar', {
  p_id: LIVRO_ID, p_status: 'erro', p_resposta: null, p_erro: 'SMOKE — tentativa de reabrir', p_releitura: null,
});
console.log('3.7 reabrir terminal →', s7.http, s7.body);

// E um status que a função não aceita registrar:
var s7b = await rpc('op_rm_atender_marcar', {
  p_id: LIVRO_ID, p_status: 'finalizado', p_resposta: null, p_erro: null, p_releitura: null,
});
console.log('3.7b status não registrável →', s7b.http, s7b.body);
```

### 3.8 · O índice único é PARCIAL — a RM destrava após o desfecho

```js
// ═══ BLOCO 3.8 — abre de novo e FECHA em seguida ════════════════════════════
// Prova que `ux_op_rm_atend_em_voo` só pega `pendente`/`validado`: com a
// tentativa anterior encerrada, a RM volta a aceitar atendimento.
var s8 = await rpc('op_rm_atender_iniciar', {
  p_numero: RM_SMOKE, p_payload: { smoke: 'AT-3 · 2ª tentativa' }, p_filial: '1.01',
});
console.log('3.8 iniciar após desfecho →', s8.http, s8.body);

// 🔴 FECHA IMEDIATAMENTE — senão a RM fica em voo por 15 min.
if (s8.body?.id) {
  var s8b = await rpc('op_rm_atender_marcar', {
    p_id: s8.body.id, p_status: 'recusado_releitura', p_resposta: null,
    p_erro: 'SMOKE AT-3 (10/08/2026): 2ª tentativa, encerrada pelo próprio roteiro.', p_releitura: null,
  });
  console.log('3.8b fechada →', s8b.http, s8b.body);
} else {
  console.log('⚠ 3.8 sem id — rode o bloco 3.9 para conferir se sobrou algo em voo.');
}
```

### 3.9 · Destravar (só se algo ficou em voo)

```js
// ═══ BLOCO 3.9 — rede de segurança ══════════════════════════════════════════
var voo = await sel(`op_rm_atendimentos?numero_reqmat=eq.${RM_SMOKE}` +
  '&status=in.(pendente,validado)&select=id,status,criado_em');
console.log('3.9 em voo:', voo.http, voo.body);

for (const l of (Array.isArray(voo.body) ? voo.body : [])) {
  const f = await rpc('op_rm_atender_marcar', {
    p_id: l.id, p_status: 'recusado_releitura', p_resposta: null,
    p_erro: 'SMOKE AT-3: encerrada pelo bloco 3.9 (destravar).', p_releitura: null,
  });
  console.log('3.9 fechando', String(l.id).slice(0, 8), '→', f.http, f.body);
}
console.log('3.9 fim. Se ainda restar algo em voo, o expurgo automático de 15 min resolve.');
```

---

# Como ler os resultados

## Bloco 1 — o campo do `ClassInstance` (linhas 1.5, 1.6, 1.7)

O item tem **200 pedidos, 99 atendidos, 101 de saldo**, e queremos atender **5**. A tabela abaixo
cobre as saídas possíveis de `T1` (que é o que o Hub faz **hoje** ao abrir o modal):

| `T1` alocou | Significa | O que muda em `alvoReqMatAtendimentoService.ts` |
|---|---|---|
| **101** | manda o **`QuantidadeSaldo…`** — o Alvo ignora a atendida que enviamos | A **abertura está certa** (propõe atender o saldo inteiro). 🔴 Mas `realocarLotesDoItem` fica **errado**: o usuário digita 5 e o Alvo aloca 101. ⇒ `alocarNoServidor` passa a mandar também `QuantidadeSaldoProdUnidMedPrincipal = quantidadeAtenderAgora`. **Uma linha.** Confirmar por `T3 = 5` |
| **200** | manda a **`QuantidadeAtendida…`** crua (o acumulado que enviamos) | 🔴 **A proposta de abertura nasce inválida em todo item parcial** (46 dos 211 com lote): aloca 200 contra 101 a atender, e a validação nº 1 barra tudo. ⇒ `alocarNoServidor` passa a mandar **`quantidadeAtenderAgora`**, não o acumulado — e o comentário da decisão nº 9 do `RETOMADA-AT-4.md` é retificado. Confirmar por `T2 = 5` |
| **5** | há um terceiro campo derivando a diferença | Improvável (o espécime da AT-2 já descartou `pedido − atendida`). Me mande `T1`, `T2` e `T3` inteiros — o desenho muda |
| **0** ou lista vazia | o Alvo não alocou nada | Ver `1.8`. Se o corpo trouxer `BrokenRulesException`, é regra de negócio **com nome** — leia a mensagem. Se `NullReferenceException`, o `ClassInstance` perdeu campo ao ser copiado |

**Cruzamento que fecha o caso:** `T2` isola a atendida (5 contra saldo 101) e `T3` isola o saldo
(5 contra atendida 104). **Exatamente um dos dois vai alocar 5** — esse é o campo que manda.
Se os dois alocarem 5, o Alvo usa o **menor** dos dois, e mandar ambos ajustados (o que o `T3`
faz) é o desenho seguro.

⚠ **Se `T1` alocar 101 ou 200, a AT-4 tem defeito no caminho comum** — e a AT-5 não pode ser
escrita antes da correção. É o motivo desta medição vir antes da tela.

## Bloco 1, linha 1.3 e Bloco 2, linhas 2.3 / 2.5 — o candidato a "Saldo Calc"

A §10.20 registra que a tela "Seleção Lote (Saída)" do Alvo mostra **duas** colunas de saldo —
`Saldo Calc` e `Saldo` — e nunca se mapeou qual campo alimenta qual. O dump da AT-1 foi parcial
("os campos que importam").

| O que aparecer em `Object.keys` | Leitura |
|---|---|
| Uma chave de saldo além de `QuantidadeSaldoProdUnidMedPrincipal` (algo como `…Calculado`, `…Disponivel`, `…Liquido`) | 🟢 É o `Saldo Calc`. Comparar com o saldo bruto na mesma linha decide qual dos dois a validação usa |
| Só as chaves já conhecidas | As duas colunas da tela são a mesma quantidade em unidades diferentes, ou o cálculo é do cliente. Fecha a hipótese e vira card |

## Bloco 2, linha 2.4 — o Ajuste A2 resolvido na origem

| Saída | Significa | Consequência |
|---|---|---|
| 🟢 **"vêm preenchidos"** | O Alvo **dá** reserva e empenho por lote; os nulos anteriores eram ausência de empenho, não omissão | A validação nº 2 passa a ser **`quantidade ≤ saldo − reserva − empenho`**. O A2 deixa de ser risco e vira número na tela ("saldo 184, empenhado 25, disponível 159"). Custo: **zero chamadas extras** |
| ⚠ **"nulos mesmo com empenho"** | Não há saldo líquido nativo neste endpoint | A validação continua contra o **bruto** e a tela **sinaliza**: badge "empenhado" no item (de `gera_empenho`, do espelho) e aviso quando o produto tem empenho em **outra** RM aberta — hoje são **26 produtos com lote e 1.634 unidades empenhadas**, 13 deles com item livre no mesmo produto. Vira card de backlog: capturar os botões **Reservas**/**Empenhos** (§9.9, Fase 5) |

## Bloco 3 — o que cada resposta deve ser

| Passo | Esperado | Se vier diferente |
|---|---|---|
| **3.2** | `{success: true, id: "<uuid>", abandonadas: 0}` | `sem_permissao` → o gate recusou quem tem bypass de admin: **PARE**, é defeito. HTTP **404** → PostgREST não recarregou o schema (`notify pgrst, 'reload schema'`). HTTP **403** → grant de `authenticated` não aplicado |
| **3.3** | `{success: false, erro_codigo: "atendimento_em_voo", em_voo_id, em_voo_status: "pendente"}` | Se **passar** e devolver outro `id`, o índice `ux_op_rm_atend_em_voo` **não existe** — a trava Hub-vs-Hub não está de pé. Rode o 3.9 e me avise |
| **3.4a** | `{success: false, erro_codigo: "rm_ja_atendida"}` | Se passar, a validação nº 7 do lado do banco não está funcionando |
| **3.4b** | `{success: false, erro_codigo: "nao_no_espelho"}` | — |
| **3.5** | `{success: true, status: "recusado_releitura"}` | — |
| **3.6** | 1 ou 2 linhas, a mais nova com `status: "recusado_releitura"`, `desfecho_em` preenchido, `temDiff: true` | **Lista vazia** com HTTP 200 → a **RLS de SELECT** está barrando a leitura: o livro grava e a tela nunca mostraria. É defeito, e some da vista |
| **3.7** | `{success: false, erro_codigo: "transicao_invalida"}` | Se passar, um retry atrasado consegue reescrever o desfecho de uma tentativa encerrada |
| **3.7b** | `{success: false, erro_codigo: "status_invalido"}` | Se passar, `finalizado` seria carimbável sem semeadura — o livro passaria a mentir sobre o ERP |
| **3.8** | `{success: true, id: "<outro uuid>"}` e depois `3.8b` com `success: true` | Se **recusar** com `atendimento_em_voo`, o índice não é parcial: a primeira RM atendida travaria para sempre. É defeito grave |
| **3.9** | `em voo: []` | Qualquer linha restante é fechada pelo próprio bloco |

### 🔴 O que o bloco 3 **não** prova

`_user_has_perm` começa por `public._is_admin()`. **Você é o único `is_admin` de 53 perfis
ativos** ⇒ nas suas mãos o gate `producao.rm.atender` **passa por bypass**, não por permissão.

O smoke prova as **travas de estado**, o **índice único parcial**, a **RLS de leitura** e o
**registro do diff**. O gate real continua dependendo de um usuário **sem** a flag — e o papel
`almoxarifado` tem **0 titulares** hoje (medido). É o aceite nº 1 do plano da fase, e não há
código que o resolva.

### O que o bloco 3 deixa para trás

Duas ou três linhas em `op_rm_atendimentos`, todas com `status = 'recusado_releitura'` e
`erro_mensagem` começando em **"SMOKE AT-3"**. **Não apague** — o livro é histórico, e a AT-3 o
desenhou para não perder rastro. Quando a tela entrar em uso, elas são a única coisa lá com essa
marca.

---

# Cards prontos para colar (o Pedro aplica; eu não edito plano)

### → `PLANO-OP.md` §6.3-N, retificações

> **Retificação de 10/08/2026 — o espécime da AT-2 na §10.31 mistura dois itens.**
> A §10.31 e a §2.6 do `PLANO-RM-ATENDIMENTO.md` registram "RM `0000002277`, item
> `001.003.00047`, 20 a atender → lote `0002467`". No espelho, a seq 4 (`001.003.00047`) tem
> **quantidade 8**; quem tem **20** é a **seq 1, `001.003.00059`** — e o lote `0002467`
> (`QuantidadeBruta` 350) é desse produto: a §2.2 o registra com saldo 184 em 08/08 e a §10.31
> com 154, e a diferença de 30 é exatamente a baixa do BL-29 no mesmo lote.
> ⇒ Foram **duas medições em itens diferentes da mesma RM**: o `Relacionar` na **seq 1** e a
> classificação contábil (`ItemReqMatClasseRecdespChildList`) na **seq 4** — esta última buscou
> por `CodigoProduto`, não por sequência, e **continua válida**. O que se corrige é o rótulo,
> não o achado. Texto original intacto.

### → `PLANO-RM-ATENDIMENTO.md`, seção "Ajustes" — depende do bloco 2

> **Ajuste A4 (10/08/2026) — a dimensão do empenho sobre lote, medida.**
> **26 produtos com controle de lote têm saldo empenhado em RM aberta**, somando **1.634
> unidades**; em **13 deles o mesmo produto aparece também em item sem empenho** (ex.:
> `001.007.00012` com 400 empenhados contra 180 livres; `001.003.00059` com 25 contra 323).
> ⇒ O saldo bruto do lote pode cobrir material comprometido para outra requisição.
> **E os nulos de `QuantidadeReservaLote`/`QuantidadeEmpenhoLote` não provavam nada:** os dois
> espécimes que fundaram a conclusão (`0000002283` e `0000002277`) eram itens
> `GeraEmpenho = "Não"`. Medição no espécime B (`0000002096` seq 1, `GeraEmpenho = "Sim"`)
> decide se há saldo líquido nativo. Mesma família do BL-30: **ninguém tinha olhado o campo no
> contexto certo.**

---

## Perguntas

1. **Ordem de execução:** os blocos 1 e 2 são os que travam a AT-5; o 3 não trava nada (as RPCs
   já estão aplicadas). Se a janela for curta, rode **1 → 2** e deixe o 3 para depois — mas rode
   o 3 **antes** de eu escrever a tela, porque ele é o único jeito de saber se a RLS de SELECT
   do livro deixa a tela ler o que ela mesma grava.

2. **RM do smoke:** escolhi a `0000002053` (Atendida Parcial, 2 itens com saldo, nenhum
   atendimento em andamento). Ela fica com 2 ou 3 linhas de teste no livro, marcadas com
   "SMOKE AT-3". Se preferir outra RM, é trocar `RM_SMOKE` no bloco 3.2 — precisa estar no
   espelho, sem `ausente_desde` e diferente de `Atendida Total`.

3. **Se o `T1` do bloco 1 alocar 101 ou 200** (as duas saídas prováveis), a AT-4 ganha uma
   correção de uma a duas linhas **antes** da AT-5. Quer que eu entregue essa correção como
   **AT-4.1** (card novo, arquivo próprio, original intacto) ou emendada no serviço com nota no
   cabeçalho? Minha recomendação é **AT-4.1** — a AT-4 já está commitada em `60183b4`, e a
   disciplina da §6.3-N é apendar, não reescrever.
