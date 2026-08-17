# PROMPT-EXEC-A1 — Open-load de pedidos via erp-proxy
### Missão de EXECUÇÃO (código) · Card A1 do `PLANO-REVISAO-SUPRIMENTOS-v1.1.md`

> **Prompt imutável.** Mudanças viram `AJUSTE-RS-A1.md`, nunca edição deste arquivo.
> Colar o conteúdo inteiro do bloco abaixo numa sessão nova do Codex, dentro de
> `C:\Users\PFBR-2601-3\finances-pf`.

---

```
MISSÃO A1 — Migrar o open-load de pedidos para o erp-proxy.
Você está EXECUTANDO código desta vez (as missões CDX-1..4 eram leitura pura).

════ CONTEXTO ════
Financial Hub (P&F Brasil), React/TS editado no Lovable. Repo local
C:\Users\PFBR-2601-3\finances-pf, branch main. Windows/PowerShell (grep → Select-String).
Hoje a tela de detalhe do pedido chama o ERP Alvo DIRETO do navegador, autenticando com
credenciais lidas do localStorage (alvo_username/alvo_password). Quem não configurou
essas chaves — toda a operação não-admin — recebe:
  [pedido-detalhe] Falha no open-load: PedCompLoadError: Falha na autenticação ERP
Caso real: operadora Mirlene, 17/08/2026, pedido 0004677.
O gateway erp-proxy já expõe a rota equivalente, autenticada por JWT do Supabase — que
todo operador logado tem. A migração é frontend-only: o repo do proxy é OFF-LIMITS.

════ REGRAS DA SESSÃO ════
1. PREFLIGHT, nesta ordem, antes de qualquer edição:
   git pull --ff-only
   git status
   git branch --show-current
   O working tree tem sobras de outras sessões (arquivos não rastreados). Isso é
   ESPERADO — não limpe, não faça stash, não resolva nada. Se o pull falhar, PARE e
   reporte com git log HEAD..origin/main --oneline.
2. PROIBIDO: git add -A / git add . / git commit -a. Staging individual e explícito.
   src/integrations/supabase/types.ts está em skip-worktree — nunca tocar.
3. PROIBIDO: qualquer SQL de escrita, deploy de Edge Function, alteração no repo
   erp-proxy, chamada HTTP ao Alvo/Render, e "Publicar" no Lovable (é do Pedro).
4. Se houver MCP Supabase na sessão, ele é READ-ONLY. Esta missão não precisa do banco.
5. Leia antes de codar: CLAUDE.md · GUIA-OPERACIONAL-AGENTE.md ·
   PLANO-REVISAO-SUPRIMENTOS-v1.1.md (os três alertas do topo + CARD A1).
6. Números de linha em documentos podem ter driftado — localize por conteúdo.
7. Escopo é sagrado. Achou problema fora dele? Anota em "Achados fora do escopo" e NÃO
   corrige.

════ ESCOPO ════
PERMITIDO EDITAR:
  - src/services/alvoPedCompLoadService.ts   (o alvo da missão)
  - src/pages/SuprimentosPedidoDetalhe.tsx   (SOMENTE se a assinatura mudar)
NÃO EDITAR, mesmo que pareça relacionado:
  - src/services/alvoService.ts (tem outros ~13 consumidores — frente própria)
  - o download de anexos do pedido (segue direto por ora — Bloco F do plano)
  - alvoPedCompService.ts, statusPedido.ts, a Edge do cron, qualquer wizard

════ FASE 1 — LEITURA ORIENTADA (não edite nada ainda) ════
Localize e relate em no máximo 10 linhas:
 a) Como os services JÁ MIGRADOS montam a chamada ao gateway: veja
    alvoEntidadeService.ts, alvoEstoqueService.ts e alvoReqMatLoadService.ts.
    Qual constante/env guarda a URL do proxy? Como obtêm o JWT
    (supabase.auth.getSession() → session.access_token)? Existe helper compartilhado?
    REUSE o padrão existente — não invente um novo.
 b) Em alvoPedCompLoadService.ts: onde está fetchLoadWithRetry, o que ele faz hoje
    (auth + Load + retry), o formato do retorno, a guarda anti-wipe por Numero, o
    helper isPedidoInexistenteNoAlvo e onde PedCompLoadError é lançado.
 c) De onde sai o codigo_empresa_filial do pedido na tela (NÃO hardcodar "1.01").

════ FASE 2 — IMPLEMENTAÇÃO ════
Trocar o TRANSPORTE, preservando toda a semântica:
  DE : authenticateAlvo() + fetch direto em pef.it4you.inf.br (PedComp/Load)
  PARA: GET {URL_DO_PROXY}/ped-comp/{codigo_empresa_filial}/{numero}
        header Authorization: Bearer <access_token da sessão Supabase>

Contrato da rota (verificado no código do gateway — pode confiar):
  • 200 → corpo é o payload CRU do PedComp/Load (Load com loadParent/loadChild/
    loadOneToOne=All). Mesma forma que o service já sabe interpretar hoje.
  • 404 → { error, details }. O gateway já converte o 412 "Precondition Failed" do
    Alvo em 404 por regex na Message. Ou seja: via proxy só chega 404.
  • 502 → { error, details }. O gateway devolve 502 quando o Alvo responde 200 com
    corpo vazio/sem Numero — a guarda anti-wipe na origem.
  • Só GET/POST/OPTIONS e apenas os headers Content-Type e Authorization são aceitos
    (CORS do gateway). Não adicione headers customizados.

PRESERVAR, obrigatoriamente:
  • A guarda anti-wipe do cliente (checar Numero no payload) — redundância intencional.
  • isPedidoInexistenteNoAlvo continua aceitando 404 E 412 (outros caminhos podem ver
    412; não estreite o helper).
  • 404 isolado NUNCA marca excluido_alvo — quem marca é o cron, com cross-check.
  • 502 / erro de rede / sessão ausente → PedCompLoadError SEM nenhuma escrita no
    Supabase (o snapshot local do pedido permanece intacto na tela).
  • As mensagens/logs [pedido-detalhe] que a tela já emite, com o texto de erro agora
    refletindo a causa real (ex.: sessão expirada ≠ ERP indisponível).
REMOVER: o import/uso de authenticateAlvo DESTE arquivo apenas.
Se não houver sessão Supabase válida, falhe com mensagem clara — nunca caia de volta
para credenciais do localStorage.

════ FASE 3 — VERIFICAÇÃO ════
  bun run build          (se bun não existir: npm run build)
  Select-String -Path src\services\alvoPedCompLoadService.ts -Pattern "authenticateAlvo|alvo_username|alvo_password|pef.it4you"
      → esperado: nenhuma ocorrência.
  git diff --stat        → esperado: 1 arquivo (ou 2, se a assinatura mudou).
Nota: teste em localhost pode falhar por CORS — o gateway só libera origens
*.lovable.app / *.lovableproject.com / *.lovable.dev. Isso NÃO é bug do código; a
validação real acontece no preview do Lovable, com o Pedro.

════ FASE 4 — ENTREGA ════
  git add src/services/alvoPedCompLoadService.ts   (+ a page, se alterada)
  git status                                       (conferir que só isso está staged)
  git commit -m "fix(compras): open-load de pedidos via erp-proxy (JWT) — card A1"
  git push
NÃO publicar no Lovable. NÃO tocar em nenhum outro arquivo.

════ RELATÓRIO FINAL (em português) ════
 1. O que foi alterado, com o diff.
 2. O padrão de gateway que você reusou (arquivo de referência).
 3. Como cada item do "PRESERVAR" ficou garantido no código novo.
 4. Riscos ou dúvidas que sobraram.
 5. Achados fora do escopo (1-3 linhas cada, sem aprofundar).
 6. Roteiro de validação para o Pedro: publicar → Mirlene abre 2-3 pedidos (incluindo o
    0004677) → esperado: sem toast "Não foi possível atualizar do ERP", status e itens
    atualizam, e no DevTools nenhuma chamada a pef.it4you.
```

---

*Card A1 do plano v1.1. Próximo da fila: PROMPT-EXEC-B1 (detalhe do líder), só depois da
validação do A1 com a operação.*
