# CLAUDE.md — Missão MOEDA-PEDIDOS

## O que é esta sessão
O Hub exibe pedidos em moeda estrangeira como se fossem Reais (cifrão `R$` hardcoded). Os valores no banco estão corretos numericamente, mas **não há informação de moeda** na tabela `compras_pedidos` — o Hub nunca importou o campo de moeda do Alvo. Esta missão traz a moeda do Alvo, guarda no Hub e corrige a exibição. **Escopo travado** — nada além do descrito em "O que falta". Esta missão é SEPARADA da FH41; não reabrir nada da FH41.

## Contexto e diagnóstico já feito
- Projeto Supabase: `hbtggrbauguukewiknew`. Frontend: finance-pf.lovable.app. Repo local: `C:\Users\PFBR-2601-3\finances-pf`.
- MCP `supabase` conectado em **read-only** — usar para toda verificação de leitura.
- **Fato confirmado por dados:** `compras_pedidos` NÃO tem nenhuma coluna de moeda (verificado via information_schema por %moeda%/%currency%/%cambio%/%dolar%/%usd% → zero linhas). Os campos de valor (`valor_total`, `valor_mercadoria`, etc.) não dizem a moeda.
- **Dois pedidos-cobaia, ambos em DÓLAR** (aparecem como R$ na tela — errado):
  - 0004564 · id `81bc9d4f-61c9-41bd-b544-170b2b895c84` · valor_total 45.72
  - 0004568 · id `d06ecae6-a53d-452a-bbce-5661131e095d` · valor_total 450
  - Ambos: fornecedor QOSINA MEDICAL COMPONENTS (0000303), `criado_no_hub=false` (descobertos, sem criador Hub), `codigo_usuario=MIRLENE.OLIVEIRA`, `codigo_empresa_filial=1.01`.
- **Campo de moeda — CONFIRMADO no payload real de PedComp/Load (pedido 0004564):**
  - `CodigoIndEconomico` = `'0000002'` → moeda. De-para: `0000001`=BRL (R$), `0000002`=DOLAR (US$), `0000003`=EUR (€).
  - **Câmbio no PedComp é `ValorCambio`** (ex.: 5.1211) — **NÃO** `CotacaoIndice`. Atenção: no DocFin o câmbio é `CotacaoIndice`; no PedComp é `ValorCambio`. São dialetos diferentes por entidade. Usar `ValorCambio` para pedido.
  - `ValorConvertido` pode ou não vir no cabeçalho do PedComp (resposta observada foi truncada em 224 chaves; confirmar na implementação). Se não vier, BRL-equivalente = valor × `ValorCambio` — mas NÃO exibir convertido na tela (ver Etapa 5).
  - Bônus observado no cabeçalho (não é desta missão, só registro): `CodigoComprador`, `EmailComprador`, `EmailFuncionario` existem no PedComp — fonte real do comprador/e-mail direto do Alvo.
- **Etapa 1 já CONCLUÍDA** — campo confirmado empiricamente via interceptor no Console do Hub sobre o PedComp/Load do 0004564. Não é preciso puxar payload de novo.

## Arquivos relevantes (do repo local)
- `src/services/alvoPedCompLoadService.ts` — **PRINCIPAL SUSPEITO**: faz o `PedComp/Load` (carrega pedido do Alvo). É onde a moeda chega e provavelmente é descartada.
- `src/services/alvoPedCompService.ts` — listagem/RetrievePage de pedidos.
- `src/services/pedidosService.ts` — grava/monta a linha em `compras_pedidos`.
- `supabase/functions/sync-compras-status-cron/index.ts` — cron de status (reflete aprovação). NÃO alterar sem necessidade.
- Formatação de valor (cifrão hardcoded) a caçar em: telas de pedido (card "Valor total", lista, KPIs), PDF de pedido, e os e-mails `notify-pedido-criador`, `notify-pedido-aprovado`, `notify-pedido-concluido` (todos podem ter `R$`/`fmtBRL` chumbado).

## O que falta (o escopo inteiro — nada além disto), em ordem
1. **[CONCLUÍDA] Confirmar o campo de moeda no PedComp.** Já feito: `CodigoIndEconomico='0000002'` (dólar) confirmado no payload real do PedComp/Load do 0004564; câmbio em `ValorCambio`. Não repetir.
2. **Migração de schema (SQL — Supabase, escrita → só entregar, Pedro roda no SQL Editor).**
   - Adicionar em `compras_pedidos`: `codigo_ind_economico text` (nullable) e `valor_cambio numeric` (nullable). Confirmar via information_schema que não existem antes de criar.
   - Entregar como migração com dry-run; NÃO executar (MCP é read-only; escrita é do Pedro).
