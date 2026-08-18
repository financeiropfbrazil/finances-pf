# AJUSTE 6.2 — Atribuição em massa no Mapa de Líderes por CC
## Missão Aprovação de Requisições · Fase 6

> `FASE6-MAPA-LIDERES-CC.md` e `AJUSTE-6.1-POS-DISCOVERY.md` permanecem INTACTOS.
> Este Ajuste **complementa** a tela `/settings/lideres-cc` (commit 57d387a, já publicada).
> **Sem SQL novo, sem mudança de banco:** reusa `atribuir_lider_cc`, que já é idempotente.
> Base: uso real de 11/08/2026 — 80 CCs no universo, **78 sem líder**.

---

## 1. Por que

Atribuir 78 centros de custo um a um é inviável. A tela funciona, mas o gargalo virou o volume:
o líder de uma área normalmente responde por **vários** CCs, e hoje isso são vários cliques
idênticos. A massa transforma "uma tarde" em "um minuto por área".

## 2. Decisões (Pedro, 11/08/2026)

| # | Tema | Decisão |
|---|---|---|
| H1 | CC que já tem líder | **Adiciona** o novo (nunca substitui). Mas com **aviso explícito**: "Este CC já tem líder. Deseja mesmo adicionar?" — na atribuição individual **e** na massa |
| H2 | Vários líderes no mesmo CC | **Qualquer um aprova sozinho.** Não há consenso nem ordem. ⚠️ **Já é o comportamento atual** — `aprovar_requisicao` só checa se existe *alguma* linha ativa ligando o usuário ao CC. **Nada a implementar**; só refletir isso na UI |
| H3 | Seleção | **Checkbox por linha + "selecionar todos os visíveis"** (respeitando busca e filtros ativos) |
| H4 | Escopo | Só atribuição. **Revogação em massa fica de fora** — remover liderança de vários CCs de uma vez é destrutivo demais para um clique |

---

## 3. Comportamento da tela

### 3.1 Seleção
- Checkbox em cada linha da tabela.
- Checkbox no cabeçalho = **"selecionar todos os visíveis"**: marca exatamente as linhas que a
  busca/filtros estão exibindo no momento (não a base inteira). Estado indeterminado quando parcial.
- Trocar o filtro **preserva** a seleção já feita, mas o "todos os visíveis" só age sobre o conjunto
  visível — o usuário pode empilhar seleções (ex.: filtra "Administrativo", marca todos; filtra
  "Operacional", marca mais alguns).
- **Linhas órfãs não são selecionáveis** (o CC não existe mais no universo ativo; atribuir daria
  `CC_INVALIDO`). Checkbox desabilitado com tooltip explicando.

### 3.2 Barra de ação
- Aparece quando há ≥1 selecionado: **"N centros de custo selecionados"** + botão **Atribuir líder**
  + **Limpar seleção**.
- Fixa no rodapé (ou topo da tabela), não some ao rolar.

### 3.3 Diálogo de atribuição em massa
1. **Seletor de líder** — um só, aplicado a todos (mesma fonte da atribuição individual:
   `hub_list_users_with_roles`).
2. **Resumo do que vai acontecer**, separado em dois grupos:
   - *"N centros de custo receberão este líder"* — os que estão sem líder;
   - ⚠️ *"M centros de custo **já têm líder**"* — listados com o nome do líder atual e o texto de
     H1: **"Este CC já tem líder. Deseja mesmo adicionar? Ambos poderão aprovar; basta a decisão de
     um deles."** Se M = 0, o bloco não aparece.
   - Se o líder escolhido **já lidera** algum dos selecionados, esses aparecem como *"já é líder —
     será ignorado"* (a RPC reativa sem efeito prático).
3. **Campo de motivo** (opcional, texto livre) — vai para `p_motivo` de todas as chamadas, o que dá
   uma trilha comum ("Reorganização de alçadas 08/2026").
4. Botão **Confirmar** com contagem explícita: "Atribuir a N centros de custo".

### 3.4 Execução e relatório
- Chamar `rpc('atribuir_lider_cc', { p_user_id, p_cc, p_motivo })` **em laço**, sequencialmente
  (não paralelizar: evita rajada e mantém a ordem do relatório).
- Barra de progresso ou contador "processando X de N" — a operação pode levar alguns segundos.
- **Uma falha não aborta o restante.** Ao final, relatório: *"N atribuídos · M falharam"*, com a
  lista dos que falharam e o retorno de cada um (`CC_INVALIDO`, `USUARIO_INVALIDO`,
  `PAPEL_INEXISTENTE`, `SEM_PERMISSAO`). Fallback nunca silencioso.
