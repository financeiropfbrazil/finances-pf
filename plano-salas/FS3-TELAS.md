# FS3 — Telas (MVP de três eventos)

**Criado em:** 21/08/2026 · **Libera:** a fase FS3, `bloqueada` no §3/§6 do `PLANO-SALAS.md`
**Pré-requisitos cumpridos:**
- FS1 concluída e validada (§7.2: `pode_entrada = true`, `pode_estornar = false` com usuário
  sem `is_admin`);
- FS2 concluída; FS2B (Ajuste B) concluída — os três eventos do MVP existem;
- **Teste funcional das RPCs: 20/20 passando** (21/08, console com sessão real). Bloqueio de
  vencido, conversão de unidade, gates de papel do produto, motivo por tipo, lote obrigatório e
  soft-estorno — todos provados em execução, não só em estrutura.

> Aditivo. Não altera nada do `PLANO-SALAS.md`, `FS2-MOVIMENTO.md` ou `FS2-AJUSTE-B.md`.
> Todos os guardrails do §1 do plano continuam valendo. **Esta é a primeira fase que toca
> `src/`** — leia o §G (regras de frontend) antes de escrever qualquer componente.

---

## §A — O que esta fase entrega

Uma seção nova do Financial Hub, com item de menu próprio, que permite ao operador de produção
registrar **entrada de insumo**, **refugo** e **saída de produto** na sala em que está vinculado
— em tablet ou computador, **usando luvas**, em ambiente limpo.

Fora de escopo (registrado para não voltar por engano): saldo de sala, batelada/lote de
produção com consumo, dashboards analíticos, qualquer leitura ou escrita no Alvo ERP.

### A.1 A restrição que manda no design: luva e paramentação

O operador está de luva, em sala limpa, possivelmente com o tablet dentro de saco selado. Isso
não é preferência estética — é requisito funcional:

- **Alvos de toque grandes:** mínimo 56 px de altura; cartões de escolha com 72–80 px.
- **Zero digitação de texto no caminho normal.** Números entram por **teclado numérico na
  própria tela** (não o teclado do sistema). A única exceção é o lote de produção da saída
  (decisão do Pedro: campo livre) — e ali o teclado do sistema é aceitável.
- **Nenhum seletor de data.** Validade vem junto do lote ou é escolhida em lista.
- **Sem hover, sem menu suspenso pequeno, sem drag.** Toda escolha é botão ou cartão.
- **Alto contraste**, texto de valor em fonte tabular, mensagens de erro em frase completa.
- **Uma decisão por tela.** Fluxo em passos, com botão Voltar sempre visível.

---

## §B — Decisões de produto já fechadas (executar, não rediscutir)

1. **Rótulos.** O módulo se chama **"Movimentação de Salas"** no menu. Dentro, a sala é
   "Sala de Ponteiras". Os três eventos são **Entrada**, **Refugo** e **Saída**.
2. **Lote de produção (saída):** campo **livre e obrigatório**, rótulo **"Lote"**. Se em teste
   com a sala houver confusão com o lote do material, mudar para "Lote de produção".
3. **Lote de material (entrada/refugo):** campo livre nesta fase. Dropdown vindo de
   `op_reqmat_lotes` está **fora do MVP**.
4. **Sala:** o operador vinculado a uma única sala entra direto nela, sem seletor. Com duas ou
   mais, aparece um seletor de cartões no topo.
5. **Correção:** não existe edição. Erro se corrige por **estorno** (botão no log do dia). A
   RPC decide se o usuário pode: autor dentro de 60 min, ou quem tem `salas.estornar`.
6. **Conversão de unidade:** a tela mostra a conversão ao vivo ("2 KG = 2.000 g") mas **não
   calcula nada** para gravar — envia quantidade e unidade; a RPC converte e grava
   `quantidade_base` e `fator_usado`.

---

## §C — Tarefas (adicionar ao Quadro de Status §3 do plano)

