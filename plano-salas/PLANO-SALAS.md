# PLANO-SALAS — Movimentação de Salas de Produção

**Financial Hub P&F Brasil · Supabase `hbtggrbauguukewiknew` · Repo `finances-pf` (main → Lovable)**
**Criado em 20/08/2026 · Fonte única de verdade do agente Claude Code**

> **Regra de imutabilidade (a mesma da casa):** nada neste plano é apagado ou reescrito.
> Correções e mudanças entram como **seções novas numeradas** (Ajuste, Correção, Retificação),
> mantendo o original intacto. As únicas áreas editáveis são o **Quadro de Status (§3)** e o
> `DIARIO.md` (append-only).

---

## §0 — Contexto e decisões já tomadas (não rediscutir; executar)

O módulo **Movimentação de Salas** registra o WIP da produção no nível físico da sala:
**entrada de insumos**, **saída de semiacabados** e **refugo**, em livro append-only com
auditoria completa (timestamp de sistema, operador via `auth.uid()`, lote, validade, documento
de origem). Equação por sala: `Entradas = Saídas + Refugos + Saldo em sala`. O MVP é 100% Hub —
**nenhuma escrita no Alvo ERP**.

Decisões fechadas com o Pedro (Controller, dono do projeto):

1. **Piloto:** Sala de Produção de Ponteiras (`PONTEIRAS`, tipo `CATETER`).
2. **De-para insumos ↔ Alvo** (chave = campo `Alternativo` do cadastro de produto):
   Silicone `001.007.00037` (810017) · Sulfato de Bário `001.007.00004` (810021) ·
   Tensionador `001.007.00025` (810020) · Tubo de Passagem `001.007.00033` (810086) ·
   Holder `001.007.00012` (810076 — o 810086 da planilha era erro de digitação).
3. **Saída do piloto:** Sub Assembly A `001.007.00065` (Ponteira de silicone com tubo passante,
   linha aórtica). Sub Assembly F fica FORA até ordem expressa.
4. **Lote:** os 6 produtos controlam lote na filial 1.01, com lote automático no ERP e
   `PermiteLoteVencido = Não`. Regra do Hub: lote+validade obrigatórios; **validade vencida
   BLOQUEIA a entrada** (sem override no MVP).
5. **Unidades:** unidade de produção = unidade base (pos 1) nos 6. Conversão para base:
   `quantidade_base = quantidade × peso` da unidade escolhida (regra provada: Fator divide na
   leitura). A escala KG do Tensionador está invertida no ERP e foi **excluída de propósito**
   da semeadura.
6. **RBAC:** módulo próprio `salas` no catálogo. 7 permissões globais + 4 papéis globais
   (`operador_salas`, `qualidade_salas`, `gestor_salas`, `visualizador_salas`). O escopo por
   sala é **dado**, não papel: tabela `prod_sala_usuarios` + função
   `user_has_sala_permission` ("papel dá o verbo, vínculo dá o lugar").
7. **Correção de erro = soft-estorno** (`estornada_em/por/motivo`), nunca UPDATE de quantidade,
   nunca DELETE.
8. As tabelas de teste antigas (`prod_apontamento_motivos`, `prod_apontamentos`,
   `prod_atividades`, `prod_itens`, `prod_motivos_refugo`, `prod_vw_apontamentos`) **não são
   tocadas** — o Pedro decide o destino delas depois.

---

## §1 — Guardrails do agente (invioláveis)

### 1.1 Escopo de banco (MCP Supabase em modo escrita)

- **PERMITIDO criar/alterar:** tabelas, índices, policies e funções **novas** com prefixo
  `prod_` listadas neste plano; a função `user_has_sala_permission`; INSERTs no catálogo RBAC
  (`hub_permissions`, `hub_roles`, `hub_role_permissions`) **exatamente** como no SQL da fase.
