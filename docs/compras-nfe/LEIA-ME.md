# Suprimentos → Notas Fiscais (NF-e de produto) — ajustes

## NFE-S1 (19/10/2026) — status "No Alvo" e fim do lançamento pelo Hub

Ordem do Pedro (19/10/2026): "Arrume o status e remova o botão Lançar e a função que o faz. Não quero recuperar nada dessa função agora."

- **Problema:** a coluna "Lançamento" mostrava o status do próprio Hub (`compras_nfe.status_lancamento`), que só mudaria se a nota fosse lançada pela tela — o que nunca aconteceu (0 lançamentos). 930 de 932 NF-e apareciam "pendentes", 748 delas já lançadas no Alvo.
- **Solução:**
  - RPC nova `compras_nfe_no_alvo(p_de, p_ate)` ([aplicar](NFE-S1-aplicar.sql) · [verificar](NFE-S1-verificar.sql) · [rollback](NFE-S1-rollback.sql)): diz se a nota está no Alvo pelos espelhos (chave de acesso, contas a pagar, Rastreio, Despesas, Intercompany — a mesma regra das candidatas do Rastreio).
  - A tela mostra dois eixos com nome: **No Alvo** (lançada / não encontrada) e **Pedido no Hub** (vínculo feito nesta tela).
- **Removido do código:**
  - o botão Lançar e o Reverter;
  - os "Lotes gerados" (lidos do Alvo direto do navegador);
  - o lançamento V2 (`LancarNfeModalV2`, `LancarNfeItensTable`, `LancarNfePagamento`, `LancarNfeConfirmacao`, `buildMovEstqPayloadService`);
  - o V1 morto (`LancarNfeModal`, `alvoMovEstqLancarNfeService`);
  - `alvoMovEstqLoadService`.
- **Fica como está:**
  - as colunas `status_lancamento` / `erp_chave_movestq` / `lancado_*` de `compras_nfe` (sem DDL);
  - o vínculo de pedido (Vincular / Desvincular);
  - a rota `/mov-estq/save` do erp-proxy, agora sem cliente no Hub (repo separado; remover em tarefa própria se o Pedro quiser).
- **Rollback:** `git revert` do commit do código, depois `NFE-S1-rollback.sql`.