| Fase | Tarefa | Descrição |
|---|---|---|
| FS3 | FS3-0 | Pré-voo: mapear padrões do app existente (rota, menu, gate, service, toast) |
| FS3 | FS3-1 | Camada de dados: tipos + `salasService.ts` (queries e chamadas de RPC) |
| FS3 | FS3-2 | Hook de contexto da sala (salas do usuário, produtos, motivos, permissões) |
| FS3 | FS3-3 | Rota + item de menu gateado em `salas.access` |
| FS3 | FS3-4 | Componentes base do estilo caixa (cartão de escolha, teclado numérico, passo) |
| FS3 | FS3-5 | Painel da sala (três botões + log do dia) |
| FS3 | FS3-6 | Tela de Entrada |
| FS3 | FS3-7 | Tela de Refugo |
| FS3 | FS3-8 | Tela de Saída |
| FS3 | FS3-9 | Estorno a partir do log do dia |
| FS3 | FS3-10 | Aba Equipe (vincular/revogar operador) — gate `salas.cadastros.manage` |
| FS3 | FS3-11 | `bun run build` + push + roteiro de validação humana |

---

## §D — Pré-voo (FS3-0) — obrigatório antes de escrever componente

O agente **não inventa arquitetura**: copia a do app. Antes de qualquer código, mapear e
registrar no DIARIO:

1. **Roteamento:** onde as rotas são declaradas (`App.tsx`/`router`), como uma página existente
   é registrada. Espelhar exatamente.
2. **Menu lateral:** onde os itens são definidos e **como o gate de permissão é aplicado**
   (o padrão da casa consome `get_user_permissions`). Achar um item existente gateado por
   `*.access` e copiar o mecanismo.
3. **Cliente Supabase:** caminho do client e como as RPCs são chamadas em módulos existentes
   (ex.: Suprimentos, Intercompany). Reusar o mesmo padrão de tratamento de erro.
4. **UI kit:** confirmar shadcn/ui + Tailwind, e quais componentes já existem (Button, Card,
   Dialog, Toast/Sonner). **Não introduzir biblioteca nova.**
5. **Tema:** o Hub está em migração visual (institucional, sóbrio, sem glow/gradiente,
   `tabular-nums`). Usar as variáveis CSS de `index.css`; **não** criar paleta própria.
6. **Nomenclatura:** olhar 2 ou 3 páginas existentes e seguir a convenção de nomes de arquivo,
   pasta e componente.

Registrar as descobertas no DIARIO **antes** de FS3-1. Divergência grave do previsto (ex.: não
há gate de menu por permissão) → **PARAR e reportar**.

---

## §E — Desenho das telas

### E.1 Painel da sala (FS3-5)

```
┌────────────────────────────────────────────┐
│ Sala de Ponteiras                J. Silva  │
├────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Entrada  │ │  Refugo  │ │  Saída   │    │  ← 96 px, só os permitidos
│  └──────────┘ └──────────┘ └──────────┘    │
│                                            │
│  Hoje na sala                              │
│  09:14  Entrada  Silicone      500 g   [↩] │
│  09:02  Refugo   Ponteira        3 un  [↩] │
│  08:40  Saída    Ponteira       37 un      │
└────────────────────────────────────────────┘
```

- Botões renderizados conforme permissão (`salas.registrar.entrada|refugo|saida`) **e** vínculo
  com a sala. Sem permissão → botão não aparece.
- **Log do dia:** movimentos de hoje da sala, mais recente primeiro, das três tabelas
  (`prod_entradas`, `prod_refugos`, `prod_saidas`). Mostra hora, tipo, item, quantidade + unidade
  e quem registrou. Estornados aparecem tachados, com o motivo.
- `[↩]` = estornar. Aparece quando: autor e < 60 min, **ou** usuário tem `salas.estornar`. A UI
  esconde por conveniência; **a RPC é quem decide** — se ela recusar, mostrar a mensagem dela.