- **PROIBIDO:** qualquer comando em tabelas fora da lista acima (`compras_*`, `op_*`, `desp_*`,
  `intercompany*`, `rh_*`, `imob_*`, `profiles`, `hub_user_roles`, etc. — leitura para
  verificação é permitida, escrita jamais); `DROP`, `DELETE`, `TRUNCATE`, `ALTER` destrutivo
  (exceção única: o canário FS1-0b); criar policy de INSERT/UPDATE para `authenticated`;
  qualquer `GRANT` a `anon`; mexer em cron jobs, Vault, storage, Edge Functions ou no
  `erp-proxy`.
- **SQL literal:** executar o que está em `sql/FS1-fundacao.sql`, statement a statement, na
  ordem. Se um statement falhar ou uma verificação divergir do esperado → **PARAR**, registrar
  no DIARIO (mensagem de erro literal) e reportar. Nunca "consertar" com SQL improvisado.
- **Ferramenta:** preferir `apply_migration` (nome `salas_fs1_<n>_<slug>`) para DDL e
  `execute_sql` para verificações/INSERTs, conforme o MCP expuser. Sem `BEGIN/COMMIT` manuais.
- **Pós-DDL obrigatório:** `NOTIFY pgrst, 'reload schema';` ao final do lote.
- **Janela de DDL:** evitar iniciar DDL nos minutos `:00`, `:10`, `:15`, `:25`, `:30`, `:45`
  (crons da casa). Minutos seguros: `:05`, `:20`, `:35`, `:50`.
- **Toda função nova:** `SECURITY DEFINER` + `SET search_path = public` + `revoke ... from
  public` + `revoke ... from anon` **com assinatura completa** + `grant ... to authenticated`
  (regra OP-2.7: o projeto tem default grant nominal a `anon`).

### 1.2 Git e Lovable

- Fonte de verdade do frontend = **este repositório**. O Lovable builda a cada push na `main`.
- **Sempre** `git pull --rebase origin main` antes de trabalhar e antes de push (o Lovable
  também commita na `main`). Conflito de rebase → PARAR e reportar, nunca resolver sozinho.
- Commits **por tarefa concluída**, mensagem `salas: <ID> — <resumo curto>`
  (ex.: `salas: FS1-6 — catálogo RBAC do módulo`). Push ao final da sessão.
- Nesta Fase 1 o agente só altera arquivos **dentro de `plano-salas/`** (DIARIO, status).
  Código em `src/` só a partir da FS3, com tarefas explícitas.
- Nunca commitar segredos, tokens ou saídas de MCP contendo credenciais.

### 1.3 Conduta

- Uma tarefa por vez, na ordem do plano. Terminou → DIARIO → status → commit → próxima.
- O agente **não cria escopo**: ideia boa fora do plano vira linha em "Pendências/Sugestões"
  no DIARIO, para o Pedro decidir.
- Divergência entre plano e realidade do banco = achado, não obstáculo a contornar. PARAR e
  reportar é o comportamento correto.

---

## §2 — Ritual de sessão

1. `git pull --rebase origin main`; `git status` limpo.
2. Ler `PLANO-SALAS.md` (este arquivo) e as últimas entradas do `DIARIO.md`.
3. Identificar no §3 a próxima tarefa `pendente`.
4. **Pré-voo da fase** (na FS1: tarefa FS1-0/FS1-0b). Divergência → parar e reportar.
5. Executar a tarefa exatamente como especificada; rodar a **verificação** da tarefa e
   comparar com o esperado.
6. Registrar no `DIARIO.md` (modelo lá dentro): id, hora, o que rodou, resultado das
   verificações, migração/commit.
7. Atualizar o Quadro de Status (§3).
8. Commit da tarefa. Repetir 3–8 até fechar a fase **ou** encontrar bloqueio.
9. Fim de sessão: `NOTIFY pgrst` (se houve DDL), push, resumo ao Pedro com: tarefas feitas,
   verificações (valores reais), pendências e o que precisa de validação humana (§7).

