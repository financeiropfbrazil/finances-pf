# DIARIO — Movimentação de Salas (execução do agente)

> **Append-only.** Nada é apagado ou editado; correções entram como novas entradas.
> Uma entrada por tarefa concluída, bloqueada ou falhada. Erros sempre com a mensagem literal.

## Modelo de entrada (copiar e preencher)

```
---
### [SESSÃO S? · AAAA-MM-DD HH:MM BRT] <ID da tarefa> — <título curto>
- **Status final:** concluída | bloqueada | falhou
- **O que foi executado:** (statements/migrações aplicadas, arquivos alterados)
- **Verificações:** (consulta → resultado real vs. esperado)
- **Migração/Commit:** (nome da migração MCP · hash/mensagem do commit)
- **Pendências/Sugestões:** (fora de escopo → fica aqui para o Pedro decidir)
```

---

### [SESSÃO S0 · 2026-08-20] Abertura do diário
- **Status final:** concluída
- **O que foi executado:** pasta `plano-salas/` criada com README, PLANO-SALAS, DIARIO e
  `sql/FS1-fundacao.sql`. Nenhum objeto criado no banco ainda.
- **Verificações:** —
- **Migração/Commit:** commit inicial da pasta pelo Pedro.
- **Pendências/Sugestões:** —

---
### [SESSÃO S1 · 2026-08-20 11:15 BRT] FS1-0 — Pré-voo (somente leitura)
- **Status final:** concluída
- **O que foi executado:** ritual §2 passos 1–4. `git remote -v` (origin =
  `github.com/financeiropfbrazil/finances-pf` ✔), `git branch --show-current` = `main`,
  `git pull --rebase origin main` = *Already up to date* (nenhum commit novo do Lovable).
  Árvore sem modificações rastreadas (só untracked pré-existentes alheios ao plano:
  `Relatorio_Modulo_OP.md`, `docs/C3-item3-rpc.sql`, `especies-docfin-canonical.csv`,
  `listagem.txt`, `razao/`). Em seguida as 3 consultas de pré-voo do
  `sql/FS1-fundacao.sql`, somente leitura, via `execute_sql`.
- **Verificações:**
  - (a) `pg_tables` `prod\_%` → **5 linhas**: `prod_apontamento_motivos`, `prod_apontamentos`,
    `prod_atividades`, `prod_itens`, `prod_motivos_refugo`. **= esperado** (exatamente as
    legadas, nenhuma outra). Serve também de **fingerprint de conteúdo do projeto**
    (`current_database()` retorna `postgres` em qualquer projeto Supabase e não identifica nada).
  - (b) `hub_permissions` com `salas.%` → **0 linhas** = esperado.
        `hub_roles` com os 4 códigos novos → **0 linhas** = esperado.
  - (c) `id` de `hub_permissions` / `hub_roles` / `hub_role_permissions` → as 3 com
    `column_default = gen_random_uuid()` = esperado.
  - **Extras (leitura, permitida por §1.1) — dependências do SQL da fase:**
    `public.user_has_permission(p_user_id uuid, p_permission_code text) → boolean` existe com a
    assinatura exata usada nas policies; as 3 funções novas da fase ainda **não** existem;
    papel `admin` existe; `profiles.user_id` e `profiles.is_admin` existem; as 3 tabelas RBAC
    têm todas as colunas referenciadas pelos INSERTs da FS1-6 (`codigo, nome, descricao,
    modulo, is_system, role_id, permission_id`). Baseline: **59 permissões / 14 papéis**.
- **Migração/Commit:** nenhuma migração (fase de leitura). Commit: `salas: FS1-0 — pré-voo`.
- **Pendências/Sugestões:**
  - ⚠️ **Relógio da máquina ≠ relógio do banco (3h).** `TZ=America/Sao_Paulo date` no Git Bash
    devolve `14:15` (o Windows ignora `TZ`; a máquina está efetivamente em UTC) enquanto o banco
    devolve `11:15:33` BRT / `14:15` UTC. Como a **janela de DDL do §1.1 é definida em minutos
    de cron BRT**, adotei o **relógio do banco** como autoridade para timestamps e para a
    checagem de janela. Registrado porque induziria erro em qualquer sessão futura.
