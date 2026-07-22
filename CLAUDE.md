# CLAUDE.md — Financial Hub (finances-pf)

App de gestão financeira da P&F Brasil (Lovable + React + TypeScript). Banco e auth em **Supabase externo** (project ref `hbtggrbauguukewiknew`). Gateway ERP em repo separado (`erp-proxy`, Node + Express, deploy no Render, `https://erp-proxy.onrender.com`). ERP corporativo: Alvo (Riosoft).

**Produção é protegida. Não existe staging — este app É produção, usado por 7 pessoas (Brasil + Áustria).**

Responda sempre em português brasileiro.

## Início de TODA sessão (obrigatório, antes de qualquer outra coisa)

1. Identifique qual prompt está executando (ex.: "Prompt 43.1 — Diagnóstico"). Se o usuário não colou um prompt identificado, pergunte. **Nunca retome tarefa de conversa anterior sem confirmação explícita.**
2. Rode `git remote -v`, `git branch --show-current` e `git log -1 --oneline`. O remote DEVE ser `github.com/financeiropfbrazil/finances-pf`. Se divergir, PARE e avise — não edite nem faça push.
3. `git pull origin main`. Se vierem commits originados no Lovable, mostre a lista antes de seguir.
4. Se a sessão for usar Supabase (MCP ou CLI): o projeto DEVE ser `hbtggrbauguukewiknew` (`https://hbtggrbauguukewiknew.supabase.co`). Confirme por evidência — URL do MCP com `project_ref=hbtggrbauguukewiknew&read_only=true`, e fingerprint query antes de qualquer outra (ver seção 0.5 do plano do módulo). CLI sempre com `--project-ref hbtggrbauguukewiknew` explícito. Projeto divergente = PARE e avise.

## Método de trabalho

- **Uma tarefa por vez.** Explique **problema → causa → impacto → solução → risco** ANTES de executar.
- Nada destrutivo sem aprovação explícita do Pedro. Em dúvida, pergunte.
- Etapas pequenas e reversíveis. Sempre declare o caminho de rollback.
- **Nunca assuma schema.** Leia antes de escrever (information_schema, \d, SELECT de amostra).
- **Nunca altere um prompt já registrado no plano.** Mudanças entram como prompts novos (Ajuste/Correção), preservando o original.

## Git / Lovable (pipeline de código — validado no piloto 43.0-B)

- Edição de código é **direta neste repo** (você edita → build → push → Lovable puxa via GitHub sync no `main`).
- **PROIBIDO** usar `send_message`, `create_project` ou `deploy_project` do MCP do Lovable. Do MCP do Lovable, apenas tools de **leitura** (`read_file`, `list_files`, `get_diff`, `list_edits`) — e só se necessário.
- **Um escritor por vez:** enquanto você estiver ativo neste repo, ninguém prompta no Lovable.
- `npm run build` (ou bun, conforme lockfile) DEVE passar limpo antes de todo push. O projeto usa TS estrito (`noUnusedLocals`) — import órfão quebra o build.
- Commits pequenos e descritivos. **Nunca** push forçado. Rollback = `git revert` + push.
- Push no `main` atualiza o preview do Lovable; o app **publicado** só muda com Publish manual no Lovable.
- Package manager deste repo: **bun** (`bun.lock` é o lockfile vigente; `package-lock.json` está obsoleto). Nesta máquina, `bun install` exige `--backend=copyfile` (antivírus bloqueia o padrão com EPERM).

## Supabase (banco)

- MCP do Supabase fica em **`read_only=true` por padrão**. Writes só com SQL revisado e aprovado pelo Pedro, precedido de **dry-run** (SELECT mostrando exatamente o que será afetado).
- **Migration antes de qualquer query de teste** (causa nº 1 de falso erro "function/column does not exist").
- O editor SQL do Supabase roda **sem autenticação**: RPCs com gate `auth.uid()` lançam "Não autenticado" ali. Conferências leem as tabelas direto.
- **Nunca** `DELETE FROM storage.objects` (bloqueado) — usar Storage API ou o painel.
- RPCs novas com escrita nascem `SECURITY DEFINER` com gate explícito de permissão (`user_has_permission`), nunca abertas.
- UPDATE/DELETE sempre com WHERE revisado; ao alterar view (`CREATE OR REPLACE`), salvar o DDL anterior para rollback imediato.
- **NUNCA `supabase db push` neste projeto:** histórico de migrations divergente do banco (Lovable/MCP escrevem direto — 58 arquivos locais constam como não-aplicados; push tentaria rodar migrations de fev/mar em produção). DDL pontual = SQL editor (Pedro cola) ou psql com connection string.
- **4 projetos Supabase na conta** (`Hub de IA`, `IBBIC`, `Inveentory`, `financeiropfbrazil's Project` = este). Só `hbtggrbauguukewiknew` está `linked`, mas comando sem `--project-ref` explícito ou MCP mal configurado cai no projeto errado. SEMPRE fingerprint (`count` em `compras_pedidos` ~1.650) antes de qualquer escrita.
- `status_local` é enum `public.compras_pedido_status_local` (não texto livre). Novos valores exigem `ALTER TYPE` aplicado por fora **antes** do código usá-los.

