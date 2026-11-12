# PLANO-PAPEIS — revisão dos papéis e permissões do Hub

Aberto em 12/11/2026 a pedido do Pedro ("Eu quero revisar as roles. Pois já já eu vou ter que liberar para várias
pessoas"). Projeto Supabase `hbtggrbauguukewiknew`. Escrita no banco só sob as tarefas abaixo, com SQL de aplicar,
verificar e rollback em `docs/papeis/`. Toda tarefa só fica validada depois de teste com usuário **sem** `is_admin`.

## 1. Como funciona hoje (levantamento de 11–12/11/2026)

- **RBAC novo:** `hub_roles` → `hub_role_permissions` → `hub_permissions`; `hub_user_roles` (com `revogado_em`).
  `user_has_permission(uid, código)` e `get_user_permissions(uid)`: `is_admin` libera tudo. Atribuição só por admin
  (`hub_assign_role` / `hub_revoke_role`, tela Configurações › Usuários).
- **Sistema antigo de menu:** `user_permissions` (menu_key) — **vazia**. Os módulos que ainda dependem dele (Caixa,
  Recebíveis, Vendas antigo, Estoques, Imobilizado, Comodato, Entidades, Contas a Pagar, Empréstimos, Impostos, Cartões,
  Fechamento, Configurações) e os que checam só `isAdmin` (Despesas, Recebimento, Dashboard) **só abrem para admin**.
- Outros sistemas de papel: `imob_*` (Imobilizado/QR, 2 usuários) e `rh_*` (RH, 1 usuário).

## 2. Achados da revisão

| # | Achado | Gravidade |
|---|---|---|
| A1 | 51 tabelas com policy de escrita "Allow all for authenticated" (pedidos, requisições, contas a pagar, centros de custo, perfis…): o papel só esconde a tela | 🔴 |
| A2 | `profiles`: qualquer logado apagava perfil de outra pessoa e trocava nome / usuário do Alvo / senha obrigatória de outra pessoa (o gatilho `profiles_guard_privilegios` já barrava is_admin, is_active, user_id, email) | 🔴 → PAP-2 |
| A3 | Desativar usuário não corta acesso: `is_active` não é checado no login nem nas permissões; auth não é bloqueado (ex.: guilherme.molinari) | 🔴 → PAP-1 |
| A4 | Módulos antigos sem papel — liberar = tornar admin | 🟠 |
| A5 | Página de entrada e menu assumem Requisições (Intercompany/Produção/Salas/Vendas-only caem em "Acesso Restrito"; Rastreio-only não vê Suprimentos; "Dashboard" de Suprimentos dá Acesso Restrito ao requisitante) | 🟡 → PAP-3 |
| A6 | Contas a confirmar: nfe@ (7 papéis), pscrignoli@gmail (Operador de Produção), Hugo (6 papéis), ryan.santos (Compras + Produção), 3 perfis sem login, 1 e-mail repetido em profiles | 🟡 |
| A7 | `get_user_roles(uuid)` executável por anon sem gate | ⚪ |

## 3. Tarefas

| ID | Tarefa | Onde | Status |
|---|---|---|---|
| NFE-18 | Operador de Compras: NF-e (ver, XML, anexar, comentar — sem vincular), NFS-e, Rastreio (registrada no PLANO-NFE) | SQL + finances-pf | ✅ 12/11 |
| PAP-1 | Desativar passa a cortar o acesso | SQL + finances-pf | ⏳ aguardando ok |
| PAP-2 | Fechar escrita em `profiles` e `user_permissions` | SQL | 🟡 aplicado 12/11 — **teste como usuário pendente** |
| PAP-3 | Página de entrada e menu por papel | finances-pf | ⏳ aguardando ok |
| PAP-4 | Papéis para os módulos antigos (sob demanda: quem entra em qual módulo) | SQL + finances-pf | ⏳ decisão do Pedro |
| PAP-5 | Plano para fechar a escrita das 51 tabelas, módulo a módulo (começar por Compras) | — | ⏳ planejar |

Decisões abertas (Pedro): Analista Fiscal continua criando pedidos/apagando rascunhos?; quem recebe Visualizador de
Vendas (papel novo, VND-7, sem ninguém); contas da A6; revisão do Rastreio de Compras.

## 4. PAP-2 — escrita em `profiles` e `user_permissions`

Ordem do Pedro (12/11): "ok, aplique o 2º". Migration `pap_2_profiles_escrita`; `docs/papeis/PAP-2-profiles-escrita-{aplicar,verificar,rollback}.sql`.

| Tabela | Ler | Criar / alterar | Apagar |
|---|---|---|---|
| `profiles` | todos os logados | só admin | ninguém pela API |
| `user_permissions` | a própria linha (admin: tudo) | só admin | só admin |

Quem grava e continua funcionando: tela de Usuários (só admin, upsert); troca de senha obrigatória
(`hub_clear_must_change_password`, SECURITY DEFINER — o upsert direto de `ResetPassword.tsx` é só reserva e agora só
passa para admin); Edges de convite/criação (chave de serviço). Busca no código: nenhuma outra tela grava nessas tabelas.

## 5. Diário

| Data | Tarefa | Registro |
|---|---|---|
| 2026-11-12 | PAP-2 | Pré-voo: fingerprint 2.459; uma policy "Allow all" (ALL, true/true) em cada tabela, sem FORCE RLS. Aplicado. O 1º teste como usuário (Mirlene × Pedro, em rollback) não rodou: tem UPDATE/DELETE e o servidor do MCP pediu confirmação ao Pedro, que ficou sem resposta. Teste pendente — rodar `PAP-2-profiles-escrita-verificar.sql` com o Pedro acompanhando. |
