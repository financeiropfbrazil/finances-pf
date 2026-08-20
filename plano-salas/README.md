# plano-salas — Agente de execução (Claude Code)

**Projeto:** Movimentação de Salas de Produção · Financial Hub (P&F Brasil)
**Piloto:** Sala de Produção de Ponteiras (linha Cateter / aórtica)
**Esta pasta é a fonte única de verdade do agente.** O Claude Code só executa o que está
escrito no `PLANO-SALAS.md`, registra tudo no `DIARIO.md` e nunca sai do escopo definido.

---

## Infraestrutura

| Item | Valor |
|---|---|
| Repo local | `C:\Users\PFBR-2601-3\finances-pf` |
| GitHub | `https://github.com/financeiropfbrazil/finances-pf.git` (branch `main`) |
| Supabase | `https://hbtggrbauguukewiknew.supabase.co` (projeto `hbtggrbauguukewiknew`) |
| Deploy frontend | Lovable builda automaticamente a cada push na `main` |
| MCP | Supabase MCP em **modo leitura E escrita**, apontado ao projeto acima |

## Pré-requisitos (uma vez)

1. Claude Code instalado e autenticado (PowerShell: `claude --version`).
2. MCP do Supabase configurado **sem** flag de read-only (o agente confirma a capacidade
   de escrita no pré-voo, com o teste-canário autorizado no plano — FS1-0b).
3. Git funcionando no clone local (`git status` limpo antes de começar).

## Arquivos desta pasta

- `README.md` — este arquivo (como rodar).
- `PLANO-SALAS.md` — o plano vivo: contexto, guardrails, ritual, quadro de status e fases.
- `DIARIO.md` — log de execução, **append-only**. O agente escreve aqui ao fim de cada tarefa.
- `sql/FS1-fundacao.sql` — o SQL da Fase 1, statement a statement, com resultados esperados.

## Como rodar uma sessão

```powershell
cd C:\Users\PFBR-2601-3\finances-pf
git pull --rebase origin main
claude
```

E cole o prompt de bootstrap:

```
Leia, nesta ordem: plano-salas/README.md, plano-salas/PLANO-SALAS.md e plano-salas/DIARIO.md.
Identifique no Quadro de Status (§3 do plano) a próxima tarefa pendente.
Execute o Ritual de Sessão (§2) respeitando os Guardrails (§1) à risca.
Ao concluir cada tarefa: registre entrada no DIARIO.md, atualize o Quadro de Status e faça commit.
Ao final da sessão: push para origin main e apresente resumo (feito, verificações, pendências).
Se qualquer verificação divergir do esperado: PARE, registre no DIARIO.md e reporte. Não improvise.
```

## Regras de ouro (versão curta — a completa está no §1 do plano)

1. **Escopo cercado:** só objetos `prod_*` novos + catálogo RBAC do módulo `salas`. Nada além.
2. **Zero DROP / DELETE / TRUNCATE** (única exceção: o canário FS1-0b, definido no plano).
3. **Parou-divergiu-reportou:** verificação que não bate = fim da execução, nunca contorno.
4. **Tudo registrado:** cada tarefa vira entrada no `DIARIO.md` + commit próprio.
5. **`git pull --rebase` antes de qualquer trabalho** — o Lovable também commita na `main`.
