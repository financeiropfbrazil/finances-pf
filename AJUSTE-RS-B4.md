# AJUSTE-RS-B4 — Auditoria append-only: manter INSERT, revogar UPDATE/DELETE
### Ajuste ao `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` (CARD B4 e CARD B3 §VERIFY)

> **Documento aditivo.** Não altera o plano v1.1 — ele permanece como está. Onde houver
> conflito, **este arquivo prevalece para os cards B3 e B4**.
> **Base factual:** levantamento no banco `hbtggrbauguukewiknew` em 19/08/2026 (sessão
> Codex, leitura pura, MCP read-only) + leitura do `requisicoesService.ts`.
> **Motivo:** a especificação original do CARD B4 partia de uma premissa falsa e, se
> aplicada como escrita, degradaria a trilha de auditoria em silêncio.

---

## 1. O erro da especificação original

O CARD B4 do plano v1.1 dizia: *"a gravação segue pelas RPCs `SECURITY DEFINER`, que
executam como owner"* — e por isso mandava revogar `insert, update, delete` de
`authenticated`.

**O banco mostra o contrário.** Das 933 linhas de `compras_requisicoes_auditoria`:

| Origem | Linhas | Sobrevive ao B4 original? |
|---|---:|---|
| RPCs `SECURITY DEFINER` (owner) | **41** | ✅ |
| Frontend, como `authenticated` (`requisicoesService.ts`) | **887** | ❌ |
| Fora do módulo (vinculado/desvinculado pedido) | 5 | ❌ |

Eventos que parariam de ser gravados: `criada` (238), `envio_tentado` (225),
`envio_sucesso` (239 pela via frontend), `envio_falha` (19), e parcialmente
`convertida_pedido` e `cancelada_alvo` (a via frontend; a via cron sobrevive por usar
`service_role`).

**E pararia em silêncio.** São 9 chamadas `await (supabase as any).from("compras_requisicoes_auditoria").upsert({...})`
sem checar `error`. Com o INSERT revogado, o PostgREST devolve **42501**, o código ignora
e segue: o usuário não vê nada, o fluxo funciona, o evento não é gravado. Trocaríamos
"trilha alterável" por **"trilha incompleta sem ninguém saber"** — pior, porque a primeira
é detectável e a segunda não.

---

## 2. Decisão

### B4-A — Vale a **Seção 3-ALT**: manter INSERT, revogar UPDATE e DELETE
É o que "append-only" significa: ninguém **altera** nem **apaga**, todo mundo pode
**acrescentar**. Fecha o risco real (adulteração/exclusão da trilha) sem criar o risco novo
(trilha furada). A Seção 3 original fica **suspensa** até o B4-B estar feito.

### B4-B — Dívida: mover as 9 escritas do frontend para uma RPC
Enquanto `requisicoesService.ts` gravar direto na tabela como `authenticated`, a trilha
depende de permissão de usuário. O molde já existe: `_req_evento` (`SECURITY DEFINER`,
chamada internamente pelas outras quatro RPCs). Migrar as 9 chamadas para uma RPC
equivalente — **e checar o `error` de cada uma**, que hoje é ignorado — deixa a gravação
independente de RLS. Só **depois disso** a Seção 3 original (revogar INSERT também) passa a
ser correta e desejável.
> Dívida de esforço médio, sem urgência. Não bloqueia nada. Relacionada ao CARD D1
> (checar todo `error` do Supabase).

### B4-C — Ordem de aplicação
1. **Seção 2 (B3)** isolada, hoje. Depois V1 e V2.
2. Teste com líder não-admin (feito em 19/08: Guilherme, líder de TI, recebeu e rejeitou).
   Confirmar com V5 que a trilha registrou.
3. **Seção 3-ALT**. Depois V3 e V4.

⚠️ **A ordem dentro da Seção 2 não pode ser invertida.** O `revoke ... from public` também
alcança `authenticated` (que herda de PUBLIC); é o `grant ... to authenticated` seguinte que
devolve o acesso. Parar no meio deixa a fila do líder quebrada até rodar os grants.