---

## §3 — Quadro de Status (única área editável do plano)

| Fase | Tarefa | Descrição | Status | Sessão/Data |
|---|---|---|---|---|
| FS1 | FS1-0 | Pré-voo (leituras) | concluída | S1 · 20/08/2026 |
| FS1 | FS1-0b | Canário de escrita MCP | concluída | S1 · 20/08/2026 |
| FS1 | FS1-1 | `prod_salas` | concluída | S1 · 20/08/2026 |
| FS1 | FS1-2 | `prod_produtos` | concluída | S1 · 20/08/2026 |
| FS1 | FS1-3 | `prod_sala_produtos` | concluída | S1 · 20/08/2026 |
| FS1 | FS1-4 | `prod_sala_usuarios` | concluída | S1 · 20/08/2026 |
| FS1 | FS1-5 | `prod_entradas` | concluída | S1 · 20/08/2026 |
| FS1 | FS1-6 | Catálogo RBAC (7 perms, 4 papéis, admin) | concluída | S1 · 20/08/2026 |
| FS1 | FS1-7 | `user_has_sala_permission` + revokes | concluída | S1 · 20/08/2026 |
| FS1 | FS1-8 | RPCs vínculo equipe + revokes | concluída | S1 · 20/08/2026 |
| FS1 | FS1-9 | Semeadura piloto (sala + 6 produtos + vínculos) | concluída | S2 · 20/08/2026 (AJUSTE A) |
| FS1 | FS1-10 | NOTIFY pgrst + verificação final | concluída | S2 · 20/08/2026 |
| FS2 | FS2-0 | Pré-voo da fase (leituras) | concluída | S3 · 20/08/2026 |
| FS2 | FS2-1 | `prod_sala_motivos_refugo` + semeadura (5 peça + 6 insumo) | concluída | S3 · 20/08/2026 |
| FS2 | FS2-2 | `prod_salas`: ADD COLUMN `prefixo_lote` + set `PT` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-3 | `prod_bateladas` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-4 | `prod_batelada_consumos` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-5 | `prod_saidas` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-6 | `prod_refugos` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-7 | Permissão `salas.batelada.manage` + mapeamentos (inclui `admin`) | concluída | S3 · 20/08/2026 |
| FS2 | FS2-8 | RPC `prod_registrar_entrada` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-9 | RPCs de batelada (abrir · declarar consumo · fechar) | concluída | S3 · 20/08/2026 |
| FS2 | FS2-10 | RPC `prod_registrar_refugo` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-11 | RPC `prod_estornar_movimento` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-12 | View `prod_vw_saldo_insumos` | concluída | S3 · 20/08/2026 |
| FS2 | FS2-13 | `NOTIFY pgrst` + verificação final | pendente | — |
| FS3 | — | Telas (aguardando GO do Pedro) | bloqueada | — |

Valores de status: `pendente` · `em execução` · `concluída` · `bloqueada` · `falhou (ver DIARIO)`.

---

## §4 — FS1: Fundação (banco + RBAC + semeadura)

**Fonte SQL:** `plano-salas/sql/FS1-fundacao.sql` — statements na ordem, com o resultado
esperado comentado em cada verificação. Resumo das tarefas:

- **FS1-0 — Pré-voo (só leitura).** (a) `pg_tables` com `prod\_%`: esperado **exatamente** as
  5 tabelas de teste antigas; (b) catálogo `salas.%` e papéis novos: esperado **0 linhas**;
  (c) `information_schema.columns`: `id` de `hub_permissions`/`hub_roles`/
  `hub_role_permissions` **com default** de uuid. Qualquer diferença → parar.
- **FS1-0b — Canário de escrita.** Criar `public.prod_zz_agent_canary`, inserir 1 linha, ler,
  e **dropar** (única exceção de DROP do projeto, restrita a este nome). Prova que o MCP está
  em modo escrita antes de qualquer objeto real.