- Estado vazio: "Nenhum movimento hoje. Toque em Entrada para registrar o primeiro."

### E.2 Entrada (FS3-6) — 4 passos

1. **Insumo** — cartões dos produtos com `papel = 'INSUMO'` na sala (5 no piloto), com
   nome_curto e código.
2. **Quantidade** — unidade base pré-selecionada; alternativas da `escala_unidades` como botões.
   Teclado numérico na tela. Conversão ao vivo quando a unidade não é a base.
3. **Lote e validade** — lote em campo livre; validade em lista de opções rápidas ou campo de
   data grande. Só quando `controla_lote` (todos os 6 do piloto).
4. **Conferência** — tudo por extenso + "Registrar entrada".

Chama `prod_registrar_entrada`. Sucesso → toast + volta ao painel com o registro no topo do log.
Erro → mostrar **a mensagem da RPC**, sem traduzir nem reformular (elas já são claras em
português: *"Lote X vencido em 30/06/2026 — não pode entrar na sala"*).

Opcionais (NF, observação) atrás de um botão "Mais dados" no passo 4 — fora do caminho normal.

### E.3 Refugo (FS3-7) — 4 passos

1. **O que foi refugado** — dois grupos: "Peça produzida" (produtos com `papel='PRODUTO'`) e
   "Insumo" (`papel='INSUMO'`). O grupo escolhido define `p_tipo_item`.
2. **Motivo** — de `prod_sala_motivos_refugo`, filtrados por `aplica_a` (o tipo escolhido ou
   `AMBOS`), ordenados por `ordem`, só `ativo = true`.
3. **Quantidade e lote** — igual à entrada; lote obrigatório para insumo.
4. **Conferência** + "Registrar refugo".

Chama `prod_registrar_refugo` com `p_batelada_id = null` (sem batelada no MVP).

### E.4 Saída (FS3-8) — 3 passos

1. **Produto** — cartões com `papel = 'PRODUTO'` (1 no piloto: Sub Assembly A).
2. **Quantidade e lote** — teclado numérico + campo **"Lote"** (livre, obrigatório).
3. **Conferência** + "Registrar saída".

Chama `prod_registrar_saida` com `p_batelada_id = null`.

### E.5 Estorno (FS3-9)

Diálogo simples: o que está sendo estornado, campo de motivo (obrigatório, texto livre) e
confirmação. Chama `prod_estornar_movimento(p_tipo, p_id, p_motivo)`. Sem motivo, a RPC recusa —
a UI também deve exigir antes de enviar.

### E.6 Aba Equipe (FS3-10)

Visível só com `salas.cadastros.manage`. Lista os vínculos ativos da sala
(`prod_sala_usuarios` + `profiles` por **`user_id`**, nunca `id`), permite adicionar usuário e
revogar vínculo — via `prod_sala_usuario_vincular` / `prod_sala_usuario_revogar`.

> ⚠️ **Vincular à sala não concede permissão.** O papel (`operador_salas` etc.) é atribuído no
> admin do Hub. A tela deve dizer isso em uma linha, para o gestor não achar que o vínculo
> basta.

---

## §F — Contratos das RPCs (provados em 21/08 — usar exatamente assim)

