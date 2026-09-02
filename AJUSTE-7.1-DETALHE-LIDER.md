# AJUSTE 7.1 — Líder consegue abrir o detalhe da requisição que aprova
## Missão Aprovação de Requisições · correção do bug A1.4

> Guia v2 e Ajustes 1.1/1.2/1.3, PROMPT-3-FASE3, FASE6 e Ajustes 6.1/6.2 permanecem INTACTOS.
> Este Ajuste manda dentro do seu escopo. Base: `DISCOVERY-FASE7A.md` (seção A1).
> **Escrito para sessão nova.** Escopo mínimo: corrigir o bug. A visão ampliada (todas as
> requisições e pedidos dos CCs do líder) **NÃO** entra aqui — é a frente A2, ainda não especificada.

---

## 1. O bug

**Sintoma:** o líder vê a requisição pendente na fila (`/suprimentos/aprovacoes`), mas ao clicar em
"Ver detalhe" recebe **"Requisição não encontrada"**.

**Consequência de controle interno:** o líder consegue **decidir apenas pelos botões da fila** — ou
seja, **aprova sem conseguir ler o que está aprovando**. Um aprovador sem acesso ao documento que
autoriza é uma falha de controle, não apenas de usabilidade: à pergunta "com base em quê o líder
aprovou?", hoje não há resposta.

**Causa:** a tela de detalhe (`SuprimentosRequisicaoDetalhe.tsx`) resolve o escopo de visibilidade por
`view_own` / `view_all` **e não tem ramo de líder**. Como a requisição é de outro usuário e o líder
não tem `view_all`, ela é descartada antes de qualquer teste de liderança.

**Por que nunca apareceu:** nenhum líder **sem `is_admin`** jamais havia aberto requisição de outra
pessoa. As decisões anteriores foram auto-aprovações do próprio CC ou passaram pelo bypass de
administrador. Caminho feliz que nunca rodou não é caminho validado.

**Já descartado (não reinvestigar):** não é RLS — a policy de `compras_requisicoes` é
`ALL … using(true)` para `authenticated`; o líder **consegue** ler no banco. O filtro é do frontend.

**Caso real para validar:** requisição `7247431f-a21c-4eca-bfee-514276e7fd12` (requisitante Diego,
`pendente_aprovacao`, CC `00007.00001.00002`), cuja líder ativa é `ana.sanches@pfbrazil.com`.

---

## 2. O que corrigir

### 2.1 Detalhe da requisição (o bug em si)

O escopo de visibilidade da tela passa a ter um **terceiro ramo**, somado aos existentes:

```
pode ver a requisição  ⟸  é o requisitante (view_own)
                       OU  tem view_all
                       OU  É LÍDER ATIVO DO codigo_centro_ctrl DA REQUISIÇÃO   ← novo
                       OU  is_admin (bypass já existente)
```

Regras de implementação:

- O ramo novo consulta `compras_lideres_cc` (`lider_user_id = auth.uid()`, `ativo = true`) e compara
  com `compras_requisicoes.codigo_centro_ctrl`.
- ⚠️ **Cuidado com a dependência circular** apontada no Discovery: o teste de liderança existente
  depende de `req`, que o gate zera antes. **Resolver a liderança em paralelo ao carregamento da
  requisição**, não depois dele.
- ⚠️ **Hooks no topo** — `SuprimentosRequisicaoDetalhe.tsx` já tem um `useHasPermission` chamado
  **depois** de returns condicionais (bug pré-existente herdado do Lovable, `a973f1c`). **Aproveitar
  para corrigi-lo**: todos os hooks no topo, antes de qualquer return.
- **Não afrouxar nada para quem não é líder.** Quem não se enquadra em nenhum dos quatro ramos
  continua vendo "não encontrada".
- **Escopo do que ele vê:** qualquer status **exceto `rascunho` de outra pessoa** — rascunho é
  trabalho em andamento, não documento submetido. Da submissão em diante, tudo.

### 2.2 Correção preventiva — detalhe do pedido

O Discovery aponta que a **tela de detalhe do pedido tem o mesmo padrão**. Quando a visão ampliada
(frente A2) entrar, o líder verá pedidos na lista e não conseguirá abri-los — o mesmo bug, de novo.

**Nesta fase:** apenas **verificar e relatar** se o detalhe do pedido tem o mesmo problema, com
arquivo:linha. **Não corrigir agora** — sem a visão ampliada, o líder ainda não chega à lista de
pedidos, então a correção seria código sem caminho de uso. Fica registrado para a A2.

### 2.3 Não entra neste Ajuste

Visão ampliada de requisições e pedidos (frente A2) · aprovação múltipla por rateio (frente B) ·
qualquer mudança em RLS · qualquer SQL · fila, badges, catálogo de motivos, mapa de líderes.

---

