# FS1-9 · AJUSTE A — semeadura com `criado_por` explícito

**Criado em:** 20/08/2026 · **Origem:** SESSÃO S1 (execução da FS1)
**Escopo:** substitui **somente** o primeiro INSERT da tarefa FS1-9. Nada mais do plano muda.

> Este arquivo existe por causa da **regra de imutabilidade** do `PLANO-SALAS.md`: nada é
> apagado ou reescrito; correções entram como seções/arquivos novos. O
> `sql/FS1-fundacao.sql` permanece intacto, inclusive com o statement que falhou.

---

## 1. O que aconteceu

Na SESSÃO S1, o primeiro INSERT da FS1-9 falhou com:

```
ERROR: 23502: null value in column "criado_por" of relation "prod_salas"
       violates not-null constraint
```

**Causa:** a FS1-1 define `prod_salas.criado_por uuid not null default auth.uid()`. A conexão
do MCP é **não autenticada** (`current_user = postgres`, `auth.uid()` = NULL), então o default
resolve para NULL e a constraint barra o INSERT.

**Classificação:** incompatibilidade entre a FS1-1 e a FS1-9 **do próprio plano**, pelo meio de
execução (MCP). Não é erro de ambiente, nem do agente, nem do Supabase. O agente detectou o
risco antes, executou o statement como estava para produzir o erro literal, e parou — conduta
correta conforme §1.3 do plano. Nenhuma linha foi escrita; as 5 tabelas seguiram com 0 linhas.

## 2. Decisão do Pedro (20/08/2026)

**Opção 1 — semear com `criado_por` explícito.**

- A coluna **continua** `not null default auth.uid()` — o default é correto para a escrita que
  virá pela tela (FS3), onde `auth.uid()` existe.
- **Não** tornar a coluna nullable (enfraqueceria a auditoria do cadastro).
- **Não** semear autenticado (não há necessidade de complicar o meio de execução).
- O valor informado é o `profiles.user_id` do Pedro — quem de fato semeou o piloto.

## 3. O que executar

Substitui **e somente** o primeiro INSERT da FS1-9 (o de `prod_salas`). Os INSERTs de
`prod_produtos` e `prod_sala_produtos` seguem **exatamente** como estão no
`sql/FS1-fundacao.sql`.

```sql
-- Passo 1 — obter o user_id do Pedro (esperado: EXATAMENTE 1 linha)
select user_id from public.profiles where email = 'pedro.scrignoli@pfbrazil.com';
```

> ⚠ Se o Passo 1 devolver **0 linhas** ou **mais de 1** → **PARAR**, registrar no `DIARIO.md`
> e reportar. Não improvisar outro critério de busca.
> ⚠ Usar a coluna **`user_id`** (chave canônica do projeto), nunca `profiles.id`.

```sql
-- Passo 2 — semear a sala com criado_por explícito
-- (substituir <USER_ID> pelo valor retornado no Passo 1)
insert into public.prod_salas (codigo, nome, descricao, tipo_producao, criado_por)
values ('PONTEIRAS', 'Sala de Produção de Ponteiras',
        'Piloto do módulo de Movimentação de Salas — linha Cateter (aórtica)', 'CATETER',
        '<USER_ID>');
```

```sql
-- Passo 3 — verificação (esperado: 1 linha, ativa = true, criado_por preenchido)
select codigo, nome, tipo_producao, ativa, criado_por, criado_em
  from public.prod_salas where codigo = 'PONTEIRAS';
```

## 4. Depois deste ajuste

1. Seguir a **FS1-9 original**: INSERT dos 6 produtos e INSERT dos vínculos
   `prod_sala_produtos` (5 INSUMO + 1 PRODUTO), sem alteração.
2. Executar a **FS1-10** completa (NOTIFY pgrst + as 5 verificações finais).
3. Registrar no `DIARIO.md` e atualizar o Quadro de Status (§3) marcando FS1-9 e FS1-10.
4. Commit e push.

## 5. Registros da SESSÃO S1 acolhidos (sem ação nesta tarefa)

- **`apply_migration` bloqueado pelo harness do Claude Code.** Seguir com `execute_sql` está
  autorizado pelo §1.1 ("conforme o MCP expuser"). Consequência conhecida e aceita: os objetos
  desta fase **não** aparecem em `supabase_migrations`.
- **Relógio:** adotar sempre o **relógio do banco** (`select now()`) como autoridade para a
  janela de DDL do §1.1. `TZ=...` no Git Bash do Windows não se aplica de forma confiável.
- **Bypass de admin:** `user_has_sala_permission` retorna `true` na primeira linha para
  `profiles.is_admin`. Testar com a conta do Pedro **não valida nada** — a validação do §7
  exige usuário sem a flag.
- **RPCs de equipe usam permissão global:** quem tem `salas.cadastros.manage` gere a equipe de
  qualquer sala. Coerente com o §0.6 do plano no MVP; reavaliar quando existir a 2ª sala.