## Gateway erp-proxy (repo separado — mudanças de PDF, mappers, sync)

- Vive fora deste repo; deploy no Render. Não misturar mudanças dos dois repos numa mesma tarefa.
- Deploys que afetam o sync saem **fora das janelas do cron** (07h30 / 12h30 / 16h30 BRT, dias úteis) ou com o kill-switch do `sync_settings` acionado.
- Chamadas ao Alvo a partir do frontend: **sempre via gateway** (direto do navegador dá CORS). `alvoService` é browser-side.

## Armadilhas conhecidas do projeto

- **Konto em duas colunas com nomes diferentes:** `konto_at_numero` (em `intercompany_invoices_master_blocos`) vs `konto_austria_numero` (em `..._blocos_manual`). Mesmo conceito, nomes distintos — fonte do Finding F2.
- Mexer na view `v_intercompany_master_unificado` afeta **lista E export Excel ao mesmo tempo** — validação dupla obrigatória (tela + relatório reconciliando).
- `numero_invoice` tem UNIQUE no master (`uq_master_numero_invoice`) — correções de número podem colidir.
- Câmbio 0 em invoice EUR ⇒ `valor_eur = 0` silencioso (padrão do Finding F3).
- Falhas de sync podem ser **silenciosas** (`persistence?.updated ?? 0`) — sempre conferir `sync_runs` após mexer no sync.
- Cache do Vite após instalar dependência pode dar tela branca fantasma (`useLocation` fora de Router) — hard refresh antes de caçar bug de código.
- Padrão de serviço frontend: `(supabase as any).rpc("nome", {params})` via `@/integrations/supabase/client`; todo acesso a dados passa pelos services em `src/services/`.
- `payload_alvo` na bruta **NÃO é o DocFin/Load direto** — é um wrapper `{docfin, nfe, nfse}`; todos os campos (UserInvoice, CotacaoIndice, ParcDocFinChildList...) vivem sob `payload_alvo->'docfin'`.
- Existem DOIS formatos de `payload_alvo` no banco: na bruta intercompany é wrapper `{docfin, nfe, nfse}` (campos sob `payload_alvo->'docfin'`); em `desp_docfin_doc` o DocFin está direto na raiz (`ParcDocFinChildList` na raiz).
- `sync_runs` tem colunas em inglês (`started_at`, `job_type='intercompany'`, `total_*`).
- Códigos de situação do Alvo vistos até hoje: `01.001` (aberta) e `01.002` (paga); código desconhecido = tratar conservadoramente, **nunca** marcar pago automaticamente, apenas logar.

## Constantes rápidas

- Entidade Áustria no Alvo: `CodigoEntidade=0000017` · Filial `1.01` · Moedas: `0000001` BRL, `0000003` EUR · CFOP exportação serviço `7.933.001` · NFS-e série 001.
- Número intercompany oficial = `DocFinUserFieldsObject.UserInvoice` (só vem no `DocFin/Load` com `loadOneToOne=All`, não no `RetrievePage`).
- pg_cron do sync intercompany: jobid 14 (`30 10,15,19 * * 1-5`).

##Para trabalho no módulo de Despesas, leia e mantenha PLANO-DESPESAS.md
##Para trabalho no módulo de Suprimentos (Requisições e Pedidos), leia e mantenha PLANO-PEDIDOS.md — atualize o status ao concluir cada prompt e registre achados no diário (seção 8)

##Para trabalho no módulo de Ordem de Produção (OP), leia e mantenha PLANO-OP.md — leia integralmente no início de toda sessão do módulo, atualize o status ao concluir cada tarefa e registre achados no diário (seção 7). O plano é autocontido: protocolo, modelo de dados, tarefas e decisões vivem lá.