## 3. Regras de engajamento

1. `git pull` antes de tudo — o Lovable também escreve na `main`.
2. **MCP Supabase é read-only.** Nenhuma escrita no banco. Se concluir que precisa de SQL, **PARE e
   reporte** — este Ajuste foi desenhado para não precisar.
3. **Staging explícito** (proibido `git add -A` / `.`). `types.ts` em skip-worktree — não tocar.
   Arquivos de outras missões no working tree — ignorar.
4. **Sem push.** **Publicar** é decisão do Pedro.
5. **Frontend nunca usa `.update()`** (CORS bloqueia PATCH).
6. **Fallback nunca silencioso.**
7. ⚠️ **Zona sensível:** o módulo `compras` tem `view_own`/`view_all` muito marcada — mexer em escopo
   de visibilidade pode **vazar dados entre usuários**. O ramo novo deve ser **aditivo** e escopado ao
   mapeamento; nada é afrouxado para quem não é líder.

---

## 4. Gate de saída

1. `bun run build` limpo · `tsc --noEmit` sem erros novos · ESLint sem regressão.
2. Um líder **sem `is_admin`** abre o detalhe de requisição de outra pessoa **no CC que lidera** →
   carrega, com itens, rateio, valores e anexos legíveis, e os botões Aprovar/Rejeitar disponíveis.
3. O mesmo líder abre requisição de CC que **não** lidera → continua "não encontrada".
4. Usuário sem papel de líder e sem `view_all` → comportamento **inalterado**.
5. Rascunho de outra pessoa → não acessível, mesmo para o líder do CC.
6. Hooks: nenhum chamado após return condicional no arquivo tocado.
7. Relatório sobre o detalhe do pedido (§2.2), com arquivo:linha.
8. Commit com staging explícito, **sem push**.

---

## 5. Validação (Pedro, após Publicar)

Como Pedro é `is_admin`, o bypass mascara o defeito — **a validação exige um líder sem esse
privilégio**. Opções:

- **Ana Sanches** (`ana.sanches@pfbrazil.com`, líder de 12 CCs): pedir que abra a requisição
  `7247431f-…` pela fila de Aprovações. ⚠️ O último login dela é de **11/05/2026**, anterior à Fase 3
  — pedir **recarga forçada** (`Ctrl+Shift+R`) antes de concluir qualquer coisa, para descartar
  bundle antigo em cache.
- **Hugo Maffei** (`hugo.maffei@pfbrazil.com`, `is_admin=false`): mapear temporariamente a um CC com
  requisições de terceiros, validar, e revogar depois.

**Sinal de sucesso:** o líder abre o detalhe, lê itens e valores, e decide **com base no documento** —
não pelos botões da fila.

---

## 6. PROMPT 7.1 — colar na sessão do Claude Code

```
PROMPT 7.1 — Correção: líder não consegue abrir o detalhe da requisição que aprova

Leia, nesta ordem: CLAUDE.md (siga o protocolo de início de sessão) → ESTADO-APROVACAO-REQ.md
→ AJUSTE-7.1-DETALHE-LIDER.md (ESTE MANDA; é o escopo da sessão)
→ DISCOVERY-FASE7A.md (seção A1: a causa já foi mapeada, não reinvestigar do zero).

Contexto: o gate de aprovação está em produção. A líder Ana Sanches vê a pendência na fila mas
recebe "Requisição não encontrada" ao abrir o detalhe — ou seja, aprova sem ler. Já descartado:
não é RLS (policy é ALL using(true)); o filtro é do frontend, que resolve escopo por
view_own/view_all e não tem ramo de líder.

Escopo: §2.1 e §2.2 do Ajuste. NENHUM SQL, nenhuma escrita no banco, nenhum push.
Não implementar a visão ampliada (frente A2) nem a aprovação múltipla (frente B).

Atenção a três pontos que o Discovery levantou:
- dependência circular: o teste de liderança existente depende de `req`, que o gate zera antes —
  resolver a liderança em paralelo ao carregamento, não depois;
- hooks: há um useHasPermission chamado após returns condicionais neste arquivo (herdado de
  a973f1c). Corrigir junto — todos os hooks no topo;
- o ramo novo é ADITIVO e escopado ao mapeamento: nada pode ser afrouxado para quem não é líder.

Gate de saída: §4 do Ajuste. Git: staging explícito, commit
"fix(suprimentos): lider acessa detalhe da requisicao do seu CC (AJUSTE 7.1)". SEM push.
Atualize o ESTADO-APROVACAO-REQ.md. Termine com: arquivos alterados, como resolveu a dependência
circular, o relatório sobre o detalhe do pedido (§2.2), e o que contradisse a espec.
```

---

*Fim do Ajuste 7.1. Depois: revisão, push, Publicar, validação §5 — e só então liberar acesso a
novos líderes.*
