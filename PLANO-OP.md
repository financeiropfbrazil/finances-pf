# PLANO-OP.md — Módulo Ordem de Produção (Financial Hub)

**Fonte de verdade do módulo OP. Autocontido: protocolo, decisões, modelo de dados, tarefas e diário vivem aqui.**
Complementa o CLAUDE.md (regras gerais do repo) — em conflito, o CLAUDE.md prevalece.

---

## 0. Protocolo de sessão do módulo OP (obrigatório)

**Início de toda sessão:**
1. Ler este arquivo integralmente antes de qualquer ação.
2. Cumprir o início de sessão do CLAUDE.md: `git pull origin main` primeiro (Pedro pode ter alterado via Lovable entre sessões — se vierem commits do Lovable, listar antes de seguir), conferir remote/branch, e se for usar Supabase: projeto `hbtggrbauguukewiknew` confirmado por fingerprint.
3. Identificar a tarefa a executar (ex.: "OP-1.3"). Se o Pedro não indicou, perguntar. Nunca retomar tarefa de sessão anterior sem confirmação explícita.
4. Conferir a seção 2 (Status): o que está CONCLUÍDA não se refaz; o que está BLOQUEADA tem o motivo anotado.

**Durante:**
- Uma tarefa por vez. Antes de executar: problema → causa → impacto → solução → risco.
- Nunca assumir schema: ler `information_schema`/amostras antes de escrever qualquer SQL ou service.
- Tarefas registradas neste plano são **imutáveis** — mudanças entram como tarefas novas (Ajuste/Correção), preservando a original.
- **Banco:** MCP do Supabase é read-only. Toda DDL/DML sai daqui como bloco revisado → Pedro cola no **SQL Editor** → confirmação empírica (SELECT) antes de qualquer código que dependa dela. NUNCA `supabase db push`. Escritas de app em produção só via RPC `SECURITY DEFINER` com gate de permissão.
- **Blocos SQL para aplicação manual são gravados em arquivo no repo (`sql/OP-x.y.sql`) e copiados DO ARQUIVO, nunca do terminal/chat** — o display colapsa linhas longas e corrompe o SQL. O arquivo é a fonte canônica do bloco; o DDL espelhado neste plano (seção 3) deve bater com o arquivo. Pedro abre `sql/OP-x.y.sql` no editor e copia de lá para o SQL Editor.

**Fim de toda tarefa concluída (nesta ordem):**
1. Atualizar a seção 2 (Status) e registrar achados/decisões no Diário (seção 7).
2. Build limpo (`bun run build` — TS estrito, import órfão quebra).
3. Commit pequeno e descritivo **incluindo este arquivo** + `git push origin main`.
4. Push atualiza só o preview do Lovable — avisar o Pedro quando houver mudança de frontend pronta para **Publish manual**.

---

## 1. Visão do módulo

Controle de Ordens de Produção da P&F (dispositivo médico classe III/IV — rastreabilidade é requisito, não luxo). O fluxo replica e digitaliza o formulário **FRM-07-11** (fonte dos campos) e depois integra com o Alvo via ReqMat.

**Princípios:**
1. **Alvo é dono do estoque físico** — todo movimento de material (baixa/transferência/devolução) acontece via ReqMat no Alvo. O Hub orquestra, registra e reconcilia; nunca inventa saldo.
2. **Ledger imutável** — movimentos são append-only; correção = estorno integral referenciando o original + relançamento. Saldos são views.
3. **Extensível por dados** — tipos de OP, motivos de reprova/perda são cadastros, não enums de código.
4. **Rastreabilidade** — nº de OP em tudo; reason codes obrigatórios; trilha de status; campo `lote` previsto desde já (genealogia futura com Rastro P&F / `NumeroCtrlLote`).

**Equação de balanço (coração do módulo, Fases 2+):**
```
Disponibilizado = Σ Requisitado (ReqMat Retirada) − Σ Devolvido (ReqMat Devolução)
Disponibilizado = Consumido + Reprovado (Qualidade) + Perdas + Saldo em aberto (WIP)
```
No fechamento, saldo em aberto = 0 (sobras → ReqMat Devolução). Rendimento vs. BOM é camada analítica separada (variação pode existir; balanço físico não).

**Máquina de estados:**
```
RASCUNHO ──► ABERTA ──► EM_ANDAMENTO ──► EM_FECHAMENTO ──► FECHADA
     │           │             │                │
     └───────────┴─────────────┴────────────────┴──► CANCELADA
```
Transições permitidas (mapa completo, válido desde já): RASCUNHO→ABERTA · RASCUNHO→CANCELADA · ABERTA→EM_ANDAMENTO · ABERTA→CANCELADA · EM_ANDAMENTO→EM_FECHAMENTO · EM_ANDAMENTO→CANCELADA · EM_FECHAMENTO→EM_ANDAMENTO (reabrir) · EM_FECHAMENTO→FECHADA. Cancelamento exige motivo. Na Fase 1 a UI expõe apenas RASCUNHO→ABERTA e →CANCELADA; EM_ANDAMENTO passa a ser automático na Fase 2 (1ª requisição atendida).

**Fases:**
- **Fase 0** — Investigação ReqMat no Lab de API (Pedro conduz; roteiro na seção 6). **CONCLUÍDA (23/07/2026) — leitura em §6.1, escrita em §6.2.** Restam só **pendências humanas** (§6.2) para destravar a Fase 2.
- **Fase 1** — Fundação interna ao Hub: DDL + RLS/RPCs + lista + modal de abertura + detalhe. **✓ CONCLUÍDA (23/07/2026)** — entregue, validada (gate real provado) e publicada; produção limpa (contador em 500 p/ a 2026-0501 real). **Próxima: Fase 2**, travada pelas pendências humanas (§6.2 + §5 Q3/Q4/Q5).
- **Fase 2** — Requisição de Materiais (erp-proxy: whitelist `ReqMat/Load` + rotas de escrita com mapper; espelho `op_requisicoes` + ledger `op_movimentos`). **Refinada pela Fase 0 (§6.1):** o Hub **cria** a ReqMat (`Descricao` = nº da OP), o **almoxarifado atende no Alvo**, e o Hub **lê o atendido por item via Load e gera o ledger pelo ATENDIDO — sem rota de atender**. Ainda destrava por §5 Q3 (reprova) / Q4 (produto acabado) + pendências de ESCRITA da Fase 0 (§6.1, item 9).
- **Fase 3** — Qualidade (reprovas com motivo, validação contra saldo).
- **Fase 4** — Fechamento (BOM/proporções, wizard, ReqMat Devolução, relatório de yield/scrap, trava).
- **Fase 5** — Perdas avançadas, genealogia de lotes, custo por OP.

---

## 2. Status das tarefas

| Tarefa | Descrição | Status | Data | Notas |
|---|---|---|---|---|
| OP-1.0 | Reconhecimento read-only do terreno | CONCLUÍDA | 22/07/2026 | Achados e ajustes na seção 4.1. Timestamps EN (`created_at`/`updated_at`); permissões pontilhadas `modulo.recurso.acao`; espelho = `stock_products`; RLS Suprimentos aberta; `profiles` sem `setor`. |
| OP-1.1 | Migração: tabelas + seeds + numeração | CONCLUÍDA | 23/07/2026 | Aplicada e **verificada empiricamente via `pg_catalog` (MCP read-only, fingerprint 1686)**: 5 tabelas com RLS ligada (`op_ordens`=28 col, `op_ordem_itens`=9, `op_status_historico`=7, `op_tipos`=6, `op_numeracao`=2); contagens `op_tipos`=3, `op_numeracao`=1, demais=0; **seed 2026=500**; `op_proximo_numero()` SECURITY DEFINER + `search_path=public` + CASE `v_n>9999`; `op_set_updated_at()` `search_path=public`; trigger `trg_op_ordens_updated_at`; 4 CHECKs (status 6 estados, destino, tipo_ordem, tipo_produto). Bloco canônico: `sql/OP-1.1.sql`. |
| OP-1.2 | RLS + RPCs de escrita | CONCLUÍDA | 23/07/2026 | Aplicada (v2) e **verificada via `pg_catalog`** (fingerprint 1686): colunas `fechada_por`/`fechada_em`; 4 policies SELECT (`op_tipos`/`op_ordens`/`op_ordem_itens`/`op_status_historico`; `op_numeracao` deny-all); 3 permissões `producao.*` + papéis `operador_producao`(wiring=2)/`gestor_producao`(wiring=3); 5 RPCs `SECURITY DEFINER`+`search_path=public`; lockdown `op_proximo_numero` (execute=false p/ authenticated+anon), RPCs execute=true. Bloco: `sql/OP-1.2.sql`. |
| OP-1.3 | Frontend: seção Produção + lista de OPs | CONCLUÍDA | 23/07/2026 | **Validada e publicada em 23/07/2026 (ver OP-1.6).** **Código pronto no preview do Lovable** (build limpo). Nav "Produção" gateada por `producao.access`, rota `/producao/ordens`, lista no molde `SuprimentosPedidos`, chips de contagem, filtros server-side, service `src/services/opService.ts`, status `src/lib/statusOP.ts`, permissões espelhadas em `constants/permissions.ts`. **Aguarda validação + Publish manual do Pedro.** |
| OP-1.4 | Modal de abertura (USER 1) | CONCLUÍDA | 23/07/2026 | **Validada e publicada em 23/07/2026 (ver OP-1.6).** **Entregue (código no preview) — validação PENDENTE (OP-1.6).** Build limpo. Modal XL espelhando o FRM-07-11: cabeçalho + grade de itens com picker de SKU dedicado (busca server-side `codigo_alternativo`+`nome_produto`+`codigo_produto`, `codigo_barras` fora), fluxo de teclado (selecionar→foco na qtd, Enter→volta à busca), dedup de SKU, dirty-check, "Salvar rascunho"/"Salvar e abrir" via `op_criar_ordem`(+`op_transicao_status`). **Aguarda validação + Publish do Pedro** (teste real: espelhar a 2026-0007, 3 SKUs de válvula). |
| OP-1.5 | Detalhe da OP + transições | CONCLUÍDA | 23/07/2026 | **Validada e publicada em 23/07/2026 (ver OP-1.6).** **Entregue (código no preview) — validação PENDENTE (OP-1.6).** Build limpo. Rota `/producao/ordens/:id` (clique na linha navega, substitui o toast): cabeçalho com número + badges, bloco de campos (`DataSection`/`Field`), tabela de itens, timeline do histórico; ações por status/permissão: Editar (RASCUNHO→modal em modo edição via `op_atualizar_rascunho`), Abrir (RASCUNHO), Cancelar com motivo (RASCUNHO/ABERTA/EM_ANDAMENTO, gate manage), Registrar aprovação/comunicação (carimbos, gate manage). **Aguarda validação + Publish do Pedro** (cancelar 0501/0502 com motivo "OP de teste da Fase 1"). |
| OP-1.6 | Validação ponta a ponta + saneamento + fechamento Fase 1 | CONCLUÍDA | 23/07/2026 | **SELADA — Publish feito; saneamento reconferido no selo (0/0/0/500, fingerprint 1693).** Bateria completa VERDE (visual + banco, fingerprint 1692): Bloco A (carimbos provados na 0504; qtd 0; dirty-check; edição sem itens; cancelamento c/ e sem motivo), Bloco B (dark/light, filtro+F5 via URL, console limpo), **Bloco C gate real provado** — `nfe@pfbrazil.com` **não-admin**: create efetivo (0505 ABERTA emitida por ele), manage negado, **revogação** (`revogado_em`) tira acesso, higiene dos demais papéis preservada. Numeração 0501–0505, contador=505. Critério **reformulado** (sem recriar a 2026-0007 — BPF). **Saneamento AUTORIZADO** (`sql/OP-1.6-saneamento.sql`). **Falta selar:** Pedro aplica saneamento (reconferir op_ordens=0 / contador=500) + Publish → então OP-1.6 e Fase 1 CONCLUÍDAS. IVC 41 presente+ativo (sem pendência). BL-1 no backlog §8. |
| OP-2.0 | Reconhecimento read-only do terreno de ESTOQUE e RECEBIMENTO | CONCLUÍDA | 28/07/2026 | Achados completos e **consolidados** na **seção 6.3** (retificações da 1ª redação em §6.3-N). Sessão de leitura (Lab de API + SQL read-only no Hub), **sem escrita no Alvo**. **Fluxo de recebimento provado ponta a ponta em 4 tempos:** (1) fiscal lança NF → `MovEstq` tipo `E0000158` com **`ControlaEstoque="Não"`** → **cria o lote** com a quantidade cheia, validade e destino `001`, **sem gerar saldo**; (2) sistema gera **um Laudo por lote** (`Emitido`); (3) Qualidade analisa (`QuantidadeAprovada`/`QuantidadeReprovada`); (4) conclusão → `MovEstq` `E0000163` com `ControlaEstoque="Sim"` → **só a quantidade aprovada vira saldo**. Prova numérica no laudo `0000002070`: lote de 60, aprovadas 21 + reprovadas 39, entrada de **21** un (chave 18072). ⇒ **material reprovado nunca fica disponível para requisição**; a RM pode confiar no saldo do `001`. **Não existe transferência 015→001** — o local de inspeção não é modelado no Alvo. Endpoints provados: `MovEstq/RetornaFichaEstoque`, `MovEstq/Load`, `Laudo/Load`, `laudo/GetListForComponents`. Junção **bidirecional**: `laudo.ChaveMovEstq`→origem e `ficha.Documento`=**número do laudo**→entrada. Valorização **se lê** (`BaseCustoMedio`/`CustoUnitario`); **`CustoMedio` da ficha não é confiável** (2 evidências). **O lote do fornecedor não entra no Alvo** — ruptura da rastreabilidade está no **recebimento**, não na transformação. **Única lacuna que o Hub preenche de forma nativa: o momento físico entre recebimento e inspeção** (`DataRecepcao` é preenchida na conclusão, 3 de 3 casos). |

| REC-1.0 | Espelho do Laudo (`rec_laudos`) | CONCLUÍDA | 28/07/2026 | Bloco `sql/REC-1.0.sql` aplicado pelo Pedro e **verificado empiricamente** (MCP read-only, fingerprint 1720): **39 colunas**, **8 índices** (1 PK + 7), **RLS ligada**, **1 policy** de SELECT (`rec_laudos_select_admin` via `public._is_admin()`), **1 trigger** (`trg_rec_laudos_updated_at`), **0 linhas** antes do 1º sync. Espelho **read-only**: nenhuma coluna é editada por tela; quem grava é a Edge Function (service_role). Chave natural `(codigo_empresa_filial, numero)`. Colunas de enriquecimento nulas até o `Laudo/Load` rodar (`enriquecido_em`). |
| REC-1.1 | Sync do Laudo (Edge Function) + tela de Fila de Inspeção | **CONCLUÍDA** | 28/07/2026 | **Deployada, agendada, validada pelo Pedro e publicada no mesmo dia.** Estado provado no banco (fingerprint 1720): **751 laudos espelhados** — **119 `Emitido`** (a fila) e **632 `Concluído`**; tela no ar mostrando 119 lotes / 1.523 unidades / lote mais antigo com **110 dias** / 31 NFs. Desempenho medido no 1º disparo real: **751 listados + 100 enriquecidos em 14,5 s** (watchdog de 110 s ⇒ folga larga — ver §9.4). O enriquecimento converge nas execuções seguintes (651 pendentes no fim do 1º disparo). Detalhe completo na **seção 9**. Percalço no caminho: o CHECK de `sync_runs.job_type` (REC-1.2). |
| REC-1.2 | `sync_runs.job_type`: estender o CHECK para `'laudos'` | CONCLUÍDA | 28/07/2026 | **Achado que vale como regra permanente do repo.** O 1º disparo do `sync-laudos` falhou no **passo zero**, antes de qualquer chamada ao Alvo: `ERROR 23514 — new row for relation "sync_runs" violates check constraint "sync_runs_job_type_check"`. `public.sync_runs.job_type` tem **CHECK enumerado** e a tabela é compartilhada pelos 7 crons do Hub. ⇒ **Todo sync NOVO precisa estender essa constraint ANTES do primeiro disparo**, senão nem abre o registro de execução. Bloco `sql/REC-1.2.sql` (aplicado pelo Pedro): aditivo, em transação (a tabela é gravada por crons ativos — sem `begin/commit` ficaria sem CHECK entre o drop e o add), preservando os 9 valores originais e acrescentando só `'laudos'`. Nota associada: existe também `sync_runs_triggered_by_check`, restrito a `('pg_cron','manual_admin','test')` — a Edge Function já sanitiza esse valor. |
| REC-1.3 | Fila de Inspeção: filtro de período + exportação XLSX | **CONCLUÍDA** | 28/07/2026 | **Código entregue e buildado (build + `tsc --noEmit` limpos); nada publicado.** (a) **Filtro de período** (Emissão de / até) sobre `data_emissao`, com o date picker já usado no Hub (`Popover` + `Calendar`, molde de `SuprimentosPedidos`), **independentes** (só De, só Até ou os dois), sem default, persistidos na URL (`de`/`ate`) e refletidos nos KPIs — nenhum filtro existente foi alterado; (b) **botão Exportar** (`.xlsx`, SheetJS **já dependência** `^0.18.5`, import dinâmico) respeitando **todos** os filtros ativos, **plano** (uma linha por laudo, sem agrupamento), com as 14 colunas pedidas (+2 na aba Concluídos), **datas como data e quantidades/dias/chave como número** (verificado relendo o arquivo gerado), larguras por coluna, autofiltro no cabeçalho e nome `fila-inspecao_AAAA-MM-DD_HHmm.xlsx`. ⚠ **Freeze de cabeçalho não entregue**: o writer XLSX do SheetJS community 0.18.5 não emite `<pane>` (`write_ws_xml_sheetviews` só escreve `workbookViewId`) — entregue **autofiltro** no lugar; congelar exigiria dependência nova (decisão do Pedro). Novos: `src/services/recebimentoExport.ts`. **VALIDADA pelo Pedro no app publicado** (28/07/2026): período com **De e Até independentes**, sobrevivendo ao F5 e com os KPIs refletindo o recorte; planilha aberta no Excel com **datas ordenando como data**, **zeros à esquerda preservados** em NF e Laudo e **autofiltro** no cabeçalho. **Reconciliação ponta a ponta:** as somas do Excel — **1.760** na coluna Quantidade reprovada e **R$ 13.499,81** em Valor reprovado — batem **exatamente** com o banco (`sum(quantidade_reprovada)` = 1.760,000000000 e `sum(valor_reprovado)` = 13.499,81, em 15 laudos), o que prova a cadeia Alvo → espelho → tela → XLSX sem perda nem coerção para texto. |

| REC-1.5 | Fila de Inspeção: dropdown único de status + valor reprovado | **CONCLUÍDA** | 28/07/2026 | **Código entregue e buildado (build + `tsc --noEmit` limpos); nada publicado.** (a) **Toggle do topo REMOVIDO** — havia dois controles para a mesma coisa (o toggle "Aguardando liberação / Concluídos" e o dropdown "Status"), que podiam divergir; o **dropdown passa a ser a única fonte de recorte**, default `Emitido`, com a opção **"Todos"** (impossível com o toggle). Links antigos com `?aba=concluidos` continuam funcionando (caem em `Concluído`). (b) **Colunas e KPIs seguem o dropdown:** "Dias parado" só onde há espera; resultado/aprovada/reprovada/valor só onde houve inspeção; em "Todos" **todas as colunas aparecem e a que não se aplica fica vazia, decidido por LINHA** (`status`), mais a coluna "Status" para distinguir as linhas. KPIs: 4 em Emitido, 5 em Concluído, 6 em Todos (grade estática por contagem). (c) **Valor reprovado:** KPI em R$ (quando o recorte inclui concluídos), coluna na tabela e coluna no Excel **tipada como número**. Referência conferida no banco: **15 laudos com reprova, R$ 13.499,81** no ano. (d) Correção de coerência: "lote mais antigo" (KPI e badge do grupo) passou a contar **só os não concluídos** — um laudo liberado não está esperando. ⚠ **Não foi inventado valor para os pendentes:** `rec_laudos` só tem `valor_reprovado`; valorizar a fila exige `CustoUnitario`/`BaseCustoMedio` do MovEstq de origem ⇒ **REC-2.0** (§9.5). **VALIDADA pelo Pedro no app publicado** (28/07/2026, dark e light): o dropdown governa o status sozinho (toggle fora), "Todos" mostra as 14 colunas com "—" no que não se aplica, e o KPI **Valor reprovado fecha R$ 13.499,81** — conferido também pela **soma da coluna no Excel exportado** (prova de que saiu como número, não texto). |

| REC-1.6 | Fila de Inspeção: responsividade dos KPIs, dos filtros e da tabela | **CONCLUÍDA (superada pela REC-1.7)** | 28/07/2026 | **Tarefa de LAYOUT — nenhuma regra de negócio tocada** (filtros, agrupamento, expandir/recolher, exportação e os próprios KPIs seguem idênticos). Código entregue e buildado; nada publicado. (a) **KPIs:** a grade passou a **quebrar em linhas** — `grid-cols-1 sm:2 lg:3 2xl:6` (6 cards) / `…2xl:5` (5) / `…lg:4` (4). A causa real do card sair da viewport era `min-width:auto` no item de grid: o rótulo longo (ex.: "TEMPO MÉDIO DE INSPEÇÃO") empurrava o card em vez de quebrar ⇒ `min-w-0` + `break-words` em toda a cadeia do `KpiCard`. (b) **Barra de filtros:** de `flex-wrap` para **grid** `1 / sm:2 / lg:3 / 2xl:6`, o que mantém "Emissão de" e "Emissão até" **na mesma linha** em 2, 3 e 6 colunas; as ações (Limpar / Recolher / Exportar) saíram para linha própria e não disputam mais espaço com os campos. (c) **Tabela:** rolagem horizontal com **"Laudo" e "Produto" congelados** (`sticky left-0` / `left-[116px]`, larguras explícitas de 116px e 240px, `border-r` de corte, `z-20` no cabeçalho e `z-10` no corpo); o **cabeçalho do grupo de NF** também acompanha, via conteúdo `sticky` dentro da célula com `colSpan`; `w-max min-w-full` na tabela para ela **crescer e rolar** em vez de espremer as 14 colunas. **Efeito colateral necessário e declarado:** o hover da linha passou de `bg-muted/30` para **`bg-muted` opaco** — coluna congelada com fundo translúcido deixaria o conteúdo rolar visível por baixo. (d) **Item 4 verificado (régua do "lote mais antigo"): NÃO muda entre "Emitido" e "Todos"** — 110 dias nos dois; a correção da REC-1.5 está valendo em todos os caminhos (sem ela, "Todos" mostraria **202**, o máximo global puxado por um concluído antigo). ⚠ **Esta entrega NÃO resolveu o vazamento de layout** — o diagnóstico foi feito por leitura de CSS, sem medir; a causa real só apareceu na **REC-1.7**, que mediu em navegador. As colunas congeladas e o "lote mais antigo" desta tarefa, sim, foram validados. |

| REC-1.7 | Fila de Inspeção: correção da responsividade (a REC-1.6 não resolveu) | **CONCLUÍDA** | 28/07/2026 | **Causa raiz encontrada MEDINDO em navegador, não por leitura de CSS** (a REC-1.6 falhou justamente por eu ter raciocinado sem exercitar o layout). Repro montado com o **CSS compilado do build** e a árvore real do `AppLayout`: `html/body` com `clientWidth 1530` e `scrollWidth 1812` (**a página rolava**), `div.flex-1.flex-col` inflado a **1556** — maior que a viewport — e o container `overflow-x-auto` da tabela com `scrollWidth == clientWidth`, ou seja **não rolava: era esticado até caber a tabela inteira**. Com o container inflado, KPIs (1508) e filtros ficavam mais largos que a área visível ⇒ cortados à direita. **Hipótese (a) confirmada; (b) refutada** — testada a mesma grade `2xl:grid-cols-6` DEPOIS da correção: 6 cards de 192px, nada cortado (o `grid-cols-6` nunca foi a causa). **Correção (testada uma a uma no repro):** `overflow-x:hidden` no raiz **não resolve**; `max-w-full`+`min-w-0` no raiz **não resolve**; **`w-0 min-w-full` no container de rolagem resolve** (a largura intrínseca vira 0 e para de subir a cadeia) — e `grid grid-cols-1` (`minmax(0,1fr)`) no raiz da página resolve também; aplicados **os dois**. Medição final: página **não rola** (`scrollWidth == clientWidth == 1530`), coluna do layout de volta a **1274** (= viewport − 256 da sidebar), tabela rolando sozinha (1225 visível / 1506 de conteúdo), **nenhum KPI ou filtro cortado**, date pickers na mesma linha e colunas fixas grudadas em 0/116 com 282px de rolagem aplicada — conferido em **dark e light** (fundo `rgb(255,255,255)` opaco na coluna fixa). Também: grade dos KPIs simplificada para **uma só** (`1 / sm:2 / lg:3 / xl:4`, no máximo 4 por linha) e rótulo "Tempo médio de inspeção" → **"Tempo médio"** (texto completo no `title`). **Layout compartilhado NÃO foi tocado** — ver a recomendação em §9.6 (virou **BL-4**). **VALIDADA pelo Pedro no app publicado** (28/07/2026, dark e light, ~1900px): **nenhuma rolagem horizontal na página — só na tabela**, nenhum KPI ou filtro cortado, colunas **Laudo** e **Produto** fixas ao rolar, e o KPI **"Lote mais antigo" estável em 110 dias** entre "Emitido" e "Todos" (sem regressão para 202). |

| REC-1.8 | Sidebar: reordenar por fluxo (só ordem, sem tocar em gates) | **CONCLUÍDA** | 28/07/2026 | **Só ordem — provado por teste, não por inspeção visual.** A sidebar é compartilhada (100+ usuários), então antes de mexer capturei a ordem e os gates REAIS renderizando o componente em **vitest + jsdom** (a infra já existia no repo): baseline de **24 entradas**. Depois da mudança: **24 entradas**, mesma lista, na ordem pedida (Dashboard · Compras · Suprimentos · NF Entrada · Email NF-e · Recebimento · Estoques · Produção · financeiro · patrimônio/contrapartes · gestão/apoio · Configurações). **Prova de que nenhum gate mudou:** varri **23 combinações** (cada permissão isolada + admin sem RBAC + tudo liberado), comparando o resultado do código antigo (via `git stash`) com o novo — **0 divergências**. **Mecanismo:** a montagem deixou de injetar grupos como efeito colateral de "âncoras" (`nav.commodatum`, `nav.nf_entrada`, `nav.loans`, `nav.closing`, cada uma com a lógica duplicada para quem não via a âncora) e passou a ser uma **lista declarativa única**, onde a ordem do array É a ordem renderizada e cada entrada carrega o próprio gate. `navItems`, `routePermMap`, ícones, rotas, rótulos, `perm` e `adminOnly` **intactos**. O "guard ampliado" da OP-1.3 deixou de existir como código porque a âncora que o exigia sumiu — **o comportamento que ele garantia continua**, agora por construção (confirmado no teste: não-admin só com `producao.access` continua vendo exatamente "Produção"). **Achado registrado, NÃO corrigido:** o grupo **Ferramentas dependia da permissão `closing`** (era injetado dentro da âncora de Fechamento) — mesmo defeito que a OP-1.3 corrigiu para `nf_entrada` e que nunca foi replicado. Preservei a amarra deliberadamente (fora do escopo desta tarefa) e deixei comentado no código; hoje não afeta ninguém (o único usuário com a permissão é admin, que tem bypass). Soltar isso é decisão do Pedro, em tarefa própria (**BL-2**). **VALIDADA pelo Pedro no app publicado** (28/07/2026): nova ordem no ar, **cadeia contígua** (Compras → Suprimentos → NF Entrada → Email NF-e → Recebimento → Estoques → Produção), **nada sumiu** e os grupos abrem/fecham. O teste que serviu de prova virou **regressão permanente**: `src/test/sidebar-ordem.test.tsx` (7 casos — ordem selada, contagem 24, e o gate de cada permissão isolada). |

| REC-1.4 | `Laudo/Load`: parar de enviar `codigoEmpresaFilial` + falha nunca carimba | **CONCLUÍDA** | 29/07/2026 | **Deployada e PROVADA em produção (29/07/2026): 751/751 laudos com `enriquecido_em`, incluindo o `0000001556` — o laudo que falhava no Lab exatamente por causa do parâmetro. Commit `1bd4a69`.** Três correções, uma superfície só (`supabase/functions/sync-laudos/index.ts`), sem DDL, sem frontend, sem permissão. **(A)** URL do `Laudo/Load` agora manda só `numero` + os três `load*`; `codigoEmpresaFilial` **não existe** na assinatura real (`LaudoController.Load(String numero, List loadParent, List loadChild, List loadOneToOne)`) e era a causa da intermitência. A filial continua no `WHERE` do UPDATE — é chave do espelho, não parâmetro do endpoint. Whitelist do gateway casa sem query string ⇒ **erp-proxy intocado**. **(B)** HTTP 200 deixou de ser prova de sucesso: `analisarRespostaLaudo()` decide por **estrutura** — falha se o corpo não é objeto, se traz chave de envelope de exceção .NET (`ExceptionType`, `ExceptionMessage`, `ClassName`, `StackTrace(String)`, `InnerException`, `BrokenRules(Collection)`, `Message`, `MessageDetail`, `ModelState`) ou se não tem **âncora de Laudo com valor** (`Numero`/`NumeroCtrlLote`/`ChaveMovEstq` não nulos). Busca textual só **dentro dos campos de mensagem**, nunca no corpo inteiro — o `Texto` do laudo é livre, em pt e alemão. **(C)** `enriquecido_em` só é carimbado em **sucesso**: em falha nada é gravado, o laudo segue com `enriquecido_em is null` e volta na fila; o número entra em `sync_runs.detalhes` numa entrada **agregada** (até 20 números + contagem total + motivos), e a falha individual **não aborta o lote**. **Provado com 12 corpos representativos** contra o código real: laudo cujo `Texto` contém "Exception/Fehler/erro/StackTrace" passa como válido (**zero falso-positivo**), enquanto `BrokenRulesException`, `"No action was found on the controller"` e o envelope que ecoa `"Numero": null` são barrados. **Pendente para CONCLUÍDA:** deploy da Edge Function pelo Pedro + 1 disparo com `total_erros` conferido. |
| REC-2.0 (passo C) | Valor e fornecedor via `MovEstq/Load` no `sync-laudos` | **CONCLUÍDA** | 29/07/2026 | **Deployada e PROVADA em produção (29/07/2026): 1ª rodada `chaves=40 ok=40 falha=0 valorizados=86 sem_item=0` em 17,3 s (~370 ms/chave). Após 4 rodadas, os 119 laudos da fila estavam 100% valorizados. Commit `9493b63`.** Terceiro passo de enriquecimento, **aditivo** — passos A e B intocados, sem DDL (as 9 colunas já existiam, conferidas), sem frontend, sem permissão, sem tocar no erp-proxy. Varredura por **`chave_movestq` DISTINTA** (não por laudo): `MOV_BATCH = 40` chaves por execução, `mov_enriquecido_em is null`, ordem `chave desc`; 295 chaves cobrem os 751 laudos ⇒ converge em ~8 rodadas. Uma chamada `MovEstq/Load?codigoEmpresaFilial=1.01&chave=<C>&…` resolve todos os laudos da chave, casando **`Sequencia` do item ⇄ `sequencia_it_movestq` do laudo**. Grava custo/valor unitário, `valor_custo_lote` (**custo × quantidade do LAUDO**, nunca a do item), fornecedor do cabeçalho (`CodigoEntidade`/`NomeEntidade` — no laudo é sempre null, §6.3-D), `ControlaLote`, `CodigoTipoLanc`, o item cru e `mov_enriquecido_em`. **Robustez herdada do REC-1.4:** `analisarRespostaMovEstq()` com a mesma régua estrutural (âncoras `Chave` + `ItemMovEstqChildList`), **lista vazia = falha da chave**, carimbo **só em sucesso**, falha de uma chave não aborta o lote, e **laudo cuja sequência não casa é falha DO LAUDO** (não da chave) — não carimba, é contado e registrado. Métricas novas em `sync_runs`: `chaves_lidas`, `chaves_ok`, `chaves_falha`, `laudos_valorizados`, `laudos_sem_item_casado`, mais duas entradas agregadas em `detalhes` (até 20 chaves com motivo, até 20 laudos sem item). **Nada foi condicionado a `ControlaLote` nem filtrado por `CodigoTipoLanc`** (variam: E0000158 nacional, E0000160 importação). **Provado contra o código real:** 10/10 casos de análise estrutural + casamento da chave 18094 (sequências 1/2/3 → 18/16/14 un × R$ 669,73 = 12.055,14 / 10.715,68 / 9.376,22), com o controle de que usar a quantidade do item (48) daria R$ 32.147,04. **Pendente para CONCLUÍDA:** deploy + 1 disparo + validação do Pedro. |

| REC-2.1 | Fila de Inspeção: KPI de valor | **CONCLUÍDA** | 29/07/2026 | **Código entregue e CONFERIDO contra o banco (29/07/2026): recorte padrão `Emitido` = R$ 963.505,23 com `sem_valor = 0`, batendo com o KPI previsto. Falta só o Publish pelo Pedro. Commit `9ce2582`.** Um KPI a mais no bloco existente, mesmo `KpiCard`, **no fim da lista** (nenhum KPI existente mudou de posição, rótulo ou cálculo). Soma `valor_custo_lote` do conjunto **já filtrado** — os KPIs são calculados no client sobre o array que a tela usa, então o novo herda status, produto, NF, faixa de dias e período sem query nova. **Regra do nulo:** `valor_custo_lote` null (enriquecimento do passo C ainda não alcançou o laudo) **não entra na soma** e é contado à parte; havendo n > 0, o card mostra "n lotes sem valor" na linha `sub` — o total nunca aparece menor sem explicação, e o aviso some sozinho quando o passo C terminar. Formato **BRL sem centavos** (`maximumFractionDigits: 0`), `tabular-nums`, sem cor (valor não é exceção). **Uma decisão além do texto do prompt:** o rótulo acompanha o recorte, como já fazia o de lotes — "Valor aguardando liberação" (Emitido), "Valor inspecionado" (Concluído), "Valor total" (Todos); chamar de *aguardando liberação* um total que inclui concluídos seria falso. Reverter para rótulo fixo é uma linha. Também incluído `valor_custo_lote` no `select` explícito do service (a query não o trazia) e na conversão `numeric`→número. **Números esperados na validação** (28/07/2026): Emitido **R$ 963.505 / 0 sem valor**; Concluído **R$ 1.135.471 / 360 sem valor**; Todos **R$ 2.098.976 / 360 sem valor**. |
| REC-3.0 | Releitura condicional do passo B + flag de ausência no passo A | **CONCLUÍDA** | 30/07/2026 | **Deployada e PROVADA em produção (30/07/2026).** Commit `1b28765`; DDL em `sql/REC-3.0.sql`. **(A) Releitura condicional.** O passo B só relia `enriquecido_em is null`; 120 laudos `Emitido` já tinham sido lidos **vazios** (a inspeção ainda não acontecera) e, ao serem concluídos, ficariam com quantidade_aprovada/reprovada, valor_reprovado, texto_resultado, data_recepcao e examinador **zerados para sempre** — o KPI de valor reprovado somaria R$ 0 numa reprova real. **Defeito já consumado quando a tarefa foi escrita:** laudo `0000002149` (água destilada, 180 un) estava `Concluído`/`Aprovado` no espelho com `quantidade_aprovada = 0`. Novas colunas `load_status_lido` e `load_resultado_lido` guardam o estado da última leitura; a fila do passo B passa a ser `enriquecido_em is null OR precisa_releitura`. **(B) Flag de ausência.** O passo A faz upsert e nunca delete — laudo excluído no Alvo virava fantasma. Agora marca `ausente_desde` em quem está no espelho e não voltou na listagem, **sem apagar**, e limpa se reaparecer. Guardas: só marca com listagem completa e sem erro; se os ausentes passarem de **5% do ano**, não marca nada e registra em `detalhes` (falha fechada). **Provado:** `relidos_por_mudanca=1`, `ausentes=0`, `total_erros=0`; o `2149` voltou com 180 aprovadas e `data_recepcao` preenchida. |
| OP-2.1 | Whitelist no erp-proxy: `reqMat/GetListForComponents` + `ReqMat/Load`; remover `Produto/GetRegistros` no mesmo commit (BL-6) | CONCLUÍDA | 04/08/2026 | **Verificada em campo (04/08/2026): `ReqMat/Load` 200; `Produto/GetRegistros` 403.** Commit `45db047` no `erp-proxy`. Leitura pura, risco zero. Repo `erp-proxy`. |
| OP-2.2 | DDL do espelho de RM — `sql/OP-2.2.sql`, aplicado pelo Pedro no SQL Editor | **CONCLUÍDA** | 05/08/2026 | **Aplicada pelo Pedro e verificada empiricamente contra o arquivo, coluna a coluna** (MCP read-only, fingerprint `compras_pedidos` = **1796**): 4 tabelas com **28 / 28 / 17 / 12** colunas — nomes, ordem, tipos, precisão (`numeric(18,9)` nas 10 quantidades), nullability e defaults **idênticos** ao `sql/OP-2.2.sql`; `precisa_releitura` com `attgenerated='s'` (**STORED**) e a expressão preservada (o Postgres normalizou `not in ('Atendida Total')` para `<> 'Atendida Total'` — forma canônica de `NOT IN` de elemento único, semanticamente igual); **20 índices** (16 + 4 PKs), os 3 parciais com o predicado certo; **RLS ligada nas 4**, 4 policies, todas `SELECT` `to authenticated`, **nenhuma de escrita**; trigger `trg_op_reqmat_updated_at` reusando `op_set_updated_at()`; FKs com `ON DELETE CASCADE` e `numero_reqmat` **sem** FK, como desenhado; 0 linhas. **Zero divergências.** ⚠ Duas colunas faltaram por leitura equivocada de 04/08 e entram aditivas na OP-2.3 (`codigo_tipo_req_mat`, `numero_ord_produc` no cabeçalho) — a OP-2.2 **não foi alterada**. |
| OP-2.3 | Edge Function `sync-reqmat` — dois passos, molde do `sync-laudos` | **CONCLUÍDA** | 05/08/2026 | **Validada em campo (05/08/2026): 679 RMs espelhadas, 0 erros, ciclo completo provado na RM 0000002271.** **Payload da listagem VALIDADO EM CAMPO pelo Pedro (05/08/2026) antes de virar código** — era a única incógnita bloqueante. Entregues `supabase/functions/sync-reqmat/index.ts` e `sql/OP-2.3.sql`. Type-check no arquivo (`tsc --noEmit --noResolve --skipLibCheck`) com **perfil idêntico ao do molde**: só o módulo remoto e `Deno`, zero erro local. **Estado em 05/08/2026, fim do dia:** seções 1–4 do SQL **aplicadas** (CHECK, kill-switch, 2 colunas + índices, RPC) — a 1ª tentativa abortou com `23502` por `schedule_cron` NOT NULL e foi corrigida. Função **deployada**, mas **nenhum disparo bem-sucedido ainda**: faltavam o `verify_jwt=false` no `config.toml` e o `call_sync_reqmat_cron`, que eu havia deixado comentado junto com o agendamento. **Sequência de fechamento, executada pelo Pedro no mesmo dia:** (1) seção 5 do `sql/OP-2.3.sql` (disparador) aplicada; (2) redeploy com o `verify_jwt=false` do `config.toml`; (3) `select public.call_sync_reqmat_cron('manual_admin');` — **679 RMs espelhadas, `total_erros = 0`, ~370 ms por `ReqMat/Load`**; a fila entrou em **platô**, como previsto (`precisa_releitura` não zera para RM não-terminal). ⏸ **Único item ainda aberto: descomentar o agendamento (seção 6)** — decisão do Pedro depois de olhar a medição. Detalhe em §10.15; ciclo completo em §10.18. |
| OP-2.4 | Tela `Produção > RM` — LEITURA (fila + detalhe + consolidado na OP) | **ENTREGUE (validação e Publish pendentes)** | 06/08/2026 | **Código no preview; nada publicado, nada aplicado no banco, nada escrito no Alvo.** Novos: `src/lib/statusRM.ts` (3 literais do Alvo, fonte única), `src/services/reqMatService.ts`, `src/pages/ProducaoRM.tsx` (fila), `src/pages/ProducaoRMDetalhe.tsx` (detalhe por **número**, não uuid), `sql/OP-2.4.sql`. Editados: `App.tsx` (2 rotas, gate `producao.rm.access`), `AppSidebar.tsx` (sub-item "RM" com `perm`, `renderProducaoGroup` passou a receber `hasAccess` e a **não renderizar grupo vazio**), `constants/permissions.ts` (3 códigos espelhados), `ProducaoOrdemDetalhe.tsx` (seção de consolidado). Filtro-base **fixo e invisível** `codigo_tipo_req_mat='0000002'` em toda consulta. Validação: `tsc --noEmit -p tsconfig.app.json` **0 erros**, `bun run build` limpo, `vitest run` **8/8** (inclui os 7 do `sidebar-ordem`, que **não** precisaram de alteração — selam o topo, e o item novo é sub-item). ⏸ **`sql/OP-2.4.sql` NÃO aplicado** (RLS ampliada para `producao.access OR producao.rm.access`) — enquanto não for, nada muda: as duas permissões estão nos mesmos papéis. Criação de RM, botão "Nova RM" e RPC de escrita **fora do escopo** (Parte 3). |

Status possíveis: PENDENTE · EM ANDAMENTO · CONCLUÍDA · BLOQUEADA (com motivo).

---

## 3. Modelo de dados — Fase 1

Validado contra os formulários reais FRM-07-11 (OPs 2026-0007 Válvulas, 2026-0030 Encapsulamento, 2026-0056 Cateter). Uma OP produz **múltiplos SKUs** → tabela filha de itens.

**Decisões assumidas (reversíveis, registradas em 22/07/2026):**
- Sem gate de aprovação por ora: campos `aprovado_*` existem e são preenchíveis no detalhe, mas não travam o fluxo. Se virar gate, entra status `AGUARDANDO_APROVACAO` como Ajuste.
- `numero_referencia` (nullable) guarda o segundo número visto nos formulários (ex.: 2025-0183) até o Pedro confirmar o que é.
- Número gerado pelo Hub: formato `AAAA-NNNN`, sequência anual, atribuído na criação (inclusive rascunho); cancelada mantém o número (sem renumeração — trilha documental limpa). **Reserva de faixa:** 2026 semeado em `500` — manual usa 0001–0500, Hub emite de 0501+ (detalhe e regra de virada de ano em `op_numeracao`, seção 3).

### Tabelas

**`op_tipos`** — id uuid PK · codigo text UNIQUE (VALVULA/CATETER/ENCAPSULAMENTO) · nome text · ativo bool default true · ordem int · created_at.

**`op_ordens`** — id uuid PK · numero text UNIQUE (AAAA-NNNN) · numero_referencia text NULL · tipo_id FK→op_tipos · produto_familia text (hoje "Tricvalve") · tipo_ordem text CHECK (FABRICACAO|EMBALAGEM_FINAL) · tipo_produto text CHECK (ACABADO|EM_PROCESSO) · destino text CHECK (INTERNACIONAL|NACIONAL|NAO_APLICAVEL) · lote text NULL · data_inicio date · data_fim_planejada date NULL · status text CHECK (6 estados) default RASCUNHO · observacoes text · emitido_por uuid NOT NULL (profiles.user_id) · emitido_depto text · emitido_em timestamptz · aprovado_por/depto/em NULL · comunicado_a/depto/em NULL · op_pai_id FK→op_ordens NULL · cancelada_por/em/motivo_cancelamento NULL · **fechada_por/fechada_em NULL (adicionadas na OP-1.2 v2 — não vieram na OP-1.1)** · created_at · updated_at (trigger `op_set_updated_at`).

**`op_ordem_itens`** — id uuid PK · op_id FK→op_ordens (cascade) · sequencia int · **codigo_produto** text NOT NULL (SKU hierárquico do espelho, ex. `001.010.037`) · **codigo_alternativo_produto** text NULL (código do FRM, ex. `82110053`) · **produto_nome** text NOT NULL (snapshot) · **produto_unidade** text NULL (snapshot, ex. `UNID`) · quantidade_planejada numeric(14,4) CHECK >0 · created_at · UNIQUE(op_id, sequencia). Snapshot da casa, **sem FK** ao catálogo (produto pode mudar/inativar; o item preserva o que foi planejado).

**`op_numeracao`** — ano int PK · ultimo int default 0. Função `op_proximo_numero()` incrementa com lock de linha. **Numeração por reserva de faixa (decidido 22/07/2026): seed 2026 = `500`.** `2026-0001`..`2026-0500` ficam reservados ao processo manual (FRM-07-11); o Hub emite de `2026-0501` em diante. Não há "último número" estável porque manual e Hub emitem em paralelo até o go-live — no **go-live o processo manual para** e o Hub vira emissor único. ⚠️ **Virada de ano:** se a operação paralela cruzar para 2027, semear `(2027, 500)` (ou a folga vigente) **antes** da 1ª OP do ano — senão `op_proximo_numero()` cria `(2027,0)` e começa em `2027-0001`, colidindo com a faixa manual.

**`op_status_historico`** — id uuid PK · op_id FK (cascade) · de text NULL · para text · motivo text NULL · usuario uuid · created_at.

**Achado OP-1.1 (verificação read-only, 22/07/2026):** os 9 códigos do FRM-07-11 (`8211020031`…`8211010001`) casam **100% com `stock_products.codigo_alternativo`** (0 em `codigo_produto`, 0 em `codigo_reduzido`, 2 coincidências em `codigo_barras`). Todos são da família `001.010` (Tricvalve — "TRICUSPID VALVE …"), `ativo=true`, `unidade_medida='UNID'`. ⇒ **o picker (OP-1.4) busca por `codigo_alternativo` + `nome_produto` + `codigo_produto`**, exibindo os dois códigos; `codigo_barras` fica **fora da busca** (as 2 coincidências geram ambiguidade). O snapshot guarda `codigo_produto` (SKU interno hierárquico) **e** `codigo_alternativo_produto` (o código que o operador escreve no formulário).

### DDL final da OP-1.1 (validado contra o banco em 22/07/2026 — ajustes documentados na seção 4.1)

> **Fonte canônica: [`sql/OP-1.1.sql`](sql/OP-1.1.sql)** — copiar DO ARQUIVO para o SQL Editor (protocolo seção 0). O bloco abaixo é espelho e deve bater com o arquivo.
> **Revisão de 4 olhos (23/07/2026, pré-aplicação):** (a) `op_proximo_numero()` usa `case when v_n > 9999 then v_n::text else lpad(v_n::text,4,'0') end` — `lpad(...,4,...)` **trunca à esquerda** acima de 4 dígitos (`lpad('10000',4,'0')`=`'1000'` ⇒ colisão silenciosa); (b) `op_set_updated_at()` com `set search_path = public`.

```sql
-- =====================================================================
-- OP-1.1 · Módulo Ordem de Produção · Fase 1 · SQL Editor (hbtggrbauguukewiknew)
-- ESTRUTURA APENAS: tabelas, trigger de updated_at, numeração.
-- Policies (RLS) + RPCs de escrita = OP-1.2. Verificação e rollback no fim (comentados).
-- =====================================================================

-- 1) Tipos de OP (cadastro extensível — não é enum de código)
create table public.op_tipos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  ativo boolean not null default true,
  ordem int,
  created_at timestamptz not null default now()
);

insert into public.op_tipos (codigo, nome, ordem) values
  ('VALVULA','Válvulas',1), ('CATETER','Cateter',2), ('ENCAPSULAMENTO','Encapsulamento',3);

-- 2) Ordens de produção (cabeçalho)
create table public.op_ordens (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  numero_referencia text,
  tipo_id uuid not null references public.op_tipos(id),
  produto_familia text,
  tipo_ordem text not null check (tipo_ordem in ('FABRICACAO','EMBALAGEM_FINAL')),
  tipo_produto text not null check (tipo_produto in ('ACABADO','EM_PROCESSO')),
  destino text not null check (destino in ('INTERNACIONAL','NACIONAL','NAO_APLICAVEL')),
  lote text,
  data_inicio date,
  data_fim_planejada date,
  status text not null default 'RASCUNHO'
    check (status in ('RASCUNHO','ABERTA','EM_ANDAMENTO','EM_FECHAMENTO','FECHADA','CANCELADA')),
  observacoes text,
  emitido_por uuid not null,                       -- = auth.uid(); uuid puro, sem FK (padrão do repo)
  emitido_depto text,                              -- texto livre (profiles não tem setor)
  emitido_em timestamptz not null default now(),
  aprovado_por uuid, aprovado_depto text, aprovado_em timestamptz,
  comunicado_a text, comunicado_depto text, comunicado_em timestamptz,
  op_pai_id uuid references public.op_ordens(id),
  cancelada_por uuid, cancelada_em timestamptz, motivo_cancelamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_op_ordens_status on public.op_ordens(status);
create index idx_op_ordens_tipo   on public.op_ordens(tipo_id);

-- 3) Itens da OP — SNAPSHOT do produto na criação (sem FK ao catálogo:
--    produto pode mudar/inativar; o item preserva o que foi planejado)
create table public.op_ordem_itens (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.op_ordens(id) on delete cascade,
  sequencia int not null,
  codigo_produto text not null,                    -- SKU hierárquico do espelho (ex. 001.010.037)
  codigo_alternativo_produto text,                 -- código do FRM/operador (ex. 82110053)
  produto_nome text not null,                      -- snapshot de stock_products.nome_produto
  produto_unidade text,                            -- snapshot de stock_products.unidade_medida
  quantidade_planejada numeric(14,4) not null check (quantidade_planejada > 0),
  created_at timestamptz not null default now(),
  unique (op_id, sequencia)
);

-- 4) Numeração anual AAAA-NNNN (gerada pelo Hub na criação)
create table public.op_numeracao (
  ano int primary key,
  ultimo int not null default 0
);

-- SEED por reserva de faixa: 2026-0001..2026-0500 reservados ao processo manual
-- (FRM-07-11); o Hub emite de 2026-0501 em diante. No go-live o manual para.
-- ⚠️ Virada de ano: se a operação paralela cruzar para 2027, semear (2027, 500)
-- ANTES da 1ª OP de 2027 (senão a função cria (2027,0) e começa em 2027-0001).
insert into public.op_numeracao (ano, ultimo) values (2026, 500);

-- Gerador de número (SECURITY DEFINER: roda como owner e ignora RLS ao tocar op_numeracao)
create or replace function public.op_proximo_numero()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ano int := extract(year from now())::int;
  v_n   int;
begin
  insert into public.op_numeracao (ano, ultimo) values (v_ano, 0)
    on conflict (ano) do nothing;
  update public.op_numeracao set ultimo = ultimo + 1
    where ano = v_ano
    returning ultimo into v_n;
  -- lpad(txt,4,'0') TRUNCA à esquerda acima de 4 dígitos (lpad('10000',4,'0')='1000'
  -- ⇒ colisão silenciosa): CASE devolve o número inteiro quando passa de 9999.
  return v_ano::text || '-' ||
    case when v_n > 9999 then v_n::text else lpad(v_n::text, 4, '0') end;
end $$;

-- 5) Histórico de status (append-only)
create table public.op_status_historico (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.op_ordens(id) on delete cascade,
  de text, para text not null, motivo text,
  usuario uuid not null,
  created_at timestamptz not null default now()
);
create index idx_op_status_historico_op on public.op_status_historico(op_id);

-- 6) Trigger de updated_at (padrão do repo: 1 função por módulo)
create or replace function public.op_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_op_ordens_updated_at
  before update on public.op_ordens
  for each row execute function public.op_set_updated_at();

-- 7) RLS habilitada SEM policies = deny-all até a OP-1.2 (estado seguro: nenhum
--    frontend usa estas tabelas ainda; o SQL Editor roda como postgres e ignora
--    RLS, então a verificação abaixo funciona).
alter table public.op_tipos            enable row level security;
alter table public.op_ordens           enable row level security;
alter table public.op_ordem_itens      enable row level security;
alter table public.op_numeracao        enable row level security;
alter table public.op_status_historico enable row level security;

-- =====================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =====================================================================
-- a) contagem das 5 tabelas (op_tipos = 3; demais = 0):
--   select 'op_tipos' t, count(*) n from public.op_tipos
--   union all select 'op_ordens', count(*) from public.op_ordens
--   union all select 'op_ordem_itens', count(*) from public.op_ordem_itens
--   union all select 'op_numeracao', count(*) from public.op_numeracao
--   union all select 'op_status_historico', count(*) from public.op_status_historico;
-- b) seed:  select * from public.op_numeracao where ano = 2026;
-- c) teste de op_proximo_numero() SEM consumir número:
--   begin;
--     select public.op_proximo_numero() as n1;   -- 2026-<seed+1>
--     select public.op_proximo_numero() as n2;   -- 2026-<seed+2>
--     select ultimo from public.op_numeracao where ano = 2026;  -- seed+2
--   rollback;
--   select ultimo from public.op_numeracao where ano = 2026;    -- de volta = seed
-- d) trigger:  select tgname from pg_trigger where tgrelid='public.op_ordens'::regclass and not tgisinternal;

-- =====================================================================
-- ROLLBACK (sem dados de produção ainda)
-- =====================================================================
-- drop trigger if exists trg_op_ordens_updated_at on public.op_ordens;
-- drop function if exists public.op_set_updated_at();
-- drop function if exists public.op_proximo_numero();
-- drop table if exists public.op_status_historico;
-- drop table if exists public.op_ordem_itens;
-- drop table if exists public.op_numeracao;
-- drop table if exists public.op_ordens;
-- drop table if exists public.op_tipos;
```

---

## 4. Tarefas da Fase 1 (detalhamento)

**OP-1.0 — Reconhecimento (read-only, nenhuma escrita).** Ler e registrar no Diário: (a) modelo de permissões vigente — assinatura real de `user_has_permission`, onde papéis/permissões são cadastrados, como Suprimentos gateia telas e RPCs; (b) nome e estrutura da tabela espelho de produtos (catálogo para o picker de SKU) e se há colunas de descrição/unidade; (c) se existe trigger genérico de `atualizado_em` reutilizável; (d) padrão de navegação/rotas/layout das telas existentes (Suprimentos como referência) e o padrão de service (`src/services/*`, `(supabase as any).rpc`); (e) padrão visual vigente (Bloomberg-calm, light+dark, tabular-nums). Saída: notas no Diário + ajustes necessários nos rascunhos das OP-1.1/1.2.

**OP-1.1 — Migração de estruturas.** Ajustar o rascunho da seção 3 conforme OP-1.0 (colisões de nome, conventions), obter do Pedro o último número de OP 2026 para o seed, entregar o bloco final → Pedro cola no SQL Editor → confirmar empiricamente (SELECT nas 5 tabelas + `select op_proximo_numero()` num BEGIN/ROLLBACK).

**OP-1.2 — RLS + RPCs de escrita.** Policies de leitura gateadas pela permissão de visualização do módulo; **sem policy de escrita direta** — toda escrita via RPC `SECURITY DEFINER` com gate: `op_criar_ordem(p_dados jsonb, p_itens jsonb) → uuid` (gera número, insere ordem RASCUNHO + itens, grava histórico NULL→RASCUNHO); `op_atualizar_rascunho(p_op_id, p_dados, p_itens)` (só em RASCUNHO); `op_transicao_status(p_op_id, p_para, p_motivo default null)` (valida o mapa de transições da seção 1, motivo obrigatório em cancelamento, carimba cancelada_*/histórico). Permissões do módulo: `op_visualizar` (leitura), `op_abrir` (criar/editar rascunho/abrir), `op_gerir` (cancelar, editar aprovado/comunicado) — nomes finais no padrão descoberto na OP-1.0. SQL redigido na sessão, mesmo fluxo: bloco → Pedro → SQL Editor → verificação.

**OP-1.3 — Seção Produção + lista de OPs.** Nova entrada de navegação "Produção" (gateada por `op_visualizar`), rota de lista: tabela com nº, tipo, tipo_ordem, itens (resumo: "3 SKUs · 45 un"), status (badge sóbrio), data início, emitido por. Filtros server-side: status, tipo, período, busca por número. Padrão visual do Hub.

**OP-1.4 — Modal de abertura (USER 1).** Campos do FRM-07-11: tipo de OP (select), tipo_ordem / tipo_produto / destino (grupos de opção), produto_familia (default "Tricvalve"), lote (opcional), data_inicio (default hoje), data_fim_planejada (opcional), numero_referencia (opcional), observações; grade de itens: busca de SKU no catálogo espelho, descrição (auto, editável — snapshot), quantidade planejada; mínimo 1 item. Ações: "Salvar rascunho" e "Salvar e abrir" (criar + transição ABERTA). emitido_por = usuário logado; emitido_depto texto livre (pré-preenchido se o profile tiver setor).

**OP-1.5 — Detalhe da OP.** Cabeçalho (número em destaque, badges de status/tipo), bloco de campos, tabela de itens planejados, timeline do histórico de status, ações condicionais por status/permissão: Editar (RASCUNHO), Abrir (RASCUNHO), Cancelar com motivo obrigatório (RASCUNHO/ABERTA), editar aprovado/comunicado (op_gerir). Abas de Requisições/Qualidade/Fechamento só nascem nas fases respectivas.

**OP-1.6 — Validação ponta a ponta + saneamento + fechamento da Fase 1.** *(Reformulada em 23/07/2026 — ver Diário. A definição original pedia "criar OP real espelho da 2026-0007"; isso foi **removido**: recriar uma ordem já executada no papel seria **registro de produção falso, vedado em BPF**.)* A Fase 1 fecha quando houver, com evidência (visual + banco):
1. **Bateria de testes completa** no preview, usando OPs de **teste descartáveis** (ex.: 2026-0503, canceladas ao fim) — cobre o checklist residual: carimbos de aprovação/comunicação, dirty-check, quantidade 0, edição sem itens, dark/light, filtro+F5, console limpo.
2. **Gate real provado:** papel `operador_producao` num usuário não-admin **vê / cria / abre** OP mas **NÃO** cancela nem carimba (manage negado); usuário **sem papel** não vê "Produção" na sidebar e a rota dá "Acesso Restrito".
3. **Saneamento pré-go-live:** aplicar `sql/OP-1.6-saneamento.sql` (apaga todas as OPs de teste + reset do contador para 500).
4. **Publish manual** no Lovable.

A **2026-0501 real** nasce **sob demanda de produção**, como **piloto com o USER 1** — não é criada nesta validação.

---

## 4.1 — OP-1.0 · Reconhecimento do terreno (achados + ajustes aos rascunhos)

Executado em 22/07/2026, **read-only**, projeto `hbtggrbauguukewiknew` (fingerprint `compras_pedidos` = 1674). Fontes: banco (MCP read-only) + código do repo (módulo **Suprimentos** como referência).

### A) Modelo de permissões (Hub RBAC)
- **Função canônica:** `public.user_has_permission(p_user_id uuid, p_permission_code text) → bool` (SECURITY DEFINER, `search_path=public`). Lógica: `profiles.is_admin` ⇒ TRUE (bypass total); senão `EXISTS` em `hub_user_roles ur → hub_role_permissions rp → hub_permissions p` com `p.codigo = code` e `ur.revogado_em IS NULL`.
- **Wrapper por `auth.uid()`:** `public._user_has_perm(p_codigo text) → bool` (mesma lógica via `auth.uid()`, chama `_is_admin()`) — **gate ideal dentro de RPC/RLS**. Também: `_is_admin()`, `hub_caller_is_admin()`, `get_user_permissions(p_user_id) → setof(codigo)` (usado pelo AuthContext do front).
- **Catálogo:** `hub_permissions(id, codigo, nome, descricao, modulo, created_at)`. Papéis: `hub_roles(codigo, nome, descricao)` — hoje: admin, analista_fiscal, analista_compras, requisitante, aprovador_projetos, controller_intercompany, financeiro, responsavel_projeto, visualizador_compras, viewer_intercompany. **Nenhum de produção.**
- **Taxonomia real dos códigos:** `modulo.recurso.acao` — pontilhado, verbos em inglês. Ex. Suprimentos: `compras.pedidos.access|create|view_all|view_own|delete_draft`; `compras.requisicoes.access|create|view_all|view_own|delete_own|reenviar_own`. Módulos são palavra única (`compras`, `projetos`, `cartao`, `intercompany`, `ferramentas`; global `_global`).
- **Gate no frontend:** `PermissionRoute permKey="…"` inline em `src/App.tsx:118-140` via `usePermissions().hasAccess()` (`src/hooks/usePermissions.ts`); botões/ações via `useHasPermission(code)` (`src/hooks/useHasPermission.ts`); permissões carregadas no `AuthContext` por `get_user_permissions`; catálogo tipado em `src/constants/permissions.ts`. Não existe `<PermissionGate>`. Convivem RBAC pontilhado e "menu_keys" legados (`suprimentos_requisicoes`, mapeados em `usePermissions.ts:14-21`) — **módulo novo usa só RBAC pontilhado.**

### B) Espelho de produtos (picker de SKU)
- Tabela **`public.stock_products`** (20 col). Chaves p/ o picker: `codigo_produto` (SKU, NOT NULL) · `codigo_reduzido` · `nome_produto` (descrição, NOT NULL) · `unidade_medida` (ex. "UNID") · `familia_codigo` (ex. "001.016") · `ativo` (bool) · `controla_lote` · `codigo_barras`/`codigo_alternativo`. Usa `created_at`/`updated_at`. Códigos no formato `001.016.062`.
- **Mapa OP:** `op_ordem_itens.sku_codigo ← codigo_produto`; `descricao (snapshot) ← nome_produto`; sugerir coluna nova `unidade ← unidade_medida`. Picker filtra `ativo=true`, busca por codigo/nome.
- ⚠️ `stock_products.tipo_produto` é código numérico ("15","53") — domínio distinto do `op_ordens.tipo_produto` (ACABADO|EM_PROCESSO). Só homônimo, **sem conflito**.

### C) Trigger de `atualizado_em`
- **Não há genérico reutilizável.** Cada módulo tem função nomeada (`set_compras_requisicoes_updated_at`, `intercompany_set_updated_at`, `tg_blocos_set_updated_at`…), todas `NEW.updated_at = now()`, ligadas por `BEFORE UPDATE ... FOR EACH ROW` (ex. real: `trg_compras_requisicoes_updated_at`).
- **Convenção decisiva:** `created_at` (132 tabelas) / `updated_at` (76) vs `criado_em`/`atualizado_em` (**1 cada**) ⇒ o rascunho da OP (português) diverge; **adotar inglês**.

### D) Rotas / service / layout
- Rotas centralizadas em `src/App.tsx` (react-router v6): import estático no topo + `<Route path="/mod/recurso" element={<PermissionRoute permKey="…"><Pagina/></PermissionRoute>}/>` dentro do bloco `AppLayout` (`<Outlet/>`). Ex.: `/suprimentos/pedidos`, `/.../novo`, `/.../:id`.
- Nav em `src/components/AppSidebar.tsx`: array de sub-itens + `renderXGroup(...)` (Collapsible shadcn) + invocação condicional a `hasAccess("…")` no bloco de injeção (~linhas 261-308). Ícone lucide.
- Services em `src/services/*.ts` (funções, sem classe): `import { supabase } from "@/integrations/supabase/client"` + `(supabase as any).rpc("nome",{p_…})` (params `p_`) ou `(supabase as any).from("tbl")`. Mutations retornam `{sucesso, …, erro?}` ou lançam `Error(msg)`.
- **Leitura de lista:** em geral **inline** na página via `useQuery` + `(supabase as any).from("tbl").select("*",{count:"exact"}).order().range().ilike()/.gte()/.lte()` (ex. `SuprimentosPedidos.tsx`). Existe também RPC de lista SECURITY DEFINER (`suprimentos_listar_pedidos_para`) — as duas abordagens convivem. Precedente de numeração Hub-side anual: `sugerir_proximo_numero_invoice(p_ano)` (SECURITY DEFINER) ⇒ **valida** o approach de `op_proximo_numero()`.

### E) Padrão visual (Bloomberg-calm)
- Tokens HSL em `src/index.css` (manifesto linhas 5-17): 3 superfícies (`--surface-1/2/3`), accent único `--primary` (azul), semânticos dessaturados `--success/--warning/--danger/--info/--violet`; sem glow/glass/gradiente; só `shadow-sm`. `darkMode:["class"]` (`tailwind.config.ts`); **dark é default** (toggle caseiro `ThemeToggle`, sem next-themes). Tokens no formato `"H S% L%"` ⇒ usar tints `token/opacidade`, nunca cor hardcoded.
- Números: `font-variant-numeric: tabular-nums` global em `body`/`table` (index.css:150-165); colunas de valor `text-right tabular-nums whitespace-nowrap` (+ às vezes `font-mono`). **Sem util central de formatação** — replicar `formatBRL` local (`Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"})`, guarda null→"—").
- Status: fonte única `src/lib/statusConfig.ts` com helpers `ROUTINE(sem)`/`EXCEPTION(sem)` e `getStatus*()` → `{label, className, Icon, tooltip}` em `<Badge variant="outline" className={…}>`. Componentes-chave: `DataSection`+`Field` (`src/components/DataSection.tsx`); set shadcn completo em `src/components/ui/*` (Dialog p/ modais, Command p/ combobox/picker, Table, Card, Select, Popover+Calendar).

### Ajustes a aplicar aos rascunhos

**OP-1.1 (DDL):**
1. `criado_em`→`created_at`, `atualizado_em`→`updated_at` em todas as tabelas `op_*`.
2. Criar `public.op_set_updated_at()` (`NEW.updated_at=now()`) + `CREATE TRIGGER trg_op_ordens_updated_at BEFORE UPDATE ON op_ordens ... EXECUTE FUNCTION op_set_updated_at()`. (Só `op_ordens` precisa; filhas são append.)
3. `op_ordem_itens`: adicionar `unidade text` (snapshot de `unidade_medida`); `sku_codigo` ↔ `stock_products.codigo_produto`.
4. `emitido_por`: uuid puro (= `auth.uid()`), **sem FK** (padrão do repo — `hub_user_roles.user_id` etc.). Confirmar unicidade de `profiles.user_id` se quiser FK.
5. `op_proximo_numero()`: nascer `SECURITY DEFINER SET search_path='public'` (padrão Hub); lógica de lock mantida.
6. Sem colisão de prefixo `op_` (verificado). `produto_familia`/`tipo_produto` seguem texto/CHECK como no rascunho.

**OP-1.2 (RLS + permissões):**
1. Renomear p/ convenção pontilhada: `op_visualizar`→`producao.access`; `op_abrir`→`producao.ordens.create`; `op_gerir`→`producao.ordens.manage`. (Opcional `producao.ordens.view_all/view_own`.) Módulo `producao`.
2. INSERT em `hub_permissions(codigo,nome,descricao,modulo='producao')` + amarrar em `hub_role_permissions`. Decidir papéis (provável novo papel "Produção" em `hub_roles` + admin, que já bypassa). Espelhar em `src/constants/permissions.ts`.
3. RLS: recomendo **divergir** do precedente compras (policy aberta `FOR ALL USING(true)`) e usar `FOR SELECT TO authenticated USING (user_has_permission(auth.uid(),'producao.access'))`; **sem policy de escrita** (só RPC SECURITY DEFINER que bypassa RLS). Combina com a leitura inline `.from()`. **Decisão do Pedro.**
4. Gate nas RPCs via `_user_has_perm('producao.ordens.create')` (raise se falso); SECURITY DEFINER + `search_path`.

**OP-1.3/1.4/1.5 (frontend):**
- Molde de lista: `src/pages/SuprimentosPedidos.tsx`. Criar `src/lib/statusOP.ts` (ROUTINE/EXCEPTION + tokens) e `src/services/ordemProducaoService.ts`. Rota base `/producao/ordens`; nav `renderProducaoGroup` gateado por `producao.access` (ícone `Factory`/`ClipboardList`).
- Picker de SKU: `Command`/combobox sobre `stock_products` (`ativo=true`); busca por `codigo_alternativo` + `nome_produto` + `codigo_produto` (exibe ambos os códigos); `codigo_barras` **fora da busca** (ambiguidade). Descrição auto de `nome_produto`, unidade de `unidade_medida`.
- ⚠️ **Correção factual OP-1.4:** `profiles` **não tem** `setor`/`departamento` (só `full_name`, `email`, `is_admin`, `is_active`, `funcionario_alvo_codigo`, `alvo_usuario`) → `emitido_depto` é **texto livre puro, sem pré-preenchimento**.

---

## 5. Questões em aberto (bloqueiam Fases 2–4; respostas do Pedro)

1. **OP também no Alvo ou só no Hub?** O `ReqMat/Load` referencia `OrdProducObject` — se a P&F usar o módulo nativo de OP do Alvo, o Hub abre a OP lá e amarra; senão, vínculo via `Descricao`/`Texto` da ReqMat. Fase 0 (item 1) informa. **→ RESPONDIDA (meio-fechada) na Fase 0 (23/07/2026):** OP nativa **não é usada** (`OrdProduc` vazio em 46 reqs + 3 Loads) ⇒ vínculo do Hub via `Descricao`. Ver §6.1.
2. **Quem atende a requisição?** USER 2 pelo Hub (inserir + atender em sequência) ou almoxarifado no Alvo? Define quando o movimento entra no ledger e a permissão. **→ RESPONDIDA na Fase 0 (23/07/2026):** atendimento é do **almoxarifado, por item** ⇒ Fase 2 **sem rota de atender**; o Hub lê o atendido via Load e **gera o ledger pelo ATENDIDO**. Ver §6.1.
3. **Reprova movimenta estoque?** Só analítica (default proposto) ou transferência física para local segregado (ReqMat Transferência)? **→ METADE FECHADA por construção (31/07/2026):** A §6.3-B provou que só a quantidade **aprovada** vira saldo (laudo `0000002070`: lote de 60, aprovadas 21, entrada de 21). Material reprovado no recebimento **nunca chega a existir como saldo** — não há o que transferir, e a pergunta "só analítica ou ReqMat Transferência?" não se aplica a este momento. **Continua aberta apenas para a PRODUÇÃO**, onde a peça já saiu pela RM e foi consumida.
4. **Como o produto acabado entra no estoque Alvo hoje?** Define a Fase 4 e o fluxo semi-acabado → Encapsulamento. **→ CONTINUA ABERTA, e maior do que estava escrito (31/07/2026):** Não se sabe como os insumos saem do ponto de vista do fechamento, nem como a sobra volta. Sem isso, a OP fecha sem zerar o saldo em aberto. **Decisão de sequenciamento:** Q4 é da **Fase 4** e **não trava a Fase 2**. Investigação adiada por decisão explícita.
5. **Segundo número dos formulários** (2025-0183 etc.): referência do ano anterior ou resíduo de planilha? (Por ora: `numero_referencia`.)

---

## 6. Referência Alvo/ReqMat (para Fases 0 e 2+)

- Endpoints: `POST ReqMat/InserirAlterarRequisicaoMaterial` (payload `ReqMatIntegracaoApi`: header + `Itens[]`) · `POST ReqMat/AtenderTodosItensRequisicao` (**tudo-ou-nada** — favorece requisições pequenas e frequentes) · `GET ReqMat/Load` (loadParent inclui `OrdProducObject`, loadChild inclui `ItemReqMatChildList`) · `GET ReqMat/DeletarReqMat`.
- **O payload de integração NÃO expõe campo de OP** — vínculo OP↔ReqMat vive no Hub; nº da OP vai em `Descricao`/`Texto` (confirmar na Fase 0).
- ReqMat tipo **Devolução** = entrada no estoque → mecanismo de acerto das sobras no fechamento.
- Nenhum endpoint ReqMat está na whitelist do passthrough hoje (`ALLOWED_ENDPOINTS`, `erp-proxy/src/routes/alvo.ts`). Fase 2: whitelist `ReqMat/Load` + rotas dedicadas de escrita com mapper (`producao-reqmat-mapper.ts`), padrão dos `emit-*-mapper.ts`. Cuidado com constraints estilo DocFin (placeholders `-1`/`""`, erro 417) — capturar empiricamente.
- **Roteiro Fase 0 (Lab de API, Pedro):** (1) `ReqMat/Load?numero=<real>&loadParent=All&loadChild=All` → capturar resposta, ver se `OrdProduc` vem preenchido; (2) descobrir códigos de `CodigoTipoRequisicaoMaterial` (Retirada/Transferência/Devolução); (3) semântica de `Operacao`, `CodigoMix`/`CodigoDepositoMix`/`CodigoCatalogoMix`, `PosicaoUnidadeMedida`; (4) de-para `CodigoFuncionario` ↔ usuários do Hub; (5) `CodigoCentroControle`, depósitos e locais da produção; (6) inserir ReqMat de teste mínima sem atender → Alvo gera o `Numero`? Movimenta estoque? Formato real da resposta? → `DeletarReqMat` para limpar; (7) só então testar `Atender` combinado com o almoxarifado e observar o MovEstq.
- Constantes: filial `1.01` · gateway `https://erp-proxy.onrender.com` · chamadas do frontend sempre via gateway (CORS).

### 6.1 — Fase 0 · Achados do Lab de API (ReqMat) — CONCLUÍDA (23/07/2026)

**Espécimes:** Loads completos de `0000002231` (Atendida Parcial), `0000002187` (Aberta) e `0000002214` (Atendida Total, 18 lotes). Base: 46 requisições de julho + 3 Loads (header e item).

1. **Atendimento é do almoxarifado, por item** (responde §5 Q2): cada item traz `CodigoFuncionarioAtendente` + `DataHoraAtendimento`. ⇒ **A Fase 2 NÃO terá rota de "atender"**: o Hub **cria** a ReqMat, o **almoxarifado atende no Alvo**, e o Hub **lê o atendido por item via Load e gera o ledger pelo ATENDIDO** (nunca pelo requisitado) — coerente com "Alvo é dono do estoque; o Hub registra e reconcilia".
2. **OP nativa do Alvo NÃO é usada** (responde §5 Q1, meio-fechada): `OrdProduc`/Ordem Produção **vazio** em TODAS as 46 requisições e nos 3 Loads (header e item). ⇒ o vínculo OP↔ReqMat vive **no Hub, via `Descricao`** (nº da OP no texto).
3. **Tipos de ReqMat em uso:** `0000002` = REQUISIÇÃO PRODUÇÃO · `0000004` = SAÍDA MATERIAL DE CONSUMO. **Devolução** não apareceu em julho — **código do tipo a descobrir** (pendência).
   **→ AMPLIADO em 05/08/2026 (n=678, ano inteiro):** são **QUATRO** valores, não dois — `0000002` (279 de 678), `0000004`, **`0000005` (NÃO documentado, candidato a DEVOLUÇÃO)** e **`null`** (requisição sem tipo). ⚠ Consequências de código, as duas registradas: (a) **nenhum código pode assumir `CodigoTipoReqMat` não-nulo** — null é valor real e frequente; (b) o **espelho não filtra** (retrato fiel, os quatro entram), mas 🔴 **o consolidado da OP e a métrica de vazamento da §10.7 FILTRAM `0000002`** — somar saída de material de consumo como material de produção infla o "disponibilizado" da OP com material que nunca entrou na produção, e seria erro **silencioso**. Ver §10.4 e §10.15.
4. **Status do header:** Aberta · Atendida Parcial · Atendida Total. **Baixa de estoque só no atendimento** (`BaixouEstoque` + `CodigoTipoLanc` = `E0000023`).
5. **Quantidades por item (nativas):** `Quantidade` · `Atendida` · `Saldo` · `Devolvida` · `Perdida` — a equação de balanço (§1) tem lastro nativo no Alvo.
6. **Lote (genealogia, Fase 5):** `CtrlLoteItemReqMatChildList` grava `NumeroCtrlLote` + validade + qtd **por lote**, no atendimento (ex.: pericárdio na `2214` = 174 un de 18 lotes). **Fonte nativa da genealogia** (casa com `NumeroCtrlLote`/Rastro P&F).
7. **Unidade & código:** `PosicaoProdUnidMed` = índice da unidade (`1` = principal); `CodigoAlternativoProduto` presente no item (bate com o snapshot da OP). **Campos de "viagem" da ReqMat** = outro uso Riosoft → **ignorar**. **Mix ausente** nos espécimes.
8. **`TipoAtendimento`** (por requisição): **Manual** ou **Automático**. **O Hub enviará Manual.** Hipótese a confirmar: Automático tenta baixar na **criação** (a `2187` ficou Aberta e com **CUSTO NEGATIVO** — sintoma).
9. **Pendências da Fase 0 (destravar antes/na Fase 2):** **teste de ESCRITA** (o Alvo gera `Numero` sozinho?, semântica de `Operacao`, efeito de `TipoAtendimento`, `Descricao` com o nº da OP) + `Deletar` para limpar; **código do tipo Devolução**; **confirmar a hipótese do Automático com o almoxarifado**. **→ teste de ESCRITA FEITO (§6.2):** `Numero` auto-gera, `Operacao="Retirada"`, `Descricao`≤40, `Deletar` OK; restam pendências humanas (§6.2).
10. **Achado operacional fora do módulo (Pedro trata):** a `2187` está **Aberta há 3 semanas** com os mesmos produtos **re-requisitados na `2231`** → **risco de baixa em dobro** no estoque.

### 6.2 — Fase 0 · Teste de ESCRITA (ReqMat Insert/Delete) — CONCLUÍDA (23/07/2026)

Provado com a requisição `0000002236` (**criada e deletada**). Espécime adicional de atendimento: `2235`.

**RECEITA DO INSERT** — `POST ReqMat/InserirAlterarRequisicaoMaterial`:
- **Sem campo `Numero`** — o Alvo auto-gera. Enviar `""` **quebra** (`SqlException 'syntax near And'`).
- Header **`Operacao="Retirada"`** (domínio: Retirada / Transferência / Devolução; `"I"` dispara `BrokenRulesException` Friendly_Message_CK).
- Item **`Operacao="I"`**.
- **`CodigoTipoRequisicaoMaterial="0000002"`** (REQUISIÇÃO PRODUÇÃO).
- **`Descricao` ≤ 40 chars** (BrokenRules explícita acima disso) → formato do vínculo: **`"OP 2026-05xx - <resumo curto>"`**.
- **Campos `Mix` omitidos** — o servidor preenche `-1` sozinho (**mistério Mix encerrado**).
- **`PosicaoUnidadeMedida=1`**.
- ⚠️ **Resposta de sucesso tem ECO BUGADO** (o `Numero` é replicado em TODOS os campos string) → **parsear APENAS o campo `Numero`** e **confirmar via `Load`**.

**DESCOBERTAS:**
1. **`CodigoCentroControle` enviado é IGNORADO** — o centro gravado **deriva do funcionário** (enviei `00009.00001.00001`, gravou `00010.00002.00003` do func. `0000149`). ⇒ verificar na Fase 2 com o funcionário correto; o **de-para `profiles.funcionario_alvo_codigo` ganha importância dobrada**.
2. **`Origem="Importação"`** — requisições via API nascem com marcador próprio (vs `ManualAlvo` = tela) ⇒ **carimbo de auditoria gratuito** para reconciliação.
3. **`TipoAtendimento="Automático"` é o default de nascimento** (via API — payload não tem o campo — E via UI). n=2 requisições Automático **com estoque disponível ficaram Abertas sem atender** ⇒ **semântica de "Automático" segue DESCONHECIDA** (pergunta oficial ao almoxarifado). → resolvido em 31/07/2026 — ver "Resolvidas" abaixo.
4. **`DataValidade` nasce null via API** (a UI punha +1 ano) — verificar impacto.
5. **Inserção (UI e API) NÃO baixa estoque** — baixa **só no atendimento** (confirmado em `2235` e `2236`).
6. **`DeletarReqMat`:** o parâmetro é **`reqMatNumero`** (não `numero`); `'Registro não encontrado'` = `BrokenRulesException` padrão. **Padrão Riosoft:** parâmetros com **prefixo da entidade** — conferir swagger antes de chutar.
7. **A UI usa endpoints internos próprios** (`GerenciaReqMat`, `New?numero=-1`) — **não** o de integração. As capturas valem como **dicionário**; o **contrato do Hub é o endpoint de integração** (validado hoje).
8. **A tela da ReqMat tem botões Estornar e Aprovar** — **estorno de atendimento existe nativamente** ⇒ entra na conversa com o almoxarifado.
9. **Cadastro de tipos** tem também `0000005` SAÍDA DE MATERIAL e `0000003` EPI'S além dos mapeados; **nenhum tipo com cara de Devolução** visto ainda — descobrir o código na conversa/cadastro.

**Pendências humanas (§5 + novas — para o almoxarifado/Pedro):** semântica do `Automático`; **código do tipo Devolução**; **quem deleta requisições** (`2196`/`2230` sumidas); reprova movimenta estoque? (§5 Q3); como o acabado entra no estoque? (§5 Q4); segundo número do FRM (§5 Q5).

#### Resolvidas em 31/07/2026 (sessão de investigação)

**`TipoAtendimento = "Automático"` (resolve §6.2-3)**

Era n=2 com semântica "DESCONHECIDA". Agora **n=71**, correlação perfeita, confirmada em segunda
amostra n=69:

| Tipo | Status | Baixou estoque |
|---|---|---|
| Automático (4) | `Aberta`, todas | `Não`, todas |
| Manual (67) | `Atendida Total` ou `Parcial`, todas | `Sim`, todas |

> 🔴 **REQUISITO DE CÓDIGO DA FASE 2.** `"Automático"` é o **default de nascimento via API**.
> Se o mapper não enviar `TipoAtendimento = "Manual"` **explicitamente**, toda requisição criada
> pelo Hub nasce morta — aberta para sempre, sem baixar estoque, **sem erro**.

*Ressalva: correlação não prova causa. Mas enviar Manual custa zero e o risco de não enviar é total.*

**Empenho — fecha a investigação do botão Empenhos**

`GeraEmpenho: "Não"` no cabeçalho e em **22/22 itens** da `2251`. É opção **por item**, e ninguém liga.

⇒ **Requisição aberta não reserva estoque.** É a `2187`/`2231` da §6.1-10 acontecendo.
⇒ **Consequência de tela:** o saldo exibido é uma foto. Mostrar o horário da consulta e **não
prometer**. *(n=1; confirmar em outra requisição.)*

**`ControlaLote` do item não prediz lote (retifica §9.7-3)**

**756/756** itens de `MovEstq` com laudo: `ControlaLote = "Não"` em todos e **todos** com
`CtrlLoteItemMovEstqChildList` preenchido. O fenômeno **não é** da importação — é universal.
Mesma classe de erro do "nunca filtrar por `CodigoTipoLanc`".

**NOVO · `Saldo ≠ Quantidade − Atendida`**

Na `2251`: pedido **2.850** × atendido **2.918**. O excedente vai para `QuantidadeAtendidaMaior`
(item 18: +47; item 19: +121); o `Saldo` não fica negativo.

⇒ **O `Status` do cabeçalho não é indicador confiável.** A `2251` está `"Atendida Parcial"` porque
**um** item ficou zerado, escondendo excesso em dois outros. **Conferência é por item.**

**NOVO · O almoxarifado aloca por FEFO**

5/5 itens multi-lote, sempre da validade mais antiga, inclusive drenando resto.
A soma dos lotes bate com o **atendido**.
⇒ `CtrlLoteItemReqMatChildList` é a genealogia de saída nativa. Fase 5 servida sem replay.

**NOVO · Cinco requisições apagadas — nenhuma movimentou estoque**

Faltam `2196`, `2230`, `2235`, `2236`, `2246` (7% do período). O cruzamento com os 65 movimentos
`Especie == 'RM'` de julho bate exatamente com as 69 do export menos as 4 abertas.
⇒ Foram apagadas ainda `Aberta`.
⇒ **Requisito de DDL: `ausente_desde` no espelho de RM.**

---

### 6.3 — Preparação da Fase 2 · Investigação de ESTOQUE e RECEBIMENTO (MovEstq / Ficha / Laudo) — CONCLUÍDA (28/07/2026)

> **Consolidada ao fim da sessão de 28/07/2026.** A primeira redação desta seção continha inferências que a própria sessão derrubou (ver **§6.3-N · Retificações**). O que está abaixo é o estado provado.

**Escopo.** Sessão de leitura (Lab de API do Alvo + SQL read-only no Hub) para responder como a tela de RM vai exibir "material disponível no local 001". **Nenhuma escrita no Alvo.** Espécimes: `001.007.00101` (MEMBRANA DE PERICÁRDIO BOVINO SELECIONADO, matéria-prima biológica, BIOCOLLAGEN) · `001.007.00025` (LFU – Lucélio Ferramentaria, caso de reprova parcial) · `001.007.00005` (FAST PARTS).

---

#### A) Endpoints

| Endpoint | Método | Assinatura | Estado |
|---|---|---|---|
| `MovEstq/RetornaFichaEstoque` | POST | body `{produto, unidadeMedida, posicao, peso, pesoFatorDivisor, dataInicial, dataFinal, idProdutoId}` — datas `dd/MM/yyyy` | **PROVADO** |
| `MovEstq/Load` | GET | `?codigoEmpresaFilial=1.01&chave=N&loadParent=All&loadChild=All&loadOneToOne=All` | **PROVADO** |
| `Laudo/Load` | GET | `?codigoEmpresaFilial=1.01&numero=0000002073&loadParent=All&loadChild=All&loadOneToOne=All` | **PROVADO** |
| `laudo/GetListForComponents` | POST | body `{FormName:"laudo", ClassInput:"Laudo", ControllerForm:"laudo", ClassVinculo:"laudo", Input:"gridTableLaudo", Shortcut:"laudo", Type:"GridTable", TypeObject:"tabForm", Filter, Order, PageIndex, PageSize}` | **PROVADO** (via Network) |
| `movEstq/GetListForComponents` | POST | mesmo padrão, `FormName:"movEstq"`, `Input:"gridTableMovEstq"` | capturado do Network — **não testado direto** |
| `Produto/Load` | GET | `?codigo=001.007.00101&loadParent=All&loadChild=All&loadOneToOne=All` — o parâmetro é **`codigo`** | do swagger |
| `CtrlLote/Load` | — | **3 tentativas falharam.** Ler o swagger antes de tentar de novo | **A INVESTIGAR** |

**Regra de leitura de erro.** `"No action was found on the controller 'X'"` significa que o **controller resolveu** e os **parâmetros não casaram** (binding do ASP.NET Web API) — **não** que a action não existe. Foi o caso do `MovEstq/Load`: falhou com `?chave=`, funcionou com `codigoEmpresaFilial=1.01&chave=`. Corolário: **não adivinhar nome de parâmetro** — ler o swagger. O padrão de prefixo deduzido na §6.2 (`reqMatNumero`) **não é universal** (`Produto/Load` usa `codigo`; `Laudo/Load` usa `numero`).

**Sintaxe do filtro do `GetListForComponents`** (C#-like — **diferente** do `DocFin/RetrievePage`, que é SQL-like):
```
( DataEmissao >= #01/06/2026 00:00:00# &&  DataEmissao <= #30/06/2026 23:59:59#)
( DocumentoHomologado == 'Sim' && CodigoEmpresaFilial == '1.01' && DataMovimento >= #01/01/2026 00:00:00#)
```
`==`, `&&`, datas entre `#dd/MM/yyyy HH:mm:ss#`. `Order: "Numero DESC"` / `"Chave DESC"`. Retorna **apenas cabeçalhos** (sem itens, sem lotes) ⇒ sync = **listar → `Load` por chave**.

---

#### B) O fluxo de recebimento — quatro tempos, PROVADO ponta a ponta

```
1. FISCAL LANÇA A NF
   MovEstq  tipo E0000158  ·  ControlaEstoque = "Não"
   → CRIA o(s) lote(s): NumeroCtrlLote, quantidade CHEIA da nota,
     DataFabricacao, DataValidadeCtrlLote, CodigoLocArmaz = 001 (destino)
   → NÃO gera saldo  (não aparece na ficha de estoque)

2. SISTEMA GERA UM LAUDO POR LOTE
   Status = "Emitido"  ·  ResultadoAnalise = "Nenhum"
   → aponta ChaveMovEstq + SequenciaItMovEstq + NumeroCtrlLote
   → CodigoFuncionario = null (examinador ainda não definido)

3. QUALIDADE ANALISA
   → ResultadoAnalise (Aprovado / Aprovado Parcial / …)
   → QuantidadeAprovada, QuantidadeReprovada, ValorReprovado
   → DataResultado, DataRecepcao, CodigoFuncionario (examinador)

4. CONCLUSÃO DO LAUDO
   MovEstq  tipo E0000163  ·  ControlaEstoque = "Sim"
   Especie = LAUDO · Serie = 99 · Documento = NÚMERO DO LAUDO
   → SÓ A QUANTIDADE APROVADA entra como saldo no 001
```

**Prova numérica (laudo `0000002070`, produto `001.007.00025`, LFU, NF-e 100):**

| Etapa | Chave | Tipo | ControlaEstoque | Qtd | Efeito |
|---|---|---|---|---|---|
| Lançamento da NF (29/06) | `18063` | `E0000158` | **Não** | 60 | cria lote `0002636` (60 un, val. 25/06/2031), **sem saldo** |
| Laudo `0000002070` | — | — | — | 60 | `Aprovado Parcial` · aprovada **21** · reprovada **39** · `ValorReprovado` R$ 5.304 |
| Entrada por laudo (29/06) | `18072` | `E0000163` | **Sim** | **21** | `QtdEntrada 21`, `ValorEntrada 2.591,82` (= 21 × R$ 123,42) |

`21 + 39 = 60` — **o balanço fecha dentro do laudo. Não há saída silenciosa.**

⇒ **A Qualidade controla o que vira saldo.** Material reprovado **nunca fica disponível para requisição**. A RM pode confiar no saldo do `001` — o filtro de aprovação já aconteceu a montante.

**Não existe transferência `015 → 001`.** O local de inspeção não é modelado no Alvo de forma alguma: o material simplesmente **não tem saldo** enquanto o laudo está `Emitido`. O `015` não aparece em nenhum registro examinado.

**Janela de inspeção medida:** NF 1460 emitida 27/04 → laudos emitidos 29/04 → conclusão 25/05 = **26 dias**.

---

#### C) `ControlaEstoque` do cabeçalho é o discriminador de efeito em estoque

| Chave | Espécie | Tipo | `ControlaEstoque` | Aparece na ficha? |
|---|---|---|---|---|
| `18063` | NF-e | `E0000158` | **Não** | não |
| `12614` | NF-e | `E0000158` | **Não** | não |
| `15028` (NF 1405) | NF-e | `E0000003` | **Sim** | **sim** |
| `17127` | LAUDO | `E0000163` | **Sim** | **sim** |
| `18072` | LAUDO | `E0000163` | **Sim** | **sim** |

**Isso explica a NF 1405** (24/03/2026, único caso do semestre a entrar direto no estoque): foi lançada com tipo **`E0000003`** em vez de `E0000158`. Não foi "decisão de pular o laudo" — foi **escolha de tipo de lançamento pelo operador fiscal**. O tipo determina o comportamento.

Verificado empiricamente: as chaves `17363`, `17364`, `17365`, `17492`, `17493`, `17494`, `17646` (lançamentos de NF de junho, citados nos laudos pendentes) estão **dentro** da faixa de chaves da ficha (12576–17537) e **nenhuma aparece** nela.

⚠️ Nem todo `MovEstq` mexe em estoque — a amostra de janeiro trouxe `CT-e` (`E0000108`, frete, `ControlaEstoque="Não"`). **A varredura precisa filtrar por `ControlaEstoque`/tipo**, senão a carga histórica traz frete e serviço junto.

---

#### D) A entidade `Laudo` — é o registro de recebimento POR LOTE

Campos do `Laudo/Load` (o `GetListForComponents` mostra só um subconjunto):

| Grupo | Campos |
|---|---|
| Identidade | `Numero` (`0000002073`), `CodigoEmpresaFilial`, `CodigoProduto`, `CodigoProdUnidMed`, `PosicaoProdUnidMed` |
| **Junção** | **`ChaveMovEstq`**, **`SequenciaItMovEstq`**, **`NumeroCtrlLote`**, `DataValidadeCtrlLote` |
| Documento origem | `EspecieDocumento`, `SerieDocumento`, `NumeroDocumento` (nº da NF) |
| Quantidades | `QuantidadeProdUnidMedPrincipal`, `Quantidade2`, **`QuantidadeAprovada`**, **`QuantidadeReprovada`**, `QuantidadeExame`, `QuantidadeDestruida`, `QuantidadeDestruidaAprovada`, `QuantidadeDestruidaReprovada`, **`QuantidadeDevolvida`** |
| Resultado | `Status` (`Emitido`/`Concluído`), **`ResultadoAnalise`** (`Nenhum`/`Aprovado`/`Aprovado Parcial`), `DataResultado`, **`TextoResultado`**, `ValorReprovado`, `DiferencaIcmsValorReprovado` |
| Pessoas / datas | `CodigoFuncionario` (examinador — null enquanto Emitido), `CodigoFuncionarioResponsavel` (`0000005`, constante), **`DataRecepcao`**, `DataEmissao`, `DataValidade`, `DataDevolvida`, `DataDestruida`, `DataExame` |
| **Laboratório externo** | `DataEnvioTesteLab`, `QuantidadeEnvioTesteLab`, `TelefoneTesteLab`, `CodigoCentroCtrlTesteLab`, `DataRetornoTesteLab`, `QuantidadeRetornoTesteLab` |
| EPI / CA | `NumeroCa`, `DataValidadeInicialCa`, `DataValidadeFinalCa`, `NomeFabricanteCa`, `CodigoFabricanteCa` |
| Outros | `CodigoCentroCtrl` (`00001.00001.00005`), `CodigoLocArmaz` (destino), `GeraRmEspecifica`, `OrigemRecMerc`, `FotoLaudoObject` (foto anexa), `LaudoProdAnaliseQuimicaChildList` (análise química) |

**Um lote do fornecedor = um laudo, com a quantidade daquele lote.** Provado: NF 1586 → laudos `2073`(18) / `2074`(16) / `2075`(14), todos `ChaveMovEstq 18094`, ~~`SequenciaItMovEstq 1`~~ **[RETIFICADO em 29/07/2026 — são `SequenciaItMovEstq` 1, 2 e 3, um item por laudo; ver §6.3-N]**, emitidos com milissegundos de diferença e numeração sequencial. NF 1460 → 7 laudos (`1815`–`1821`) para 7 lotes, 71 un.

⚠️ **`CodigoEntidade` é sempre null no laudo** — o fornecedor só se descobre via `ChaveMovEstq → MovEstq/Load`, ou por join no espelho.

⚠️ **`DataRecepcao` é preenchida na conclusão, não na chegada física.** Confirmado em 3 laudos (`1815`: recepção 25/05 = resultado 25/05; `2070`: 29/06 = 29/06; `2073` pendente: null). **O campo existe e não carrega a informação real** — é exatamente a lacuna que o Hub vai preencher.

**O laudo é geral, não é de um fornecedor.** Aparecem `001.002.00035` (ROLO), `001.004.00008` (GALÃO), `001.003.00086/87`, `001.002.00084` (etiqueta, P+F GMBH), com NFs `280664`, `273773`, `100`. Validades de meses a **5 anos** (`0002636`: 25/06/2031). ⇒ **o módulo nasce genérico**, servindo o recebimento inteiro da empresa.

---

#### E) Chaves de junção — a ligação é BIDIRECIONAL

```
laudo.ChaveMovEstq  ──►  MovEstq de ORIGEM   (E0000158, cria o lote, sem saldo)
ficha.Documento     ◄──  MovEstq de ENTRADA  (E0000163, traz o nº do LAUDO)
```

Exemplo (`0000002070`): `laudo.ChaveMovEstq = 18063` (origem) · linha da ficha com `Documento = "0000002070"` e `Chave = 18072` (entrada).
Exemplo (`0000001815`): `laudo.ChaveMovEstq = 16458` (origem) · entrada = chave `17127`.

⇒ **A ficha basta para o sync.** O campo `Documento` do movimento `E0000163` **é o número do laudo** — casamento direto, sem varredura.

Chave natural do laudo dentro do movimento de origem: **`(ChaveMovEstq, SequenciaItMovEstq, NumeroCtrlLote)`**.

---

#### F) A ficha responde posição em qualquer data

`RetornaFichaEstoque` aceita janela e devolve, como primeira linha, `Operacao: "Saldo Anterior"` com `QtdSaldo` e `ValorSaldo` **já calculados** na entrada da janela (carimbada com a data do último movimento anterior).

⇒ **Janela de 1 dia devolve o saldo atual.** Não é preciso varrer desde ago/2024.

**Reconciliação verificada** (pericárdio, jan–jun/2026, 191 linhas): `66 + 1.893 − 1.345 = 614`. **Zero divergências em quantidade e em valor.**

⚠️ O resultado **depende** de `unidadeMedida`/`posicao`/`peso`/`pesoFatorDivisor`. Na varredura, passar sempre a unidade própria do produto.

---

#### G) Todo movimento com efeito em estoque carrega LOCAL e LOTE

Dentro de `ItemMovEstqChildList[]`:

- **`LocArmazItemMovEstqChildList[]`** → `CodigoLocArmaz`, **`CodigoLocArmazDestino`** (nulo fora de transferência), `QuantidadeProdUnidMedPrincipal`
- **`CtrlLoteItemMovEstqChildList[]`** → `NumeroCtrlLote`, `DataValidadeCtrlLote`, `DataFabricacao`, `CodigoLocArmaz`, `QuantidadeProdUnidMedPrincipal`, `QuantidadeBruta`, `QuantidadeDevolvidaProdUnidMedPrincipal`, `Operacao`

⇒ **Posição por `produto × local × lote × validade` é derivável** por replay do ledger.

Provado na RM `0000002125` (chave 17537, 11/06, 75 un): 10 lotes, todos `CodigoLocArmaz = "001"`, somando exatamente 75. `QuantidadeBruta` = tamanho do lote · `Quantidade` = o que saiu dele.

**FEFO é praticado** pelo almoxarifado (em 11/06 consumiram lotes com validade 05–06/2027 tendo o `0002396`, validade 08/2027, disponível). O Hub não implementa FEFO; não atrapalha.

**Estruturas nativas presentes** (existem porque o conceito existe): `NumSerieItemMovEstqChildList`, `MovEstqFifoChildList`, `TipoTransferencia`/`TipoDevolucao`/`TipoRetorno`/`TipoRemessa`, `GeraRMEspecificaLaudo` + `CodigoFuncionarioAprovadorRMEspecificaLaudo`, `ConfiguracaoAlteraMovEstqLaudoConcluido`.

---

#### H) Valorização — LER, nunca calcular

| Campo | Significado |
|---|---|
| `ValorProduto` | valor de documento (comercial) — R$ 900,00/un no pericárdio |
| **`BaseCustoMedio` / `CustoUnitario`** | **o que entra no estoque** — R$ 669,73/un; é o que a ficha usa em `ValorEntrada`/`ValorSaida` |

Fórmula observada: `BaseCustoMedio = ValorProduto × (1 − ICMS 18%) × (1 − PIS/COFINS 9,25%)` — custo líquido de impostos recuperáveis. Bate na 4ª casa nos 5 itens da NF 1405.

⚠️ **Regra:** o Hub **lê** `BaseCustoMedio`/`CustoUnitario`; **nunca** replica o cálculo (depende de alíquota por item, CFOP e regime) e **nunca** usa `ValorProduto` para valorizar estoque.

⚠️ **O `CustoMedio` da ficha não é confiável — duas evidências independentes:**
1. Pericárdio, a partir de 16/04/2026: `CustoMedio` ≠ `ValorSaldo ÷ QtdSaldo`. Quatro saídas (docs `0000001965`, `0000002015`, `0000002040`, `0000002125`) com unitário 6–10× o custo médio da data — 152 un por R$ 405.650 onde o custo médio indicava R$ 62.189, **excesso de R$ 343.461** — derrubando o custo médio de R$ 669 para R$ 235. Todas as entradas do semestre vieram a R$ 669,74/un ⇒ não é oscilação de preço.
2. `001.007.00025`, 23/06/2026: linha `Saldo Anterior` com `QtdSaldo 76`, `ValorSaldo 1.117,04` e `CustoMedio 132,28` — mas `1.117,04 ÷ 76 = 14,70`.

⇒ **Regra: o Hub lê `ValorSaldo` e `QtdSaldo`; se precisar de unitário, calcula a partir dos dois, ou lê `CustoUnitario` do movimento. Nunca o `CustoMedio` da ficha.** Investigar em separado (achado de Controller, fora do módulo).

---

#### I) Genealogia — o lote do fornecedor NÃO entra no Alvo

`NumeroLoteFabricante`, `NumeroLoteOrigem`, `NumeroNotaFiscalOrigem`, `CodigoEntidadeProdutoOrigem`, `CodigoProdutoEntidadeOrigem`: **os campos existem e estão sempre nulos.**

Confirmado pelo Pedro: a operadora que dá entrada na NF **converte para o código da P&F**, e o lote interno é **gerado pela P&F**. O lote do fornecedor só existe na descrição da nota.

⚠️ **Este é o ponto de ruptura da rastreabilidade, e ele está no RECEBIMENTO — não na transformação.** Se um fornecedor recolher um lote, hoje não há caminho no sistema que ligue o lote dele aos lotes internos.

**Onde o dado está:** XML da NF-e, **partido** entre `xProd` (limite de 120 caracteres — trunca) e `infAdProd`. Exemplo NF 1460:
```
xProd:      ...260202-3 02/08/2027  260203 03/08/2027  260203-3 03/08/2027  260204 04/08
infAdProd:  /2027 260204-2 04/08/2027  260205 05/08/2027  260205-2 05/08/2027
```
Sete lotes do fornecedor. Padrão = **`AAMMDD` da fabricação**; validade = fabricação + 18 meses.

**Casamento lote fornecedor ⇄ lote interno:** por **`DataFabricacao`** (lote `0002396` tem fab. 02/02/2026 ⇒ lote `260202-3`). Ambíguo apenas quando dois lotes do fornecedor compartilham a data — e aí desempata a **ordem dos laudos dentro da NF** (`Numero` do laudo crescente = ordem da descrição).

⚠️ **Nunca usar offset** entre número de documento e número de lote. Os contadores correm em paralelo e desalinham (jan/2026: bases 1323, 1331, 1413; mai/2026: 1814).

**O código do produto na NF é o do fornecedor** (`001.009.00003` na NF 1460), não o da P&F (`001.007.00101`) nem o `codigo_alternativo` do Hub (`810081`) ⇒ o recebimento precisa de um **de-para fornecedor→produto** que hoje não existe.

---

#### J) Campos que enganam (registrar para não repetir)

| Campo | O que parece | O que realmente é |
|---|---|---|
| `ItemMovEstqChildList[].ControlaLote` | flag de controle de lote do produto | vem **`"Não"`** mesmo com 10 lotes gravados no mesmo item. **NÃO usar.** O flag do produto está em `stock_products.controla_lote` e **não** aparece no export do mestre `Produto` (hipótese: `ProdEmpresaFilialChildList`). |
| ficha `.Sequencia` | sequência do item no movimento | é a posição do documento dentro da leva de recebimento (o item no `Load` é sempre `Sequencia=1`). |
| ficha `.CentroControle` | local de armazenagem | é **centro de custo**, e deriva do funcionário (§6.2, descoberta 1). |
| ficha `.CustoMedio` | `ValorSaldo ÷ QtdSaldo` | **diverge** (duas evidências em §6.3-H). Não usar. |
| `laudo.DataRecepcao` | quando a Qualidade recebeu o material | preenchida **na conclusão** (= `DataResultado` em 3 de 3 casos). Não carrega a informação real. |
| `laudo.CodigoEntidade` | fornecedor | **sempre null**. Fornecedor vem do `MovEstq` de origem. |
| `nf_entrada` (Supabase) | espelho das entradas de estoque | espelho **parcial** — só notas com classificação de despesa. **Não contém** os 163 laudos nem a NF 1405. **Não serve ao módulo de recebimento.** |
| `Produto` (export, 112 colunas) | traz o controle de lote | **não traz.** Único campo com "Lote" é `Base Lote Controle Esterilização`. Sem campo de validade no mestre. |

---

#### K) Cadastro de produtos — famílias e lote

| Família | O que é | Lote |
|---|---|---|
| `001.007.*` | pericárdio bruto (matéria-prima comprada) | **Sim** |
| `001.009.00088` | membrana para treinamento | Não |
| `001.010.*` (alt. `825*`) | membranas cortadas — semi-acabado | **Não** |
| `001.010.*` (alt. `835*`) | membranas cortadas **estéreis** | **Não** |

**O lote liga na matéria-prima e desliga em tudo que é produzido.** A genealogia interna (lote → produto) só pode existir no registro da OP — o ERP não a mantém.

**Esterilizar é trocar de SKU:** dez tamanhos não estéreis e dez estéreis, um a um (1.5×2.0 … 12.0×18.0). O de-para **não se deriva do código** (estéreis sequenciais `83510000`–`83510009`; não estéreis fora de ordem `825100xx`) ⇒ de-para explícito pelo tamanho no nome. Transformação e esterilização são **o mesmo mecanismo aplicado duas vezes**.

**O classificador real é o prefixo do `codigo_alternativo`**, não o código hierárquico (`001.010` mistura peças de válvula `821*` com membranas `825*`/`835*`). Largura dos segmentos é variável ⇒ **nada de parsing de largura fixa.**

**Bug de de-para na tela:** `001.009.00088` exibe `15` cru na coluna Tipo. Mapa numérico incompleto. (Registro; não corrigir agora.)

---

#### L) Achados operacionais (fora do escopo do módulo — para o Pedro)

1. **Pendência de inspeção sem visibilidade — o argumento mais concreto do módulo.** Em 28/07/2026 havia **76 laudos `Emitido` de pericárdio, 1.044 unidades**, de 20 NFs, emitidos entre 02/06 e 15/07. O saldo em estoque em 11/06 era **614**. Há **70% mais pericárdio esperando liberação do que disponível para produzir**. Em `compras_nfe`: 52 NFs da Biocollagen abr–jun/2026 (R$ 1.278.850), **todas** `status_lancamento='pendente'`, `erp_chave_movestq` nulo, `recebido=false`. No mesmo período o pericárdio teve 7 laudos concluídos em maio e **nenhum em junho**.
2. **Reprova sem acompanhamento estruturado.** Laudo `0000002070`: 39 unidades reprovadas, R$ 5.304, com `QuantidadeDevolvida = 0` e `DataDevolvida = null` — a decisão de devolver ao fornecedor existe **apenas em `TextoResultado`** (texto livre). Material fisicamente existe, contabilmente não. Nada no sistema cobra a devolução. **Levantar o acumulado do semestre** (`laudo/GetListForComponents` com `ResultadoAnalise != 'Aprovado'`).
3. **Custo médio da ficha não confiável** — ver §6.3-H, duas evidências independentes.
4. **A Biocollagen tem três relações comerciais** (abr–jun/2026): VENDA DE PRODUÇÃO DO ESTABELECIMENTO (27 NFs, R$ 1.210.320) · **RETORNO DE MERCADORIA UTILIZADA NA INDUSTRIALIZAÇÃO POR ENCOMENDA** (18 NFs, R$ 13.630) · VENDA DE MERCADORIA ADQUIRIDA DE TERCEIROS (7 NFs, R$ 54.900). **A segunda é nova:** a P&F manda material para industrializar e recebe de volta — *serviço de redução de biocarga* (CFOP 5124) com retorno de cubas de inox, instrumentais e wipers (CFOP 5902). **Segundo processador externo além do Oximed**, pertence ao elo E3. A Biocollagen também presta **serviço** (2 NFS-e, `E0000091`, R$ 73.700 em 27/04).
5. **Teste de laboratório externo existe como conceito** (`DataEnvioTesteLab`, `QuantidadeEnvioTesteLab`, `TelefoneTesteLab`, `CodigoCentroCtrlTesteLab`, `DataRetornoTesteLab`) e não estava em nenhum plano. Zerado nos casos examinados.
6. **NF 1405 (24/03/2026)** entrou direto no estoque por tipo de lançamento `E0000003` — único caso no semestre.

---

#### M) Impacto no desenho dos módulos

> ⚠ **SUPERADO em 31/07/2026 — ver §9.9.**
> O desenho do `est_saldos` como *replay* dos `MovEstq` com `ControlaEstoque="Sim"` foi abandonado.
> O texto abaixo fica registrado como o raciocínio da época; **não implementar**.
> Quem abrir a Fase 2 deve ler a §9.9 antes de qualquer schema de saldo.

1. **Espelho de estoque (`est_saldos`)** = replay dos lotes do `MovEstq` **com `ControlaEstoque="Sim"`**, chave `(produto, local, lote)`. Reconciliação contra `RetornaFichaEstoque` com janela de 1 dia.
2. **Lote com movimento de estoque = disponível · lote sem movimento = em inspeção.** As duas perguntas são respondidas pela mesma fonte.
3. **A RM pode confiar no saldo do `001`** — a Qualidade já filtrou a montante (§6.3-B). **Não** precisa filtrar por aprovação do laudo.
4. **A coluna "a caminho".** Com os laudos `Emitido` (quantidade por lote), a RM pode mostrar ao requisitante o que vai entrar quando a Qualidade liberar — em vez de ele descobrir no atendimento.
5. **Sync em dois tempos:** `movEstq/GetListForComponents` (chaves por período, filtrar `ControlaEstoque`) → `MovEstq/Load` por chave. Um movimento de laudo cobre vários produtos ⇒ a varredura serve o catálogo inteiro.
6. **`MovEstq` e `Laudo` NÃO estão na whitelist do passthrough.** `ALLOWED_ENDPOINTS` em `erp-proxy/src/routes/alvo.ts`, **repo separado** `financeiropfbrazil/erp-proxy`; hoje: `DocFin/Load`, `DocFin/GetListaRelatorio`, `ClasseRecDesp/Load`, `ClasseRecDesp/RetornaListaClasseRecDespSistemaExterno`, `CentroCusto/GetRegistros`, `Produto/GetRegistros`, `FaturaFin/GetRegistros`, `FaturaFin/GerarRealizado`. Inclusão é **mudança no gargalo compartilhado** (Suprimentos 100+ usuários, Despesas, Intercompany, NF-e) — fazer **aditivo**, com rollback confirmado no Render antes de publicar.
7. **O módulo de recebimento muda de forma.** Deixa de ser "criar local RECEB no Alvo". **RECEBIMENTO e ESTOQUE já existem no Alvo** (laudo `Emitido` / laudo `Concluído` + movimento). O que **não existe em lugar nenhum** é o momento físico entre os dois — quando o material saiu da doca e chegou na inspeção, e com quem. **Esse é o único dado que o Hub gera de forma nativa**, e ele é a razão do bipe/QR.
8. **Peças novas necessárias:** parser de lote/validade do `xProd`+`infAdProd`, de-para fornecedor→produto, tabela de vínculo lote-fornecedor ⇄ lote-interno, e o registro de custódia física.

---

#### N) Retificações durante a investigação (o que foi superado)

| Afirmação da 1ª redação | Correção |
|---|---|
| "O lote interno nasce na conclusão do laudo" | **ERRADO.** O lote é criado **no lançamento da NF**, dentro do item do `MovEstq` (`12614`, `18063`), com quantidade cheia e sem saldo. O material tem identidade durante toda a inspeção. |
| "O laudo é a entrada em estoque, portanto 001 = liberado por construção" | **Parcialmente errado na 1ª formulação, agora confirmado com ressalva.** É verdade para o caminho normal (`E0000158`→laudo→`E0000163`), mas o caminho `E0000003` entra direto. O discriminador é o **tipo de lançamento**, não o produto nem a relação comercial. |
| "O discriminador entre os dois caminhos é a natureza da operação" | **Impreciso.** O CFOP acompanha, mas o que determina o efeito em estoque é **`ControlaEstoque` do cabeçalho**, herdado do tipo de lançamento. |
| Regra de genealogia por ordem de `Documento` + quebra por `Sequencia == 1` | **Superada.** O laudo carrega `NumeroCtrlLote` diretamente. O casamento posicional só é necessário para amarrar o **lote do fornecedor**, e aí o critério primário é `DataFabricacao`. |
| "A ligação laudo ⇄ entrada só existe num sentido" | **ERRADO.** O movimento `E0000163` traz o **número do laudo** no campo `Documento` — visível já na ficha. |
| §6.3-D: "laudos `2073`/`2074`/`2075` têm todos `SequenciaItMovEstq = 1`" | **ERRADO (retificado em 29/07/2026, REC-2.0).** No espelho são **1, 2 e 3** — um item do `MovEstq` por laudo. Medido no conjunto inteiro: o par **`(chave_movestq, sequencia_it_movestq)` é único em 751/751** ⇒ a ligação item⇄laudo é **1:1**, não N:1. O código do passo C ainda trata N laudos por par, porque unicidade observada não é garantia estrutural do ERP. |
| "`E0000158` e `E0000163` são os tipos de lançamento do recebimento" | **Incompleto (29/07/2026).** A importação usa **`E0000160`**. O que se mantém constante é **`ControlaEstoque` do cabeçalho** (§6.3-C) — **nunca filtrar por `CodigoTipoLanc`**, sob pena de perder as importações inteiras no replay do `est_saldos`. |

**Retificações de 31/07/2026**

**⚠ Local NÃO é constante**

O plano e o relatório de 30/07 registram `001` como único local com base em 746/746 itens de
`MovEstq` e 71/71 requisições. **O cadastro de produto mostra que existe o `003 PRODUÇÃO`**
(`ProdLocArmazChildList` do `001.003.00047`, com `Prioridade` 1 contra 0 do `001`).

O que as amostras provavam é que *entrada por laudo* e *requisição* usam o `001`.
**Local é dimensão, não constante.** Entra assim no DDL do OP-2.2.

**⚠ `UnidadeMedidaMovimentacaoEstoque` não é gate**

42 dos 82 produtos de `001.003` não têm nenhuma unidade com o flag `Sim` — e movimentam
normalmente (verificado no `001.003.00056`, dezenas de saídas desde janeiro).
É preferência de tela.

**⚠ Os exports da tela não são paginados**

O rodapé "1 de 2" é paginação **horizontal das colunas**. A ressalva anterior está errada.

**Taxonomia de falhas do passthrough — quarta causa (04/08/2026)**

Eram três causas registradas; são quatro. A diferença está em QUEM respondeu:

| Status | Origem | Significado |
|---|---|---|
| 401 | proxy | JWT expirado |
| 403 | proxy | endpoint fora da whitelist — corpo traz "Endpoint não permitido: X" |
| 404 + corpo ASP.NET | **Alvo** | action inexistente OU parâmetro obrigatório faltando |
| 200 + corpo de exceção | Alvo | regra de negócio |

O 404 chega com corpo do IIS/ASP.NET citando a URI (`https://pef.it4you.inf.br/api/...`) e
"No action was found on the controller 'X'". Provado em 04/08/2026: `DocFin/Load` (GET não
existe — o DocFin usa SavePartial, POST) e `ReqMat/Load` sem `?numero=`. Nos dois casos a
whitelist estava correta e a requisição atravessou o proxy.
⇒ 404 NÃO é sintoma de whitelist. Diagnosticar pelo corpo, nunca só pelo status.

**Achados de 05/08/2026**

- 🔴 **`NullReferenceException` do Alvo = PAYLOAD INCOMPLETO.** O ERP **não diz qual campo
  falta**: estoura. Visto em `ReqMatRules.cs:277` (`InserirAlterarRequisicaoMaterial`) e em
  `ProdutoRules.cs:3223` (`FiltrarSaldoProduto`, faltando `idProdutoId`/`todasUnidades`/
  `empresas`). ⇒ **Nunca completar payload por tentativa e erro: CAPTURAR do Network.** Foi o
  que resolveu os dois casos, e é a razão de a §10.16 existir. Some-se isto à taxonomia acima:
  é uma **quinta** forma de falha, e a mais silenciosa, porque parece bug do servidor.
- **`item.BaixaEstoque` ≠ `cabecalho.BaixouEstoque`.** O do **item** é REGRA ("este item baixa
  quando atendido" — vem `"Sim"` mesmo em RM aberta); o do **cabeçalho** é FATO ("já baixou").
  Confundir os dois leva a concluir que o material saiu quando ele está no estoque. Entra na
  família da §6.3-J.
- **Campos "2"** (`Quantidade2`, `QuantidadeAtendida2`, `QuantidadeSaldo2`…) = quantidade na
  **SEGUNDA unidade de medida**, não duplicata. Ficam no `raw` do espelho, fora do núcleo.
- **`FiltrarSaldoProduto` — payload completo:** `produto`, `idProdutoId`, `unidMedida`,
  `posicao`, `todasUnidades`, `empresas`. **Leitura:** empresa → `ListaLocArmaz` com
  `Codigo != null` → unidade. Os de `Codigo` null são **agregados** ("Saldo Disponível",
  "Total Disponível") — é a armadilha já registrada na §9.9, agora com o payload fechado.
- **`CodigoTipoReqMatObject` traz `ObrigatorioRelacionarOP`** (hoje `"Não"`) e `SolicitaLote`
  (`"Não"`) no tipo `0000002`. ⚠ **Se `ObrigatorioRelacionarOP` se referir à `OrdProduc` NATIVA
  do Alvo** — que não é usada e vem null em 679 RMs — **ligá-lo TRAVARIA as requisições**.
  Investigar o que o campo exige **antes** de sequer considerar usá-lo como gate de disciplina.
- **O atendimento devolve campos que o `Load` NÃO traz:** `ControlaLote`, `ControlaEstoque`,
  `CodigoTipoProduto`, `ProdutoNome`, `PossuiNumSerie`. ⇒ **testar `loadOneToOne=All` no
  `ReqMat/Load`**: se trouxer, o espelho ganha `ControlaLote` — discriminador de
  rastreabilidade, e peça do BL-20 — **de graça**, sem endpoint novo.

**Retificações da sessão de testes (05/08/2026, RMs 2271–2275)**

- 🔴 **`CodigoCentroCtrl` é ESCOLHA DO USUÁRIO na tela, NÃO derivado do funcionário.** A §6.2-1
  registrou que o campo enviado é "ignorado" — isso vale para o endpoint de LEITURA/integração
  que foi testado em 23/07. Na **criação pela tela**, quem define o centro é **quem abre a RM**:
  a `2271` nasceu com **CONTROLADORIA/FINANCEIRO**, o centro do Pedro, e não PRODUCAO.
  ⇒ **A tela da Fase 2 tem de expor o campo** (§10.21).
  ⚠ **Isto afeta a §10.9**, que tratava o de-para `profiles.funcionario_alvo_codigo` como a
  fonte do centro de custo — ele continua necessário para `CodigoFuncionario`, mas **não**
  determina mais o centro. E afeta o `comment on` de `op_reqmat.codigo_centro_ctrl` (OP-2.2),
  que repete a formulação antiga — corrigir num SQL futuro, é só comentário.
- 🔴 **`CodigoFuncionarioAtendente` NÃO É EDITÁVEL e NÃO é quem atendeu.** Veio
  **`0000165 - Maria Alves`** em **todos** os atendimentos feitos pelo Pedro — provável padrão
  do local `001`. ⇒ A rastreabilidade **REAL** de pessoas vem dos campos de **Entrega**
  (`CodigoFuncionarioEntregou` / `Retirou` / `Conferiu`), que são editáveis e **provadamente
  gravam**: `2273` por API e `2274` pela tela, com pessoas distintas. (Detalhe em §10.17.)
- **`TipoAtendimento` VOLTA para `"Manual"` após um atendimento manual.** A `2273` e a `2275`
  nasceram `"Automático"`, **não** passaram por `Update` e terminaram `"Manual"`.
  ⇒ **Refina o BL-19:** a formulação correta é que **`Automático` nunca atende SOZINHO**, e
  atender manualmente **o converte**. Não invalida a regra de negócio (13 `Automático` = 13
  `Aberta`, §10.16) — invalida a leitura de que o campo é **imutável**.
- **O `Texto` do cabeçalho aceita texto longo** (398 caracteres gravados **sem truncar**) e é
  **exibido na tela de atendimento**. ⇒ É o carregador da OP para quem atende no Alvo, **sem o
  limite de 40 caracteres da `Descricao`** (§6.2). Confirma o desenho da §10.16.
- **O atendimento devolve campos resolvidos que o `Load` não traz** — lista completa, ampliando
  o item acima: `ControlaLote`, `ControlaEstoque`, `CodigoTipoProduto`, `ProdutoNome`,
  **`ProdutoCodigoAlternativo`**, `PossuiNumSerie`, **`PesoFatorDivisor`**, **`Peso`**,
  **`LocArmazNome`**.

---

#### O) Pendências desta investigação

1. **Assinatura do `CtrlLote/Load`** (swagger) — 3 tentativas falharam. *Pode não ser necessário:* lote com movimento = disponível, lote sem movimento = em inspeção.
2. **Catálogo de tipos de lançamento** — `E0000003`, `E0000005`, `E0000023`, `E0000026`, `E0000091`, `E0000108`, `E0000158`, `E0000163`. O cabeçalho do MovEstq tem campos `TipoLancamentoGeraControleEstoque`/`IntegraFinanceiro`/`IntegraCompras` (zerados no retorno) que provavelmente vêm do mestre do tipo ⇒ carregar o mestre dá a **matriz de comportamento** de forma estrutural.
3. `movEstq/GetListForComponents` **testado direto** (só capturado do Network).
4. Onde vive o flag `controla_lote` do produto no Alvo (hipótese: `ProdEmpresaFilialChildList`).
5. Acumulado de reprovas do semestre e destino do material reprovado.
6. Onde está o lado fiscal dos lançamentos `E0000158` (não integram estoque, mas `IntegradoFiscal="Sim"`).
7. `GeraRmEspecifica` — o que dispara e o que gera (`"Não"` em todos os casos examinados).

---

## 7. Diário de achados e decisões

| Data | Tarefa | Registro |
|---|---|---|
| 22/07/2026 | — | Plano criado. Decisões assumidas: sem gate de aprovação (campos preenchíveis, sem trava); `numero_referencia` nullable para o 2º número dos formulários; numeração AAAA-NNNN gerada pelo Hub na criação. Fonte dos campos: FRM-07-11 (OPs 2026-0007/0030/0056). |
| 22/07/2026 | OP-1.0 | Reconhecimento read-only concluído (fingerprint `compras_pedidos`=1674, projeto `hbtggrbauguukewiknew`). Detalhe completo + ajustes na **seção 4.1**. Principais achados: (1) timestamps EN `created_at`/`updated_at` são a convenção (132/76 tabelas vs 1 em pt) e não há trigger genérico — cada módulo tem `set_*_updated_at`; (2) permissões pontilhadas `modulo.recurso.acao` via `user_has_permission`/`_user_has_perm` + catálogo `hub_permissions`/`hub_roles` — os nomes `op_*` do plano viram `producao.*`; (3) espelho de produtos = `stock_products` (codigo_produto/nome_produto/unidade_medida/ativo); (4) RLS do Suprimentos é aberta (`USING(true)`), gate em RPC+front — OP-1.2 vai divergir p/ SELECT gateado; (5) `profiles` **sem** `setor` ⇒ `emitido_depto` texto livre (corrige OP-1.4); (6) molde de tela = `SuprimentosPedidos.tsx`, visual em `statusConfig.ts`/`DataSection`, leitura de lista inline via `useQuery`+`.from()`. |
| 22/07/2026 | OP-1.1 | Decisões do Pedro aplicadas ao DDL: módulo de permissão `producao` (rota `/producao`); RLS gateada por `producao.access` (policies só na OP-1.2); papéis novos `operador_producao` (access+create) e `gestor_producao` (access+create+manage), `is_system=false` (wiring na OP-1.2); timestamps `created_at`/`updated_at` + trigger `op_set_updated_at()`; itens em snapshot (`codigo_produto`, `codigo_alternativo_produto`, `produto_nome`, `produto_unidade`, `quantidade_planejada`), sem FK ao catálogo; `op_proximo_numero()` SECURITY DEFINER + `search_path=public`. **Verificação read-only:** os 9 códigos do FRM-07-11 batem **100% em `stock_products.codigo_alternativo`** (0 em `codigo_produto`/`codigo_reduzido`; 2 coincidências em `codigo_barras`), família `001.010` (Tricvalve, "TRICUSPID VALVE …"), `ativo=true`, `UNID` ⇒ picker (OP-1.4) busca `codigo_alternativo`+`nome_produto`. DDL final na seção 3. **Pendências para CONCLUÍDA: seed real de 2026 (`<PREENCHER>`) + aplicação no SQL Editor + verificação empírica.** RLS habilitada sem policies = deny-all seguro no intervalo (nenhum frontend usa as tabelas ainda; SQL Editor roda como postgres e ignora RLS). |
| 22/07/2026 | OP-1.1 | Seed definido: **`(2026, 500)` — reserva de faixa** (não há "último número" estável; manual e Hub emitem em paralelo). Regra: `2026-0001`..`0500` = processo manual (FRM-07-11); Hub emite de `2026-0501`. No **go-live o manual para** → Hub emissor único. ⚠️ **Virada de ano:** se a operação paralela cruzar 2027, semear `(2027, 500)` (ou folga vigente) antes da 1ª OP de 2027 — senão `op_proximo_numero()` cria `(2027,0)` e emite `2027-0001`, colidindo com a faixa manual. Endossado: deny-all até OP-1.2; lockdown de `op_proximo_numero()` (revogar EXECUTE público) na OP-1.2. `sequencia`+`UNIQUE(op_id,sequencia)` mantidos. Picker OP-1.4: busca `codigo_alternativo`+`nome_produto`+`codigo_produto` (exibe ambos); `codigo_barras` fora (ambiguidade). `<<SEED_2026>>`→`500` no bloco. **Pendente p/ CONCLUÍDA: aplicação no SQL Editor + verificação empírica.** |
| 23/07/2026 | OP-1.1 | **Sessão de sincronização.** `git pull` = up-to-date, sem commits do Lovable. **Detecção empírica do estado (MCP read-only, fingerprint `compras_pedidos`=1686):** `op_*` = **0 tabelas, 0 funções** (checado via `information_schema` + `pg_proc`/`pg_namespace` + regex de token) ⇒ **OP-1.1 NÃO aplicada**; banco limpo. **Revisão de 4 olhos incorporada ao bloco (pré-aplicação):** (a) `op_proximo_numero()` retorna `v_ano::text || '-' || case when v_n > 9999 then v_n::text else lpad(v_n::text,4,'0') end` — `lpad(txt,4,'0')` **trunca à esquerda** acima de 4 dígitos (`lpad('10000',4,'0')`=`'1000'`), gerando colisão silenciosa ao passar de 9999; (b) `op_set_updated_at()` ganha `set search_path = public`. **Regra de protocolo nova (seção 0):** blocos SQL de aplicação manual vivem em `sql/OP-x.y.sql` e são copiados DO ARQUIVO (o terminal colapsa linhas longas e corrompe o SQL). Criado **`sql/OP-1.1.sql`** (bloco canônico com as duas correções + seed 500). **Próximo passo: Pedro cola `sql/OP-1.1.sql` no SQL Editor**, depois roda a verificação empírica (contagem das 5 tabelas, seed, `op_proximo_numero()` em BEGIN/ROLLBACK, trigger) → OP-1.1 CONCLUÍDA e segue OP-1.2. |
| 23/07/2026 | OP-1.1 | **CONCLUÍDA.** Pedro aplicou no SQL Editor; confirmado empiricamente via `pg_catalog` (MCP read-only, fingerprint 1686): 5 tabelas com **RLS ligada** (`op_ordens`=28 col incl. `motivo_cancelamento`/`comunicado_em`/`cancelada_em`; `op_ordem_itens`=9; `op_status_historico`=7; `op_tipos`=6; `op_numeracao`=2); contagens `op_tipos`=3, `op_numeracao`=1 (**seed 2026=500**), demais=0; `op_proximo_numero()` `SECURITY DEFINER`+`search_path=public`+CASE `v_n>9999` (via `pg_get_functiondef`); `op_set_updated_at()` `search_path=public`; trigger `trg_op_ordens_updated_at`; 4 CHECKs (status 6 estados, destino, tipo_ordem, tipo_produto). Numerador testado ao vivo pelo Pedro (`2026-0501`/`0502`) e resetado a 500. |
| 23/07/2026 | OP-1.2 | **SQL redigido (sem executar nada no banco) → `sql/OP-1.2.sql`.** Schema RBAC lido ao vivo (não assumido): `hub_permissions.codigo` UNIQUE, `hub_roles.codigo` UNIQUE (`modulo` NOT NULL, `is_system` default false), `hub_role_permissions` liga por **`role_id`+`permission_id` (UUID)** com UNIQUE(role_id,permission_id) — wiring resolve `codigo→id` via subselect. Conteúdo: (1) 3 permissões `producao.access`/`producao.ordens.create`/`producao.ordens.manage` (descrições no padrão da casa); (2) papéis `operador_producao` (access+create) e `gestor_producao` (os três), `is_system=false`, módulo `producao`; (3) wiring idempotente `ON CONFLICT DO NOTHING`; (4) 5 policies **SELECT** gateadas por `user_has_permission(auth.uid(),'producao.access')`, **sem policy de escrita**; (5) RPCs `SECURITY DEFINER`+`search_path=public` com gate `_user_has_perm`: `op_criar_ordem` (nº via `op_proximo_numero`, ordem RASCUNHO+itens, histórico NULL→RASCUNHO, mín. 1 item), `op_atualizar_rascunho` (só status RASCUNHO, substitui cabeçalho+itens), `op_transicao_status` (valida o mapa da seção 1, gate por ação — avanço=create / cancelar·fechar·reabrir=manage, motivo obrigatório em CANCELADA, carimba `cancelada_*`); grants só `authenticated`; (6) **lockdown de `op_proximo_numero`** (revoke execute de public/anon/authenticated — só chamada por dentro de `op_criar_ordem`, que roda como owner). Idempotente e reexecutável; verificação + rollback comentados no arquivo. **Pendente para CONCLUÍDA:** Pedro cola `sql/OP-1.2.sql` no SQL Editor + verificação. Nota p/ frontend (OP-1.3+): espelhar as 3 permissões em `src/constants/permissions.ts`. |
| 23/07/2026 | OP-1.2 | **CONCLUÍDA.** Pedro aplicou o v2; confirmado via `pg_catalog` (fingerprint 1686): `fechada_por`/`fechada_em` presentes; **4 policies** SELECT (`op_tipos`/`op_ordens`/`op_ordem_itens`/`op_status_historico`), `op_numeracao` sem policy (deny-all) conforme desenho; **3 permissões** `producao.access`/`producao.ordens.create`/`producao.ordens.manage`; **2 papéis** `operador_producao` (wiring=2) e `gestor_producao` (wiring=3), `is_system=false`; **5 RPCs** (`op_criar_ordem`/`op_atualizar_rascunho`/`op_transicao_status`/`op_registrar_aprovacao`/`op_registrar_comunicacao`) todas `SECURITY DEFINER`+`search_path=public`; **lockdown** de `op_proximo_numero` OK (`has_function_privilege` authenticated=false, anon=false) e as 5 RPCs executáveis por `authenticated`. Nota histórica: a 1ª tentativa de aplicação não constava no banco (0 objetos) — reconferido e reaplicado antes de prosseguir. |
| 23/07/2026 | OP-1.4/1.5 | **CORREÇÃO DE REGISTRO (transparência do Pedro, sessão OP-1.6).** O registro anterior que dava a OP-1.4 como "validada no preview pelo Pedro … todos ✓ e publicado" foi **retirado**: aquele texto veio de um prompt-modelo colado **antes** dos testes — **os testes da OP-1.4 e da OP-1.5 NÃO foram executados** e o Publish dessas duas não ocorreu. Confirmado empiricamente (fingerprint 1688): `op_ordens` **vazia**, `op_numeracao` 2026 = **500**, **zero** atribuições de papel de produção. Status de OP-1.4 e OP-1.5 corrigido para **"entregue (código no preview), validação pendente"**. A validação real (criar OP espelho da 2026-0007 + bateria de gate) acontece na **OP-1.6**, com conferência empírica antes de qualquer CONCLUÍDA. |
| 23/07/2026 | OP-1.6 | **Bateria parcial + apuração empírica + reformulação do fechamento + saneamento.** Estado real (fingerprint 1691): 2 OPs, **ambas CANCELADA** — `2026-0501` (3 itens, motivo "TESTE", hist NULL→RASCUNHO→CANCELADA) e `2026-0502` (1 item, hist NULL→RASCUNHO→**ABERTA**→CANCELADA); `op_numeracao` 2026 = **502** (sequência confirmada); **nenhum carimbo** de aprovação/comunicação (0/0); `emitido_depto`="Produção" persistido. **Evidência visual declarada pelo Pedro:** modal fiel ao FRM (defaults + número prometido), picker por `codigo_alternativo` c/ snapshot dos 2 códigos, dedup de SKU, "Salvar e abrir"→ABERTA, chips/resumo na lista, edição de rascunho populada, cancelamento c/ motivo obrigatório + `cancelada_por/em` + histórico + botões ocultos pós-cancelamento. **Residual (sem evidência visual nem no banco):** carimbos aprovação/comunicação, dirty-check, quantidade 0, edição sem itens, dark/light, filtro+F5, console, gate real. Carimbos nunca rodaram **e** as 2 OPs estão CANCELADA (RPC recusa carimbo em CANCELADA) ⇒ residual inclui **criar 2026-0503, carimbar aprovação+comunicação, cancelar c/ motivo "OP de teste da Fase 1"**. **Item 3 (catálogo):** IVC 41 checado — `8211020041` (001.010.058, transcatheter) e `82110077` (001.010.042, delivery loaded) **presentes e ATIVOS** ⇒ **sem pendência de catálogo pré-go-live**. **Item 4 (BPF):** critério de fechamento da OP-1.6 **reformulado** (seção 4.1) — proibido recriar a 2026-0007 real (registro de produção falso, vedado em BPF); Fase 1 fecha com bateria completa + gate real + saneamento + Publish; a 2026-0501 real nasce sob demanda com o USER 1. **Item 5:** entregue `sql/OP-1.6-saneamento.sql` (dry-run + transação: apaga todas as `op_ordens` de teste, cascade nas filhas, reset contador→500; verificação), **decisão do Pedro**, a aplicar SÓ após fechar o residual. |
| 23/07/2026 | OP-1.6 | **Residual — conferência empírica (fingerprint 1692).** **Bloco A verde:** A2 qtd 0 e A3 dirty-check (UI, declarados ✓); **A4 edição sem itens** — 0504 preservou o item original (banco: 1 item) ✓; **A5 carimbos PROVADOS na 0504** — `aprovado_em` 16:17:43 (`aprovado_depto`="\|Financeiro" — pipe solto digitado, cosmético, some no saneamento), `comunicado_em` 16:17:59 (`comunicado_a`="Qualidade", `comunicado_depto`="Financeiro"), **ambos enquanto RASCUNHO** (abertura RASCUNHO→ABERTA só às 16:18:18) ✓ + recusa de motivo vazio (declarado ✓); **A6** — 0503 CANCELADA (motivo "Teste da Fase 1") ✓; IVC 41 provado no picker. Numeração sequencial 0501–0504, `op_numeracao`=**504** ✓. **⚠️ Pendências que travam o fechamento:** (a) **0504 está ABERTA, não cancelada** (report dizia "0503 e 0504 canceladas" — só a 0503 foi); sem impacto no saneamento; (b) **Bloco B (dark/light, filtro+F5, console)** = placeholder, sem evidência (UI, sem rastro no banco); (c) **Bloco C (gate real)** = **0 atribuições** de papel de produção no banco ⇒ **não exercitado**. **Saneamento NÃO autorizado** — o critério reformulado exige bateria completa + gate real provado. **Achado de UX** (aceito, não trava a fase): carimbos aceitos em RASCUNHO → Backlog §8 (BL-1). |
| 23/07/2026 | OP-1.6 | **Blocos B e C — conferência empírica (fingerprint 1692): tudo verde.** **Bloco C (gate real) provado no banco:** conta de serviço `nfe@pfbrazil.com` **is_admin=false**; **OP `2026-0505` criada e ABERTA por ela** (`emitido_por`=nfe) ⇒ caminho `producao.ordens.create` efetivo **sem bypass de admin**; contador=505. **C2:** botões manage (Cancelar/Registrar aprovação/comunicação) ocultos na sessão dele (visual ✓). **C3 revogação:** `operador_producao` de nfe com `revogado_em`=2026-07-23 17:39:31 (inativo); **nenhum papel ATIVO da conta concede `producao.*`** (cross-check vazio) ⇒ "Produção" sai da sidebar e `/producao/ordens` barra ✓ — caminho `revogado_em` provado. **Higiene:** só `operador_producao` revogado; `requisitante`/`viewer_intercompany`/`analista_compras` preservados (ativos). **Nota da conta de serviço:** esses 3 papéis prévios de compras **não concedem `producao.*`** (confirmado) ⇒ teste válido, sem contaminação de permissão. **Bloco B:** dark/light (lista/detalhe/modal) + filtro+F5 (persistência via URL) + console limpo — ✓. **⇒ Saneamento AUTORIZADO** (`sql/OP-1.6-saneamento.sql`). Sequência para selar: Pedro aplica (dry-run→transação) → reconfiro op_ordens=0 e contador=500 → Publish → marco OP-1.6 e Fase 1 CONCLUÍDAS + §1. |
| 23/07/2026 | Fase 0 | **Investigação ReqMat concluída (leitura / Lab de API).** Achados completos na **§6.1**. **§5 Q2 RESPONDIDA:** atendimento é do **almoxarifado, por item** (`CodigoFuncionarioAtendente`/`DataHoraAtendimento`) ⇒ **Fase 2 sem rota de atender; ledger pelo ATENDIDO via Load**. **§5 Q1 meio-fechada:** OP nativa não usada (`OrdProduc` vazio em 46 reqs + 3 Loads) ⇒ vínculo do Hub via `Descricao`. Tipos em uso `0000002` (REQUISIÇÃO PRODUÇÃO)/`0000004` (SAÍDA CONSUMO); **Devolução a descobrir**; baixa só no atendimento (`BaixouEstoque`+`CodigoTipoLanc E0000023`); quantidades nativas `Quantidade/Atendida/Saldo/Devolvida/Perdida`; lote nativo em `CtrlLoteItemReqMatChildList` (genealogia Fase 5; pericárdio 2214 = 174 un/18 lotes); `PosicaoProdUnidMed` 1=principal, `CodigoAlternativoProduto` no item, campos de viagem/Mix ignorar; `TipoAtendimento` Manual/Automático (Hub=**Manual**; Automático suspeito de baixar na criação → 2187 Aberta c/ **custo negativo**). **Pendências Fase 0:** teste de ESCRITA (Numero auto?/`Operacao`/`TipoAtendimento`/`Descricao`) + `Deletar`; código do tipo Devolução; confirmar Automático c/ almoxarifado. **Achado operacional (fora do módulo):** 2187 aberta há 3 semanas + re-requisição na 2231 = **risco de baixa em dobro** (Pedro trata). Espécimes: 2231 (parcial), 2187 (aberta), 2214 (total, 18 lotes). §1 atualizado (Fase 0 CONCLUÍDA-leitura; Fase 2 refinada). |
| 23/07/2026 | Fase 0 | **Perna de ESCRITA concluída — ReqMat Insert/Delete provado** (req `0000002236` criada e deletada). Achados na **§6.2**. **Receita do INSERT** (`POST ReqMat/InserirAlterarRequisicaoMaterial`): **sem `Numero`** (auto-gera; `""` quebra c/ `SqlException 'syntax near And'`), header `Operacao="Retirada"`, item `Operacao="I"`, `CodigoTipoRequisicaoMaterial="0000002"`, **`Descricao`≤40** (`"OP 2026-05xx - <resumo>"`), `Mix` omitido (servidor põe -1), `PosicaoUnidadeMedida=1`; **resposta com ECO BUGADO** (Numero replicado em todo campo string) → parsear só `Numero` + confirmar via Load. **Descobertas:** (1) `CodigoCentroControle` **ignorado** — centro deriva do funcionário ⇒ de-para `profiles.funcionario_alvo_codigo` crítico; (2) `Origem="Importação"` = carimbo de auditoria grátis (vs `ManualAlvo`); (3) `TipoAtendimento="Automático"` = default de nascimento (API+UI) mas **não atendeu** com estoque (2 casos Abertos) — semântica DESCONHECIDA; (4) `DataValidade` nasce null via API; (5) inserção **não baixa estoque** (baixa só no atendimento — 2235/2236); (6) `DeletarReqMat` usa `reqMatNumero`; (7) UI usa endpoints internos (`GerenciaReqMat`/`New?numero=-1`), contrato do Hub = endpoint de integração; (8) tela tem **Estornar/Aprovar** (estorno nativo); (9) cadastro tem tipos `0000005` SAÍDA MATERIAL / `0000003` EPI'S, **Devolução não identificada**. **Pendências humanas:** semântica do Automático; código Devolução; quem deleta requisições (2196/2230 sumidas); §5 Q3 (reprova) / Q4 (acabado) / Q5 (2º número). **§1: Fase 0 CONCLUÍDA (leitura + escrita).** |
| 23/07/2026 | OP-1.6 / Fase 1 | **SELADA — FASE 1 CONCLUÍDA.** Publish confirmado pelo Pedro (feito hoje, logo após o saneamento). Reconferência final de selo (fingerprint 1693): `op_ordens`=0, `op_ordem_itens`=0, `op_status_historico`=0, `op_numeracao` 2026=**500** ⇒ produção limpa, pronta para a **2026-0501 real** (piloto sob demanda com o USER 1). **Fase 1 completa:** OP-1.0 (reconhecimento) → OP-1.1 (DDL/numeração) → OP-1.2 (RLS+RPCs+RBAC+lockdown) → OP-1.3 (nav+lista) → OP-1.4 (modal FRM) → OP-1.5 (detalhe+transições) → OP-1.6 (validação ponta a ponta + gate real provado com `nfe@pfbrazil.com` + saneamento). Backlog aberto: BL-1 (carimbos aceitos em RASCUNHO). **Próxima: Fase 2 (ReqMat)** — abre quando fecharem as pendências humanas (§6.2 + §5 Q3/Q4/Q5); Pedro conduz nos próximos dias. |
| 28/07/2026 | OP-2.0 | **Reconhecimento de ESTOQUE concluído (read-only; Lab de API + SQL no Hub).** Achados completos na **§6.3**. Espécime `001.007.00101` (pericárdio, BIOCOLLAGEN). **Endpoints provados:** `MovEstq/RetornaFichaEstoque` (POST, janela de datas, devolve `Saldo Anterior` calculado) e `MovEstq/Load?codigoEmpresaFilial=1.01&chave=N&loadParent=All&loadChild=All&loadOneToOne=All`. **Capturado do Network (não testado):** `movEstq/GetListForComponents` (POST, filtro C#-like `==`/`&&`/`#dd/MM/yyyy#`, paginado, **só cabeçalhos**) ⇒ sync em dois tempos: listar chaves → Load por chave. **Regra de erro registrada:** `"No action was found on the controller"` = controller resolveu, **parâmetros não casaram** (foi o caso do `MovEstq/Load` sem `codigoEmpresaFilial`) — não adivinhar parâmetro, ler o swagger; o padrão de prefixo da §6.2 **não é universal** (`Produto/Load` usa `codigo`). **Estrutura:** todo movimento traz `LocArmazItemMovEstqChildList` (com `CodigoLocArmazDestino`, nulo fora de transferência) e `CtrlLoteItemMovEstqChildList` (lote, validade, fabricação, local, qtd) ⇒ **`est_saldos` = replay do ledger**, reconciliado contra a ficha. Ledger do Alvo reconciliou **191 linhas com 0 divergências** em qtd e valor. FEFO é praticado pelo almoxarifado. **Entrada:** dois caminhos, ambos para o 001 — `LAUDO`/99/`E0000163`/CFOP `1.101.001` (163 lanç., 1.852 un, R$ 1,24 mi, `IntegradoFiscal=Não`) e `NF-e`/1/`E0000003`/CFOP `1.101.002` (5 lanç., 41 un, integrado). Mesmo SKU nos dois ⇒ **discriminador é a natureza da operação**. **Não existe transferência 015→001**: o laudo **é** a entrada em estoque; janela de inspeção de **26 dias** (NF 1460 em 27/04 → chegada 29/04 → efetivação 25/05, elo provado por aritmética exata: 71 un × R$ 900 = R$ 63.900). ⚠️ **"Saldo em 001" ≠ "liberado pela Qualidade"** — o caminho NF-e direta existe. **Valorização:** `BaseCustoMedio = ValorProduto × (1−ICMS) × (1−PIS/COFINS)`; o Hub **lê**, não calcula, e nunca usa `ValorProduto`. **Genealogia:** o lote do fornecedor **não entra no Alvo** (`NumeroLoteFabricante`/`NumeroLoteOrigem`/`CodigoProdutoEntidadeOrigem` sempre nulos) — a operadora converte para o código da P&F e a Inspeção gera lote novo; o dado do fornecedor vive partido entre `xProd` (trunca em 120 chars) e `infAdProd` do XML. **Regra de reconstrução:** ordenar por `Documento`, quebrar leva quando `Sequencia==1`, casar posicionalmente com a NF, validar pela soma — **nunca por offset** (bases diferentes por leva: 1323/1331/1413 em jan; 1814 em mai; leva pode atravessar dias). Provado nas posições 1, 4 e 7 da NF 1460. **Campos que enganam:** `ControlaLote` do item vem "Não" com 10 lotes gravados (não usar); `Sequencia` da ficha é a posição do documento na leva (não do item); `CentroControle` é centro de custo; **`nf_entrada` é espelho parcial** (só notas com classificação de despesa) e **não serve** ao recebimento. **Achados operacionais (fora do módulo):** (a) 52 NFs da Biocollagen abr–jun/2026, R$ 1.278.850, **todas pendentes**, contra 7 laudos em maio e 0 em junho ⇒ ~R$ 1 mi de material invisível no estoque e na inspeção — **é o argumento mais concreto do módulo**; (b) `CustoMedio` da ficha diverge de `ValorSaldo÷QtdSaldo` desde 16/04/2026, 4 saídas com excesso de R$ 343 mil derrubando o custo médio de R$ 669 para R$ 235 — **investigar em separado**; (c) Biocollagen tem **3 relações comerciais**, incluindo **industrialização por encomenda** (redução de biocarga, CFOP 5124/5902) = **segundo processador externo além do Oximed**, não previsto em nenhum plano. **Impacto no desenho:** o módulo de recebimento deixa de ser "criar local RECEB no Alvo" e vira **tela de conciliação no Hub** (NF ⇄ lotes internos, vínculo gravado no Hub, sem escrever no Alvo); "RECEB" vira visão calculada. **`MovEstq` NÃO está na whitelist** do passthrough (repo separado `financeiropfbrazil/erp-proxy`) — inclusão é mudança no gargalo compartilhado (Suprimentos 100+ usuários), fazer aditivo com rollback confirmado. **Pendências em §6.3-K.** |
| 28/07/2026 | OP-2.0 | **Consolidação da §6.3 — modelo de recebimento fechado.** A 1ª redação da §6.3 continha inferências que a própria sessão derrubou; **§6.3-N lista as 5 retificações**. **O que mudou:** (1) **o lote NÃO nasce na conclusão do laudo** — é criado no **lançamento da NF**, dentro do item do `MovEstq` (`12614`: lote `0001988`/150 un; `18063`: lote `0002636`/60 un), com quantidade cheia, validade e destino `001`, **sem gerar saldo** ⇒ o material tem identidade durante toda a inspeção, e o bipe do Hub pode carregar um lote real; (2) o discriminador de efeito em estoque é **`ControlaEstoque` do cabeçalho** (herdado do tipo de lançamento), não a natureza da operação — `E0000158`=Não, `E0000003`/`E0000163`=Sim; isso **explica a NF 1405** (entrou direto por ter sido lançada com `E0000003`); (3) a ligação laudo⇄entrada é **bidirecional**: o movimento `E0000163` traz o **número do laudo** no campo `Documento`, visível já na ficha ⇒ **a ficha basta para o sync**; (4) a regra de genealogia posicional (ordenar por `Documento`, quebrar por `Sequencia==1`) foi **superada** — o laudo carrega `NumeroCtrlLote` direto; o casamento posicional sobra só para o **lote do fornecedor**, com `DataFabricacao` como critério primário. **Endpoints novos provados:** `Laudo/Load?codigoEmpresaFilial=1.01&numero=N` e `laudo/GetListForComponents` (mesmo padrão do `movEstq`). **A entidade Laudo é o registro de recebimento POR LOTE** — traz `ChaveMovEstq`+`SequenciaItMovEstq`+`NumeroCtrlLote`, quantidades aprovada/reprovada/devolvida/destruída, resultado, examinador, foto, análise química e **teste de laboratório externo** (conceito novo, não previsto). **Reprova provada com balanço fechado:** laudo `0000002070` (LFU, NF 100), lote de 60 → aprovadas 21 + reprovadas 39 = 60; entrada de **21** un (chave 18072, `ValorEntrada` 2.591,82 = 21×123,42). ⇒ **a Qualidade controla o que vira saldo; material reprovado nunca fica disponível para requisição** e a RM **pode confiar no saldo do `001`** sem filtrar por laudo. ⚠️ As 39 reprovadas existem só em `QuantidadeReprovada`+`ValorReprovado` (R$ 5.304) e em **texto livre** (`QuantidadeDevolvida=0`, `DataDevolvida=null`) — **a devolução ao fornecedor não tem registro estruturado**. ⚠️ **2ª evidência de que o `CustoMedio` da ficha não é confiável** (`001.007.00025`, 23/06: `ValorSaldo/QtdSaldo`=14,70 vs `CustoMedio`=132,28) ⇒ regra: ler `ValorSaldo`+`QtdSaldo` ou `CustoUnitario` do movimento, **nunca** o `CustoMedio`. **Pendência de inspeção quantificada:** 76 laudos `Emitido` de pericárdio, **1.044 un** de 20 NFs (02/06 a 15/07), contra 614 un em estoque ⇒ **70% mais material esperando liberação do que disponível para produzir**. **Conclusão de desenho:** RECEBIMENTO e ESTOQUE **já existem no Alvo** (laudo `Emitido`/`Concluído`); o que **não existe em lugar nenhum** é o momento físico entre os dois — `DataRecepcao` é preenchida na conclusão (3 de 3 casos). **É a única informação que o Hub gera de forma nativa, e é a razão do bipe/QR.** Pendências em §6.3-O. |

| 28/07/2026 | REC-1.1 | **Sync do Laudo + Fila de Inspeção entregues (código; nada deployado).** Sessão iniciada com `git pull` = up-to-date (sem commits do Lovable) e **fingerprint `compras_pedidos` = 1720** (projeto `hbtggrbauguukewiknew`, MCP read-only). **REC-1.0 reconferido no banco antes de escrever qualquer código:** `rec_laudos` com 39 colunas, 8 índices, RLS ligada, 1 policy (`rec_laudos_select_admin` → `_is_admin()`), 1 trigger, **0 linhas**. **Whitelist do gateway conferida na fonte** (`erp-proxy`, `origin/main`, commit `e0b6e05`): `Laudo/Load`, `laudo/GetListForComponents` e `Laudo/GetListForComponents` estão em `ALLOWED_ENDPOINTS` — o clone local do erp-proxy estava 1 commit atrás e **não** foi tocado. **Autenticação lida, não inventada:** as 6 Edge Functions de sync do projeto usam `X-System-Secret` server-to-server; o middleware `requireSupabaseAuth` do gateway aceita esse header antes do JWT ⇒ `sync-laudos` segue o mesmo caminho. **Padrão de histórico seguido:** `sync_runs` (`job_type='laudos'`) + kill-switch `sync_settings` + `CRON_SECRET` + disparador `call_sync_laudos_cron` espelhado de `call_sync_produtos_cron`. **Decisões registradas:** (1) o Alvo devolve datas **sem offset** e elas são horário de Brasília — gravar cru em `timestamptz` faria a data "voltar" um dia, então o mapper carimba `-03:00` (constante `ALVO_TZ_OFFSET`); (2) o parser da lista é **defensivo** (tenta `Registros`/`Lista`/`Items`/… e, no limite, o 1º array de objetos) porque o envelope do `GetListForComponents` nunca foi visto de dentro de código — a chave usada vai para `sync_runs.detalhes`; (3) datas-zero do .NET (`0001-01-01`) viram null; (4) **sem corte silencioso**: se a lista bater no `PageSize` 2000 o job marca `possivel_truncacao` no retorno e na observação. **Mapeamento `sync_runs` deste job:** `total_candidatos`=listados · `total_consultados`=gravados · `total_mudaram`=enriquecidos · `total_erros`=erros. **Tela:** `/recebimento/fila`, somente leitura, **admin-only sem permissão nova** (gate = RLS `_is_admin()` + `isAdmin` na página e na sidebar) — `hub_permissions`/`hub_roles` não foram tocados. **Nenhuma escrita no Alvo, nenhum SQL aplicado, nenhum deploy** (função, Lovable e Render seguem intactos). Build `bun run build` limpo e `tsc --noEmit` limpo. Detalhe operacional (rota, payload, cadência, teto, o que validar) na **seção 9**. |

| 28/07/2026 | REC-1.1 / REC-1.2 | **REC-1.1 CONCLUÍDA — sync no ar e tela publicada.** Sessão de REC-1.3 abriu com `git pull` (1 commit novo, do Pedro: `7123bb4` REC-1.2; nenhum do Lovable) e **fingerprint `compras_pedidos` = 1720**. Estado conferido no banco: **751 laudos** em `rec_laudos` — **119 `Emitido`**, **632 `Concluído`**, 651 ainda sem enriquecer, último `sincronizado_em` 28/07 15:08 UTC; a tela mostra 119 lotes / 1.523 unidades / lote mais antigo com **110 dias** / 31 NFs. **Percalço que virou regra (REC-1.2):** o 1º disparo do `sync-laudos` morreu **antes de qualquer chamada ao Alvo** com `ERROR 23514 ... sync_runs_job_type_check` — `sync_runs.job_type` tem **CHECK enumerado** e é tabela compartilhada pelos 7 crons ⇒ **todo sync novo precisa estender a constraint antes do primeiro disparo**; corrigido por `sql/REC-1.2.sql` (aditivo, em transação, 9 valores preservados + `'laudos'`). Mesma armadilha existe em `sync_runs_triggered_by_check`. **Desempenho medido:** 751 listados + 100 enriquecidos em **14,5 s**, contra watchdog de 110 s ⇒ **folga de ~7,5×**, sobra espaço para subir o `LOAD_BATCH` e convergir o enriquecimento em menos rodadas (§9.4). |
| 28/07/2026 | REC-1.3 | **Filtro de período + exportação XLSX na Fila de Inspeção (código entregue; nada publicado).** Fingerprint 1720. **(a) Período:** par "Emissão de / até" sobre `data_emissao`, com o date picker que o Hub já usa (`Popover` + `Calendar`, molde de `SuprimentosPedidos` — nenhuma biblioteca nova), **independentes** (só De, só Até ou ambos), sem default, persistidos na URL (`de`/`ate`) e refletidos nos KPIs; comparação por **instantes locais** (início do dia "De", fim do dia "Até") para o limite não cortar meio dia. Agrupamento por NF, expandir/recolher e os filtros antigos **não foram tocados**. **(b) Exportação:** `src/services/recebimentoExport.ts`, SheetJS (`xlsx@^0.18.5`, **já era dependência** — nada instalado), import dinâmico com botão em estado "Gerando…". Exporta **o conjunto filtrado inteiro**: a tela não pagina no servidor (carrega tudo com teto de 3.000 e aviso), então **não houve paginação a resolver**. Planilha **plana**, 14 colunas na ordem pedida (+2 na aba Concluídos), **tipagem verificada empiricamente** gerando e relendo o arquivo com o SheetJS do projeto: datas viram `t:"d"` **no dia certo** (08/05 continua 08/05 — sem escorregar de fuso), quantidade/dias/chave viram `t:"n"`, NF e nº do laudo ficam **texto** (zeros à esquerda), células vazias quando o dado não existe. **(c) Achado que muda o pedido:** o writer XLSX do **SheetJS community 0.18.5 não emite `<pane>`** (`write_ws_xml_sheetviews` grava apenas `workbookViewId`; as ocorrências de "pane" no bundle são `case ...: break` do parser de SpreadsheetML) ⇒ **freeze de cabeçalho não é possível por essa lib**; entregue **autofiltro** (`!autofilter`, suportado pelo writer) como substituto funcional — congelar exigiria dependência nova, decisão do Pedro. **(d) Correção de fronteira:** `numeric` do Postgres chega como **string** no PostgREST (`"32.000000000"`) — o service passou a converter `quantidade`, `quantidade_aprovada`, `quantidade_reprovada` e `chave_movestq` para número na entrada, para ninguém somar texto adiante; `chave_movestq` entrou no SELECT e no tipo `LaudoFila`. Build e `tsc --noEmit` limpos. **Nada deployado** (sem Publish, sem `functions deploy`, sem SQL aplicado, sem escrita no Alvo). |

| 28/07/2026 | REC-1.5 | **Dropdown único de status + valor reprovado (código entregue; nada publicado).** Fingerprint **1720**; `git pull` up-to-date, **nenhum commit do Lovable**. Estado do espelho conferido antes de mexer: **751 laudos, 751 com lote, 0 pendentes de enriquecimento** (backfill completo), **119 `Emitido` / 632 `Concluído`** — só 2 status distintos no espelho. **(a) Toggle removido:** a tela tinha dois controles para o mesmo recorte (toggle no topo + dropdown "Status") que podiam ficar em desacordo; agora o **dropdown é a única fonte**, com "Emitido" default e **"Todos"** novo. Compatibilidade preservada para `?aba=concluidos` de links antigos. **(b) Condicionais por LINHA, não por aba:** "Dias parado" só vale para quem ainda espera e "resultado/aprovada/reprovada/valor/inspeção" só para quem foi inspecionado ⇒ em "Todos" **todas as colunas aparecem e a inaplicável fica com "—" naquela linha**, decidido por `status`; entra também a coluna "Status" (só em Todos) para as linhas serem distinguíveis. KPIs acompanham: 4 / 5 / 6 cards conforme o recorte, com grade em classes estáticas (Tailwind não gera classe dinâmica). **(c) Valor reprovado:** KPI em R$ (`tabular-nums`, vermelho só quando > 0), coluna na tabela e coluna no XLSX **tipada como número**. Conferido no banco: **15 laudos com reprova somando R$ 13.499,81** — bate com a referência do Pedro. **(d) Coerência corrigida:** "lote mais antigo" (KPI e badge do grupo de NF) agora ignora concluídos — um laudo liberado não está esperando; antes, com o toggle, o caso não existia. **(e) Limite respeitado — não inventei valor para a fila:** o espelho **não tem** o valor do lote, só `valor_reprovado`; valorizar o material parado exige o MovEstq de origem. **Medição para dimensionar a REC-2.0:** as 751 linhas vêm de **295 `chave_movestq` distintas** (2,5 laudos por movimento, 0 sem chave) — **a estimativa anterior de ~130 chamadas estava baixa**; e `codigo_entidade` é null em **751/751**, confirmando §6.3-D. Pendência registrada em **§9.5** (exige `MovEstq/Load` na whitelist do erp-proxy, repo separado com deploy no Render). Build e `tsc --noEmit` limpos; **nada deployado** (sem Publish, sem `functions deploy`, sem SQL, sem escrita no Alvo). |

| 28/07/2026 | REC-1.6 | **Responsividade da Fila de Inspeção (layout; código entregue, nada publicado).** Fingerprint **1720**; pull up-to-date, **sem commits do Lovable**. **Diagnóstico da quebra em "Todos":** não era a contagem de colunas do grid — era **`min-width:auto`** nos itens de grid/flex. Com rótulo longo o `KpiCard` assumia a largura do conteúdo e empurrava o último card para fora da viewport; o mesmo mecanismo fazia o campo "Emissão até" vazar da barra `flex-wrap`. Correções: `min-w-0` + `break-words` na cadeia do card, grade que **quebra em linhas** (`sm:2 / lg:3 / 2xl:6`) e barra de filtros convertida de flex para **grid** (`sm:2 / lg:3 / 2xl:6`), o que também garante os **dois date pickers na mesma linha** em 2, 3 e 6 colunas. Ações (Limpar/Recolher/Exportar) foram para uma linha própria. **Colunas congeladas:** "Laudo" (116px) e "Produto" (240px) com `sticky left-0` / `left-[116px]`, `border-r` marcando o corte, `z-20` no `thead` e `z-10` no corpo; o cabeçalho do grupo de NF acompanha via conteúdo `sticky` dentro do `colSpan` (ali o fundo é uniforme, então não há transparência a resolver); `w-max min-w-full` na tabela para **crescer e rolar** em vez de espremer. **Regra que ficou registrada:** coluna congelada exige **fundo opaco** — por isso o hover da linha passou de `bg-muted/30` (translúcido) para **`bg-muted`**, aplicado igual nas fixas e nas que rolam; com translúcido o conteúdo rolaria visível por baixo. **Verificação pedida (item 4):** a régua do "lote mais antigo" **não muda** entre "Emitido" e "Todos" — **110 dias** nos dois, medido no banco reproduzindo as duas contas; se a correção da REC-1.5 não estivesse valendo, "Todos" mostraria **202** (máximo global). Também confirmado: **0 laudos** com status fora do par `Emitido`/`Concluído`. **Conferência do build:** as classes arbitrárias e responsivas saíram no CSS gerado — `grid-cols-3` em `min-width:1024px`, `grid-cols-5`/`grid-cols-6` em `min-width:1536px`, além de `116px`/`240px` e `group:hover`. Build e `tsc --noEmit` limpos; **nada deployado**. ⚠ A conferência **visual** em ~1280/~1600/~1920 é do Pedro: a tela é admin-only e exige sessão autenticada, então não foi exercitada em navegador nesta sessão. |

| 28/07/2026 | REC-1.7 | **Responsividade: causa raiz medida, corrigida dentro da página.** Fingerprint **1720**; pull up-to-date, sem commits do Lovable. **Método (a lição da REC-1.6):** em vez de deduzir do CSS, montei um repro com o **CSS compilado do build** e a árvore real do `AppLayout` (SidebarProvider → `flex min-h-screen w-full` → sidebar 16rem → `flex flex-1 flex-col` → `main overflow-auto`) e **medi no Chrome**. **Diagnóstico:** `html/body` 1530 de largura visível contra **1812** de conteúdo (a página rolava); `div.flex-1.flex-col` inflado a **1556**; e o `overflow-x-auto` da tabela com `scrollWidth == clientWidth` — **ele não rolava, era esticado até caber a tabela**. Com o container inflado, KPIs (1508) e filtros (1474) ficavam maiores que a área visível e apareciam cortados. ⇒ **hipótese (a) confirmada**. **Hipótese (b) refutada empiricamente:** com a correção aplicada, a mesma grade `2xl:grid-cols-6` acomoda os 6 cards (192px cada, último terminando em 1512 < 1536) — o `grid-cols-6` nunca foi a causa. **Variantes testadas** (todas medidas, não supostas): `overflow-x:hidden` no raiz **não resolve**; `max-width:100% + min-width:0` no raiz **não resolve**; **`width:0 + min-width:100%` no container de rolagem resolve**; `grid-template-columns: minmax(0,1fr)` no raiz também resolve. Aplicados os dois juntos (cinto e suspensório): `w-0 min-w-full overflow-x-auto` no scroller e `grid grid-cols-1 gap-6 p-6` no raiz da página. **Medição pós-correção:** página **sem rolagem horizontal**, coluna do layout em **1274** (= viewport 1530 − 256 da sidebar), tabela rolando sozinha (1225/1506), zero KPI e zero filtro cortados, pickers na mesma linha, colunas fixas em 0 e 116 com 282px de scroll — **dark e light** (fundo opaco `rgb(255,255,255)` na coluna fixa em light). Simplificações de layout: grade única de KPIs (`1/sm:2/lg:3/xl:4`) no lugar das três condicionais, e rótulo **"Tempo médio"** (completo no `title`). **Nada de negócio mudou** e o **layout compartilhado não foi tocado** — a fragilidade estrutural encontrada (`div.flex.flex-1.flex-col` do `AppLayout` sem `min-w-0`) está registrada como recomendação em **§9.6**, para decisão do Pedro. Build e `tsc --noEmit` limpos; nada deployado. |

| 28/07/2026 | REC-1.8 | **Sidebar reordenada por fluxo — mudança validada por teste automatizado.** Fingerprint **1720**; pull up-to-date, sem commits do Lovable. **Método:** a sidebar é compartilhada com 100+ usuários, então em vez de conferir no olho eu renderizei o componente em **vitest + jsdom** (infra que já existia no repo, `@testing-library` não estava instalado então usei `createRoot` + `act` direto) e capturei a ordem e os gates ANTES de tocar em qualquer linha. **Baseline: 24 entradas de topo.** **Depois: 24 entradas**, mesmo conjunto, na ordem pedida. **Prova dos gates:** mapa de **23 combinações** (cada permissão isolada, admin sem RBAC, tudo liberado) gerado no código novo e no antigo (`git stash` para voltar no tempo) ⇒ **0 divergências**. **O que mudou no mecanismo:** os grupos colapsáveis eram injetados como efeito colateral de quatro "âncoras" (`nav.commodatum`, `nav.nf_entrada`, `nav.loans`, `nav.closing`), cada uma com a lógica duplicada para o caso de o usuário não enxergar a âncora — isso amarrava a ordem dos grupos à posição do item hospedeiro (Estoques só existia colado em Bens em Comodato) e tornava a cadeia física impossível de montar. Agora há uma **lista declarativa única**: a ordem do array é a ordem renderizada e cada entrada carrega o próprio gate. `navItems` e `routePermMap` seguem intactos e são a fonte dos itens soltos. **Guard da OP-1.3:** deixou de existir como código (a âncora que o exigia sumiu) mas o comportamento continua por construção — teste confirma que não-admin só com `producao.access` vê exatamente "Produção", e admin sem RBAC vê exatamente "Recebimento" e "Despesas". **⚠ Achado que NÃO corrigi (fora do escopo):** o grupo **Ferramentas estava gateado também por `closing`**, porque era injetado dentro da âncora de Fechamento e quem não passava no gate de Fechamento saía por `return null` antes de chegar nele. É a mesma classe de defeito que a OP-1.3 resolveu para `nf_entrada` com o "guard ampliado". Como esta tarefa era exclusivamente de ordem e a sidebar é compartilhada, **preservei a amarra** (com comentário no código) em vez de "consertar" sem autorização. Medido no banco: **1 usuário** tem `ferramentas.bulk_edit.execute` e **é admin** (bypass), então **ninguém é afetado hoje**. Soltar a amarra é decisão do Pedro, em tarefa própria (**BL-2**). Build, `tsc --noEmit` e a suíte (`vitest run`) limpos. *(Selo: o teste usado como prova ficou fora do commit da REC-1.8 e foi incorporado junto do selo, no mesmo dia, como regressão permanente.)* |

| 28/07/2026 | REC-1.5 / 1.6 / 1.7 / 1.8 | **SELO — quatro tarefas VALIDADAS pelo Pedro no app publicado** (dark e light, ~1900px). **Fingerprint `compras_pedidos` = 1722** — mudou de 1720 no intervalo porque o cron de compras rodou; mesma base `hbtggrbauguukewiknew`, sem significado além de sinal de vida. Estado do espelho no selo: **751 laudos, 0 pendentes de enriquecimento**, `codigo_entidade` null em 751/751. **REC-1.5:** o dropdown governa o status sozinho (toggle removido); "Todos" com as 14 colunas e "—" no que não se aplica por linha; KPI **Valor reprovado fechando R$ 13.499,81**, confirmado também pela **soma da coluna no Excel exportado** — prova de que a tipagem numérica funciona ponta a ponta. **REC-1.6/1.7:** **sem rolagem horizontal na página, só na tabela**; nenhum KPI ou filtro cortado; **Laudo** e **Produto** fixos ao rolar; KPI "Lote mais antigo" **estável em 110 dias** entre "Emitido" e "Todos" (sem a regressão para 202). Registrado que a **REC-1.6 não resolveu o vazamento** — diagnosticou por leitura de CSS; a causa só apareceu na REC-1.7, que mediu em navegador. **REC-1.8:** nova ordem no ar, **cadeia contígua** Compras → Suprimentos → NF Entrada → Email NF-e → Recebimento → Estoques → Produção, nada sumiu, grupos abrindo e fechando. **Teste de regressão incorporado:** `src/test/sidebar-ordem.test.tsx` (7 casos) agora roda na suíte — trava a ordem das 24 entradas e o gate de cada permissão isolada, inclusive o caso do Ferramentas amarrado a `closing` (BL-2), que ficou documentado *no próprio teste* para não ser "corrigido" por engano. **Backlog atualizado:** BL-2 (Ferramentas × `closing`), **BL-3** (i18n dos grupos colapsáveis — dívida **preexistente**, não regressão da REC-1.8), **BL-4** (`min-w-0` no `AppLayout`, §9.6), **REC-1.4** (`Laudo/Load` com `codigoEmpresaFilial`, linha 494) e **REC-2.0** (valor + fornecedor via `MovEstq/Load`). Nada aplicado, nada deployado. |

| 28/07/2026 | REC-1.3 | **SELO — período e exportação XLSX VALIDADOS pelo Pedro no app publicado.** Fingerprint **1722**. **Período:** "Emissão de" e "Emissão até" **independentes**, persistindo no F5 (URL) e com os KPIs refletindo o recorte. **Excel:** datas **ordenando como data** (não texto), **zeros à esquerda preservados** em NF e nº do laudo, **autofiltro** no cabeçalho. **Reconciliação ponta a ponta — o dado mais valioso deste selo:** as somas feitas no Excel batem **exatamente** com o banco — **1.760** unidades na coluna Quantidade reprovada (`sum(quantidade_reprovada)` = 1.760,000000000) e **R$ 13.499,81** em Valor reprovado (`sum(valor_reprovado)` = 13.499,81), ambas sobre os mesmos **15 laudos**. Isso fecha a cadeia **Alvo → `rec_laudos` → tela → XLSX → Excel** sem perda de precisão e sem coerção de número para texto — inclusive validando, na prática, a correção de fronteira da REC-1.5 (`numeric` do PostgREST chega como string). ⚠ Fica registrado o que **não** foi entregue: **freeze de cabeçalho** na planilha é impossível com o SheetJS community 0.18.5 (o writer não emite `<pane>`); o **autofiltro** é o substituto funcional, e congelar de verdade exigiria dependência nova — decisão do Pedro. **Com este selo, todas as tarefas REC-1.x entregues estão CONCLUÍDAS**; restam REC-1.4 e REC-2.0 (PENDENTES) e o backlog BL-2/BL-3/BL-4. |

| 28/07/2026 | REC-1.4 | **Correção do `Laudo/Load` no `sync-laudos` (código entregue; NADA deployado).** Fingerprint **1726** (subiu de 1722 no dia — cron de compras; mesma base). **Leitura antes de editar, os quatro pontos:** (1) a URL montava 5 parâmetros, `codigoEmpresaFilial` incluso (linhas 493-496); (2) sucesso/falha era decidido em duas camadas — `callPassthrough` (fetch, 401/403 do gateway, envelope `ok:false`/417) e depois `desembrulharLaudo`; (3) `enriquecido_em` é carimbado **dentro de `mapearLoad()`**, no mesmo objeto do UPDATE — dados e carimbo eram inseparáveis; (4) falha individual **não** abortava o lote nem era silenciosa (try/catch por laudo, `total_erros` + `detalhes`). **Achado da leitura:** o risco de carimbar em falha era **mais estreito** do que "sempre" — o `desembrulharLaudo` já barrava a maioria dos envelopes, MAS aceitava campo *presente com valor null* (`!== undefined`), então um corpo de erro que ecoasse `"Numero": null` passava e gravava 12 colunas nulas **com carimbo**, tirando o laudo da fila para sempre. **Correções (A/B/C) na §2.** **Critério de detecção escolhido e por quê:** estrutural em três regras — não-objeto ⇒ falha; **chave de envelope .NET** ⇒ falha; **âncora de Laudo com valor** (`Numero`/`NumeroCtrlLote`/`ChaveMovEstq` não nulo) ⇒ sucesso. Substring **só dentro dos campos de mensagem** (`Message`/`MessageDetail`/`ExceptionMessage`), para dar motivo específico ao `"No action was found on the controller"` (= binding de parâmetro, §6.3-A) sem nunca encostar no `Texto` do laudo, que é livre e vem em pt e alemão. **Prova:** 12 corpos representativos rodados contra o código real — laudo com `Texto` contendo "Exception/Fehler/erro/StackTrace" **passa** (zero falso-positivo); `BrokenRulesException`, `No action was found`, `{Numero:null,ExceptionType:…}`, `{Numero:null}`, `{Numero:""}`, `{}`, `null`, string e array são **barrados**, cada um com motivo próprio. **Auditoria:** falhas viram UMA entrada agregada em `sync_runs.detalhes` (até 20 números + total + motivos), em vez de uma linha por falha. `bun run build`, `tsc --noEmit` e `vitest run` limpos. **Nada fora dos três itens foi tocado** — `LOAD_BATCH` segue 100, erp-proxy intocado, sem DDL. |

| 28/07/2026 | REC-2.0 (passo C) | **Valor e fornecedor via `MovEstq/Load` (código entregue; NADA deployado).** Fingerprint **1735**; DDL do REC-2.0 conferido antes de escrever — **9/9 colunas** presentes; **295 chaves distintas, todas pendentes**; **751/751 laudos com `sequencia_it_movestq` preenchida**. **Achado que corrige a §6.3-D:** o plano registrou que os laudos `2073/2074/2075` (NF 1586) tinham **todos** `SequenciaItMovEstq = 1`. **Está errado** — no espelho eles têm sequências **1, 2 e 3**, com lotes `0002639/0002640/0002641` e quantidades 18/16/14. Medido no conjunto inteiro: o par `(chave_movestq, sequencia_it_movestq)` é **único em 751/751** — a ligação item⇄laudo é **1:1** hoje. Ainda assim o código trata **N laudos por par** (agrupa e aplica a quantidade de cada um), porque a unicidade é um fato observado, não uma garantia do ERP. **Desenho:** varredura por chave distinta (não por laudo), `MOV_BATCH = 40`, dedup no cliente sobre `MOV_BATCH × 8` linhas — o PostgREST não tem `DISTINCT`. **Regras herdadas do REC-1.4:** análise estrutural do envelope, carimbo só em sucesso, falha isolada não aborta o lote. **Distinção importante:** chave que falha ⇒ nenhum laudo dela é carimbado; laudo cuja sequência não casa ⇒ falha **daquele laudo** apenas, contado em `laudos_sem_item_casado` e listado nos detalhes (o Pedro quer saber quantos casos existem). **Nada condicionado a `ControlaLote` nem filtrado por `CodigoTipoLanc`** — variam entre nacional (E0000158) e importação (E0000160), e `ControlaLote="Não"` convive com laudo existente. **Prova contra o código real:** 10/10 casos estruturais (inclusive campo livre com "Exception/Fehler" passando como válido, e lista de itens vazia barrada como falha da chave) + casamento da chave 18094 gerando 12.055,14 / 10.715,68 / 9.376,22 — com o **controle** de que usar a `Quantidade2=48` do item daria 32.147,04, o erro contra o qual o prompt alertou. Build, `tsc --noEmit` e `vitest run` limpos. |

| 28/07/2026 | REC-2.1 | **KPI de valor na Fila de Inspeção (código entregue; aguarda Publish).** Fingerprint **1748**. **Estado do passo C em produção no momento da entrega:** 391 laudos valorizados, **135 chaves ainda pendentes**, 28 fornecedores distintos. **Leitura antes de editar:** KPIs são calculados **no client** (`calcularKpis` sobre o array já filtrado, via `useMemo`) — nenhum agregado vem do servidor; o `select` do service é **explícito** e **não trazia** `valor_custo_lote` (precisou entrar na lista, na interface e na conversão `numeric`→número); dos filtros, só o **status** vai ao servidor, o resto é client-side, então o KPI novo herda todos sem query nova; o componente é o `KpiCard` local, que já tinha a prop `sub` — exatamente onde o aviso de nulos cabia, sem redesenho. **Regra do nulo (o ponto da tarefa):** nulo é "ainda não enriquecido", não zero — fica fora da soma e vira o contador "n lotes sem valor". Medido: no recorte **Emitido não há nenhum nulo** (119/119 já valorizados), então o aviso **não aparece** no padrão da tela; ele existe em Concluído e Todos (360 lotes). **Valores esperados:** Emitido R$ 963.505 · Concluído R$ 1.135.471 (360 sem valor) · Todos R$ 2.098.976 (360 sem valor). O R$ 960.062 citado no pedido subiu para R$ 963.505 porque o passo C drenou mais chaves no intervalo — o número acompanha o enriquecimento até fechar. **Decisão declarada:** rótulo do KPI acompanha o recorte (Aguardando liberação / Inspecionado / Total), pelo mesmo motivo do KPI de lotes. Build, `tsc --noEmit` e `vitest run` limpos. Nada além do KPI foi tocado — exportação, filtros, tabela e Edge Functions intactos. |
| 29/07/2026 | REC-1.4 | **Deployada e PROVADA em produção.** Deploy da `sync-laudos` (commit `1bd4a69`) pelo Pedro. Canário armado à mão antes do deploy: `enriquecido_em` zerado nos laudos `0000001556` (o que falhava no Lab com `codigoEmpresaFilial`) e `0000002070`. Após o disparo, **751/751 com `enriquecido_em`** e `total_erros = 0` ⇒ as três correções (parâmetro fora da URL, HTTP 200 com corpo de exceção tratado como falha, carimbo só em sucesso) estão exercitadas contra o Alvo real, não só em teste unitário. **Nota de método:** os 12 corpos sintéticos do `vitest` provam a detecção e o não-carimbo; o canário é o único que prova a chamada. São coisas diferentes e ambas necessárias. |
| 29/07/2026 | REC-2.0 (passo 1) | **`MovEstq/Load` na whitelist do erp-proxy.** Edição aditiva de uma linha em `ALLOWED_ENDPOINTS` (`src/routes/alvo.ts`), commit direto em `main`, Render publicou sozinho. Procedimento idêntico ao já executado em 28/07 para o `Laudo/Load`. **Canário no `DocFin/Load` antes do teste real:** respondeu `412` (chave inexistente) — resposta do Alvo, não bloqueio de gateway ⇒ a lista não quebrou para quem já estava dentro. Confirmado que `endpoint.split("?")[0]` mantém a query string fora do casamento da whitelist. |
| 29/07/2026 | REC-2.0 (DDL) | **9 colunas aditivas + índice parcial em `rec_laudos`**, aplicadas no SQL Editor: `custo_unitario`, `valor_unitario`, `valor_custo_lote`, `codigo_entidade_mov`, `nome_entidade_mov`, `controla_lote_item`, `codigo_tipo_lanc_item`, `mov_enriquecido_em`, `raw_movestq_item`; índice `idx_rec_laudos_mov_pendente` sobre `chave_movestq where mov_enriquecido_em is null`. **Duas decisões de desenho:** (a) `mov_enriquecido_em` é **separado** do `enriquecido_em` — se fossem a mesma coluna, uma falha no `MovEstq/Load` apagaria também o enriquecimento do `Laudo/Load`, que já estava pronto; os dois passos falham independentemente; (b) o índice é sobre **chave**, não sobre laudo, porque a varredura do passo C é por movimento distinto. |
| 29/07/2026 | REC-2.0 (passo C) | **Deployado, drenado e a fila fechou em valor.** 4 rodadas × 40 chaves, `falha=0` e `laudos_sem_item_casado=0` em todas. **Fila 100% valorizada: 119 laudos, R$ 960.062,44** (às 12h; R$ 963.505,23 ao fim do dia, com laudos novos entrando). **Custo medido:** 17,3 s para 40 chaves (~370 ms/chave) contra 2,5 s da execução sem passo C ⇒ as 295 chaves de uma vez dariam ~110 s, acima do `WATCHDOG_MS` (110 s) — **drenar em rodadas era mesmo o caminho certo, não uma precaução**. **Coincidência a não confundir com validação:** a estimativa de guardanapo feita antes (1.433 un × R$ 669,74 = R$ 959.737) errou por R$ 325 — mas por dois erros que se cancelaram (usar preço de mercadoria em vez de custo de estoque subestimava; aplicar o preço do pericárdio às 1.523 un incluindo nitinol e etiquetas superestimava). O número que vale é o do `CustoUnitario`, que tem procedência. |
| 29/07/2026 | REC-2.1 | **KPI de valor: código entregue e conferido contra o banco; aguarda Publish.** Soma client-side de `valor_custo_lote` sobre o array já filtrado (os KPIs da tela nunca vieram do servidor). **Duas decisões do agente que melhoraram o pedido:** (a) **rótulo acompanha o recorte** — "Valor aguardando liberação" (Emitido) / "Valor inspecionado" (Concluído) / "Valor total" (Todos); rótulo fixo mostraria R$ 2,1 mi em "Todos" sob um nome falso, já que 632 daqueles laudos já foram liberados; (b) o aviso **"n lotes sem valor"** (nulo fora da soma, contado à parte) foi pedido como salvaguarda temporária da fila, mas **não aparece no recorte padrão** — os 119 já estão valorizados — e vira indicador permanente de enriquecimento parcial em "Concluído" e "Todos" (360 lotes). Conferido: `Emitido` = **R$ 963.505,23**, `sem_valor = 0`. |
| 29/07/2026 | — | **Achado operacional (não é software).** Com a fila valorizada, o quadro fechou: **94% dela é um produto só** — pericárdio `001.007.00101`, **115 laudos / 1.433 un / 28 NFs consecutivas da Biocollagen**, emissão de **08/05 a 15/07**, **nenhuma conclusão no período**. Não é fila drenando devagar: é **parada com data**. Tudo anterior a 08/05 foi liberado. O fornecimento nunca parou (entregas a cada 4–8 dias) — compra à frente por **decisão comercial**, confirmada pelo Pedro, então **não há risco de parada de linha** e o volume não é descontrole de compra. Os 4 laudos restantes: 3 de nitinol (NF `4530`/`4622`, os mais antigos, 110 e 91 dias) e 1 de etiqueta. **Causa da parada: desconhecida.** Três perguntas abertas com a Qualidade, na ordem que rende mais: (1) NF `4530` — três lotes do mesmo grupo, um liberado em 09/04 e dois parados desde então, por quê; (2) o que mudou em **08/05**; (3) as 15 devoluções com `quantidade_devolvida = 0` em 15/15 — o material reprovado sai fisicamente do lugar e alguém registra isso? *A pergunta (3) é a metade operacional da **Q3 do §5** e fecha um dos dois bloqueadores humanos da Fase 2 da OP.* |
| 30/07/2026 | REC-3.0 | **Releitura condicional + flag de ausência — deployada e PROVADA.** Fingerprint **1752**. **Duas correções minhas que o agente fez e estão certas.** (a) Eu propus backfillar `load_status_lido = status` (o estado atual). Isso zeraria a fila **e tornaria o bug permanente exatamente nos registros que o manifestam** — o `2149` sairia da fila e as 180 unidades aprovadas ficariam 0 para sempre. O backfill correto deriva de **`raw_load`**, que é o registro do que a última leitura enxergou; copiá-lo reconstrói o estado anterior, e a fila fica com **exatamente 1 laudo**, que é o resultado desejado. (b) Eu especifiquei "um predicado SQL" comparando duas colunas — **o PostgREST não compara colunas entre si**. Sem uma 4ª coluna o predicado teria de rodar no client, lendo a tabela inteira e ficando à mercê do `db-max-rows` (1.000 por padrão), que **corta a resposta em silêncio**: com ~1.300 laudos/ano isso estoura em meses e a fila passa a ignorar os antigos sem um único erro no log. Solução: coluna **gerada e indexada** `precisa_releitura`, que mantém predicado e teto `LOAD_BATCH` dentro do Postgres. **Ordem de aplicação (crítica):** todo o SQL primeiro, deploy por último — a função nova referencia `precisa_releitura` e, sem a coluna, o passo B falha inteiro com 400 no PostgREST; o inverso é seguro. **Cron confirmado:** `45 11,14,17,20 * * 1-5` UTC = **08:45 / 11:45 / 14:45 / 17:45 BRT** (o relatório do agente dizia 07h30/12h30/16h30 — errado). |
| 30/07/2026 | — | **ACHADO DE MÉTODO: `bun run build` e `tsc --noEmit` NUNCA validaram as Edge Functions.** O `tsconfig.app.json` tem `include: ["src"]` e as functions vivem em `supabase/functions/` — estão **fora do escopo do typecheck**. Aceitamos "build limpo" como evidência em REC-1.4, REC-2.0 e REC-2.1; não era evidência de nada (as três funcionaram, mas por prova empírica, não por tipo). **Regra nova do repo:** para Edge Function, a checagem é `node node_modules/typescript/bin/tsc --noEmit --noResolve --skipLibCheck supabase/functions/<nome>/index.ts` — os erros de `Cannot find module` de URL remota são esperados e ignorados; o que importa é sintaxe e tipo local. `npx tsc` não funciona (typescript não é dependência raiz). Não existem testes automatizados para `sync-laudos`. |
| 30/07/2026 | — | **Investigação do momento da INSPEÇÃO no Alvo (não é software, é achado).** Medido em 752 laudos: existem **4 estados e só isso** — Aprovado (617), Emitido/Nenhum (120), Aprovado Parcial (14), Reprovado (1). **Nenhum** laudo destruído, enviado a laboratório externo ou com análise química, embora a entidade tenha esses campos. **1.760 unidades reprovadas no ano, `quantidade_devolvida = 0` em 15 de 15** e `data_devolvida` nula em todas. **A causa é estrutural, não de disciplina:** a tela do Laudo **não expõe** o campo de devolução (nem quantidade aprovada/reprovada); a grade de listagem mostra as duas colunas de *destruição* e nenhuma de devolução. Cinco examinadores distintos escrevem "devolvido ao fornecedor" no **Comentário** (`TextoResultado`) porque é o único lugar que existe. Quatro laudos afirmam devolução em texto — o `0000002070` diz "**serão** devolvidas" (futuro, 29/06) e ninguém voltou para confirmar. **Dois casos mal classificados:** `0000001408` é divergência de quantidade entregue ("veio menos do que a NF"), não defeito; `0000002047` são 468 un da LFU **liberadas sob condição** de produção-sob-risco previamente aprovada — se a condição não foi cumprida, há material em uso com pendência que não aparece em campo nenhum. **Taxa de reprova: 15 em 632 concluídos (2,4%)** — não é problema de qualidade de fornecimento; é uma operação que aprova quase tudo e não sabe dizer o que faz com o resto. |
| 31/07/2026 | Fase 2 · investigação (30–31/07) | **Sessão de investigação, sem código.** Sete pendências fechadas por medição: `TipoAtendimento="Automático"` nunca atende — n=71 (§6.2-3) · Empenho não é usado — `GeraEmpenho: "Não"` em 22/22 (fecha o botão Empenhos) · `est_saldos` não será construído — quatro provas, decisão na §9.9 · Lote vem da child list, nunca do `ControlaLote` — 756/756 (retifica §9.7-3) · Payload do `FiltrarSaldoProduto` é obrigatório completo; `produto: ""` quebra (fecha §9.9) · Q3 fechada pela metade — a parte do recebimento não precisa da Qualidade · Cinco RMs apagadas não movimentaram estoque. **Endpoints novos mapeados:** `reqMat/GetListForComponents`, `ReqMat/Load`, `movEstq/GetListForComponents`, `MovEstq/Load`, `MovEstq/RetornaFichaEstoque`, `Produto/Load` (parâmetro `codigo`), `produto/GetListForComponents`, `unidMedida/GetListForComponents`. Dialeto do `Filter` provado em três entidades. **Escopo da Fase 2 reformulado** pelas decisões do Pedro: tela própria de RM com seletor de OP obrigatório; OP não tem lista de insumos; consolidado soma o atendido. **Três retificações minhas:** local não é constante (existe `003 PRODUÇÃO`); `UnidadeMedidaMovimentacaoEstoque` não é gate; exports da tela não são paginados. **Achados de valorização** (não são software — são para o Pedro): a `2211` registrou R$ 3.897.408 onde o custo médio dava R$ 16.073,64; a ficha do `001.003.00056` documenta a gênese de um custo médio negativo em 02/06; `ValorSaida` desconectado de `QtdSaida × CustoMedio` em dois produtos distintos. **Achados operacionais:** a `2251` entregou 68 unidades a mais do que o pedido; `DataConferencia` == `DataEntrega` ao milissegundo em 68/71 — não há conferência, há carimbo; 13/71 sem registro de custódia; lead time bimodal (mediana 1,1 h, p90 308 h); 20% ficam `Atendida Parcial` sem fechar; a `2187` está aberta há 30 dias; classificação contábil em 4 de 22 itens da `2251`. **Cadastro de unidades:** piloto da família `001.003` (82 produtos) concluído — 23 com múltiplas unidades, 10 com divergência. Planilha de trabalho entregue. `MIL` e `MILHEI` são o mesmo nome no cadastro do ERP; `UN` e `UNID` são equivalentes. **Adiado por decisão explícita:** como os insumos saem e como a sobra volta (Q4 / Fase 4). |
| 04/08/2026 | OP-2.1 · whitelist e gate | **OP-2.1 CONCLUÍDA — gate verificado em campo, nos dois sentidos.** Commit `45db047` no `erp-proxy` (`src/routes/alvo.ts`, 1 arquivo, +4/−1): adiciona `reqMat/GetListForComponents` e `ReqMat/Load` — a **caixa divergente entre as duas é intencional**, a whitelist é case-sensitive — e remove `Produto/GetRegistros` (**BL-6**, entrada morta: nenhum uso no proxy, e a única referência no Hub, `alvoService.fetchEstoqueERP`, chama o ERP direto sem passar pelo passthrough e não é referenciada em lugar nenhum). Deploy no Render **Live 22:35**. **Verificação:** `ReqMat/Load?numero=0000002251&loadChild=All` respondeu **200** e `Produto/GetRegistros` respondeu **403 com o corpo do próprio proxy** — provadas a ponta que abriu e a que fechou, não só a que interessava. **Quarta causa de falha registrada (§6.3-N):** 404 com corpo ASP.NET é resposta do **Alvo** (action inexistente ou parâmetro obrigatório faltando), não de whitelist; apareceu em `DocFin/Load` via GET e em `ReqMat/Load` sem `numero` — diagnosticar pelo corpo, nunca só pelo status. **Prova de campo da `0000002251` (§10.4):** 22 itens; excedente **carimbado** em `QuantidadeAtendidaMaior` (47 e 121), não inferido; o "Atendida Parcial" do cabeçalho esconde as duas pontas (um item zerado contra 168 un sobrando em outros dois) ⇒ conferência é por item; saldo já vem calculado em `QuantidadeSaldoProdUnidMedPrincipal`; lote na `CtrlLoteItemReqMatChildList` (2 lotes em item rateado, zero no não atendido); `TipoAtendimento="Manual"` e `GeraEmpenho="Não"` confirmados; `NumeroOrdProduc` **null em 22/22** mesmo com a OP escrita à mão na Descrição (mantém o parse até o BL-9); campo novo `FinalizouOP`; e o volume — **103 campos no cabeçalho, 102 no item**, a maioria irrelevante — que recomenda **núcleo tipado + `raw` jsonb** na OP-2.2, no molde do `rec_laudos`. **BL-5 retificado — ver §8:** o `Produto/SavePartial` não vivia na whitelist, e o escopo real são duas rotas dedicadas de escrita. |
| 04/08/2026 | OP-2.2 · modelo de dados | **DDL entregue em `sql/OP-2.2.sql`, NÃO aplicado** (aguarda o Pedro no SQL Editor). **Quatro tabelas em duas famílias:** espelho do Alvo (`op_reqmat` cabeçalho · `op_reqmat_itens` · `op_reqmat_lotes`, sobrescritos a cada sync, núcleo tipado + `raw` jsonb no molde do `rec_laudos`) e o **livro do Hub** (`op_requisicoes`, onde vive o vínculo OP↔RM e **onde o sync nunca escreve**). **Decisão central registrada na §10.14:** o vínculo não pode ser coluna do espelho — morreria no primeiro upsert, e entre o POST e o primeiro sync não existe linha onde gravá-lo; por isso a linha do livro **nasce antes do POST** (eco bugado da resposta + RM órfã se a rede cair). **Fechadas as decisões 1 e 3 da §10.10:** o seletor filtra `status IN ('ABERTA','EM_ANDAMENTO')` (`EM_FECHAMENTO` fora — OP em fechamento não recebe material novo), e **o parse da `Descricao` foi descartado como vínculo** — a OP não existe no Alvo, então a pergunta era mal posta; a `Descricao` fica só como carregador humano de 40 caracteres. **Convenções lidas no banco antes de escrever** (MCP read-only, fingerprint `compras_pedidos` = **1796**): PK natural composta e `numeric(18,9)` do `rec_laudos`, prefixo `idx_op_*` e RLS `producao.access` em SELECT do módulo OP, reuso de `op_set_updated_at()`. **Releitura por coluna gerada** `precisa_releitura`, com três cláusulas (nunca lida · ainda pode mudar · mudou desde o último Load) e guard de `ausente_desde` — ⚠ **o literal terminal `'Atendida Total'` NÃO foi confirmado empiricamente** (só `Aberta` e `Atendida Parcial` observados); escrito como `NOT IN` de conjunto explícito, com `comment on` mandando a 1ª execução da OP-2.3 reportar os `DISTINCT status` — a falha é reler demais, que é segura. **BL-14** (contrato do insert capturado do swagger — os nomes da escrita **não são** os da leitura) e **BL-15** abertos; o BL-15 é sério: **`TipoAtendimento` não existe no contrato de integração**, e é o campo que decide se a RM atende — bloqueia a criação, não o espelho. |

| 05/08/2026 | OP-2.2 · verificação | **OP-2.2 CONCLUÍDA — DDL conferido contra o arquivo, coluna a coluna, zero divergências.** Fingerprint `compras_pedidos` = **1796**. 4 tabelas com 28/28/17/12 colunas, tipos e defaults idênticos ao `sql/OP-2.2.sql`; `precisa_releitura` STORED (`attgenerated='s'`); 20 índices; RLS nas 4 com 4 policies só de SELECT; trigger e FKs como desenhados; 0 linhas. **Detalhe que vale registrar:** o Postgres normalizou `not in ('Atendida Total')` para `<> 'Atendida Total'` na expressão da coluna gerada — é a forma canônica de um `NOT IN` de elemento único, **não** uma alteração de semântica; quem conferir de novo vai ver a mesma diferença de texto. **Bloqueio encontrado na verificação, que a OP-2.2 não cobria:** `sync_runs_job_type_check` não tinha `'reqmat'` — regra permanente da REC-1.2 (§9.4), a função morreria no passo zero. ⚠ E `'requisicoes'`, que já existe no CHECK, é de OUTRO job (Suprimentos): reaproveitá-lo misturaria dois módulos no histórico. |
| 05/08/2026 | OP-2.3 | **Edge Function `sync-reqmat` + `sql/OP-2.3.sql` entregues. NADA aplicado, NADA deployado, nada escrito no Alvo.** Commit único; detalhe de desenho em **§10.15**. **O payload da listagem foi validado em campo pelo Pedro ANTES de virar código** — era a única incógnita bloqueante da Parte 1, e o modo de falha perigoso não era 417 e sim **200 com lista vazia**, que parece "não há RMs" e é filtro errado. **Duas inferências minhas foram refutadas pela medição e ficam registradas:** (a) `Input` é **`"defaultSearch"`**, não `"gridTableReqMat"` — o padrão `gridTableLaudo`/`gridTableMovEstq` da §6.3-A **não se generaliza**; (b) a resposta é **array puro**, sem wrapper — o extrator defensivo do molde (que tenta `Registros`/`Items`/`Result`) seria caminho não observado escondendo mudança de forma, então o novo falha visível. **Achado que muda o mapper de todo sync futuro do Alvo:** 🔴 o cabeçalho traz `DataRecebimento: "0001-01-01T00:00:00-02:00"` — `DateTime.MinValue` do .NET **com offset**, então quem validasse só a forma da string aceitaria; vira data real absurda que polui filtro por período. A guarda é por prefixo e vale para todos os campos de data. **Segundo achado:** os campos `Quantidade2`/`QuantidadeAtendida2`/… são a quantidade na SEGUNDA unidade de medida, não duplicata — ficam no `raw`, fora do núcleo, porque a família `001.003` tem divergência de unidade documentada (§9.8) e eles VÃO divergir. **Duas colunas faltavam em `op_reqmat` e a OP-2.2 não foi alterada:** `codigo_tipo_req_mat` (a fila do passo B prioriza tipo, e sem coluna o teto `LOAD_BATCH` teria de ser aplicado no cliente — exatamente a armadilha de `db-max-rows` que a REC-3.0 resolveu) e `numero_ord_produc` no **cabeçalho** (a OP-2.2 o pôs no item, por leitura equivocada de 04/08; a coluna do item fica marcada como OBSOLETA por `comment on`, **não dropada** — nada destrutivo sem aprovação). **Divergência consciente do molde, com razão registrada:** aqui `precisa_releitura` **não zera** após a releitura, então a ordem do `sync-laudos` giraria as mesmas N RMs para sempre; a fila virou varredura circular (`tipo asc NULLS LAST` → `detalhes_carregados_em asc NULLS FIRST` → `data desc`), e `'0000002'` ser o menor dos quatro códigos entrega a prioridade **sem CASE**, mantendo o índice utilizável. **RPC transacional `op_reqmat_aplicar_load`** em vez de três chamadas PostgREST: a janela entre DELETE e INSERT deixaria a RM sem filhos e o consolidado leria "atendido 0" numa tela que decide requisição. Trancada por GRANT (`service_role` apenas) — o gate não pode ser `user_has_permission` porque quem chama é a Edge Function e `auth.uid()` seria null. **Validado read-only contra o banco antes de commitar:** os casts de `jsonb_populate_recordset` para `numeric(18,9)`/`timestamptz`/`date`/`jsonb` com o shape real que o TS emite, o `jsonb_exists` com chave presente-mas-null, e a ordem `asc nulls last` devolvendo 0000002 primeiro e null por último. **Type-check no arquivo** (`node node_modules/typescript/bin/tsc --noEmit --noResolve --skipLibCheck`) com **perfil idêntico ao do molde** — só o módulo remoto e `Deno`; os 5 `TS2802` de spread de `Set` que apareceram na 1ª rodada viraram `Array.from` para não deixar ruído em checagens futuras. ⚠ `bun run build` **não** foi usado como evidência: o `tsconfig.app.json` só inclui `src` e nunca validou Edge Function (regra de 30/07). **Pendente:** SQL → deploy → 1 disparo manual medido → só então descomentar o agendamento (`LOAD_BATCH`/`LOAD_CHUNK` foram escolhidos SEM medir o custo do `ReqMat/Load`). |

| 05/08/2026 | OP-2.3 · correção | **`sql/OP-2.3.sql` abortou na 1ª aplicação e deixou o banco pela metade — corrigido, com a lição registrada.** O `insert into sync_settings` omitiu `schedule_cron`, que é **NOT NULL e sem default**: `23502`. Como o arquivo **não roda numa transação única**, o aborto derrubou as seções 3 e 4 junto — só o CHECK de `sync_runs` entrou. Estado conferido no banco antes de reescrever: CHECK **com `'reqmat'`** ✓, `op_reqmat` ainda com **28** colunas, RPC inexistente, índices novos inexistentes, sem linha em `sync_settings`. **A causa raiz não foi a coluna esquecida — foi eu ter tratado `schedule_cron` como opcional por dedução ("o cron está comentado, logo não preciso agendar"), sem ler o schema.** É exatamente a regra "nunca assuma schema" aplicada a uma tabela que eu não tinha criado. **Varredura completa do arquivo contra o schema real depois disso**, procurando a mesma classe de erro: `on conflict (job_name)` ✓ (existe `sync_settings_job_name_key` UNIQUE); `service_role`/`anon`/`authenticated` existem ✓; colunas do INSERT da RPC batem e as NOT NULL sem default (`numero_reqmat`, `sequencia`, `sequencia_item`) estão todas na lista ✓; `gen_random_uuid()` é built-in de `pg_catalog` no **PG 17.6**, então `search_path=public` na RPC não quebra o default da PK de `op_reqmat_lotes` ✓; e a gravação passa apesar de RLS ligada sem policy de escrita porque as tabelas são `owner=postgres` com `relforcerowsecurity=false` e o DEFINER roda como owner ✓ (⚠ ligar FORCE RLS quebraria a função **em silêncio** — anotado no arquivo). Nenhum outro problema encontrado. Corrigido também um número errado na verificação (índices de `op_reqmat`: 9, não 8). **Idempotência reconfirmada seção a seção:** §1 `drop constraint if exists` antes do `add` (reaplicar o CHECK já aplicado **não** dá erro, e o ADD revalida as linhas `job_type='reqmat'` que passam), §2 `on conflict do nothing`, §3 `if not exists`, §4 `create or replace`. **ACHADO SOBRE O KILL-SWITCH DO HUB INTEIRO, medido:** a RPC `sync_cron_pause` grava `enabled=false` + `paused_at`/`paused_by`/`paused_reason` **juntos** e `sync_cron_resume` limpa os quatro; a tela usa `isPaused = !enabled` e os 8 crons leem só `enabled` ⇒ **`enabled` é o kill-switch canônico**. Mas a linha do `sync-compras-status-cron` está com **`enabled=true` E `paused_at` desde 26/05/2026** — par que a RPC nunca produziria, resíduo de UPDATE manual — e aquele cron **roda normalmente** (50 execuções em 7 dias, `bicephalous`). ⇒ Se a intenção em maio era pausá-lo, **ele nunca esteve pausado**. Registrado, **não corrigido** (cron compartilhado, fora do escopo). O `sync-reqmat` passou a parar por `enabled=false` **OU** `paused_at` preenchido, com o gatilho real indo para `sync_runs.observacao` — falha fechada, sem depender de qual das duas leituras é a "certa". Janela definida pelo Pedro: `15 12,15,18,21 * * 1-5` (09:15/12:15/15:15/18:15 BRT), 30 min depois do `sync-laudos`; o valor está na linha de `sync_settings` **e** no `cron.schedule` comentado, e os dois têm de andar juntos. |

| 05/08/2026 | OP-2.3 · disparo | **`sync-reqmat` devolvia 401 em todas as tentativas de disparo. Duas causas, ambas minhas, e a mais grave só apareceria no primeiro disparo automático.** Sintoma: `{"error":"Não autorizado"}` no PowerShell com anon key, no painel Invoke com role postgres, e `UNAUTHORIZED_ASYMMETRIC_JWT` pelo browser. **Causa 1 — erro de agrupamento no `sql/OP-2.3.sql`:** deixei `call_sync_reqmat_cron` DENTRO do bloco comentado do agendamento. Mas aquela função **é** o caminho de disparo manual — é ela que lê o secret do Vault e monta o header `x-cron-secret`. Comentá-la junto com o `cron.schedule` deixou a Edge Function sem NENHUM caminho de disparo: o gate é `CRON_SECRET` e nenhuma credencial de usuário serve (anon, service_role, sessão, painel — nenhum manda esse header). Movida para a seção 5, aplicada; só o `cron.schedule` segue comentado. **Causa 2, a séria — `supabase/config.toml` não tinha `[functions.sync-reqmat] verify_jwt = false`.** Todos os crons têm, e o próprio arquivo já explicava por quê num comentário do `notify-pedido-criador`. Sem essa entrada o deploy deixa `verify_jwt=true` e o gateway do Supabase barra o `pg_net` — que não manda JWT — **antes** da função: o `CRON_SECRET` nem seria avaliado e o cron **nunca rodaria**, sem erro visível até alguém notar a fila parada. Corrigido; ⚠ `verify_jwt` é lido **no deploy** ⇒ redeploy obrigatório. **Como o `sync-laudos` roda hoje, já que não tem botão na tela** (fato levantado pelo Pedro e confirmado no banco): `_sync_cron_resolve` só conhece `'compras'`/`'nfe'`/`'intercompany'`, e Despesas/DocFin têm RPC dedicada — laudos, produtos, lote e reqmat **não têm tela**. O caminho é o SQL Editor: `select public.call_sync_laudos_cron('manual_admin');`. Prova de que funciona: `net._http_response` id 19988, `200`, 05/08 14:45, `"triggered_by":"pg_cron"` com o fingerprint 1796. **Convenção escrita pela primeira vez em §10.15 → "Como um cron é disparado neste projeto"**, incluindo a taxonomia do 401 pelo idioma da resposta (inglês = gateway do Supabase; português = gate `CRON_SECRET` da função) — que é o atalho de diagnóstico que faltou aqui. **Achado lateral:** `call_sync_laudos_cron` está com execute para `anon` e `authenticated` (**BL-17**); a `call_sync_reqmat_cron` já nasce com `revoke`. **Sequência combinada com o Pedro:** config.toml → SQL → redeploy (dele) → `select public.call_sync_reqmat_cron('manual_admin')` (dele). Invertê-la reproduz o 401 e manda procurar o erro no lugar errado. |

| 05/08/2026 | Fase 2 · fechamento do dia | **A Fase 2 saiu do papel: espelho no ar e ciclo de escrita provado ponta a ponta.** **OP-2.2 aplicada** (4 tabelas, conferidas coluna a coluna contra o arquivo, zero divergências) e **OP-2.3 CONCLUÍDA** — `sync-reqmat` deployada e rodando: **679 RMs espelhadas, `total_erros = 0`, ~370 ms por `ReqMat/Load`**, fila em **platô** exatamente como o desenho previa (`precisa_releitura` não zera para RM não-terminal). O caminho até lá teve **dois tropeços meus, ambos de suposição**: `sql/OP-2.3.sql` abortou com `23502` (`schedule_cron` é NOT NULL e eu o tratei como opcional porque o cron estava comentado — e, como o arquivo não roda em transação única, o aborto derrubou as seções 3 e 4 junto); e depois **nenhum disparo funcionava**, por duas causas somadas: `call_sync_reqmat_cron` comentada junto com o agendamento (mas ela **é** o caminho de disparo manual — é quem lê o secret do Vault e monta o `x-cron-secret`) e a falta de `[functions.sync-reqmat] verify_jwt = false` no `config.toml`, sem o que o gateway barra o `pg_net` **antes** da função e o cron nunca rodaria, em silêncio. Disso saiu a convenção que **não estava escrita em lugar nenhum** (§10.15, "Como um cron é disparado neste projeto"), incluindo o atalho de diagnóstico pelo idioma do 401 — inglês = gateway do Supabase, português = gate `CRON_SECRET`. **🔴 BL-15 FECHADO, e com retificação de rota:** a Fase 2 **não** usa o `InserirAlterarRequisicaoMaterial` do swagger (4 tentativas, todas `NullReferenceException` em `ReqMatRules.cs:277`); usa **`ReqMat/SaveReqMat`** com envelope `{Action, ClassObject}` e os nomes da **leitura** — o que desfaz a tradução de duas vias que o BL-14 previa. A RM criada por API **nasce `Automático` e Automático nunca atende** (13 de 13 abertas contra 266 Manual, 0 aberta), então o **`Update` com `TipoAtendimento: "Manual"` é passo obrigatório**, não polimento; e o `op_requisicoes` da OP-2.2 já cobria os três passos sem tocar no schema. **Fluxo de atendimento mapeado** (`ValidarAtendimento` → `FinalizarAtendimento`, objeto inteiro sem envelope): a quantidade é **digitada** — origem do `QuantidadeAtendidaMaior` —, o `E0000023` é aplicado pelo servidor, e 🔴 **`CodigoFuncionarioAtendente` não é quem atendeu** (na `2271`, atendida pelo Pedro, veio "Maria Alves", padrão do local; quem executou está em `CodigoUsuario`) — qualquer relatório de "quem atendeu" por esse campo mede a coisa errada. **Ciclo completo validado na RM `0000002271`** (§10.18): criar → corrigir → atender → **estoque 31 → 30** → espelhar → sair da fila, o que de quebra prova a expressão STORED da OP-2.2 com um caso terminal real (`'Atendida Total'` deixou de ser hipótese). ⚠ Aquela RM **baixou estoque de verdade** e segue em produção. **Vazamento medido: 96,4%** — só 10 das 279 RMs de produção do ano citam OP na `Descricao`, em 5 formatos, e as 9 OPs citadas são de papel (numeradas abaixo de 500, não existem em `op_ordens`) ⇒ **não há consolidação retroativa; o módulo começa nas OPs do Hub**. **Regra nova do repo:** `NullReferenceException` do Alvo significa **payload incompleto** — o ERP não diz qual campo falta, estoura; capturar do Network, nunca completar por tentativa (§6.3-N). **Abertos: BL-18** (11 mil un em RM aberta, 67 produtos com RMs simultâneas — a §6.1-10 em escala, com risco de baixa em dobro), **BL-19** (`TipoAtendimento` não existe na tela: ninguém escolheu "Automático", o valor vem por baixo — investigar pelo botão `Log`) e **BL-20** (rastreabilidade de lote parcial: 110 de 175 produtos, três causas distintas, só uma é lacuna regulatória). |

| 05/08/2026 | Fase 2 · testes de escrita no Alvo (RMs 2271–2275) | **O ciclo COMPLETO foi provado POR API — criar → corrigir → atender → ratear lote —, e isso muda o escopo do que a Fase 2 *pode* fazer.** Cinco RMs de teste (`0000002271`–`0000002275`). 🔴 **O atendimento por API funciona** (§10.19): `ValidarAtendimento` → `FinalizarAtendimento`, objeto inteiro sem envelope, o segundo recebendo **exatamente** o que o primeiro devolveu — provado na `2273` **sem tocar a tela do Alvo** (estoque 6 → 4 galões). A §6.1-1 decidiu que o atendimento fica com o almoxarifado; isso **continua sendo a decisão de processo**, mas agora é **escolha, não limitação**. **Genealogia de lote mapeada** (§10.20): uma linha por lote na `CtrlLoteItemReqMatChildList`, com **regra de fechamento** — a soma de `QuantidadeProdUnidMedPrincipal` tem de bater EXATAMENTE com o atendido, e o Alvo não deixa salvar com diferença. ⚠ **`QuantidadeBruta` NÃO é a quantidade do lote e seu significado não está fechado** (5 na `2275` com 1 galão; 4 nas duas linhas da `2272` com 4 galões — a hipótese de "unidade secundária" explica uma e não a outra) ⇒ quem somar `QuantidadeBruta` conta errado. E **FEFO é MANUAL**: a tela lista os lotes sem sugerir nada, o rateio 1+3 da `2272` foi escolha da pessoa ⇒ **oportunidade para o Hub pré-preencher por validade**. Rateio entre lotes montado à mão e aceito por API (`2273`). **Requisitos da tela derivados dos testes em §10.21**, com a regra que o dia inteiro ensinou: 🔴 **validar no Hub ANTES de enviar** — o Alvo responde `NullReferenceException` sem dizer qual campo falta, e foi assim que 4 tentativas se perderam. **BL-9 FECHADO:** `NumeroOrdProduc` **não é gravável** — `Update` com "2026-0500" devolveu `Friendly_Message_FK_Reference`; é **FK para a `OrdProduc` nativa do Alvo**, vazia em 679/679 e com módulo não usado. Usá-la exigiria criar a OP dentro do ERP (escrita dupla, duas numerações, risco de acordar MRP/empenho) ⇒ **o vínculo OP↔RM fica no Hub definitivamente — impedimento estrutural, não preferência.** **Três retificações na §6.3-N:** 🔴 **`CodigoCentroCtrl` é escolha do usuário**, não derivado do funcionário (a `2271` nasceu com o centro do Pedro, CONTROLADORIA/FINANCEIRO) — afeta a §10.9 e o `comment on` da OP-2.2; 🔴 **`CodigoFuncionarioAtendente` não é quem atendeu** ("Maria Alves" em todos os atendimentos do Pedro; a rastreabilidade real está nos campos de Entrega, que gravam — provado na `2273` por API e na `2274` pela tela); e **`TipoAtendimento` volta para "Manual" após atendimento manual** (`2273` e `2275` nasceram Automático, não passaram por Update e terminaram Manual) ⇒ refina o BL-19: `Automático` **nunca atende SOZINHO**, e o campo **não é imutável**. **`Texto` confirmado como carregador da OP:** aceita 398 caracteres sem truncar e é **exibido na tela de atendimento** — sem o limite de 40 da `Descricao`. **Abertos: BL-21** (capturar o endpoint de lotes disponíveis — última peça do atendimento, o `FiltrarSaldoProduto` não dá saldo por lote) e **BL-22** (limpar as 5 RMs; quatro baixaram estoque, e o glutaraldeído foi de 11 para 1 galão — avisar quem repõe; deletar exige estorno, cujo payload vale capturar porque a Fase 3 vai precisar dele). |

| 06/08/2026 | OP-2.4 · leitura (Partes 1 e 2) | **Tela `Produção > RM` de LEITURA entregue; nada publicado, nada aplicado no banco, nada escrito no Alvo.** Fingerprint `compras_pedidos` = **1802**; espelho em **680 RMs** (280 de produção, **280/280 detalhadas**), `op_ordens` = 2, `op_requisicoes` = **0**, último sync **05/08 16:16 BRT** (o cron segue sem agendamento — §10.15). **Cinco medições feitas ANTES de codificar, e três delas mudaram o desenho:** (1) 🔴 **`codigo_funcionario` NÃO é quem digita** — MARIA.EDUARDA abriu RMs com **cinco** funcionários distintos (`0000098` 214×, `0000125` 17×, `0000061` 8×, `0000023` 5×, `0000028` 2×) e Ryan usou `0000098` em 9 das 16 dele ⇒ o campo é *para quem* a RM é, e o de-para do perfil serve de **default editável**, não de valor derivado (retifica a leitura da §10.21 e reforça a §6.3-N); (2) 🔴 **5 dos 7 centros usados pelas RMs de produção estão `is_active=false` em `cost_centers`** — incluindo `00001.00005.00002` PRODUCAO VALVULAS, que responde por **162 das 280** RMs (a operação migrou para `00009.00001.00001` PRODUCAO em maio) ⇒ um dropdown que copie o filtro do wizard de compra (`is_active=true`) não mostra os centros históricos; (3) **76 itens usam unidade de posição ≠ 1** (`MILHEI` onde o catálogo diz PACOTE, `LITRO` onde diz GALAO, `BOBINA` onde diz M) ⇒ copiar `stock_products.unidade_medida` + posição 1 requisitaria na unidade errada, e o erro é silencioso — a divergência da §9.8 agora quantificada em ~4% dos itens; (4) **395 itens (120 RMs) com `quantidade_saldo > 0`**, e a correlação com `status <> 'Atendida Total'` é perfeita **hoje** (0 divergências nos dois sentidos) — mesmo assim o filtro "com saldo em aberto" **mede nos itens**, não infere do cabeçalho, porque inferir é o erro que a §10.4 documenta; (5) **597 itens atendidos SEM lote** (produto sem controle de lote) contra **908 com lote**, dos quais só **4 divergem** da regra de fechamento — e os 4 são exatamente as "4 RMs abertas com lote" que a §10.20 registrou como anedota: `Aberta`, atendida 0, lote apontado com a quantidade cheia. A tela mostra o aviso só nesses 4 (itens sem lote não entram na tabela de lotes, então não há alarme falso). **Três regras de campo entraram como comentário no código, não como convenção oral:** `quantidade_saldo` espelhado e nunca recalculado; `quantidade_atendida_maior` é excedente **carimbado** (badge âmbar com tooltip nos 88 itens de hoje); e na tabela de lotes soma-se `quantidade`, **nunca `quantidade_bruta`**. **Decisão de RLS registrada:** `sql/OP-2.4.sql` **amplia** (`producao.access OR producao.rm.access`) em vez de trocar — trocar quebraria em silêncio quem tem só `producao.access`, e o `almoxarife` proposto na §10.23 (sem `producao.access`) veria **tela vazia sem erro**, que é o modo de falha mais caro. Hoje é no-op: as duas permissões estão nos mesmos três papéis. **Estado vazio tratado como retrato, não como defeito:** a coluna OP mostra "—" em 100% das linhas porque `op_requisicoes` tem 0 linhas — é o vazamento de 96,4% da §10.7, e a tela diz isso com todas as letras em vez de parecer que está carregando. **`sidebar-ordem.test.tsx` não precisou mudar** (sela 24 entradas de **topo**; RM é sub-item) e passou 7/7 — mas por isso mesmo **o gate do sub-item não tem regressão automatizada**. ⚠ **Achado que a Parte 3 tem de resolver antes de escrever:** o payload de Insert da §10.16 manda `Origem: "ManualAlvo"` literal; se o Hub copiar o gabarito, **toda RM criada pelo Hub nasce indistinguível da tela e a métrica de vazamento morre no dia 1** — hoje o espelho tem 680/680 `ManualAlvo` e nenhuma evidência do que o `SaveReqMat` aceita em contrário (as 5 RMs de teste foram excluídas). |
| 05/08/2026 | Fase 2 · escopo da tela e RBAC | **Escopo da tela de RM fechado, e um bloqueio de piloto que não era técnico.** **Tela `Produção > RM` (entrada nova no menu), 1ª versão = LEITURA + CRIAÇÃO**, com `CodigoTipoReqMat = "0000002"` **fixo**; atendimento fora (depende do BL-21 e contraria a §6.1-1). Os quatro tipos foram inspecionados um a um (§10.22): `0000002` produção (279) · `0000004` consumo (357) · `0000005` (35) · null (8). ⚠ **`0000005` NÃO é Devolução** — a §6.1-3 procurava esse código desde julho e **não é este**: são baixas administrativas, 26 delas "AJUSTE DE INVENTARIO RETROATIVO" de 28/02/2026, nenhuma de qualidade. ⇒ **A hipótese de que a reprova teria lastro nativo no Alvo não se confirma**, e a pergunta "em que tipo a Qualidade lança?" fica aberta; se não usa RM, a Fase 3 registra no Hub, como a §1-2 já previa. As 8 sem tipo também foram olhadas: nenhuma é de produção ⇒ o filtro não perde nada. **A tela é para UMA pessoa:** MARIA.EDUARDA abriu **246 das 279** RMs de produção do ano (88%) ⇒ validar o desenho com ela antes de construir, e registrar o **risco de ponto único de falha**. 🔴 **Dois achados de RBAC que bloqueiam o piloto** (§10.23): **ninguém tem `gestor_producao` nem `operador_producao`** (zero atribuições em 52 usuários) e **`producao.access` é órfã do papel `admin`** — que concede 42 de 55 permissões, faltando 13, todas criadas depois dele. ⇒ **Só quem tem `is_admin` enxerga o módulo Produção — hoje, uma pessoa** — e isso **provavelmente explica os 2 registros em `op_ordens`**: a Fase 1 está entregue, validada e publicada desde 23/07, e **invisível para o chão de fábrica**. Não é falta de adesão, é falta de atribuição de papel ⇒ **atribuir os papéis vem ANTES de construir tela nova**. Mesmo padrão em `analista_fiscal` (existe, zero usuários). ⚠ E como o Pedro é o único `is_admin`, **erro de permissão não aparece para ele** — toda tela nova precisa ser testada com usuário sem a flag, como a OP-1.6 fez com `nfe@pfbrazil.com`. Permissões `producao.rm.*` propostas com o mapeamento por papel, e a regra para não repetir o defeito: **mapear toda permissão nova ao `admin` no mesmo bloco**. **BL-23 aberto** (custo negativo em 41 produtos, reportado pela operação em 18 RMs entre 22/05 e 14/07 porque não havia outro canal — frente própria de Controller, mas pode explicar parte do BL-18). **BL-22 fechado** com uma ressalva que importa: as 5 RMs de teste foram estornadas e excluídas, **mas faltou 1 galão** (`001.003.00032`, 11 → 10) ⇒ **o estorno pode não devolver tudo**, e a Fase 3 depende dessa operação. |

---

## 8. Backlog / ajustes futuros (não bloqueiam a Fase 1)

| ID | Origem | Descrição |
|---|---|---|
| REC-2.0 | REC-1.5 · 28/07/2026 | **Enriquecer o espelho com o MovEstq de origem: VALOR e FORNECEDOR.** Hoje `rec_laudos` só tem `valor_reprovado` — **não existe** o valor do material parado; e `codigo_entidade` é **null em 751/751**, então a fila não sabe de quem veio o material. Ambos vivem no `MovEstq` apontado por `chave_movestq`. **Dimensionamento medido:** 751 laudos ⇒ **295 chaves distintas** (2,5 laudos por movimento). **Bloqueio:** `MovEstq/Load` fora da whitelist do passthrough — **repo separado** (`financeiropfbrazil/erp-proxy`), deploy no Render, gargalo compartilhado ⇒ inclusão aditiva com rollback confirmado. Esboço completo em **§9.5**. |
| ~~REC-1.4~~ *(corrigida — código entregue, aguarda deploy; ver §2)* | Pedro · 28/07/2026 | **`Laudo/Load` não aceita `codigoEmpresaFilial` — e o sync ainda envia.** Provado por stack trace do `LaudoController`. Ocorrência em `supabase/functions/sync-laudos/index.ts`, **linha 494** (`Laudo/Load?codigoEmpresaFilial=…&numero=…`). Falha **intermitente**. **Não urge:** backfill completo — 9 execuções do job, **751/751 enriquecidos e `total_erros` = 0** em todas (medido em 28/07/2026); com 0 pendentes, o passo de enriquecimento sequer chama o endpoint hoje. Volta a importar quando entrarem laudos novos. Correção = tirar o parâmetro da URL + `supabase functions deploy sync-laudos --no-verify-jwt --project-ref hbtggrbauguukewiknew`. ⚠ Ao mexer, reler §6.3-A: `"No action was found on the controller"` significa **parâmetro que não casa**, não action inexistente. |
| BL-4 | REC-1.7 · 28/07/2026 | **`min-w-0` no `AppLayout`.** O `div.flex.flex-1.flex-col` é flex item com `min-width:auto`: qualquer descendente largo (tabela, `<pre>`, imagem sem `max-w-full`) infla a coluna além da viewport e a rolagem vira **da página**, arrastando cabeçalho e filtros para fora da tela. Medido na REC-1.7: coluna a **1556** com viewport de 1530. **Uma classe** conserta o Hub inteiro. Não aplicado porque é layout compartilhado: telas que hoje "funcionam" por acidente passariam a rolar dentro de um container. Exige regressão nas telas de tabela larga (`ContasPagar`, `ComprasPedidosCompra`, `IntercompanyMaster`, `SuprimentosPedidos`) antes e depois. Análise em **§9.6**. Enquanto não for feito, o padrão a copiar em tela nova com tabela larga é o da Fila de Inspeção: raiz `grid grid-cols-1` + scroller `w-0 min-w-full overflow-x-auto`. |
| BL-3 | REC-1.8 · 28/07/2026 | **Grupos colapsáveis da sidebar não traduzem.** Usam `label` fixo em português (ex.: `{ label: "Pedidos de Compra" }`) em vez de `titleKey` + `t()`, então **ficam em pt quando o idioma é EN**. Atinge **Compras, Suprimentos, Recebimento, Estoques, Produção, Contas a Pagar, Despesas e Intercompany** (rótulo do grupo e/ou dos sub-itens). **Dívida preexistente — não é regressão da REC-1.8**, que só mudou a ordem. Correção = mover os rótulos para o dicionário i18n e trocar `label` por `titleKey` nos `*SubItems` e nos `render*Group`. Cuidado: o teste `src/test/sidebar-ordem.test.tsx` compara rótulos e vai precisar de atualização junto. |
| BL-2 | REC-1.8 · 28/07/2026 | **Grupo "Ferramentas" da sidebar depende da permissão `closing`.** Herança da estrutura de âncoras: Ferramentas era injetado dentro de `nav.closing`, e quem não passava no gate de Fechamento nunca chegava nele. Mesma classe de defeito que a OP-1.3 corrigiu para `nf_entrada` (guard ampliado). Preservado de propósito na REC-1.8 (tarefa só de ordem) e comentado no código. **Hoje não afeta ninguém** (o único usuário com `ferramentas.bulk_edit.execute` é admin, que tem bypass). Correção = trocar o gate para só `hasAccess("ferramentas_bulk_edit_produtos_campos")`, uma linha, mas é **mudança de visibilidade em menu compartilhado** ⇒ entra como tarefa própria se o Pedro quiser. |
| BL-1 | OP-1.6 · 23/07/2026 | **Carimbos aceitos em RASCUNHO.** `op_registrar_aprovacao` e `op_registrar_comunicacao` gateiam só por `status <> 'CANCELADA'`, então aprovam/comunicam uma OP ainda em RASCUNHO (provado ao vivo na 0504: carimbos 16:17, abertura 16:18) — semanticamente estranho. Avaliar restringir a `status IN ('ABERTA','EM_ANDAMENTO','EM_FECHAMENTO')` na RPC **e** esconder os botões no detalhe quando RASCUNHO. Ajuste futuro (entra como tarefa nova, ex. OP-2.x); **não trava a Fase 1**. |
| 23/07/2026 | OP-1.5 | **Detalhe da OP + transições (código pronto no preview; build limpo).** Params das RPCs reconfirmados ao vivo (fingerprint 1686): `op_atualizar_rascunho(p_op_id,p_dados,p_itens)`, `op_registrar_aprovacao(p_op_id,p_depto)`, `op_registrar_comunicacao(p_op_id,p_comunicado_a,p_depto)`, `op_transicao_status(p_op_id,p_para,p_motivo)`. Nova página `src/pages/ProducaoOrdemDetalhe.tsx` (rota `/producao/ordens/:id`; clique na linha da lista agora **navega** — substituiu o toast placeholder): cabeçalho com número em destaque (mono/tabular) + badges de status e tipo_ordem; bloco de campos via `DataSection`/`Field` (todos os campos do FRM, incluindo blocos condicionais de aprovação/comunicação/cancelamento/fechamento e motivo); tabela de itens planejados; **timeline do histórico** (`op_status_historico`, de→para + motivo + usuário + data, rótulos via `getStatusOP`). Ações condicionais por status/permissão: **Editar** (só RASCUNHO, gate create — reabre o `NovaOPModal` em **modo edição** via novo prop `edicao`, salvando por `op_atualizar_rascunho`; "Salvar e abrir" faz update+`op_transicao_status` ABERTA), **Abrir** (RASCUNHO, create), **Cancelar** (RASCUNHO/ABERTA/EM_ANDAMENTO, gate manage, **motivo obrigatório** via dialog → `op_transicao_status` CANCELADA), **Registrar aprovação** e **Registrar comunicação** (botões-carimbo, gate manage, dialogs → `op_registrar_aprovacao`/`op_registrar_comunicacao`; disponíveis enquanto status≠CANCELADA). Toda mutação invalida `op_detalhe`/`op_lista`/`op_counts`. Serviços novos em `opService.ts`: `obterOrdem`/`atualizarRascunho`/`transicionar`/`registrarAprovacao`/`registrarComunicacao`. `NovaOPModal` ganhou modo edição (prop `edicao`, `ymdToDate`, título/toast condicionais). **Aguarda Publish do Pedro** — na validação, cancelar 2026-0501/0502 com motivo "OP de teste da Fase 1". |
| 23/07/2026 | OP-1.4 | **Modal de abertura de OP (código pronto no preview; build limpo).** Verificado ao vivo (fingerprint 1686): `stock_products` tem `codigo_produto`/`codigo_alternativo`/`nome_produto`/`unidade_medida`/`ativo`; RPCs `op_criar_ordem(p_dados jsonb, p_itens jsonb)→uuid` e `op_transicao_status(p_op_id uuid, p_para text, p_motivo text)→void`. Novo `src/components/producao/NovaOPModal.tsx` (Dialog XL `max-w-4xl`, cabeçalho em cima + grade de itens embaixo, ordem do FRM-07-11): tipo de OP (select `op_tipos`), tipo_ordem/tipo_produto/destino (radios horizontais, rótulos do form), `produto_familia` default "Tricvalve", lote/`data_fim_planejada`/`numero_referencia`/observações opcionais, `data_inicio` default hoje, `emitido_depto` pré-preenchido com o último valor do usuário (`ultimoDeptoDoUsuario`). Defaults: `tipo_ordem=FABRICACAO`; **destino e tipo_produto sem default** (decisão consciente). Número prometido, não reservado (RPC gera no salvar; texto "Nº automático 2026-05xx"). Picker de SKU **dedicado** (não mexi no `ProductCombobox` compartilhado): busca server-side debounce 300ms + race-guard em `stock_products` por `codigo_alternativo`+`nome_produto`+`codigo_produto` (**`codigo_barras` fora**), só `ativo=true`, exibe "alternativo · hierárquico · nome · unidade"; selecionar→snapshot na linha + foco na quantidade, Enter→volta à busca; **SKU repetido bloqueado** com aviso; mín. 1 item, qtd>0. Ações "Salvar rascunho" e "Salvar e abrir" (2ª faz `op_criar_ordem`+`op_transicao_status` RASCUNHO→ABERTA), validação idêntica. Dirty-check via AlertDialog "Descartar alterações?". Botão "Nova OP" só com `producao.ordens.create`. Após salvar: toast "OP 2026-05xx criada" + invalidação de `op_lista`/`op_counts` (lista e chips atualizam). Serviços novos em `opService.ts`: `buscarProdutos`/`ultimoDeptoDoUsuario`/`criarOrdem`/`abrirOrdem`. **Aguarda Publish do Pedro.** |
| 23/07/2026 | OP-1.3 | **Frontend: nav Produção + lista de OPs (código pronto no preview; build limpo).** Novos: `src/lib/statusOP.ts` (6 estados no padrão sóbrio, molde de `statusPedido.ts`), `src/services/opService.ts` (`listarOrdens`/`contarPorStatus`/`listarTipos`; leitura direta gateada pela RLS; resolve tipo, agregado de itens e nome do emissor via `profiles` em lote por `.in()`), `src/pages/ProducaoOrdens.tsx` (lista no molde `SuprimentosPedidos`: Nº tabular-nums, tipo, tipo_ordem, resumo "N SKUs · Q un", badge de status, data_inicio, emitido por; filtros server-side status/tipo/período/busca com persistência na URL, ordenação padrão `created_at desc`, chips de contagem por status clicáveis, empty state com "Nova OP"). Editados: `App.tsx` (rota `/producao/ordens` gateada por `PermissionRoute permKey="producao.access"`), `AppSidebar.tsx` (grupo colapsável "Produção" ícone `Factory`, injetado nos dois caminhos do bloco `nf_entrada` + guard ampliado para quem só tem `producao.access`), `constants/permissions.ts` (3 permissões `PRODUCAO_*` + papéis `OPERADOR_PRODUCAO`/`GESTOR_PRODUCAO`). "Nova OP"→toast (modal = OP-1.4); clique na linha→toast (detalhe = OP-1.5). **Aguarda Publish manual do Pedro.** Para ver a tela, um usuário precisa do papel `operador_producao`/`gestor_producao` (ou admin) — senão o menu/rota não aparecem (RBAC) e a RLS retorna vazio. | (sem executar nada; tarefa OP-1.2 é a mesma). Gate do `op_transicao_status` confirmado (abrir/iniciar=create; cancelar/avançar/fechar/reabrir=manage). **Achado empírico:** `fechada_por`/`fechada_em` **não existiam** em `op_ordens` (verificado: 28 colunas, sem elas — a OP-1.1 não as criou; não estavam "órfãs") ⇒ v2 adiciona no topo `alter table op_ordens add column if not exists fechada_por uuid / fechada_em timestamptz` (aditivo, nullable, 0 registros; rollback = drop column) e o ramo `p_para='FECHADA'` passa a carimbar `fechada_por=auth.uid()`/`fechada_em=now()` (antes caía no else genérico). **Duas RPCs novas** (gate `producao.ordens.manage`, SECURITY DEFINER + `search_path=public`, mesmo revoke public/grant authenticated): `op_registrar_aprovacao(p_op_id,p_depto)` → `aprovado_por/aprovado_em/aprovado_depto`; `op_registrar_comunicacao(p_op_id,p_comunicado_a,p_depto)` → `comunicado_a/comunicado_depto/comunicado_em`; ambas exigem OP existente e `status<>'CANCELADA'`. **Perf/segurança:** 4 policies de SELECT com gate em subselect `((select user_has_permission(auth.uid(),'producao.access')))` (InitPlan 1x/consulta, não 1x/linha); **`op_numeracao` perde a policy (deny-all; RLS segue habilitada)** — nenhuma tela lê o contador, RPCs acessam por dentro do definer ⇒ contagem de policies `op_*` = **4**. Verificação do arquivo ampliada: `has_function_privilege` (proxnum=false p/ authenticated+anon; 5 RPCs=true p/ authenticated), policies=4, e `pg_get_functiondef(_user_has_perm)`. **Evidência do gate interno:** `_user_has_perm(text)` é `STABLE SECURITY DEFINER search_path=public,auth`, usa **`auth.uid()`** (`hub_user_roles→hub_role_permissions→hub_permissions`, `revogado_em IS NULL`, bypass `_is_admin()`). Normalização `nullif(depto,'')` nas RPCs de aprovação/comunicação (padrão do arquivo). |
| BL-5 | Sessão 30–31/07/2026 | **Gate de papel no `Produto/SavePartial`.** 🔴 O passthrough valida só o JWT. Enquanto a linha existir na whitelist, qualquer um dos 100+ usuários grava no cadastro de produtos do ERP. **Não amarrar ao fim da carga de unidades.** Gate aditivo no proxy, ou correção pela tela do Alvo e remoção do endpoint. ⚠ **Retificado em 04/08/2026.** O texto acima assume que `Produto/SavePartial` vive na whitelist do passthrough. **Não vive** — e não é um endpoint, são rotas dedicadas: `POST /produto/save-partial` (usada por `produtoBulkService.ts:155`, consumida pelo bulk edit em `Etapa5Execucao.tsx`) e `POST /entidade/save-partial` (usada por `EntidadesUploadCodigos.tsx:127`). Família `/produto/*` tem três rotas (`list-by-alternativos`, `load`, `save-partial`). ⇒ **A correção NÃO é remover** — quebraria o bulk edit em produção. É **gate de papel na rota**, no servidor: se a tela é gateada no frontend e a rota valida só JWT, o gate é decorativo — qualquer usuário autenticado chama direto pelo console. Escopo real do BL-5 = 2 rotas de escrita, não 1 entrada de lista. |
| BL-6 | Sessão 30–31/07/2026 | **Remover `Produto/GetRegistros` da whitelist.** Entrada morta — não existe no Alvo. Risco zero. |
| BL-7 | Sessão 30–31/07/2026 | **Confirmar `GeraEmpenho` em 2ª requisição.** n=1 hoje. Campo é por item. |
| BL-8 | Sessão 30–31/07/2026 | **Testar devolução contra a requisição original.** Existem `QuantidadeDevolvida` no item **e** no lote, e `CodigoFuncionarioDevolveu` no cabeçalho. Se procede, o bloqueio da Fase 4 (§6.2-9) **deixa de existir**. |
| ~~BL-9~~ | Sessão 30–31/07/2026 | ~~**`NumeroOrdProduc` é gravável na tela?**~~ Null em 71/71 — inclusive na `2251`, que tem a OP escrita à mão. Se for gravável, o vínculo vira estruturado e a §10.4 muda. ✅ **FECHADO em 05/08/2026.** `NumeroOrdProduc` **não é gravável** com número de OP do Hub: um `Update` do `SaveReqMat` com `"2026-0500"` devolveu `BrokenRulesException: Friendly_Message_FK_Reference`. É **chave estrangeira** para a `OrdProduc` **NATIVA do Alvo** — que está vazia (null em **679/679**) e cujo módulo não é usado. Usá-lo exigiria **criar a OP DENTRO do Alvo**: escrita dupla, duas numerações e risco de acionar módulo dormente (MRP, empenho, apropriação). ⇒ **O vínculo OP↔RM fica no Hub, definitivamente** (§10.14). **Não é preferência: é impedimento estrutural.** |
| BL-10 | Sessão 30–31/07/2026 | **Capturar Estoque Transitório da CSALDOPROD.** Candidato a onde vivem as 1.433 un de pericárdio retidas. Toca a §6.3-O-6. |
| BL-11 | Sessão 30–31/07/2026 | **Varredura de valorização nos 827 produtos.** Sinais: `CustoMedio` negativo; `ValorSaldo` ≠ `QtdSaldo × CustoMedio`; `ValorSaida` ≠ `QtdSaida × CustoMedio`. **Mirar agosto** por decisão do Pedro. |
| BL-12 | Sessão 30–31/07/2026 | **Varredura de unidades nas demais famílias.** `001.010` (185), `001.007` (117), `001.002` (80)… Piloto de `001.003` feito. |
| BL-13 | Sessão 30–31/07/2026 | **Duplicidade `MIL` / `MILHEI` no cadastro de unidades.** Mesmo nome ("MILHEIRO"), dois códigos. Enquanto ambos existirem, o erro do `00067` se repete em produto novo. |
| BL-14 | Sessão 04/08/2026 | **Contrato do `ReqMat/InserirAlterarRequisicaoMaterial` capturado do swagger (04/08/2026).** Cabeçalho: `CodigoEmpresaFilial`, `Numero`, `Descricao`, `Data`, `CodigoTipoRequisicaoMaterial`, `Operacao`, `CodigoFuncionario`, `CodigoCentroControle`, `Texto`, `CodigoDepositoMix`, `CodigoLocalArmazenagem`, `CodigoMix`, `Itens[]`, `ListaMensagem[]`. Item: `Operacao`, `CodigoProduto`, `Sequencia`, `Quantidade`, `CodigoUnidadeMedida`, `PosicaoUnidadeMedida`, `CodigoLocalArmazenagem`, `Observacao`, `CodigoCatalogoMix`, `CodigoDepositoMix`. ⚠ **Os nomes da ESCRITA ≠ os da LEITURA** — `Itens` vs `ItemReqMatChildList`; `CodigoUnidadeMedida`/`PosicaoUnidadeMedida` vs `CodigoProdUnidMed`/`PosicaoProdUnidMed`; `CodigoLocalArmazenagem` vs `CodigoLocArmaz`; `CodigoCentroControle` vs `CodigoCentroCtrl`. O mapper traduz nos dois sentidos. |
| BL-23 | 05/08/2026 | 🔴 **Custo negativo é fenômeno de estoque, não caso isolado — 41 produtos afetados.** A operação reportou o problema pelo **único canal que tinha**: **18 RMs com "CUSTO NEGATIVO" na `Descricao`**, escritas por 3 pessoas (CAIO.RAFAEL, MARIA.EDUARDA, RYAN.PAGANOTTO) entre **22/05 e 14/07/2026** — 12 delas só em junho. **10 seguem abertas.** Os 41 produtos dessas RMs **são a varredura que a §6 do relatório de 31/07 pediu, já feita à mão** (é o BL-11, agora com lista concreta). **Padrões:** (a) 8 produtos da família `001.008` aparecem, sempre com os maiores saldos (210, 130, 50); (b) a janela é de ~3 semanas ⇒ tem cara de **EVENTO**, não de degradação gradual; (c) `001.003.00047` — o espécime da §F.2 do `Endpoints_Alvo.md`, item **FABRICADO** com custo médio negativo anterior a julho — **está na lista**; (d) candidato a causa raiz: os **26 "AJUSTE DE INVENTARIO RETROATIVO" de 28/02/2026** (tipo `0000005`, §10.22), que foram **ATENDIDOS** e portanto **baixaram estoque de verdade**. **Investigar com `MovEstq/RetornaFichaEstoque` nos produtos da lista, recuando a antes de junho.** ⚠ Pergunta em aberto: **por que os relatos pararam em 14/07** — problema resolvido, ou as pessoas desistiram de reportar? ⇒ **Assunto de Controller, sessão própria. Não bloqueia o módulo**, mas **pode explicar parte do BL-18**: se custo negativo impede o atendimento, parte das 11 mil unidades em aberto está presa por isso, e não por desleixo. |
| ~~BL-22~~ | 05/08/2026 | ✅ **FEITO em 05/08/2026 — as 5 RMs foram estornadas e excluídas**, confirmado por `412` no `Load` das cinco. ⚠ **Mas faltou 1 galão de `001.003.00032`: 11 → 10.** Oito dos nove estornaram — **indício de que o estorno pode não devolver tudo**, o que é **relevante para a Fase 3** (reprova e devolução dependem justamente dessa operação). Investigar antes de a Fase 3 confiar no estorno. Texto original abaixo. ~~**Limpar as 5 RMs de teste: `0000002271` a `0000002275`.**~~ Quatro **baixaram estoque**; a `2272` está **parcial** (6 galões + 2 sapólios ainda em aberto). ⚠ **Consumo real do dia, avisar quem repõe:** `001.003.00032` (GLUTARALDEIDO 2% C/5L) foi de **11 para 1 galão** e `001.003.00056` de **7 para 4**. Deletar RM atendida provavelmente exige **ESTORNO antes** (campo `Estornado` no item; função existe na tela, §6.2-8). O estorno devolve material ao estoque e é operação que a **Fase 3 vai precisar de qualquer forma** (reprova, devolução) ⇒ **capturar o payload ao fazer** — é captura de graça de um endpoint que já está no caminho. |
| BL-21 | 05/08/2026 | **Capturar o endpoint que lista LOTES DISPONÍVEIS.** É a **última peça faltante** do atendimento. A tela "Seleção Lote (Saída)" mostra nº do lote, validade, `Saldo Calc` e `Saldo` — e o `FiltrarSaldoProduto` **NÃO devolve saldo por lote** (§9.9, onde isso já estava registrado como a peça sem fonte nativa). A chamada dispara **quando o modal abre**, ANTES do `ValidarAtendimento`, e escapou de 3 tentativas de captura. **Protocolo:** Network com **Preserve log LIGADO ANTES** de clicar em Atendimento; abrir a seleção de lote; copiar a chamada **sem clicar em mais nada**. **Pré-requisito da tela de atendimento no Hub (§10.21); não bloqueia a criação.** |
| BL-18 | 05/08/2026 | 🔴 **11 mil unidades em saldo de RM aberta, e 67 produtos com RMs abertas SIMULTÂNEAS.** Topo: `001.004.00072` em **16** RMs; `001.008.00003` em **13** (707 un, fev→jul); `001.003.00056` em **12**. É a §6.1-10 (`2187`/`2231`, **risco de BAIXA EM DOBRO**) em escala: material re-requisitado enquanto o saldo antigo segue vivo. **Atender um saldo velho hoje tira material que já saiu por outra RM.** ⚠ Destes, **1.980 un estão em 13 RMs `Automático`**, que NUNCA teriam como ser atendidas — **causa sistêmica, não desleixo** (§10.16 e BL-19). Os outros ~8.300 são `Manual`: pendência administrativa. Achado de Controller, **acionável sem o módulo**: limpar/cancelar antes de qualquer bloqueio do Alvo. **Custo colateral para o sync:** RM não-terminal nunca sai da fila do passo B ⇒ o platô de `precisa_releitura` inclui dívida administrativa, não só trabalho real. |
| BL-19 | 05/08/2026 | **`TipoAtendimento` não é visível nem editável na tela do Alvo.** O campo **não existe no formulário de RM** — ninguém escolheu `"Automático"` nas 27 do ano; o valor é atribuído **por baixo**. Seis usuários distintos, ano inteiro, incluindo ontem; e os **MESMOS** usuários também criam RMs `Manual` ⇒ **não é hábito, não é permissão, não é automação de etapa**. Hipótese: caminho de criação alternativo (cópia de RM, importação, outro fluxo da tela). Fonte mais direta para fechar: **botão `Log` da RM**, que já resolveu a investigação de unidades (§9.8). A correção já existe e está provada (`SaveReqMat` `Update`, §10.16) — o que falta é entender a **causa**, senão o Hub corrige o próprio sintoma e o das outras origens continua. |
| BL-20 | 05/08/2026 | **Rastreabilidade de lote é parcial.** **110 de 175** produtos requisitados em 2026 têm lote registrado (965 linhas) — e isso é **piso, não teto**: só **236 das 679** RMs estão detalhadas, e lote só existe em item **atendido**. Os 65 restantes misturam **três causas diferentes**: (a) produto com `ControlaLote = "Não"` (ex.: `001.004.00021`, sapólio — consumível); (b) produto nunca atendido; (c) RM ainda não detalhada pelo passo B. **Só (a) é lacuna regulatória.** Para classe III/IV o que importa é identificar quais **INSUMOS DE PRODUTO** estão sem controle de lote — não o consumível de limpeza. Depende de saber `ControlaLote` por produto, que hoje o `ReqMat/Load` não traz (ver §6.3-N, `loadOneToOne=All`). Fase 5. |
| BL-17 | OP-2.3 · 05/08/2026 | 🟡 **`call_sync_laudos_cron` tem execute para `anon` e `authenticated`.** Qualquer usuário autenticado dispara o sync de laudos. Mesma classe do BL-5: permissão larga numa rota que ninguém revisou. Impacto baixo (é leitura; pior caso é carga no gateway compartilhado), correção é uma linha de `revoke`. Achado em 05/08/2026 ao diagnosticar o disparo do `sync-reqmat`. `call_sync_reqmat_cron` já nasce com `revoke`. |
| BL-16 | OP-2.3 · 05/08/2026 | **`sync-compras-status-cron` tem `paused_at` preenchido desde 26/05/2026 e está rodando.** Medido: a linha em `sync_settings` está com `enabled=true` **e** `paused_at=2026-05-26 14:57` + `paused_by` — par que a RPC `sync_cron_pause` **nunca produziria** (ela grava os quatro campos juntos, e `sync_cron_resume` limpa os quatro), logo é resíduo de UPDATE manual. O cron executou **50 vezes nos últimos 7 dias** (`job_type='bicephalous'`, última 05/08 13:00), porque o código lê só `enabled`. **Duas perguntas, nesta ordem:** (1) alguém tentou pausar aquele cron em maio e ele nunca parou? (2) se não, limpar o `paused_at` órfão para a tela de cron não mentir. ⚠ **Não corrigido de propósito:** é o cron do Suprimentos (100+ usuários) e a tarefa era outra. Como consequência de desenho, o `sync-reqmat` já nasce lendo `enabled=false` **OU** `paused_at` — falha fechada; se o Pedro quiser uniformizar os outros 7, é tarefa própria, com regressão. |
| BL-15 | Sessão 04/08/2026 | 🔴 **`TipoAtendimento` NÃO EXISTE no contrato de integração** (confirmado no swagger, não é omissão de captura) — e é o campo que decide se a RM atende. `Automático` nunca atende (n=71). Nem `DataValidade` está no contrato. **Teste decisivo, antes da tela de criação:** criar RM pelo Lab COM `TipoAtendimento: "Manual"` no payload e reler com `ReqMat/Load`. Se voltar `Manual`, o binder aceita campo não documentado e o assunto morre. Se voltar `Automático`, a Fase 2 precisa de segundo passo (alteração após criar, ou correção pela tela) — e isso muda o desenho de `op_requisicoes.status_envio`. Deletar a RM de teste, como na `0000002236`. **Bloqueia a criação, não o espelho.** |

---

## 9. Módulo Recebimento (REC) — espelho do Laudo, sync e Fila de Inspeção

**Por que existe.** A §6.3 provou que o laudo com status `Emitido` é material **fisicamente na empresa** (a NF foi lançada, o lote foi criado com quantidade cheia) que **ainda não é saldo em estoque** — logo é invisível no Alvo e não existia em nenhuma tela do Hub. Medição de 28/07/2026: **751 laudos em 2026**, **120 `Emitido`**, **1.433 unidades de pericárdio** paradas em **115 lotes**, a mais antiga desde **08/05** (dois lotes de 09/04 = 110 dias). O saldo do mesmo produto em 11/06 era 614 ⇒ **2,3× mais material esperando liberação do que disponível para produzir**.

**Princípio.** `rec_laudos` é **espelho read-only** do Alvo: nenhuma coluna é editada por tela, o Hub não escreve nada no ERP. A custódia física (o bipe recebimento→inspeção, único dado que o Hub gera de forma nativa) virá em tabela **separada** e append-only (REC-2.x).

### 9.1 — Edge Function `sync-laudos` (REC-1.1)

| Item | Valor |
|---|---|
| Arquivo | `supabase/functions/sync-laudos/index.ts` |
| Invocação | `POST /functions/v1/sync-laudos`, gate `CRON_SECRET` (header `x-cron-secret` ou `body.cron_secret`) |
| Acesso ao Alvo | **sempre** `POST {ERP_PROXY_URL}/alvo/passthrough` com header `X-System-Secret` (padrão server-to-server dos outros 6 crons; o gateway aceita esse header antes do JWT) |
| Secrets | `CRON_SECRET`, `ERP_PROXY_URL`, `ERP_PROXY_SYSTEM_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (todos já existentes) |
| Kill-switch | `sync_settings.job_name = 'sync-laudos'` → `enabled=false` registra "Pausado" em `sync_runs` e sai sem tocar no Alvo |
| Auditoria | `sync_runs` com `job_type='laudos'` |
| Body opcional | `{"triggered_by":"manual_admin"}` · `{"ano":2025}` (rejanela a lista; o upsert é idempotente) |

**Passo A — LISTA** (1 chamada): `laudo/GetListForComponents`, payload exato da §6.3-A com `Filter: "( DataEmissao >= #01/01/<ano> 00:00:00# )"`, `Order: "Numero DESC"`, `PageIndex: 1`, `PageSize: 2000`. **Sem filtro de status** — `Emitido` é a fila e `Concluído` mede o tempo de inspeção realizado. Upsert por `(codigo_empresa_filial, numero)` com os 21 campos + `raw_lista` + `sincronizado_em`; **não toca** nas colunas de enriquecimento nem em `enriquecido_em`. Se a lista bater no `PageSize`, o job marca `possivel_truncacao` (nunca corta em silêncio).

**Passo B — ENRIQUECIMENTO** (teto de **100** por execução): seleciona `enriquecido_em is null` ordenado por `data_emissao desc`, chama `Laudo/Load?codigoEmpresaFilial=…&numero=…&loadParent=All&loadChild=All&loadOneToOne=All` em chunks de 5 paralelos (sleep 200ms) e grava as 12 colunas de detalhe (incluindo **`numero_ctrl_lote`**, a âncora do QR) + `raw_load` + `enriquecido_em`. **Watchdog de 110s** antes do teto de 150s de resposta: ao estourar, devolve o parcial — o que gravou fica e a execução seguinte continua. Os ~751 laudos convergem em **~8 rodadas**.

**Cadência** (`sql/REC-1.1.sql`, a aplicar pelo Pedro): `cron.schedule('sync-laudos-4x-dia', '45 11,14,17,20 * * 1-5')` = **08:45 / 11:45 / 14:45 / 17:45 BRT**, dias úteis. Minuto 45 evita o `sync-compras-status-cron` (hora cheia, 11–20 UTC) e os crons de despesas/docfin/intercompany (minutos 00/10/30). Convergência inicial ≈ 2 dias úteis; para acelerar, `select public.call_sync_laudos_cron('manual_admin');`.

**Mapeamento `sync_runs` deste job** (ler o histórico com esta chave): `total_candidatos` = laudos listados · `total_consultados` = laudos gravados · `total_mudaram` = laudos enriquecidos · `total_erros` = erros.

**Códigos de erro distinguidos no log e em `sync_runs.detalhes`:** `401` = `X-System-Secret` inválido no gateway · `403` = endpoint fora da whitelist · `417` = payload rejeitado pelo Alvo.

**Decisões de mapeamento (registradas para não se perder):**
1. **Fuso.** O Alvo devolve datas **sem offset** (`2026-06-29T00:00:00`) e elas são horário de Brasília; gravar cru em `timestamptz` faria o Postgres assumir UTC e a data **voltaria um dia** na exibição. O mapper carimba `-03:00` (constante `ALVO_TZ_OFFSET`); strings que já trazem `Z`/`±HH:MM` passam intactas.
2. **Parser defensivo.** O envelope do `GetListForComponents` nunca foi visto de dentro de código (só pelo Network): o extrator tenta `Registros`/`Lista`/`Items`/`Rows`/`Data`/`Result` e, no limite, o primeiro array de objetos — e **registra em `sync_runs.detalhes` qual chave usou**. Diagnóstico sem redeploy.
3. **Datas-zero do .NET** (`0001-01-01`, `1900-01-01`) viram `null`.
4. **Leitura de campo case-insensitive** — o Alvo alterna a caixa dos nomes entre endpoints (`GeraRmEspecifica`/`GeraRMEspecifica`).
5. **inseridos × atualizados** sai da contagem da tabela antes/depois do upsert (só este job escreve em `rec_laudos`).

### 9.2 — Tela `/recebimento/fila`

`src/pages/RecebimentoFila.tsx` + `src/services/recebimentoService.ts`. **Somente leitura, admin-only, sem permissão nova**: o gate é a RLS de `rec_laudos` (`_is_admin()`), reforçado por `isAdmin` na página (tela "Acesso Restrito") e na sidebar. `hub_permissions`/`hub_roles`/`_user_has_perm` **não foram tocados**.

- **KPIs:** lotes aguardando · unidades · lote mais antigo (dias, em vermelho acima de 45) · nº de NFs. Na aba Concluídos o 3º KPI vira **tempo médio de inspeção**.
- **Tabela agrupada por NF** (`numero_documento`), grupos ordenados pelo lote mais antigo — a fila real. Colunas: laudo, produto (código + nome via `stock_products`), lote (`—` enquanto não enriquecido, com tooltip explicando), quantidade, unidade, emissão, **dias parado**, validade do lote.
- **Faixas de dias parado:** até 15 **sem cor** (o normal não grita), 16–45 âmbar, acima de 45 vermelho — light e dark, `tabular-nums`, sem glow/gradiente (§4.1-E).
- **Filtros:** status (default `Emitido`, com "Todos" — **único controle de recorte desde a REC-1.5**, que removeu o toggle do topo), produto, NF, faixa de dias e **período de emissão** (REC-1.3) — todos persistidos na URL (sobrevivem ao F5, como em Suprimentos). O período usa o date picker padrão do Hub (`Popover` + `Calendar`), com **De e Até independentes** e sem default; os KPIs refletem o recorte.
- **Exportar `.xlsx`** (REC-1.3, botão à direita da barra de filtros): SheetJS (`xlsx@^0.18.5`, já dependência, carregado por import dinâmico), **plano — uma linha por laudo**, respeitando **todos** os filtros ativos. Colunas: NF · Laudo · Código do produto · Nome do produto · Lote · Validade do lote · Quantidade · Unidade · Data de emissão · Dias parado · Status · Resultado da análise · Data do resultado · Chave MovEstq (+ Quantidade aprovada e reprovada na aba Concluídos). **Datas saem como data e números como número** — o Excel ordena e filtra de verdade (comportamento verificado relendo o arquivo gerado: `t:"d"` com o dia certo, sem escorregar de fuso; NF e nº do laudo ficam como **texto** para preservar zeros à esquerda). Larguras por coluna, **autofiltro** no cabeçalho, arquivo `fila-inspecao_AAAA-MM-DD_HHmm.xlsx`. ⚠ **Sem freeze de painel:** o writer XLSX do SheetJS community 0.18.5 não emite `<pane>` (`write_ws_xml_sheetviews` grava só `workbookViewId`) — o autofiltro é o substituto funcional; congelar exigiria trocar/somar biblioteca, decisão do Pedro.
- **Recorte "Concluído"** (ou "Todos"): resultado da análise, quantidade aprovada/reprovada, **valor reprovado em R$** (REC-1.5) e **tempo de inspeção realizado** (`data_resultado − data_emissao`). Em "Todos", as colunas que não se aplicam à linha saem com "—".
- **Transparência:** avisa quando a leitura atinge o teto de 3.000 linhas e quantos laudos ainda estão sem lote.
- **Rodapé:** "Atualizado em …" a partir do `sincronizado_em` mais recente.
- Nav: grupo novo **"Recebimento"** (ícone `PackageSearch`), injetado nos dois caminhos do bloco `nf_entrada` do `AppSidebar`.

### 9.3 — O que já rodou (28/07/2026)

Executado pelo Pedro no mesmo dia, nesta ordem: `supabase functions deploy sync-laudos --no-verify-jwt --project-ref hbtggrbauguukewiknew` → 1º disparo (falhou no CHECK, ver REC-1.2) → `sql/REC-1.2.sql` → disparo OK → `sql/REC-1.1.sql` (agendamento 4x/dia útil + kill-switch) → **Publish no Lovable** → validação visual. Resultado: **751 laudos espelhados**, tela no ar com 119 lotes / 1.523 un / 110 dias no mais antigo / 31 NFs.

### 9.4 — Operação: o que a primeira execução ensinou

| Medida | Valor |
|---|---|
| Duração do 1º disparo real | **14,5 s** (751 listados + 100 enriquecidos) |
| Watchdog configurado | 110 s (teto de resposta da Edge Function: 150 s) |
| Folga | ~7,5× — **há espaço para subir o teto de enriquecimento** (`LOAD_BATCH`, hoje 100) e convergir em menos rodadas |
| Pendentes após o 1º disparo | 651 (converge nas execuções seguintes do cron) |

⚠ **Regra permanente (REC-1.2): `sync_runs.job_type` tem CHECK enumerado.** Todo sync novo precisa **estender a constraint antes do primeiro disparo** — caso contrário a função falha no passo zero, ao abrir o registro de execução, sem sequer chamar o ERP. A tabela é compartilhada pelos 7 crons do Hub, então a alteração é aditiva e **em transação**. Vale o mesmo cuidado para `sync_runs_triggered_by_check` (`pg_cron` / `manual_admin` / `test`).

**Pendências conhecidas:** (a) a janela é o **ano corrente**: na virada de ano, laudos de dezembro ainda `Emitido` saem da janela até um disparo com `{"ano": <anterior>}` (registrar como tarefa REC-1.x antes de 01/01/2027); (b) **valor e fornecedor** dependem do MovEstq de origem ⇒ **REC-2.0**, §9.5; (c) subir o `LOAD_BATCH` (item acima) — ajuste barato, entra como tarefa nova quando o Pedro quiser; (d) freeze de cabeçalho no XLSX depende de biblioteca nova (REC-1.3).

### 9.5 — REC-2.0 (**CONCLUÍDA em 29/07/2026**) · enriquecer o espelho com o MovEstq de origem: VALOR e FORNECEDOR

> **Fechamento:** executada em 29/07/2026 nos quatro passos previstos (whitelist → DDL → passo C → KPI). O bloqueio da whitelist e o dimensionamento das 295 chaves, descritos abaixo, ficam como registro do que se sabia **antes**. Resultado e fatos novos do Alvo: **§9.7**.

**O que falta e por quê.** O laudo diz *quanto* material está parado, mas não *quanto vale* nem *de quem veio*:
- **Valor:** `rec_laudos` só tem `valor_reprovado`. **Não existe** o valor do lote — valorizar a fila exige `CustoUnitario` / `BaseCustoMedio` do movimento de origem (§6.3-H: o Hub **lê** esses campos, nunca recalcula, e **nunca** usa `ValorProduto`).
- **Fornecedor:** `laudo.CodigoEntidade` é **null em 751 de 751** laudos (medido em 28/07/2026) — confirma a §6.3-D. O fornecedor só existe no `MovEstq` apontado por `chave_movestq`.

**Dimensionamento medido (28/07/2026, não estimado):** 751 laudos ⇒ **295 `chave_movestq` distintas** (2,5 laudos por movimento; 0 laudos sem chave). *A estimativa anterior de ~130 chamadas estava baixa — são 295.* Com o padrão do `sync-laudos` (chunks de 5 em paralelo) e o desempenho medido em §9.4, cabe em poucas rodadas.

**Bloqueio:** `MovEstq/Load` **não está na whitelist** do passthrough (`ALLOWED_ENDPOINTS`, `erp-proxy/src/routes/alvo.ts`) — **repo separado** (`financeiropfbrazil/erp-proxy`), deploy no Render. Inclusão é mudança em gargalo compartilhado (Suprimentos 100+ usuários, Despesas, Intercompany, NF-e): fazer **aditivo**, com rollback confirmado antes de publicar.

**Esboço da tarefa:** (1) whitelist `MovEstq/Load` no erp-proxy + deploy; (2) DDL aditivo em `rec_laudos` (ou tabela `rec_movestq` por chave) para valor unitário, valor do lote e código/nome do fornecedor — bloco em `sql/REC-2.0.sql`, aplicado pelo Pedro; (3) 3º passo no `sync-laudos` percorrendo as chaves distintas ainda não enriquecidas; (4) na tela: KPI "valor aguardando liberação" e coluna de fornecedor. **Só então** a fila passa a ter valor — até lá, a tela mostra quantidade, nunca dinheiro estimado.

### 9.6 — Recomendação sobre o `AppLayout` (NÃO aplicada — decisão do Pedro)

A REC-1.7 mediu a causa da quebra de layout e ela tem uma raiz **estrutural, fora da tela de Recebimento**:

```
SidebarProvider  →  <div class="flex min-h-svh w-full">
  AppLayout      →  <div class="flex min-h-screen w-full">
                      <AppSidebar/>                       (16rem)
                      <div class="flex flex-1 flex-col">   ← flex item SEM min-w-0
                        <AppHeader/>
                        <main class="flex-1 overflow-auto w-full">
```

O `div.flex.flex-1.flex-col` é um flex item com `min-width: auto`: qualquer descendente largo (uma tabela, um `<pre>`, uma imagem sem `max-w-full`) **infla a coluna inteira além da viewport**, e a barra de rolagem passa a ser da página — arrastando cabeçalho, KPIs e filtros para fora da tela. Medido: coluna a **1556** com a viewport em 1530.

**Correção estrutural sugerida:** `className="flex flex-1 flex-col min-w-0"` no `AppLayout` (uma classe). Isso resolveria de uma vez para **todas** as telas do Hub, e não só para a Fila de Inspeção.

⚠ **Não apliquei**: `AppLayout` é compartilhado por todo o Hub (Suprimentos com 100+ usuários, Despesas, Intercompany, NF-e). Uma tela que hoje "funciona" por acidente — porque a página inflava e nada era cortado — pode passar a rolar dentro de um container e mudar de aparência. Se o Pedro quiser, entra como tarefa própria, com varredura das telas de tabela larga (`ContasPagar`, `ComprasPedidosCompra`, `IntercompanyMaster`, `SuprimentosPedidos`) antes e depois. Enquanto isso, o padrão a copiar em telas novas com tabela larga é o desta página: **raiz `grid grid-cols-1`** + **container de rolagem `w-0 min-w-full overflow-x-auto`**.

### 9.7 — Fechamento do módulo (29/07/2026) · o que o Alvo ensinou e o que ficou aberto

**Estado ao fim do dia.** Espelho `rec_laudos` com sync em **três passos** (A: lista o ano · B: `Laudo/Load` · C: `MovEstq/Load`), cron 4× ao dia, tela `/recebimento/fila` com KPI de valor e exportação XLSX. **Fila: 119 laudos, R$ 963.505,23**, todos valorizados. Enriquecimento do histórico drenando a 40 chaves por rodada (295 no ano) — fecha sozinho, sem intervenção.

**A origem do valor.** `CustoUnitario` do `ItemMovEstq` — **não** um cálculo do Hub (§6.3-H: ler, nunca calcular):

| Campo do item | Chave 15869, item 1 | O que é |
|---|---|---|
| `ValorUnitario` | 60,4766 (× 6 = `ValorProduto` 362,86) | mercadoria pura (FOB) |
| `CustoUnitario` | 128,6266 (× 6 = `BaseCustoMedio` 771,76) | **custo de estoque**, com frete e impostos não recuperáveis já rateados pelo Alvo |

A diferença de R$ 408,90 é frete 308,83 + II 84,63 + SISCOMEX 15,44. **O ICMS recuperável (186,74) não compõe** — o Alvo já trata. `valor_custo_lote` = `CustoUnitario` × **quantidade do LAUDO**; usar a `Quantidade2` do item (a do movimento inteiro) multiplicaria o valor — o erro está instrumentado no teste do passo C.

**Fatos do Alvo confirmados (medidos, não inferidos):**

1. **Ligação laudo ⇄ item é o par `(chave_movestq, sequencia_it_movestq)`** — único em 751/751. Retifica a §6.3-D.
2. **`CodigoTipoLanc` varia:** `E0000158` (nacional), `E0000160` (importação). **Nunca filtrar por ele** — usar `ControlaEstoque` (§6.3-C). Vale sobretudo para o replay do `est_saldos` na Fase 2: filtrar por código perderia as importações inteiras.
3. **`ControlaLote = "Não"` convive com laudo existente** (importação). Laudo e controle de lote são independentes. ⚠ Retificado em 31/07/2026 — o fenômeno é universal (756/756), não da importação; ver §6.2/Resolvidas.
4. **`MovEstqPedCompChildList` vem vazio em importação** ⇒ não há como amarrar `compras_pedidos` em todos os casos.
5. **A NF `4530`** — os 2 lotes mais antigos da fila, 110 dias — **é importação intercompany da PEF Austria** (`CodigoEntidade 0000017`, `SiglaPaisEntidade "AUS"`), com desembaraço (II 851,37 · SISCOMEX 192,79). Material do próprio grupo parado na inspeção, não de fornecedor externo.

**Custo operacional medido:** ~370 ms por chave no `MovEstq/Load`. 40 chaves = 17,3 s. O gateway é compartilhado com Suprimentos (100+ usuários), Despesas, Intercompany e NF-e — **subir o teto é mexer em recurso comum**; espaçar é preferível a acelerar.

**Aberto no módulo:**

1. **Publish da REC-2.1** — só o clique; o código está conferido contra o banco.
2. **Custódia física (o bipe)** — **dono indefinido entre Hub e Rastro P&F.** O Rastro já tem em produção bipe de recebimento, inspeção com re-autenticação, handshake bilateral e ledger append-only com hash chain; e o *fiscal gate* dele (material em `AGUARDANDO_FISCAL` até a NF ser lançada contra o pedido) **é o tempo 1 do fluxo de quatro tempos** — o mesmo fenômeno físico, modelado duas vezes em dois bancos. **Decidir o dono precede qualquer desenho de tabela.** Se ficar no Hub, exige papel novo num app com 100+ usuários de Suprimentos.
3. **Acompanhamento de reprova** — 15 laudos, R$ 13.499,81, `quantidade_devolvida = 0` em 15/15. **Não é software:** é a pergunta (3) para a Qualidade, que fecha a Q3 do §5.
4. **BL-4 (`min-w-0` no `AppLayout`)** — §9.6. Sessão própria, com regressão nas telas de tabela larga.

### 9.8 — Unidades de medida no Alvo (30/07/2026) · regra provada e carga iniciada

**Por que isto entrou no módulo.** A RM precisa mostrar "material disponível no 001". Antes de somar saldo, é preciso saber em que
unidade ele está — e a base tem sujeira histórica: `UNID` e `UN` como códigos distintos, `PACOTE` e `PC`, `MIL` e `MILHEI`
duplicados. Pior: produtos de líquido têm **`GALAO` como unidade-base**, sem litro na escala. A produção não conta estoque em galão.

**A escala vive em `ProdUnidMedChildList` (`Produto/Load`).** Campos que importam:

| Campo | Significado |
|---|---|
| `Posicao` | 1 = **unidade-base**; 2, 3… = escalas adicionais |
| `Peso` | fator de conversão |
| `PesoFatorDivisor` | `"Fator"` ou `"Divisor"` |
| `UnidadeMedidaCompras` / `Producao` / `Venda` / `MovimentacaoEstoque` | flags independentes |

**REGRA PROVADA — a nomenclatura é contraintuitiva: `Fator` DIVIDE.**
Sempre usar tipo **`Fator`**. O Alvo divide a quantidade da base pelo `Peso`:

| Situação | Peso | Tipo | Exemplo medido |
|---|---|---|---|
| unidade **menor** que a base | 1/n | `Fator` | galão de 5 L → `LITRO` peso **0,2**: 11 galões = **55 litros** |
| unidade **maior** que a base | n | `Fator` | unidade → `MILHEI` peso **1000**: 4.000 un = 4 milheiros |

**NUNCA usar `Divisor`** — ele multiplica. Cadastrado como `Divisor 0,2`, o glutaraldeído mostrou 11 galões = **2,2** litros
(1/25 do volume real). O erro foi encontrado com **uma chamada**, antes de replicar em 500 produtos.

**Tabela de unidades: 58 códigos** (`unidMedida/GetListForComponents`). Os códigos da planilha de migração **não existem**:
`L` → o real é **`LITRO`**; `ml` → **`ML`**; `G` → **`GRAMAS`**. Atenção a `QuantidadeCasasDecimais`, que varia:
`UNID` tem **5**, `UN` tem **2**, `LITRO` 4, `ML` 2 — migrar para unidade de menor precisão faz o Alvo arredondar.

**Escrita no cadastro — `Produto/SavePartial?action=Update` (POST).** Padrão confirmado pelo Log do Alvo:
child lists existentes vão **só com as chaves**; a linha nova vai com **`CodigoProduto: -1`** (placeholder, como no `DocFin/SavePartial`).
**Provado que o `SavePartial` PRESERVA** o que recebe só como chave: `001.003.00001` manteve 2 fotos, 1 filial e 1 local.
Se `Peso` for omitido, o Alvo assume 1.

**Dimensionamento da planilha (554 produtos):** 458 de fator 1 (renomeação), **64 que exigem fator caso a caso**
(PACOTE/ROLO/CX/CENTO → UN, GALAO → LITRO, UNID → ML) e **33 sem unidade-base nenhuma** — nesses não há posição 1,
então não dá para acrescentar posição 2; é cadastro incompleto e problema anterior.

**Feito até agora (6 produtos):** `001.003.00001` (tela) · `00006`, `00007`, `00020`, `00029` (script) com `UN` peso 1 ·
`001.003.00032` glutaraldeído com `LITRO` peso 0,2 (tela). **Dois achados pré-existentes, não causados pela carga:**
`00029` tem **`CX` duplicado** (posições 2 e 3, pesos 70 e 72); `00020` tem `ProdEmpresaFilialChildList` **vazio** —
produto sem `ControlaLote`/`PermiteLoteVencido`/`UtilizaPPCP`. O **Log do Alvo** (botão no topo da tela do produto) confirmou
que a carga só executa `Alteração-Produto` → `Inclusão-Unidades de Medida` → `Alteração-Produto1`.

**⚠ PENDÊNCIA DE SEGURANÇA:** `Produto/Load` e **`Produto/SavePartial`** estão na whitelist do `erp-proxy`. O `/alvo/passthrough`
valida **apenas o JWT do Supabase — não há gate de papel**. Enquanto essas linhas existirem, qualquer um dos 100+ usuários do Hub
pode gravar no cadastro de produtos do ERP. **Remover assim que a carga terminar.**

---

### 9.9 — `Produto/FiltrarSaldoProduto` · o saldo já existe no Alvo (30/07/2026)

A tela **CSALDOPROD** ("Saldo de Estoque do Produto") usa **POST `Produto/FiltrarSaldoProduto`**:

```json
{"produto":"001.003.00032","idProdutoId":null,"unidMedida":"LITRO","posicao":"2",
 "todasUnidades":true,"empresas":"1.01"}
```

Devolve saldo **por empresa, por local de armazenagem e por unidade**, com a conversão feita pelo próprio ERP, e separa
`"Saldo Disponível"` de `"001 ESTOQUE"`. Traz também `ProdutoControlaLote`.

**Consequência para a Fase 2:** isto é forte candidato a **substituir o `est_saldos`** — o replay de 295 `MovEstq` com
`ControlaEstoque = "Sim"` deixaria de ser necessário. É o mesmo princípio da §6.3-H: **ler, nunca calcular**. Um endpoint nativo
não diverge com o tempo; um replay nosso, sim.

**A confirmar antes de decidir:** se `produto` aceita vazio (saldo da casa inteira numa chamada) e se `todasUnidades`/`posicao`
podem ser omitidos. E falta capturar o botão **Lote** dessa tela — saldo por lote é a última peça que a RM precisa para
escolher de qual lote requisitar. Os botões **Reservas** e **Empenhos** dão o comprometido: "disponível" de verdade é
saldo menos empenho.

⚠ Respondido em 31/07/2026 — ver a decisão abaixo.

**Nota:** `SaldoEstoqueTotal` e `SaldoEstoqueDisponivel` vêm **0** no `Produto/Load` mesmo em produto com saldo — não são confiáveis.

**DECISÃO FECHADA (31/07/2026): o `est_saldos` não será construído**

**As provas**

| Peça | Fonte | Estado |
|---|---|---|
| Saldo por produto/local | `Produto/FiltrarSaldoProduto` — uma chamada por SKU | **provado** |
| Lote de **entrada** + validade | já no `raw_movestq_item` do `rec_laudos` | **provado** — 756/756 |
| Lote **consumido** | `CtrlLoteItemReqMatChildList` lido no atendimento | **provado** — soma bate com o atendido em 5/5 |
| Saldo **remanescente por lote** | sem fonte nativa | única peça que exigiria replay |

**A decisão**

**Não haverá tabela `est_saldos`.** A RM consulta o saldo **sob demanda**, uma chamada por SKU no
momento em que o requisitante escolhe o produto. Sem cron, sem espelho, sem divergência.

1. **O replay não teria consumidor.** A RM não precisa de saldo por lote — quem escolhe é o
   almoxarifado, que já faz FEFO. O Hub lê de volta a alocação real.
2. **Não existe varredura em lote.** `produto: ""` devolve `SqlException 156` (o Alvo concatena SQL).
   Um espelho custaria N chamadas por ciclo num gateway compartilhado com 100+ usuários.
3. **Ler, nunca calcular.**

**O custo aceito, explicitamente**

Acoplamento: se o Alvo ou o Render caírem, a tela não mostra saldo. Aceitável para uma tela de
requisição; **não** seria para um painel de cobertura de estoque — isso seria outra decisão.

**⚠ Limite de escopo — registrar junto**

O `FiltrarSaldoProduto` devolve **quantidade, nunca valor**. Valorização de estoque continua sem
fonte nativa confiável. Esta decisão resolve a Fase 2 e **não** resolve valorização.

**⚠ Armadilha de leitura (obrigatória para quem implementar)**

A resposta repete a mesma quantidade em três eixos — locais reais × linha sintética
`Saldo Disponível` (`Codigo: null`), elemento `Total Disponível` no topo, e a mesma quantidade em
cada unidade cadastrada. **Somar ingenuamente infla o saldo.**
Regra: filtrar empresa → local com `Codigo != null` → **uma** unidade pelo código.

---

## 10. Fase 2 — A RM nasce da OP (especificação · 31/07/2026)

### 10.1 — A regra

**Nenhuma Requisição de Material sem Ordem de Produção.**
OP aberta → produção recebe → produção abre a(s) RM(s) contra ela.

### 10.2 — Forma: tela própria, não sub-tela da OP

**Tela separada "Abrir Requisição de Material"**, com campo **OP obrigatório** — um **seletor de OPs
pendentes**, não texto livre.

Motivo decisivo: **são pessoas diferentes.** Quem abre a OP e quem requisita não trabalham no mesmo
momento. Entrar pela tela da OP obrigaria o requisitante a navegar pelo trabalho de outra pessoa.

*(Substitui a hipótese descartada de "Abrir requisição" como botão dentro do detalhe da OP.)*

### 10.3 — A OP **não** tem lista de insumos — só de itens finais

Os itens da OP são a **saída**; a RM pede a **entrada**. Conjuntos diferentes de produtos.

⇒ **Não existe** sugestão de itens planejados na grade da RM.
⇒ **Não existe** marcação de "item fora do plano" — não há plano de insumo contra o que comparar.
⇒ O picker da RM é o catálogo (`stock_products`), filtrado por saldo disponível.

*(Corrige duas hipóteses de desenho levantadas e descartadas na mesma sessão.)*

### 10.4 — O consolidado da OP soma o ATENDIDO

A produção requisita como quiser — uma RM ou dez. A OP acumula.

Tela da OP ganha **seção de Requisições**: uma linha por RM (número, data, quem abriu, status do
Alvo) e abaixo o consolidado por insumo — requisitado × **atendido** × saldo em aberto, com lotes.

> 🔴 **Somar `QuantidadeAtendida`, nunca `Quantidade`.** Coerente com a §6.1-1, e agora com prova
> de campo (§6.2/Resolvidas · `Saldo ≠ Quantidade − Atendida`).

> 🔴 **E somar apenas `codigo_tipo_req_mat = '0000002'`** (REQUISIÇÃO PRODUÇÃO). Registrado em
> 05/08/2026: só **279 das 678** RMs do ano são de produção — 60% do universo é material de
> consumo (`0000004`), o tipo não documentado (`0000005`) ou requisição **sem tipo** (`null`).
> O espelho guarda os quatro, de propósito; quem filtra é quem consome. Sem esse filtro, o
> consolidado da OP soma saída de consumo como se fosse insumo de produção — e o erro é
> **silencioso**, porque o número continua parecendo plausível. Vale igual para a métrica de
> vazamento da §10.7.

Isso é a conferência que hoje não existe no processo, e **não exige trabalho novo de ninguém**.

**Prova de campo da RM `0000002251` (04/08/2026, `ReqMat/Load?numero=0000002251&loadChild=All`)**

22 itens. Pedido 2.850, atendido 2.918 — a soma registrada, agora com o detalhe por item:

| Seq | Produto | Pedido | Atendido | Saldo | `QuantidadeAtendidaMaior` | Lotes |
|---|---|---|---|---|---|---|
| 18 | 001.007.00034 | 100 | 147 | 0 | 47 | 2 |
| 19 | 001.007.00035 | 100 | 221 | 0 | 121 | 2 |
| 21 | 001.007.00016 | 100 | 0 | 100 | 0 | 0 |

Os outros 19 itens fecharam pedido = atendido, saldo 0.

- **O excedente é carimbado, não inferido:** `QuantidadeAtendidaMaior` traz 47 e 121. Não
  é preciso calcular `atendido − pedido`.
- **O "Atendida Parcial" do cabeçalho esconde as duas pontas:** o parcial vem da seq 21
  (item inteiro em aberto), enquanto 168 unidades sobraram em outros dois itens. Somar
  `Quantidade` daria 2.850 e a falsa impressão de que falta pouco. Conferência é por item.
- **Saldo já vem calculado** pelo Alvo em `QuantidadeSaldoProdUnidMedPrincipal`. Não
  recalcular no espelho.
- **Lote vem da child list**, confirmado: `CtrlLoteItemReqMatChildList` com
  `NumeroCtrlLote`, `DataValidadeCtrlLote`, `Operacao="Saída"`, `QuantidadeBruta`,
  `QuantidadeUnidadeItem`. Itens com rateio trazem 2 lotes; o item não atendido (seq 21)
  traz ZERO.
- **`TipoAtendimento="Manual"`** no cabeçalho e **`GeraEmpenho="Não"`** no cabeçalho e nos
  22 itens — as duas premissas da Fase 2 confirmadas em campo.
- **`NumeroOrdProduc` null nos 22 itens**, inclusive nesta RM que tem a OP escrita à mão na
  Descrição. Mantém o parse como único vínculo até o BL-9.
- **Campo novo não mapeado:** `FinalizouOP` existe no item (aqui "Não").
- **Volume:** cabeçalho tem 103 campos, item 102 — a maioria irrelevante ao módulo
  (`NomeHotel`, `CidadeLocacaoVeiculo`, `DataCheckIn`). ⇒ recomendação para a OP-2.2:
  núcleo tipado + `raw` jsonb, no molde do `rec_laudos`. Não espelhar 102 colunas.

### 10.5 — Equação do balanço, sem BOM

```
disponibilizado = Σ atendido − Σ devolvido
fechamento:  disponibilizado = consumido + reprovado + perdas + saldo em aberto
```

Rendimento contra BOM continua sendo camada analítica separada — e agora está claro **por quê**:
sem plano de insumo, o balanço físico não pode depender dele.

### 10.6 — Arquitetura — nada de novo

Sync no molde do `sync-laudos`, já provado em produção:
**passo A** `reqMat/GetListForComponents` com `Filter` por período →
**passo B** `ReqMat/Load` por número, para itens e lotes.

### 10.7 — Vazamento pela tela do Alvo — medir antes de decidir

`Origem` distingue nativamente `Importação` (API) de `ManualAlvo` (tela) ⇒ dá para **medir** o
vazamento desde o primeiro dia. Linha de base: `ManualAlvo` em 71/71.

**MEDIDO em 05/08/2026: 3,6%.** Só **10 das 279** requisições de produção do ano mencionam OP na
`Descricao` ⇒ **vazamento de 96,4%**. E em **cinco formatos distintos** — `"OP. 2026-0228"`,
`"OP-2026-0177"`, `"(OP-2026-0156)"`, `"OP 2026-0122"`, `"- OP 2026-0105"` —, mais uma com ano
provavelmente errado (`"OP 2025-0056"` numa RM de 10/03/2026, com 900 un ainda em aberto).

⚠ **As 9 OPs citadas são numeradas abaixo de 500** ⇒ são **OPs de papel** (FRM-07-11) e **não
existem em `op_ordens`**, que tem 2 registros — o Hub semeou 2026 em 500 justamente para não
colidir com a faixa manual (§3).

⇒ **Não há consolidação retroativa. O módulo começa nas OPs do Hub.** Recriar as históricas e
vincular por parse da `Descricao` é **opção, não pressuposto** — e esbarra na mesma objeção de
BPF da OP-1.6 (registro de produção reconstruído a posteriori). A §10.8 (a RM `2251` que já
escrevia a OP à mão) continua valendo como evidência de demanda; o que a medição acrescenta é a
escala: o comportamento existe em 1 de cada 28 requisições, não como praxe.

### 10.8 — Evidência de demanda: o comportamento já começou sozinho

RM `0000002251`, 30/07 07:23: `"Peças de Cateter TRIC - OP. 2026-0228"` — **1 em 71**, do mesmo dia,
exatamente no formato projetado na §6.2 (Fase 0 · teste de escrita), com 37 dos 40 caracteres.
⇒ A Fase 2 **dá ferramenta a um comportamento existente**, não impõe processo novo.

### 10.9 — ⚠ Pré-requisito de dados

`CodigoCentroControle` é **ignorado** — o centro deriva do funcionário (§6.2-1).
Cobertura: **44 de 51** usuários ativos com `profiles.funcionario_alvo_codigo`.
⇒ Gate na RPC, desenhado agora e não descoberto na primeira requisição órfã.

### 10.10 — Decisões de desenho ainda em aberto

1. **Quais OPs no seletor?** `ABERTA` e `EM_ANDAMENTO`. Filtrar também por OP já comunicada?
   Daria uso real ao carimbo da OP-1.5.
   **→ FECHADA em 04/08/2026:** o seletor filtra `status IN ('ABERTA','EM_ANDAMENTO')`.
   `EM_FECHAMENTO` fica de fora — OP em fechamento não recebe material novo. Sem filtro por OP
   comunicada. Valores reais de `op_ordens.status`: `RASCUNHO` · `ABERTA` · `EM_ANDAMENTO` ·
   `EM_FECHAMENTO` · `FECHADA` · `CANCELADA`.
2. **O que dispara `ABERTA → EM_ANDAMENTO`?** Criação da RM ou atendimento.
3. **Vínculo OP↔RM:** `numero_op_detectado` derivado ao lado do texto cru, ou campo único?
   **→ FECHADA em 04/08/2026:** a pergunta era mal posta. A OP não existe no Alvo, então não há
   parse — o vínculo é gravado na criação, em `op_requisicoes`. Ver §10.14.

### 10.11 — Por que a leitura primeiro

1. Arquitetura já provada em produção (`sync-laudos`).
2. **Entrega valor antes de o Hub criar uma única RM**: as 14 parciais que nunca fecham, a `2187`
   há 30 dias, os 68 itens a mais — nada disso é visível hoje.
3. **É pré-requisito do lado de escrita de qualquer forma**: assim que o Hub criar uma RM, precisa
   ler de volta o atendido para o consolidado da OP.

### 10.12 — O que muda no DDL em relação ao `compras_pedidos`

O `compras_pedidos` é o padrão a copiar (cabeçalho em colunas, filhos em `jsonb`, `synced_at`,
`detalhes_carregados`, e o par `criado_no_hub` / `status_local` / `enviado_em` / `erro_envio`).

1. **`ausente_desde`** — pelas cinco requisições apagadas.
2. **Releitura por status, não por data** — a `2187` está aberta há 30 dias e ainda pode ser
   atendida. Tudo que não é `Atendida Total` volta a ser lido, sempre.
3. **Local como dimensão**, não constante.
4. **Itens em tabela própria**, não só `jsonb` — o consolidado soma atendido por produto.

### 10.13 — Onde o módulo está (31/07/2026)

**A Fase 2 não tem mais incógnita técnica.** Saldo, local, lote, empenho, listagem, `Load`, sintaxe
de filtro, requisito do `TipoAtendimento` e pré-requisito do de-para: tudo medido.

**O que resta é humano**, e é uma conversa só com o almoxarifado — nove perguntas, listadas na
§8.2 do `RELATORIO-31-07-2026.md`. Nenhuma delas bloqueia o espelho de leitura.

### 10.14 — Modelo de dados da Fase 2 (decidido em 04/08/2026)

DDL em `sql/OP-2.2.sql`. **Duas famílias de tabela, e a separação é a decisão central.**

**O espelho** (`op_reqmat`, `op_reqmat_itens`, `op_reqmat_lotes`) é **retrato do Alvo**: o Alvo é
dono do dado e o sync **sobrescreve** estas tabelas a cada leitura. Núcleo tipado + `raw` jsonb, no
molde do `rec_laudos` — os 103 campos do cabeçalho e os 102 do item não viram 102 colunas.

**O livro** (`op_requisicoes`) é **conhecimento do Hub**. A OP existe só aqui: o Alvo não tem OP
(`OrdProduc` vazio em 46 requisições + 3 Loads, §6.1-2; `NumeroOrdProduc` null em 22/22 na `2251`,
§10.4). O vínculo OP↔RM é gravado na criação e **o sync nunca escreve nesta tabela**.

**Por que o vínculo não é uma coluna do espelho** — duas razões independentes, e qualquer uma basta:
1. morreria no primeiro upsert desatento do sync, que sobrescreve o espelho por definição;
2. entre o POST no Alvo e o primeiro sync **não existe linha no espelho** onde gravá-lo — a RM
   ainda não foi lida.

**`op_requisicoes` nasce ANTES do POST**, de propósito:
- **(a)** a resposta de sucesso do Alvo tem **eco bugado** — o `Numero` é replicado em todos os
  campos string (§6.2) — então parseia-se **apenas `Numero`** e confirma-se via `Load`/sync;
- **(b)** se a rede cair depois de o Alvo gravar, há **RM órfã no ERP e nada no Hub**. A linha
  pré-gravada é o único rastro para reconciliar.

**`numero_reqmat` não é FK** para `op_reqmat`: a RM passa a existir no Alvo no instante do POST e o
espelho só a enxerga no sync seguinte. Uma FK recusaria a gravação exatamente no momento em que o
rastro é mais necessário.

**`quantidade_saldo` é espelhado, nunca recalculado** — o Alvo já entrega
(`QuantidadeSaldoProdUnidMedPrincipal`), e saldo **não** é `quantidade − atendida`: o excedente vai
para `QuantidadeAtendidaMaior` e o saldo não fica negativo (§10.4).

**`quantidade_devolvida` e `quantidade_perdida` entram tipadas desde já**, sem uso hoje: reprova e
devolução em produção são **leitura desses campos** (BL-8), não coluna nova depois.

**O parse da `Descricao` está MORTO como vínculo.** A OP não existe no Alvo, então não há o que
parsear — o vínculo é o `op_id` do livro. A `Descricao` permanece apenas como **carregador humano**,
para quem atende na tela do Alvo saber a que OP o material se destina; limite duro de **40
caracteres** (§6.2).

**RM nascida na tela do Alvo não tem OP e não entra em consolidado.** Isso é a **medida do
vazamento** da §10.7 (`Origem` = `ManualAlvo` vs `Importação`), não um defeito a corrigir.

---

### 10.15 — OP-2.3 · Edge Function `sync-reqmat` (código entregue em 05/08/2026)

| Item | Valor |
|---|---|
| Arquivo | `supabase/functions/sync-reqmat/index.ts` |
| SQL | `sql/OP-2.3.sql` (CHECK, kill-switch, 2 colunas, RPC, cron **comentado**) |
| Invocação | `POST /functions/v1/sync-reqmat`, gate `CRON_SECRET` |
| Acesso ao Alvo | `POST {ERP_PROXY_URL}/alvo/passthrough` com `X-System-Secret` |
| Auditoria | `sync_runs` com `job_type='reqmat'` (⚠ `'requisicoes'` já existe e é de OUTRO job) |
| Kill-switch | `sync_settings.job_name='sync-reqmat'` |
| Body opcional | `{"triggered_by":"manual_admin"}` · `{"ano":2025}` |

**Passo A — LISTA** (1 chamada). Payload **validado em campo em 05/08/2026**, antes de virar código:

```json
{"FormName":"reqMat","ClassInput":"reqMat","ControllerForm":"reqMat","ClassVinculo":"reqMat",
 "Input":"defaultSearch","Shortcut":"reqMat","Type":"GridTable","TypeObject":"tabForm",
 "BindingName":"","OrderUser":"","IsGroupBy":false,"DisabledCache":false,
 "Filter":"( Data >= #01/01/2026 00:00:00# )","Order":"Numero DESC",
 "PageIndex":1,"PageSize":2000}
```

⚠ `Input` é **`"defaultSearch"`**, NÃO `"gridTableReqMat"` — o padrão `gridTableLaudo`/`gridTableMovEstq` da §6.3-A **não se generaliza**; vale o molde documentado. ⚠ Endpoint literalmente `reqMat/GetListForComponents` (r minúsculo) e `ReqMat/Load` (R maiúsculo): a whitelist é case-sensitive e, ao contrário do laudo, **aqui não há variante alternativa cadastrada**.

**Fatos medidos:** 200 com **678 registros** em 2026 (~97/mês ⇒ projeção ~1.160/ano) · `data` é **ARRAY PURO**, sem chave de wrapper (o extrator não procura `Registros`/`Items`/`Result` — inventar caminho não observado esconderia mudança de forma) · **sem `Filter` vieram exatamente 2000 = PageSize**, ou seja o universo histórico estoura o teto ⇒ o recorte por ano é **obrigatório** e a trava `retornados == PageSize ⇒ possivel_truncacao` é essencial, não decorativa · **filial única** (`1.01`) em todo o universo ⇒ Filter no mínimo · a listagem devolve **55 campos** e cobre todo o núcleo **menos `CodigoTipoLanc` e `GeraEmpenho`** (só no Load); `Origem` e `TipoAtendimento` **vêm na listagem**.

**Passo B — DETALHE.** `ReqMat/Load?numero=…&loadChild=All`. **Sem `codigoEmpresaFilial`** (lição REC-1.4: parâmetro que não casa quebra o binding de forma intermitente) e **sem `loadParent`/`loadOneToOne`** (o que está provado é `numero`+`loadChild`; `loadParent` traria o `OrdProducObject`, que a §6.1-2 já provou vazio).

**Decisões de desenho registradas (as que divergem do molde, e por quê):**

1. **Ordem da fila.** No `rec_laudos`, `precisa_releitura` **zera** após a releitura, então `enriquecido_em desc` drena a fila. Aqui **não zera** — a cláusula `status <> 'Atendida Total'` mantém toda RM `Aberta`/`Parcial` na fila para sempre, por desenho (§10.12-2). Com a ordem do molde, as mesmas N RMs recém-lidas voltariam ao topo a cada execução e as antigas **nunca** seriam alcançadas. Ordem adotada: `codigo_tipo_req_mat asc NULLS LAST` → `detalhes_carregados_em asc NULLS FIRST` → `data desc`. Varredura circular com prioridade de tipo — `'0000002'` é o **menor** código entre os quatro observados, então o `asc` entrega a prioridade **sem expressão CASE**, o que mantém o índice `idx_op_reqmat_fila` utilizável. ⚠ Se um dia surgir tipo lexicograficamente menor que `'0000002'`, ele passa na frente.
2. **Passo A com shape FIXO, passo B com omissão fina.** No `rec_laudos` os dois passos escrevem colunas **disjuntas**; aqui escrevem **as mesmas**. O passo A é upsert em massa e precisa de shape fixo (chaves divergentes entre linhas do mesmo lote dão resultado imprevisível no PostgREST) — e o conjunto fixo dele **exclui `codigo_tipo_lanc` e `gera_empenho`**, senão apagaria a cada execução o que o passo B acabou de gravar. Já o passo B é update de uma linha e **omite a chave quando o campo não veio**, para não zerar o que só a listagem traz.
3. **`raw` só no passo B**, e **sem as child lists** (itens e lotes têm o próprio `raw`; duplicá-los triplicaria o espelho). O diagnóstico do envelope da lista vive em `sync_runs.detalhes`.
4. **RPC transacional `op_reqmat_aplicar_load`.** Os filhos são substituídos por inteiro (item cancelado *some* da resposta; `op_reqmat_lotes` sequer tem chave natural única, então não há `onConflict`). Em três chamadas PostgREST haveria uma janela entre o DELETE e o INSERT em que a RM fica **sem filhos** — o consolidado leria "atendido 0 / tudo em aberto" numa tela que decide requisição de material. A RPC faz delete + insert + carimbo **num único commit**. `SECURITY DEFINER` + `search_path=public`, revogada de `anon`/`authenticated`, concedida só a `service_role` (o gate é o GRANT: quem chama é a Edge Function, não um usuário — `user_has_permission` com `auth.uid()` null nunca rodaria). Mesmo lockdown de `op_proximo_numero()`.
5. **`ItemReqMatChildList` vazio = FALHA, não "RM sem itens".** Sem `loadChild=All` as child lists vêm **vazias, não ausentes** — cabeçalho sem filhos é indistinguível de RM sem itens. Como **não existe RM sem item**, a única leitura segura é tratar vazio como falha; do contrário um Load degradado apagaria os filhos bons de uma RM inteira. Mesmo julgamento do REC-2.0 com `ItemMovEstqChildList`. (`CtrlLoteItemReqMatChildList` vazio, ao contrário, é **normal**: item não atendido tem zero lotes.)

**🔴 Sentinela de data do .NET (achado novo, 05/08/2026).** O cabeçalho traz `DataRecebimento: "0001-01-01T00:00:00-02:00"` — é `DateTime.MinValue`, o "vazio" do .NET, **não** uma data. Note que ele chega **com offset** (−02:00, horário de verão histórico de Brasília), então quem validasse só a *forma* da string o aceitaria: vira data real absurda que polui todo filtro por período e ordenação. A guarda é por **prefixo** e vale para **todos** os campos de data, cabeçalho e filhos.

**Campos "2" (`Quantidade2`, `QuantidadeAtendida2`, `QuantidadeSaldo2`…)** não são duplicata: são a quantidade na **segunda unidade de medida**. Ficam no `raw`, **fora do núcleo**, de propósito — a família `001.003` tem divergência de unidade documentada (§9.8) e esses campos **vão** divergir do núcleo em algum produto; somar os dois eixos junto infla a quantidade.

**Tarefa permanente da função (não só da 1ª execução):** agrega `status → contagem` **separadamente** para a listagem e para o `ReqMat/Load` — divergência entre as duas é exatamente o que causa releitura eterna (`load_status_lido` que nunca alcança `status`, lição da REC-3.0). Custa zero query: o array já está em memória. Status fora do conjunto confirmado entra em `detalhes` como **erro**, não info. Na 1ª execução reporta também o `Object.keys()` do primeiro registro — documenta o contrato da listagem sem uma segunda sessão de console.

🟢 **Status distintos confirmados em campo (n=678): `Aberta`, `Atendida Parcial`, `Atendida Total`.** O literal terminal da coluna gerada `precisa_releitura` está **CORRETO** — sem migration, e a ressalva da §10.14 está resolvida.

**Ausência:** molde do REC-3.0-B, com as guardas intactas (listagem completa e sem erro; espelho lido por inteiro e conferido contra `count: exact`; teto de 5% do universo do ano). Dimensionamento: 5 RMs apagadas em 71 = 7%/mês, mas o universo é o **ano** (~1.160 ⇒ limite ~58) e na 1ª execução espelho ≡ listagem ⇒ zero ausentes. O mecanismo **vai** disparar de verdade, e com frequência. **Ponto cego declarado e contado:** RM com `data` NULL fica fora do recorte e nunca é avaliada — reportado em `detalhes` e no retorno (`espelho_sem_data`).

---

#### Como um cron é disparado neste projeto (05/08/2026)

> Não estava escrito em lugar nenhum, e custou três tentativas erradas de disparo do `sync-reqmat` antes de alguém abrir o código. Vale para **todo** sync do Hub, não só para este.

**1. A tela de Ferramentas cobre só 5 dos 9 jobs.** `sync_cron_trigger_now(p_job)` resolve por `_sync_cron_resolve`, que conhece **apenas** `'compras'`, `'nfe'` e `'intercompany'` (`raise exception 'Job desconhecido'` no resto); Despesas e DocFin têm RPC dedicada (`sync_cron_despesas_trigger_now`, `sync_cron_docfin_trigger_now`). **Laudos, produtos, lote e reqmat não têm tela** — e nunca tiveram.

**2. O caminho canônico é o SQL Editor:**
```sql
select public.call_sync_<job>_cron('manual_admin');
```
Existe uma `call_sync_*_cron` por job. Cada uma é `SECURITY DEFINER`, lê `sync_compras_cron_secret` do **Vault** (o mesmo `CRON_SECRET` para todos — não há secret por job) e faz `net.http_post` com o header `x-cron-secret`. **A chamada é assíncrona:** devolve o `request_id` do `pg_net`, **não** o resultado do sync. O resultado chega em `sync_runs` e em `net._http_response`.

**3. 🔴 Toda função de cron EXIGE `[functions.<nome>] verify_jwt = false` no `supabase/config.toml`.** Sem isso, o gateway do Supabase barra o `pg_net` — que **não manda JWT** — **antes** da função: o `CRON_SECRET` nunca é avaliado e o cron **nunca roda**, sem erro visível até alguém notar a fila parada. E `verify_jwt` é lido **no deploy**, não em runtime ⇒ **mudar o config.toml exige redeploy**. O próprio arquivo já carregava o aviso, escrito para o `notify-pedido-criador`: *"Declarado aqui para o deploy NÃO flipar verify_jwt=true e quebrar o cron jobid 21."*

**4. Taxonomia do 401 nas Edge Functions — o idioma diz quem recusou:**

| Resposta | Quem recusou | Causa |
|---|---|---|
| `UNAUTHORIZED_ASYMMETRIC_JWT` (inglês) | **gateway do Supabase** | falta `verify_jwt = false` no config.toml, ou o JWT enviado é inválido/expirado |
| `{"error":"Não autorizado"}` (português) | **gate `CRON_SECRET` dentro da função** | o `x-cron-secret` não veio, ou não bate com o secret do Vault |

**5. Chamada do browser morre no preflight** — a função não declara `apikey` em `Access-Control-Allow-Headers` (o `sync-laudos` também não). **Não é defeito:** cron não usa browser, e o `pg_net` é servidor-para-servidor, sem preflight.

---

**Ordem de aplicação (crítica, mesma lição da REC-3.0):** todo o SQL primeiro, deploy depois, **agendamento por último**. `LOAD_BATCH=60` / `LOAD_CHUNK=4` foram escolhidos **sem medição** do custo do `ReqMat/Load` (o `Laudo/Load` levava 1–3 s; o `MovEstq/Load` ~370 ms; o ReqMat traz 22 itens + lotes por RM) — o 1º disparo é que dá o número. Agendar antes de medir é convidar um cron que estoura o watchdog 4×/dia num gateway compartilhado com 100+ usuários. **→ MEDIDO em 05/08/2026: ~370 ms por `ReqMat/Load`, 679 RMs espelhadas, `total_erros = 0`.** O teto de 60 está folgado; a fila entrou em platô, como o desenho previa.

Janela definida pelo Pedro: **`15 12,15,18,21 * * 1-5`** (09:15/12:15/15:15/18:15 BRT) — 30 min depois de cada rodada do `sync-laudos`, mesma cadência, sem disputar o gateway.

**⚠ `sync_settings.schedule_cron` é NOT NULL e sem default** — e é **documental**: quem agenda é o `pg_cron`. As duas pontas (a linha da tabela e o `cron.schedule` comentado) têm de ser mantidas em sincronia, porque a tela de cron do Hub exibe a coluna como se fosse a verdade.

**Kill-switch — como se pausa de verdade (medido em 05/08/2026).** A RPC `sync_cron_pause` grava `enabled=false` + `paused_at` + `paused_by` + `paused_reason` **juntos**, e `sync_cron_resume` limpa os quatro; a tela calcula `isPaused = !enabled` e os 8 crons existentes leem só `enabled`. ⚠ Mas existe uma linha em estado que a RPC nunca produziria: `sync-compras-status-cron` com **`enabled=true` E `paused_at` de 26/05/2026** — e ele **roda normalmente** (50 execuções nos últimos 7 dias, `job_type='bicephalous'`), porque o código lê só `enabled`. Se a intenção de quem escreveu aquele `paused_at` era desligá-lo, **ele nunca esteve desligado**. Achado operacional, registrado e **não corrigido** (é cron compartilhado, fora do escopo desta tarefa). O `sync-reqmat` para por `enabled=false` **OU** `paused_at` preenchido — falha fechada, e o gatilho real vai para `sync_runs.observacao`.

---

### 10.16 — Receita de ESCRITA da RM (capturada do Network, 05/08/2026)

> 🔴 **RETIFICAÇÃO DE ROTA.** A Fase 2 **NÃO** usa `ReqMat/InserirAlterarRequisicaoMaterial` — o endpoint do swagger, que a §6.2 documentou em 23/07/2026 e que o BL-14 detalhou. **Quatro tentativas por ele falharam com `NullReferenceException` em `ReqMatRules.cs:277`, sem mensagem útil.** A tela do Alvo usa **outro** endpoint, e é esse que a Fase 2 usa. A §6.2 permanece como registro do que se sabia; o contrato vigente é este.

**1. CRIAR** — `POST ReqMat/SaveReqMat`, envelope `{ "Action": "Insert", "ClassObject": { … } }`

O `ClassObject` usa os nomes da **LEITURA** (`CodigoTipoReqMat`, `CodigoCentroCtrl`, `ItemReqMatChildList`, `CodigoProdUnidMed`) — **não** os do swagger. Isso desfaz a tradução de duas vias que o BL-14 previa: escrita e leitura falam a mesma língua neste endpoint.

São **22 campos no cabeçalho** e **15 no item**. O servidor preenche sozinho `Data`, `Operacao`, `DataValidade`, `Status` e `EspecieDocumento`.

- **Cabeçalho:** `CodigoEmpresaFilial`, `Numero` (`""`), `Descricao`, `CodigoTipoReqMat`, `CodigoFuncionario`, `CodigoCentroCtrl`, `CodigoLocArmaz`, `EspecieDocumento` (`"RM"`), `AlarmeValidade`, `Origem` (`"ManualAlvo"`), `TipoFormulario` (`"Normal"`), `IsEstorno` (`false`), `ExisteRetiradaDaTransferencia`, `ExisteTransferenciadaRetirada`, `CodigoFuncionarioAtendente`/`Devolveu`/`Recebeu` (null), `CodigoLocArmazDestino` (null), `DataRecebimento` (null), `MensagemRetorno` (`""`), `UploadIdentify` (`""`), `ItemReqMatChildList`.
- **Item:** `CodigoEmpresaFilial` (`""`), `NumeroReqMat` (`""`), `Sequencia`, `CodigoProduto`, `CodigoAlternativoProduto`, `CodigoProdUnidMed`, `PosicaoProdUnidMed`, `CodigoLocArmaz`, `QuantidadeProdUnidMedPrincipal`, `QuantidadeSaldoProdUnidMedPrincipal`, `QuantidadeEmpenharProdUnidMedPrincipal`, `Quantidade2`, `QuantidadeSaldo2`, `QuantidadeEmpenhar2`, `AvisoRetorno` (`""`).

⚠ **Placeholders do item no Insert são STRING VAZIA, não `-1`** — diferente do padrão do `DocFin/SavePartial` e do que a §6.2 registrou para o outro endpoint.
⚠ **`Numero: ""` funciona AQUI.** No `InserirAlterar` o mesmo valor causava `SqlException 156` (§6.2). O comportamento é do endpoint, não da entidade.

**2. CORRIGIR o `TipoAtendimento`** — `POST ReqMat/SaveReqMat` com `"Action": "Update"`, o mesmo `ClassObject` com `Numero` e `NumeroReqMat` preenchidos e `"TipoAtendimento": "Manual"`.

> 🔴 **PASSO OBRIGATÓRIO, não opcional.** A RM criada por API **nasce `Automático`** — provado na `0000002271` — e RM `Automático` **NUNCA atende**. Medido no universo de produção do ano (n=279): **13 `Automático` = 13 `Aberta`; 266 `Manual` = 0 aberta.** Sem este segundo passo, toda RM do Hub nasce morta: aberta para sempre, sem baixar estoque e **sem erro**.

O `Update` **aceita o campo** mesmo ele não estando em contrato nenhum (nem no swagger, nem no payload de Insert). Confirmado por `Load` independente no Lab.

**3. CONFIRMAR** — `GET ReqMat/Load?numero=X&loadChild=All`, verificando `TipoAtendimento = "Manual"`.

⇒ **Isto FECHA o BL-15.** E o `op_requisicoes` da OP-2.2 já cobre os três passos sem mudança nenhuma de schema: `status_envio` `pendente` → `enviado` (Insert devolveu `Numero`) → `confirmado` (Load confirmou `Manual`). O desenho de 04/08 sobreviveu ao contato com o endpoint real.

---

### 10.17 — Fluxo de ATENDIMENTO no Alvo (mapeado em campo, 05/08/2026)

Tela: módulo RM → ação **"Atendimento"** (modal). Dois endpoints, **nesta ordem**:

```
POST ReqMat/ValidarAtendimento   →   POST ReqMat/FinalizarAtendimento
```

Ambos recebem o objeto ReqMat **INTEIRO** (103 campos), **sem** o envelope `Action`/`ClassObject` do `SaveReqMat`. O `Finalizar` devolve `{ AtendimentoRealizado: bool, ReqMat: {…}, Messages: [] }`.

- **A quantidade atendida é DIGITADA por item** (campo editável). **Nada impede digitar mais que o pedido** ⇒ é a origem do `QuantidadeAtendidaMaior` (§10.4: +47 e +121 na `2251`). O excedente não é anomalia de sistema, é digitação.
- **`CodigoTipoLanc = E0000023`** (SAIDA BAIXA REQUISICAO DE MATERIAL) é aplicado **pelo servidor** no atendimento, não escolhido na tela. Por isso é `null` nas RMs abertas — e por isso a coluna só se preenche via `ReqMat/Load`, nunca pela listagem.
- 🔴 **`CodigoFuncionarioAtendente` NÃO É EDITÁVEL e NÃO é quem atendeu.** Na `2271`, atendida pelo Pedro, veio **`0000165 - Maria Alves`** — provável padrão do local `001`. **Quem executou está em `CodigoUsuario`.** Qualquer relatório de "quem atendeu" construído sobre esse campo mede a coisa errada. Entra na lista de campos que enganam (§6.3-J).
- No payload do `Finalizar`, `Status` ainda vem `"Aberta"` e `BaixouEstoque` `"Não"` — **quem muda é o servidor**. O recálculo para `"Atendida Total"` só aparece **na releitura**, o que confirma o desenho do passo B do sync.
- A seção **"Separação"** existe e é **OPCIONAL** (ficou vazia no teste). Os campos de **Entrega** (Funcionário Entregou / Retirou / Conferiu) **são editáveis** e dariam rastreabilidade real de pessoas — hoje não preenchidos, e é o que explica os 13/71 sem registro de custódia da sessão de 31/07.

---

### 10.18 — Ciclo completo validado (RM `0000002271`, 05/08/2026)

Espécime: **`001.004.00021`** (SAPÓLIO CREMOSO 250ML), 1 UNID, local `001`, `ControlaLote = "Não"`.

| Etapa | Como | Resultado |
|---|---|---|
| Criar | `SaveReqMat` `Insert` | nasce **`Automático`** |
| Corrigir | `SaveReqMat` `Update` | vira **`Manual`** (confirmado por `Load` no Lab) |
| Atender | `ValidarAtendimento` + `FinalizarAtendimento` | **`Atendida Total`**, `BaixouEstoque = Sim` |
| Estoque | `FiltrarSaldoProduto` | **31 → 30** |
| Espelhar | `sync-reqmat` | automático, sem intervenção |
| Sair da fila | coluna gerada | `precisa_releitura` = **false** |

⇒ Prova a cadeia inteira: escrita no Alvo → atendimento → baixa real de estoque → espelho → fila. E **valida a expressão STORED da OP-2.2 com um caso terminal real** — a última linha é a confirmação empírica de que `'Atendida Total'` é mesmo o literal terminal, que em 04/08 era só hipótese.

⚠ **A RM `0000002271` tem baixa de estoque e permanece em produção** até ser deletada ou estornada. Não é lixo de teste inerte: mexeu no saldo. Ver **BL-22** (limpeza das cinco RMs de teste).

---

### 10.19 — Receita de ATENDIMENTO por API (05/08/2026)

> 🔴 **Isto NÃO estava previsto.** A §6.1-1 decidiu que o atendimento fica com o almoxarifado, no Alvo, e a Fase 2 nasceu **sem rota de atender**. Essa continua sendo a decisão de **PROCESSO** — mas agora está provado que é **tecnicamente possível pelo Hub**. Deixar o atendimento no Alvo passa a ser **escolha, não limitação**.

**DOIS PASSOS, nesta ordem:**

1. **`POST ReqMat/ValidarAtendimento`** — objeto ReqMat **INTEIRO** (103 campos), **SEM** o envelope `Action`/`ClassObject` (diferente do `SaveReqMat`, §10.16). Devolve o objeto **carimbado**.
2. **`POST ReqMat/FinalizarAtendimento`** — **o MESMO objeto que o Validar devolveu**, sem alteração. Devolve `{ AtendimentoRealizado: bool, ReqMat: {…}, Messages: [] }`.

**Gabarito confirmado:** o payload do `Finalizar` capturado da tela ainda diz `Status = "Aberta"`, `BaixouEstoque = "Não"` e `TipoAtendimento = "Automático"` — **quem muda tudo é o SERVIDOR**. Não tentar "corrigir" esses campos no payload: o gabarito é o que o `Validar` devolveu.

**O que o cabeçalho precisa ter para o atendimento:**
`CodigoTipoLanc = "E0000023"` · `CodigoFuncionarioAtendente = "0000165"` · `DataEntrega` · `DataConferencia` · `DataRecebimento` · e, **opcionalmente**, `CodigoFuncionarioEntregou` / `Retirou` / `Conferiu` (ver §10.20 e a retificação na §6.3-N — são estes que carregam a rastreabilidade real de pessoas).

**No item:** `QuantidadeAtendida*` preenchida, `QuantidadeSaldo*` ajustada, `DataAtendimento`.

**PROVADO na RM `0000002273`** (2 galões + 1 sapólio), **sem tocar a tela do Alvo**: `Status` → `"Atendida Total"`, `BaixouEstoque` → `"Sim"`, estoque **6 → 4** galões.

---

### 10.20 — Genealogia de LOTE (05/08/2026)

Produto com **`ControlaLote = "Sim"` EXIGE indicar o lote** no atendimento. Produto com `"Não"` (ex.: `001.004.00021`, sapólio) **não abre seleção nenhuma**.

**Estrutura.** A `CtrlLoteItemReqMatChildList` do item recebe **UMA LINHA POR LOTE**:
`CodigoEmpresaFilial` · `CodigoProduto` · `NumeroReqMat` · `SequenciaItemReqMat` · `CodigoLocArmaz` · `NumeroCtrlLote` · `DataValidadeCtrlLote` · **`QuantidadeProdUnidMedPrincipal`** (a parte DESTE lote) · `Operacao = "Saída"` · `CodigoProdUnidMed` · `PosicaoProdUnidMed` · `Quantidade2` · `QuantidadeUnidadeItem` · `QuantidadeBruta`.

> 🔴 **REGRA DE FECHAMENTO:** a soma de `QuantidadeProdUnidMedPrincipal` dos lotes tem de bater **EXATAMENTE** com a quantidade atendida do item. O modal do Alvo mostra `Quantidade Item / Quantidade Utilizada / Diferença` e **não deixa salvar com diferença ≠ 0**.

⚠ No modal, **"Quantidade Item" é a quantidade que se está ATENDENDO AGORA**, não a do item da RM. Em atendimento parcial de 4 sobre 10 pedidos, o campo tem de ser mudado para 4.

⚠ **NÃO SOMAR `QuantidadeBruta`.** Ela **não** é a quantidade do lote e seu significado **não está fechado**: RM `2275` (1 galão atendido, 1 lote) → `QuantidadeBruta = 5`; RM `2272` (4 galões, 2 lotes) → **4 em ambas as linhas**. A hipótese de "quantidade na unidade secundária" (1 galão = 5 litros, `Peso = 1` + `PesoFatorDivisor = "Fator"`) explica a `2275` e **NÃO** explica a `2272`. ⇒ Usar **SEMPRE** `QuantidadeProdUnidMedPrincipal`. **Quem somar `QuantidadeBruta` conta errado.**

**FEFO é MANUAL.** A tela "Seleção Lote (Saída)" lista os lotes com saldo (nº, validade, `Saldo Calc`, `Saldo`), com checkbox e quantidade editável por linha, **sem sugestão automática**. Na `2272`, o rateio 1 (lote `0002311`, val. 17/12/2027) + 3 (lote `0002312`, val. 02/03/2028) foi **escolha da pessoa**. ⇒ **Oportunidade para o Hub: pré-preencher FEFO por validade.** (Refina a §6.3-G e a §6.2/Resolvidas, que registraram FEFO como praticado — o que não se sabia é que é praticado *à mão*.)

**Rateio entre lotes funciona por API:** RM `2273`, 1 galão do `0002312` + 1 do `0002696`, montado à mão e aceito.

**Item não atendido tem ZERO lotes** — a lista de lotes é escrita **no atendimento**, não na criação. ⇒ Retifica a leitura errada de 4 RMs abertas com lote: são **4 em 316**, anedota e não padrão; investigar só se voltar a aparecer.

---

### 10.21 — O que a TELA do Hub precisa (derivado dos testes de 05/08)

**Modal "Nova Requisição de Material".**

- **Do usuário:** OP (dropdown **obrigatório**), grade de produtos + quantidades, observação.
- **Preenchido pelo Hub:** `CodigoFuncionario` (via de-para), `CodigoTipoReqMat = "0000002"`, `CodigoLocArmaz`, `Numero = ""`, placeholders `""` no item, e as quantidades espelhadas (`Quantidade2` / `QuantidadeSaldo*` / `QuantidadeEmpenhar*` = a pedida).
- ⚠ **`CodigoCentroCtrl` é ESCOLHA DO USUÁRIO** — ver a retificação na §6.3-N. Dropdown, ou fixado por pessoa no perfil. **Isto muda o desenho:** a §10.9 tratava o centro como derivado do funcionário.
- ⚠ **Risco conhecido:** `CodigoProdUnidMed` tem de casar com o cadastro. A família `001.003` tem divergência de unidade documentada (§9.8) — **é onde se espera o primeiro erro em produção**.

**Modal de atendimento** (se e quando o atendimento vier para o Hub): grade de lotes com nº, validade e saldo, **ordenada por validade**; quantidade editável por linha; contador **Pedido / Alocado / Diferença** com a confirmação **travada até zerar** (é a regra de fechamento da §10.20, reproduzida do lado de cá).

> 🔴 **VALIDAR NO HUB ANTES DE ENVIAR.** O Alvo responde `NullReferenceException` **sem dizer qual campo falta** (§6.3-N). Quatro tentativas foram perdidas assim em 05/08. O Hub deve conferir, antes do POST: soma dos lotes = quantidade atendida · quantidade ≤ saldo do lote · unidade válida · funcionário com de-para. **Erro de usuário não pode virar exceção de ERP.**

---

### 10.22 — Escopo decidido da tela de RM (05/08/2026)

**Local no menu:** `Produção > RM` — a entrada **não existe ainda**; será criada.

**Tipo de RM: SOMENTE `0000002` (REQUISIÇÃO PRODUÇÃO).** É o único que representa material saindo do estoque **para uma OP**. Medição do ano de 2026 (679 RMs):

| Tipo | Nome | RMs | Destino |
|---|---|---|---|
| `0000002` | REQUISIÇÃO PRODUÇÃO | 279 | **módulo Produção** |
| `0000004` | SAÍDA MATERIAL DE CONSUMO | 357 | Estoques (futuro) |
| `0000005` | Baixa / Ajuste de inventário | 35 | Estoques (futuro) |
| `null` | sem tipo | 8 | ruído — ver abaixo |

⚠ **`0000005` NÃO é Devolução.** A §6.1-3 procurava o código da devolução desde julho — **não é este**. É baixa administrativa: das 35, **26 são "AJUSTE DE INVENTARIO RETROATIVO" de 28/02/2026** (usuários LUANA e RIOSOFT — evento único, provável virada/implantação), 5 são baixa de vencidos (PEDRO.GOBE), 2 ajustes (ADM), 1 "TESTE" (RIOSOFT) e 1 avulsa. **Nenhuma menciona OP e nenhuma é de qualidade.**

⇒ **A hipótese de que a reprova da Qualidade teria lastro nativo no Alvo NÃO se confirma.** Pergunta em aberto: quando a Qualidade reprova material de uma OP, **em qual tipo ela lança?** Se não usa RM, a **Fase 3 registra no Hub** — como o princípio §1-2 (ledger imutável, correção por estorno) já previa.

⚠ As **8 sem tipo** foram inspecionadas uma a uma: ajustes do ADM (jan/2026), 1 transferência de produto, "insumos logistica" e "CUSTO NEGATIVO - AGUA LABORATORIO". **Nenhuma é de produção** ⇒ o filtro `codigo_tipo_req_mat = '0000002'` **não perde nada relevante**. (Confirma a decisão da §10.4 e do `comment on` da coluna: o espelho guarda os quatro, quem filtra é quem consome.)

**Escopo da 1ª versão: LEITURA + CRIAÇÃO.** O **atendimento fica de fora** — depende do BL-21 (endpoint de lotes) e contraria a §6.1-1. A criação nasce com `CodigoTipoReqMat = "0000002"` **FIXO**; o Hub não oferece escolha de tipo.
*(Registrar para não se perder: a criação por API **aceita qualquer tipo** — se Estoques ganhar tela de saída de consumo, é o mesmo endpoint da §10.16 com `0000004`.)*

**Quem requisita hoje** (279 RMs tipo `0000002`, ano 2026):

| Usuário | RMs |
|---|---|
| MARIA.EDUARDA | **246 (88%)** |
| RYAN.PAGANOTTO | 16 |
| CAIO.RAFAEL | 10 |
| GUILHERME.LUCAS | 6 (parou em jan) |
| ADM | 1 |
| PEDRO.SCRIGNOLI | 1 (teste de hoje) |

⇒ **A tela é desenhada para uma pessoa.** Vale validar o desenho **com ela** antes de construir.
⇒ ⚠ **Risco de continuidade:** com o Alvo bloqueado para os demais, a requisição vira **ponto único de falha**.

**Decisões ainda ABERTAS** (não travam a tela — hoje só o Pedro usa):

1. **Quem abre OP no Hub** (PCP? produção? qualidade?) — define se `gestor_producao` vai para uma pessoa ou um time.
2. **Quem atende no almoxarifado** — os dados **não dizem**: o `CodigoFuncionarioAtendente` é sempre `0000165 - Maria Alves`, padrão do local `001` (§6.3-N). É uma das nove perguntas do almoxarifado (§8.2 do relatório de 31/07).
3. **Se a RM precisa da distinção `view_own`/`view_all`.** No chão de fábrica a RM **não** é documento privado como a requisição de compra — provavelmente não precisa.

---

### 10.23 — Permissões: estado medido e proposta (05/08/2026)

O módulo `producao` **existe** no RBAC, com **3 permissões** — `producao.access`, `producao.ordens.create`, `producao.ordens.manage` — e **2 papéis**: `gestor_producao` (as 3) e `operador_producao` (as 2 primeiras).

⚠ **Nenhuma permissão de Requisição de Material.** A RLS das tabelas `op_reqmat*` (OP-2.2) usa `producao.access` — o **gate de módulo**, não um gate próprio.

> 🔴 **DOIS ACHADOS QUE BLOQUEIAM O PILOTO:**
> 1. **Ninguém tem `gestor_producao` nem `operador_producao`** — **zero atribuições** em 52 usuários ativos.
> 2. **`producao.access` é órfã do papel `admin`.** O papel concede **42 de 55** permissões; as 13 não mapeadas são as 4 de `cartao`, as **3 de `producao`**, 5 de `compras` (`cadastros.sync`, `nfe.access`, `nfe.create`, `nfe.lancar`, `pedidos.view_own`) e `intercompany.master.download_pdf` — **todas criadas DEPOIS do papel**.

⇒ **Só quem tem `profiles.is_admin = true` enxerga o módulo Produção — hoje, uma pessoa.**

⇒ 🔴 **Isto provavelmente explica por que `op_ordens` tem apenas 2 registros.** A Fase 1 foi entregue, validada e publicada em 23/07 — mas **ninguém do chão de fábrica consegue abrir a tela**. **Não é falta de adesão: é falta de atribuição de papel.** ⇒ **Atribuir os papéis é pré-requisito do piloto, e vem ANTES de construir tela nova.**

⇒ Mesmo padrão em NF-e: `analista_fiscal` existe, concede `compras.nfe.lancar`, e tem **zero** usuários.

⚠ **Pedro é o único `is_admin`** ⇒ ele vê tudo por bypass e **erro de permissão não aparece para ele**. **Toda tela nova precisa ser testada com usuário sem a flag** — foi exatamente o que a OP-1.6 fez com `nfe@pfbrazil.com` para provar o gate real, e o motivo de aquilo ter valido a pena.

**Permissões PROPOSTAS para RM** (padrão `modulo.recurso.acao`, molde de `compras.requisicoes`):
`producao.rm.access` · `producao.rm.create` · `producao.rm.view_all` · `producao.rm.view_own` · `producao.rm.atender` (futuro).

Mapeamento sugerido:

| Papel | Permissões |
|---|---|
| `gestor_producao` | access + view_all + create |
| `operador_producao` | access + view_own + create |
| `almoxarife` (novo) | access + view_all + atender |

⚠ **Ao criar permissão nova, mapeá-la TAMBÉM ao papel `admin`** — senão nasce com o mesmo defeito das 13 órfãs, e o bug se repete na próxima tela.

> Detalhamento completo do RBAC no relatório `Permissoes_e_Roles_v2.md` (medido em 05/08/2026: 12 papéis, 55 permissões). ⚠ **Pegadinha de JOIN registrada lá:** `hub_user_roles.user_id` casa com **`profiles.user_id`**, não com `profiles.id`.

---

## 11. Ponto de retomada — 06/08/2026

**Feito em 05/08:** OP-2.2 aplicada · OP-2.3 no ar (**679 espelhados, 0 erros, ~370 ms/Load**) · **ciclo completo provado por API** (criar → corrigir → atender → ratear lote) · escopo da tela fechado · RBAC medido.

**Próximo passo: construir `Produção > RM` (leitura + criação).** Antes dela, **nesta ordem**:

1. ✅ **FEITO (06/08/2026)** — permissões `producao.*` mapeadas ao papel `admin` (§10.23).
2. ✅ **FEITO (06/08/2026)** — `producao.rm.access` / `producao.rm.create` / `producao.rm.atender` criadas e mapeadas (as duas primeiras a `admin` + `gestor_producao` + `operador_producao`; `atender` só a `admin`).
3. ✅ **FEITO (06/08/2026)** — papéis atribuídos: `operador_producao` para **maria.santos@** (func. `0000098`) e **ryan.santos@** (func. `0000063`). Duas atribuições ativas; a de `nfe@` segue revogada desde 23/07.
4. ⏳ **Alguém precisa abrir OP real no Hub.** `op_ordens` tem 2 registros (`2026-0501` ABERTA, `2026-0502` RASCUNHO); **sem OP, o dropdown da tela de criação nasce com uma única opção** — e a OP obrigatória é a regra fundadora da Fase 2 (§10.1). **A tela de LEITURA não depende disso** (lê o espelho, não o livro).

## 11.1 — Estado em 06/08/2026 (pós OP-2.4 · leitura)

**Entregue e no preview, aguardando validação + Publish:** `Produção > RM` de leitura — fila (filtros na URL, server-side, paginada, toggle lista/cards), detalhe por número (itens + lotes) e consolidado de material na tela da OP. Detalhe em §2 (linha OP-2.4) e no diário.

**Pendências desta entrega, nesta ordem:**

1. **Pedro aplica `sql/OP-2.4.sql`** (RLS ampliada). Hoje é no-op — as duas permissões estão nos mesmos papéis —, então a tela funciona antes disso; aplicar é o que evita a falha silenciosa quando surgir o primeiro papel assimétrico (ex.: `almoxarife`).
2. **Validar com usuário SEM `is_admin`.** Pedro é o único admin e **erro de permissão não aparece para ele** — a lição da OP-1.6 com `nfe@pfbrazil.com`. Candidatas naturais: maria.santos@ e ryan.santos@, que já têm o papel.
3. **Publish manual no Lovable.**
4. **Validar o desenho com MARIA.EDUARDA** antes da Parte 3 — ela abriu 246 das 280 RMs de produção do ano (88%). Vale sobretudo o campo Funcionário, que a medição de 06/08 mostrou que o plano descrevia errado.

**Parte 3 (criação) — o que já se sabe que falta, e nenhum item é de tela:**

- **RPC de escrita** gateada por `producao.rm.create`: não há policy de INSERT em `op_requisicoes` nem função de escrita. A linha do livro nasce **antes** do POST (§10.14).
- **`ReqMat/SaveReqMat` na whitelist do `erp-proxy`** (repo separado): hoje a whitelist tem só `reqMat/GetListForComponents` e `ReqMat/Load` (OP-2.1) ⇒ a criação responde **403 do proxy**.
- **Medir o que o Alvo grava em `Origem`** quando o Hub cria (ver o alerta no fim do diário de 06/08).
- **Resolver `CodigoProdUnidMed`** para os ~4% de itens em unidade de posição ≠ 1.

**Em aberto, sem bloquear:**

- **BL-21** — endpoint de lotes disponíveis; pré-requisito **só do atendimento**, não da criação.
- **BL-22** — ✅ **as 5 RMs de teste FORAM estornadas e excluídas em 05/08**, confirmado por `412` no `Load` das cinco. ⚠ **Falta 1 galão de `001.003.00032` (11 → 10)**: oito dos nove estornaram — indício de que **o estorno pode não devolver tudo**, o que é relevante para a Fase 3.
- **BL-23** — valorização / custo negativo (41 produtos). Frente própria de Controller.
- **As nove perguntas do almoxarifado** (§8.2 do relatório de 31/07), entre elas quem realmente atende.
- **Descomentar o agendamento do cron** (§10.15) — a medição do 1º disparo já existe; falta a decisão.