- **FS1-1 a FS1-5 — Tabelas.** `prod_salas`, `prod_produtos`, `prod_sala_produtos`,
  `prod_sala_usuarios` (índice único parcial de vínculo ativo), `prod_entradas` (livro, com
  soft-estorno e índices). Todas com RLS habilitada e policy de SELECT gateada em
  `user_has_permission(auth.uid(), 'salas.access')`. **Nenhuma policy de escrita.**
- **FS1-6 — RBAC.** 7 permissões do módulo `salas`; 4 papéis (`is_system=false`); mapeamentos
  operador/qualidade/gestor/visualizador; e as 7 permissões mapeadas **também ao papel
  `admin`** (regra do 42/55).
- **FS1-7 — `user_has_sala_permission(p_user_id, p_sala_id, p_permission_code)`.** Bypass
  `profiles.is_admin` (lookup por `profiles.user_id` — chave canônica), senão
  `user_has_permission` **E** vínculo ativo em `prod_sala_usuarios`. Revokes/grant conforme
  §1.1.
- **FS1-8 — RPCs de equipe.** `prod_sala_usuario_vincular` / `prod_sala_usuario_revogar`
  (gate `salas.cadastros.manage`, soft-delete, erros claros). Revokes/grant conforme §1.1.
- **FS1-9 — Semeadura.** Sala `PONTEIRAS`; os 6 produtos com `escala_unidades` real dos Loads
  (Silicone GRAMAS/KG=1000/UNID=4540 · Bário GRAMAS/KG=1000/UNID=450 · demais UNID);
  vínculos 5×INSUMO + 1×PRODUTO.
- **FS1-10 — Fechamento.** `NOTIFY pgrst, 'reload schema';` e verificação final. Esperado:
  7 permissões `salas`; papéis com 7/4/3/2 permissões (gestor/operador/qualidade/visualizador);
  `admin` com as 7 do módulo; sala `PONTEIRAS` com 5 insumos + 1 produto; `proacl` das 3
  funções novas **sem** `anon`.

**Critério de aceite da FS1:** todas as verificações da FS1-10 batendo com o esperado,
DIARIO completo, commits por tarefa, push feito.

---

## §5 — FS2: RPCs de movimento (BLOQUEADA — aguarda GO do Pedro após validação da FS1)

Escopo previsto (detalhamento entra como seção nova quando liberado):
`prod_registrar_entrada` — gate `user_has_sala_permission(auth.uid(), sala, 'salas.registrar.entrada')`;
valida produto INSUMO da sala; unidade ∈ `escala_unidades`; converte e grava
`quantidade_base` + `fator_usado`; lote+validade obrigatórios (`controla_lote`); **bloqueia
validade vencida**; `registrado_por = auth.uid()`. E `prod_estornar_entrada` — gate
`salas.estornar` + vínculo; só marca soft-estorno. View de saldo por sala/produto/lote.

## §6 — FS3: Telas (BLOQUEADA — aguarda GO do Pedro)

Item de menu "Movimentação de Salas" (gate `salas.access` via `get_user_permissions`), tela de
registro de entrada da sala vinculada, listagem/saldo, aba Equipe no detalhe da sala
(`salas.cadastros.manage`). Arquivos em `src/`, push na `main`, Lovable builda.

## §7 — Validações humanas (Pedro — o agente não faz)

1. Conferir no admin do Hub que os 4 papéis novos aparecem e são atribuíveis.
2. Atribuir `operador_salas` a um usuário de teste **sem `is_admin`** e (via SQL ou tela
   futura) vinculá-lo à sala — validar `user_has_sala_permission` = true/false nos casos
   certos (o erro de permissão nunca aparece para o admin).
3. Decidir o destino das tabelas de teste antigas (`prod_*` legadas).
4. GO formal para FS2.