3. **Popular no sync — DOIS arquivos (mesmo buraco nos dois):**
   - `alvoPedCompLoadService.ts` (~linhas 372–379, onde monta o objeto do upsert): ler `data?.CodigoIndEconomico` e `data?.ValorCambio` e gravar nas novas colunas.
   - `alvoPedCompService.ts` (~linhas 259–268 e ~461–469, os outros dois pontos de upsert): idem — senão a listagem/batch regrava sem moeda e sobrescreve o Load.
   - NÃO tocar em `resolverValorTotal` (compartilhado e correto — resolve valor, não moeda).
   - Entregar como diff/arquivo para Pedro colar no Lovable (ver regras de git abaixo).
4. **Backfill (SQL — Supabase, escrita).** Re-sync ou UPDATE pontual dos pedidos já sincronizados (começando pelos dois cobaia) para preencher a moeda. Entregar SQL com preview; Pedro roda.
5. **Frontend — fim do cifrão hardcoded.** Criar UM helper de formatação de moeda (de-para `0000001`→`R$`, `0000002`→`US$`, `0000003`→`€`) e aplicar em TODOS os pontos de exibição: card do pedido, lista, KPIs, PDF, e os três e-mails de notificação. **NÃO converter valor** — exibir sempre na moeda original (US$ 450,00), nunca converter para BRL na tela de pedido (introduz câmbio indevido, confunde auditoria). Entregar para Pedro colar no Lovable.

## Regras invioláveis
- **NÃO assumir nome de campo do Alvo.** Confirmar empiricamente (Etapa 1) antes de codar. Nome de campo vindo de DocFin NÃO vale como prova para Pedido.
- **NÃO executar escrita no banco** (INSERT/UPDATE/DELETE/DDL). Gerar SQL pronto (dry-run + apply separado) para Pedro rodar no SQL Editor. Leitura (SELECT/information_schema) pode via MCP read-only.
- **NÃO converter moeda na exibição.** Só trocar o símbolo conforme a moeda real. Valor sempre na moeda original.
- **NÃO tocar em nada da FH41** nem em outras frentes (Intercompany, NF-e, Estoques, DocFin, Recebimento). Não mexer em `notify-pedido-*` além de trocar o formatador de moeda na Etapa 5.
- **NÃO assumir esquema.** Confirmar colunas via information_schema antes de referenciar.
- Uma etapa por vez (1→5). Reportar e obter OK de Pedro entre etapas.

## Regras de git (mesmo fluxo validado na FH41)
- `git pull` antes de qualquer edição. Ponto de retorno: anotar o HEAD atual antes de começar.
- Working tree contém arquivos não relacionados de outras sessões: **PROIBIDO `git add -A` / `git add .` / `git commit -a`**. Staging individual e explícito; `git status` conferido antes de cada commit e mostrado a Pedro.
- Mostrar diff completo + `git status` e obter OK explícito de Pedro ANTES de qualquer commit. Um commit por mudança lógica, mensagem clara (`feat(suprimentos): moeda do pedido (CodigoIndEconomico) — MOEDA-PEDIDOS`).
- Após push, Pedro confere no editor do Lovable e clica **Publicar** (o push não publica sozinho). `src/integrations/supabase/types.ts` está em skip-worktree — nunca tocar.
- Alternativa: se Pedro preferir, entregar arquivos/diffs para cola-manual no Lovable em vez de push.

## Comandos úteis (PowerShell)
- Caçar cifrão hardcoded: `Get-ChildItem -Recurse -Include *.ts,*.tsx | Select-String -Pattern "R\$|toLocaleString|BRL|fmtBRL|Intl\.NumberFormat" | Select-Object Path,LineNumber -Unique`
- Ler o Load de pedido: abrir `src/services/alvoPedCompLoadService.ts` e localizar o parse do retorno do Alvo.

## Critério de encerramento
- Campo de moeda do PEDIDO confirmado empiricamente (nome real + valor `0000002` nos cobaia).
- Colunas de moeda criadas em `compras_pedidos`, sync populando, backfill dos dois cobaia feito.
- Tela de pedido (0004564 e 0004568) exibindo **US$**, não R$; símbolo correto também em lista/KPIs/PDF/e-mails.
- Nenhuma conversão de valor introduzida; valores intactos.