- Recarregar a tabela e os indicadores (cobertura, "sem líder definido") ao terminar.
- Limpar a seleção só após o relatório ser fechado.

### 3.5 Reflexo de H2 na interface
Onde houver mais de um líder num CC, deixar legível que **qualquer um deles aprova sozinho** — por
exemplo, um tooltip ou uma nota no cabeçalho da coluna Líder(es). É informação de processo, não de
código: evita a leitura errada de que a aprovação seria conjunta.

---

## 4. Fora de escopo

Revogação em massa (H4) · substituição de líder (H1) · importar mapeamento por planilha ·
alçada por valor · notificações · corrigir o sync de CCs (**DÍVIDA-SYNC-CC-FORA-DO-GATEWAY**) ·
fechar RLS de `cost_centers` (**DÍVIDA-RLS-COST-CENTERS**).

## 5. Gate de saída

1. `bun run build` limpo · `tsc --noEmit` sem erros novos · sem regressão de ESLint.
2. **Nenhum SQL executado, nenhuma RPC nova** — se o agente achar que precisa de SQL, deve PARAR e
   reportar em vez de escrever.
3. Selecionar todos os visíveis com filtro ativo marca **só** o conjunto filtrado.
4. Atribuir a 3+ CCs de uma vez: todos ganham o mapeamento, o líder ganha o papel uma única vez,
   cobertura e "sem líder" recalculam.
5. Um CC que já tem líder passa pelo aviso e, confirmado, fica com **dois** líderes ativos.
6. Órfãos não selecionáveis.
7. Commit com staging explícito, **sem push** até revisão.

## 6. Validação

1. Filtrar por `department_type`, "selecionar todos os visíveis", atribuir → conferir no banco:
   `select codigo_centro_ctrl, lider_user_id from compras_lideres_cc where ativo order by 1;`
2. Papel concedido uma vez só:
   `select count(*) from hub_user_roles ur join hub_roles r on r.id=ur.role_id
    where r.codigo='lider_departamento' and ur.revogado_em is null;` — uma linha por líder, não por CC.
3. CC com dois líderes: **cada um** deles vê a pendência daquele CC na fila de Aprovações, e a
   decisão de um encerra para o outro (`STATUS_INVALIDO` + recarga — comportamento já existente).
4. Requisições não são tocadas: `select count(*) from compras_requisicoes;` inalterado.

---

## 7. PROMPT 6.2 — colar na sessão do Claude Code

```
PROMPT 6.2 — Atribuição em massa no Mapa de Líderes por CC

Leia, nesta ordem: CLAUDE.md (protocolo de início) → ESTADO-APROVACAO-REQ.md
→ FASE6-MAPA-LIDERES-CC.md → AJUSTE-6.1-POS-DISCOVERY.md → DISCOVERY-FASE6.md
→ AJUSTE-6.2-ATRIBUICAO-MASSA.md (ESTE MANDA; é o escopo da sessão).

Estado: a tela /settings/lideres-cc está publicada e funcionando (commit 57d387a). SQL da Fase 6.1
executado e com gate verde. 80 CCs no universo, 2 com líder (Pedro × 00010.00002.00003,
Ana Sanches × 00007.00001.00002), 78 sem líder. As 3 RPCs estão no ar.

Escopo: §3 do Ajuste 6.2, apenas frontend. NENHUM SQL, NENHUMA RPC nova — `atribuir_lider_cc`
já é idempotente e serve para a massa, chamada em laço. Se você concluir que precisa de SQL,
PARE e reporte em vez de escrever.

Pontos que exigem atenção:
- "Selecionar todos os visíveis" marca só o conjunto exibido pelos filtros/busca ativos.
- Linhas órfãs (orfao=true) NÃO são selecionáveis.
- O diálogo separa "vão receber o líder" de "JÁ TÊM líder" (aviso de H1) e de "já é líder deste CC".
- Laço sequencial, uma falha não aborta o resto, relatório final com o retorno de cada falha.
- H2 não exige código: aprovar_requisicao já aceita qualquer líder ativo do CC. Só refletir na UI
  que a decisão de um basta.

Gate de saída: §5 do Ajuste. Git: staging explícito, commit
"feat(suprimentos): atribuicao em massa de lideres por CC (AJUSTE 6.2)". SEM push.
Atualize o ESTADO-APROVACAO-REQ.md. Termine com: arquivos alterados, como tratou a interação
entre filtro e seleção, e o que contradisse a espec.
```

---

*Fim do Ajuste 6.2. Depois: revisão, push, Publicar e o mapeamento real dos departamentos.*