```ts
prod_registrar_entrada({
  p_sala_id: uuid, p_produto_id: uuid, p_quantidade: number, p_unidade: string,
  p_lote?: string, p_validade?: 'YYYY-MM-DD', p_nf_numero?: string,
  p_local_origem?: string /* default '001' */, p_observacao?: string, p_data_movimento?: string
}) → uuid da entrada

prod_registrar_refugo({
  p_sala_id: uuid, p_produto_id: uuid, p_tipo_item: 'INSUMO' | 'PRODUTO', p_motivo_id: uuid,
  p_quantidade: number, p_unidade: string, p_lote?: string,
  p_batelada_id?: uuid /* null no MVP */, p_observacao?: string, p_data_movimento?: string
}) → uuid do refugo

prod_registrar_saida({
  p_sala_id: uuid, p_produto_id: uuid, p_quantidade: number, p_unidade: string,
  p_lote_producao: string /* obrigatório, livre */, p_batelada_id?: uuid /* null no MVP */,
  p_observacao?: string, p_data_movimento?: string
}) → uuid da saída

prod_estornar_movimento({
  p_tipo: 'ENTRADA' | 'REFUGO' | 'SAIDA' | 'CONSUMO', p_id: uuid, p_motivo: string
}) → boolean

prod_sala_usuario_vincular({ p_sala_id, p_user_id, p_motivo? }) → uuid
prod_sala_usuario_revogar({ p_sala_id, p_user_id, p_motivo? }) → boolean
```

**Leituras** (RLS já gateada em `salas.access`, basta consultar):
`prod_salas` · `prod_produtos` · `prod_sala_produtos` · `prod_sala_usuarios` ·
`prod_sala_motivos_refugo` · `prod_entradas` · `prod_refugos` · `prod_saidas`.

**`escala_unidades`** é jsonb: `[{"unidade":"GRAMAS","posicao":1,"peso":1}, …]`. A UI usa
`posicao = 1` como padrão e `peso` só para exibir a conversão.

**Mensagens de erro:** as RPCs retornam texto pronto para o operador. Exibir como vieram.

---

## §G — Regras de frontend (guardrails desta fase)

1. **Escopo:** criar arquivos novos do módulo. Alterar arquivos existentes **somente** para
   registrar a rota e o item de menu. Qualquer outra alteração fora do módulo → PARAR e reportar.
2. **Nada de biblioteca nova.** Usar o que o app já tem.
3. **Sem `localStorage`/`sessionStorage`** para estado do fluxo — estado em React.
4. **Toda escrita passa por RPC.** Nunca `insert`/`update` direto nas tabelas (não há policy de
   escrita — falharia de qualquer forma).
5. **Nunca calcular `quantidade_base` no front.** Enviar quantidade + unidade.
6. **Permissões vêm de `get_user_permissions`** (padrão do Hub) **e** do vínculo com a sala.
   Esconder na UI é conveniência; a RPC é a autoridade.
7. **`profiles` sempre por `user_id`.** Nunca `profiles.id`.
8. **Build obrigatório antes do push:** `bun run build` (ou o comando do repo). Build quebrado
   não vai para a `main` — o Lovable publica automaticamente.
9. **Um commit por tarefa**, mensagem `salas: FS3-x — <resumo>`.
10. **Não tocar** nos objetos dormindo (batelada, consumos, view de saldo) nem criar UI para eles.

---

## §H — Critério de aceite da FS3

1. `bun run build` passa sem erro.
2. Com a conta do Pedro: o item "Movimentação de Salas" aparece no menu, a Sala de Ponteiras
   abre, e os três fluxos registram — visíveis no log do dia.
3. Entrada com validade passada é recusada com a mensagem da RPC.
4. Estorno pelo log funciona e o item aparece tachado com o motivo.
5. DIARIO com uma entrada por tarefa, Quadro de Status atualizado, commits e push feitos.

## §I — Validação humana (Pedro — depois do push)

1. **Teste com usuário sem `is_admin`** (§7.2 do plano, ainda aberto): com o `nfe@pfbrazil.com`
   vinculado à Sala de Ponteiras e papel `operador_salas`, confirmar que ele vê o menu, registra
   os três eventos, **não** vê a aba Equipe e **não** consegue estornar registro de outro
   usuário fora da janela.
2. **Teste com luva, no tablet real da sala** — é o único teste que importa de verdade. Ver se
   os alvos de toque servem, se o texto é legível com paramentação e se o fluxo bate com a
   prática.
3. Validar com a sala os **6 motivos de refugo de insumo** (`provisorio = true`) e o rótulo
   "Lote" na saída.