---

## 3. Correções nas queries de VERIFY do plano v1.1

Duas queries do plano estavam erradas e foram substituídas pelas V1–V5 do SQL gerado:

| Onde | Erro | Correção |
|---|---|---|
| CARD B3, VERIFY | `... like '%=X/%' and p.proacl is null` — condição impossível (se `proacl` é null não há string para casar); nunca acusaria nada | Usar `has_function_privilege('anon', p.oid, 'EXECUTE')` (V1/V2) |
| CARD B4, PREVIEW | `select polname from pg_policies` — a view expõe **`policyname`**; `polname` é do catálogo `pg_policy` | V3, com `policyname` |

---

## 4. Achados do levantamento (registro)

1. **`rejeitar_requisicao` não tinha `anon` nominal** — o revoke do Ajuste 1.3 já o havia
   tirado; ela executava por `anon` **herdando de PUBLIC**. É a prova concreta de que
   revogar só de `anon` não fecha nada, e por isso o par `from public, anon` é obrigatório.
   Consequência prática: o rollback dela é `to public, authenticated` (sem `anon`) —
   regrantar `anon` seria piorar o estado original.
2. **Nenhuma das 5 RPCs tem sobrecarga.** Uma assinatura cada, todas `SECURITY DEFINER`,
   `search_path=public`, owner `postgres`.
3. **`_req_evento` é chamada só internamente** — `submeter_requisicao` 3×,
   `registrar_envio_requisicao` 2×, `aprovar_requisicao` 1×, `rejeitar_requisicao` 1×;
   nenhuma chamada de frontend ou Edge (o único hit no repo é um comentário). Revogar de
   `authenticated` é seguro.
4. **RLS habilitada** (`relrowsecurity = true`); `postgres` e `service_role` têm
   `rolbypassrls` — é o que garante que as RPCs e o cron sigam gravando.
5. **`klaus_readonly` tem apenas SELECT** na trilha e não é tocado por nenhum comando.
   Não foi auditado se existe consumidor externo escrevendo (BI, integrações) — pelo
   catálogo, não há.
6. **O cron grava como `service_role`** (`sync-compras-status-cron`), preservado em todos os
   comandos. Não quebra.

---

## 5. Se um comando falhar no meio

Cada bloco é um statement isolado — não há transação implícita entre eles. O que passou,
passou; o que falhou, não teve efeito.

- **Revoke/grant da Seção 2:** corrigir só a função em questão e seguir. O único estado
  perigoso é `revoke from public` aplicado **sem** o `grant to authenticated`
  correspondente: aquela RPC fica inacessível ao app. Conserto = rodar o grant que faltou.
- **`drop policy` falhou:** provavelmente o nome mudou. Rodar V3 para pegar o nome atual e
  reexecutar com o nome exato entre aspas duplas — nunca adivinhar.
- **`create policy` falhou depois do `drop`:** única janela real de exposição — a tabela
  fica sem policy e, com RLS ligada, a leitura é bloqueada para `authenticated` (a aba
  "Histórico" do detalhe fica vazia). **Nenhum dado é perdido**; `service_role`/`postgres`
  seguem gravando. Conserto = rodar o `create policy` de novo, ou voltar ao original pela
  Seção 1.
- **`revoke` de escrita falhou:** inofensivo, estado anterior permanece. Repetir.
- **Regra geral:** depois de qualquer falha, rodar V1 + V3 + V4 antes do próximo comando.

**Janela:** fora do pico da fila e dos ciclos do cron (07h30 / 12h30 / 16h30 BRT). O
`NOTIFY pgrst` é assíncrono — se a primeira RPC depois vier com erro de schema cache,
esperar alguns segundos e repetir antes de suspeitar do SQL.

---

*Ajuste v1.0 — 19/08/2026. Deriva de medição no banco, não de suposição. O SQL executável
correspondente está na saída da sessão Codex (Seções 1, 2, 3-ALT e V1–V5). Próxima
alteração = `AJUSTE-RS-B4.1.md`.*
