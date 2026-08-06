# ESTADO-APROVACAO-REQ.md — ponto de retomada da missão

> Missão: **Aprovação de Requisições pelo Líder de Departamento**.
> Documentos-mãe (imutáveis por convenção): `CLAUDE_APROVACAO_REQ.md` (guia v2) e `AJUSTE-1.1-APROVACAO-REQ.md` (manda em caso de conflito).
> Este arquivo é o **único mutável** da missão: guarda status e ponto de retomada. Atualizar ao fim de cada prompt.
> Última atualização: **06/08/2026**.

## 1. Onde estamos

| Prompt | Escopo | Status |
|---|---|---|
| **PROMPT 0** | Fase 0 — Discovery (read-only) | ✅ **concluído** → `DISCOVERY-APROVACAO-REQ.md` + `ADENDO-ERP-PROXY-REQCOMP.md` · commit `ad11808` |
| **AJUSTE 1.1** | Decisões A1–A7 + SQL definitivo da Fase 1 | ✅ recebido (autoria do Pedro), incorporado |
| **PROMPT 1** | Fase 1 — SQL pronto para o SQL Editor | ✅ **gerado** → `SQL-FASE1-APROVACAO.md` · commit `51117c7` · **NÃO executado** |
| **PROMPT 2** | Fase 2 — código (split do service + roteamento) | ⏸️ **bloqueado**: depende do SQL da Fase 1 estar aplicado |
| PROMPT 3 / 4 / 5 | Frontend · validação 255 chars · piloto fim-a-fim | ⏸️ não iniciados |

**Nada foi escrito no banco.** O MCP rodou `read_only=true` a sessão inteira (prova: `ERROR: 25006` no `update … where false`). Nenhum arquivo de código do frontend foi tocado.

## 2. Próxima ação — é do Pedro, não do Claude

1. Rodar o **ritual de lock** (§0 do `SQL-FASE1-APROVACAO.md`) — deve voltar vazio.
2. Executar **B1 → B28**, um bloco por vez, no SQL Editor. Se um falhar: parar e trazer o erro.
3. Rodar o **gate de saída G1–G12** (§3 do mesmo arquivo).
4. Com o gate verde, disparar o **PROMPT 2**.

Rollback completo e na ordem correta (trigger primeiro) está no §4 do `SQL-FASE1-APROVACAO.md`.

## 3. Commits locais — **NÃO pushados** (revisão do Pedro pendente)

```
51117c7  feat(suprimentos): sql fase 1 aprovacao de requisicoes (PROMPT 1)
ad11808  docs: discovery aprovacao de requisicoes (PROMPT 0)
```

Ambos contêm **apenas arquivos .md desta missão** — nenhum arquivo de código entrou.

## 4. Pendências abertas

1. **Cobaia da Fase 5** — um usuário `requisitante`, sem `is_admin` e sem papel de líder. Pedro indica. Não bloqueia a Fase 1 nem a 2.
2. **⚠️ Outro escritor ativo no repo (06/08).** Durante a sessão do PROMPT 1 apareceram, sem serem meus, modificações do módulo **OP**: `src/lib/statusRM.ts`, `src/pages/ProducaoOrdemDetalhe.tsx`, `src/pages/ProducaoRM.tsx`, `src/pages/ProducaoRMDetalhe.tsx`, `src/services/reqMatService.ts`, `supabase/functions/sync-reqmat/index.ts`, mais `sql/OP-2.5.sql` e `src/services/alvoReqMatLoadService.ts` (untracked). Quebra o "um escritor por vez" do FH47 — **resolver antes de qualquer push**, e conferir se essas mudanças devem ir num commit próprio do módulo OP.
3. **DÍVIDA-RLS-COMPRAS-REQ** (Ajuste §6): a RLS `ALL using(true)` continua aberta; o trigger B23–B25 protege só a superfície da aprovação. Missão própria, prioridade alta pós-piloto.

## 5. O que a Fase 2 vai encontrar (achados que a condicionam)

- `enviarRequisicao` **cria e envia na mesma função** → precisa virar `criarRequisicao()` + `enviarRequisicaoAlvo(id)`, senão não existe `p_req_id` para `submeter_requisicao`.
- `reenviarRequisicao` recusa status ≠ `rascunho`/`pendente_envio` (`requisicoesService.ts:754`) e **rebaixa para `rascunho`** em falha — apagaria a aprovação. Caminho novo, não reaproveitar.
- Erro de envio vive em **`erro_ultimo_envio` (text)** — decisão A2, sem `erro_envio jsonb`.
- Jobs de sync (1 e 4) já são seguros por filtros positivos + chave `numero_alvo` → **nenhuma mudança em cron**.
- A listagem não filtra status por padrão: pendentes/rejeitadas **aparecem** para quem tem `view_all` (decisão A4: mostrar com badge, não esconder).
- Eventos novos da auditoria (`aprovada_lider`, `rejeitada_lider`, `envio_pos_aprovacao_sucesso`, `envio_pos_aprovacao_falha`, `enviada_aprovacao`, `submetida_sem_gate`) não têm ícone em `EVENTO_ICON` (`SuprimentosRequisicaoDetalhe.tsx:62-69`) — caem no fallback `Clock`. Cosmético, Fase 3.
