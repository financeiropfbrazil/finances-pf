# DISCOVERY-REQ-EMAIL-IA.md — Requisição de compra por e-mail, analisada por IA e lançada via MCP

> **Natureza:** discovery em **leitura pura**, sem prompt registrado no plano.
> Nada foi aplicado em banco, gateway, Edge Functions ou frontend.
> **Data:** 26/10/2026.
> **Módulo:** Suprimentos (requisições). Ver `PLANO-PEDIDOS.md` e a §36 de `Requisicoes_e_Compras.md`.
>
> **Pré-voo:** remote `financeiropfbrazil/finances-pf`. Supabase confirmado por fingerprint: `tabelas_modulo=3`, `total_pedidos=2.348`, `total_requisicoes=559` — `hbtggrbauguukewiknew`. Todas as consultas foram `SELECT`. O erp-proxy foi lido num clone raso (`cf1bed7`), só leitura.
>
> **Pedido do usuário:** "criar um e-mail que recebe uma solicitação. Uma IA analisa e, conectada ao Financial Hub via MCP, lança a requisição completa, com rateio de centros de custo etc."

---

## 1. Resumo executivo

**É viável, e boa parte das peças já existe.** Mas a frase "a IA lança a requisição no Alvo" precisa mudar.

1. **A IA não deve enviar nada ao Alvo.** Desde 07/09 o caminho de envio exige aprovação de todos os CCs:
   - `/req-comp/insert` responde 409;
   - `/req-comp/enviar-aprovada` exige usuário do Financial Hub e recusa sem aprovação completa.

   Isso é decisão do Pedro (regras R1–R9 da §0 do `PLANO-RATEIO-CC-REQUISICOES.md` e entrega multi-CC de 07/09), não um obstáculo técnico. O papel da IA é **montar o rascunho completo no Hub**. A partir daí, o rascunho segue o caminho que já existe e funciona: requisitante revisa e submete, líderes aprovam, o gateway envia.
2. **O que não existe hoje:**
   - receptor de e-mail;
   - criação de requisição pelo servidor (todas as RPCs de rascunho dependem de `auth.uid()`);
   - MCP com escrita no Financial Hub. O `suprimentos-mcp` tem 4 ferramentas, todas de leitura.
3. **O ponto mais delicado é identidade, não IA.** Quem é o requisitante? Só pode vir de um remetente com autenticidade verificada. Nunca do texto do e-mail nem de um parâmetro escolhido pelo modelo.
4. **Recomendação:** começar em **modo sombra**: a IA propõe, ninguém grava, e a proposta é medida contra o que a operação de fato lançou. Só depois liberar rascunho real, sempre com confirmação humana.

---

## 2. O que já existe e é reaproveitável

| Peça | Onde | Serve para |
|---|---|---|
| Envio server-side da requisição aprovada | erp-proxy `src/routes/req-aprovada.ts` + `req-aprovada-payload.ts`; RPCs `iniciar_envio_requisicao` / `concluir_envio_requisicao` | O fim do fluxo. Já monta `ReqCompClasseRecDespChildList` com `RateioReqCompChildList` e o CC por item. **Nada muda aqui.** |
| Gate de aprovação por todos os CCs | `submeter_requisicao`, `aprovar_requisicao`, `compras_requisicoes_aprovacao_grupos`. Janela `compras_requisicoes_janela` em `aberta` desde 07/09 | Controle humano depois da IA. 143 requisições já passaram pelo gate; 24 com mais de um CC. |
| Validação de unidade (Fator, posição, peso) | erp-proxy `src/routes/req-unidades.ts` (`unidadesProduto`, `validarItemCadastro`); `supabase/functions/_shared/requisicao-unidades.ts` | A mesma regra que a tela usa. A ferramenta MCP deve chamar **esta** função, sem reescrever. |
| Rateio de CC (classe → CCs → %) | `req_replace_rateio` (service_role), `compras_requisicoes_rateio_classes` / `_rateio_cc` | Gravar o rateio do rascunho. |
| Molde de servidor MCP no gateway | `suprimentos-mcp.ts`, `estoque-mcp.ts`, `mcp-auth.ts` | JSON-RPC Streamable HTTP já em produção. |
| Molde de MCP com escrita, papéis e prévia | repo `estoque`: `supabase/functions/estoque-mcp` (OAuth Supabase, ferramentas por papel, `simular=true`, origem `'conector'`) | O desenho certo para as ferramentas de escrita. |
| IA (Anthropic) em Edge, com PDF e JSON | `nfse-ler-boleto` (Opus 5.5, SDK, saída por esquema); `extrair-nfe` (Sonnet 4.6, `fetch`). O segredo `ANTHROPIC_API_KEY` já existe | Padrão "a IA lê, a regra confere" (`nfse-ler-boleto/boleto.ts:2`). |
| E-mail de saída | Resend, `noreply@notificapfbr.com.br` (domínio verificado) | Recibo e aviso ao requisitante. |
| Precedente de e-mail de entrada | Edge `process-email-nfe` + tabela `email_notas_fiscais` (alimentada por um roteador externo, Rota 1/Rota 2) | **Atenção: parou em 13/05/2026** (23 linhas, zero desde então) e ninguém percebeu. Lição na §7, R6. |

## 3. O que falta (lacunas)

| Lacuna | Evidência |
|---|---|
| Receber e-mail | Nenhum código de inbound no repo. O único precedente é externo e está parado. |
| Criar rascunho sem navegador | `finalizar_rascunho_requisicao`, `salvar_rateio_requisicao` e `submeter_requisicao` exigem `auth.uid()`. Com service_role devolvem `SEM_PERMISSAO`. Hoje `criarRequisicao` só roda no navegador (`requisicoesService.ts:247-395`). |
| Identidade de "sistema em nome de" | `/req-comp/enviar-aprovada` recusa `source:"system"` (403). Correto: não deve mudar. |
| MCP de requisições com escrita | `suprimentos-mcp` só lê. Além disso, `tools/list` responde **sem autenticação** e não há metadados OAuth. |
| Coluna de origem | `compras_requisicoes` não tem `origem_criacao` nem ligação com uma mensagem de e-mail. |

## 4. Números que dimensionam (90 dias, medidos em 26/10/2026)

- **Volume:** 303 requisições, 280 criadas no Hub, cerca de 100/mês ou ~5 por dia útil. São 41 requisitantes distintos e 31 CCs.
- **Itens:** média de **1,31** por requisição; 99 de 394 itens são serviço. **O caso típico é simples.**
- **Finalidade:**

  | Finalidade | Requisições |
  |---|---|
  | Prestação de serviço | 129 |
  | Estoque | 59 |
  | Material de escritório | 44 |
  | Serviço de análise | 33 |
  | Manutenção | 29 |
  | Outras | 9 |

- **"Rateio", na prática, tem três sentidos.** Detalhe na §6.
  - **Classe por item:** 280 de 303 requisições.
  - **CC por item divergente do cabeçalho:** 24 requisições com mais de um grupo de aprovação.
  - **Rateio percentual por CC no cabeçalho:** **1 requisição** desde 08/09.
- **Remetentes possíveis:** 72 perfis no Hub (68 `@pfbrazil.com`, 3 `@productsandfeatures.com`, 1 gmail), 65 com `funcionario_alvo_codigo`.
- **Login no Alvo:** só 6 perfis têm `alvo_usuario`. **66 envios nos últimos 30 dias** saíram com o login provisório `PEDRO.SCRIGNOLI` (evento `login_servico_provisorio`). Problema independente desta frente; a automação não piora nem resolve.
- **CNPJ sugerido:** 88 requisições informaram `cnpj_sugestao_requisicao`. O campo é gravado no Hub, mas **não vai ao Alvo**.

---

## 5. Arquitetura proposta

```
 remetente @pfbrazil.com
        │  e-mail (texto + até 3 anexos: orçamento, foto, especificação)
        ▼
 [1] Recepção ─ Edge receber-requisicao-email  (webhook do provedor, assinatura verificada)
        │  confere autenticidade + remetente cadastrado + idempotência por Message-ID
        │  grava compras_req_email_inbox + anexos no Storage → recibo ao remetente
        ▼
 [2] Agente IA ─ Edge processar-requisicao-email  (Claude, assíncrono)
        │  etapa A: lê e-mail + PDFs → extração estruturada (o que se pede, por quê, para quando)
        │  etapa B: resolve no Hub via MCP (produto, unidade, CC, classe, finalidade)
        │           usa como credencial um TOKEN DE DELEGAÇÃO amarrado àquele e-mail
        ▼
 [3] MCP ─ erp-proxy /requisicoes-mcp  (ferramentas de leitura + criar_rascunho com simular)
        │  toda escrita passa por RPC service_role que deriva o requisitante DO E-MAIL, não do modelo
        ▼
 [4] Rascunho no Hub ─ compras_requisicoes (status 'rascunho', origem 'email_ia', pendências marcadas)
        │  aviso ao requisitante: "revise e envie" + link
        ▼
 [5] Fluxo atual, sem mudança: requisitante SUBMETE → líderes de cada CC aprovam → gateway envia ao Alvo
```

### 5.1 Recepção do e-mail

- **Recomendação:** endereço próprio no domínio já verificado no Resend, como `requisicoes@notificapfbr.com.br`, com recebimento (inbound) pelo Resend e webhook assinado para a Edge.
  - Enviar direto para esse endereço preserva a avaliação SPF/DKIM/DMARC do `pfbrazil.com`.
  - Um apelido `requisicoes@pfbrazil.com` com encaminhamento pode vir depois. Encaminhamento costuma quebrar o SPF, então a conferência teria de usar DKIM ou ARC.
  - **Não verificado:** o provedor do `pfbrazil.com` (M365 ou Google) e a configuração de MX/inbound do subdomínio. A consulta DNS foi bloqueada neste ambiente.
- **Não recomendado:** roteador externo (Make/n8n) lendo caixa postal. É o desenho do `process-email-nfe`, que morreu em silêncio em maio.
- **A Edge não chama a IA na mesma requisição.** Ela grava a mensagem, responde 200 ao provedor e enfileira (molde: `receber-chaves-nfe`, `verify_jwt=false` + segredo/assinatura).

### 5.2 Identidade e autorização: a regra central

- **O requisitante é o remetente autenticado:**
  - DMARC/DKIM aprovado;
  - domínio `pfbrazil.com` ou `productsandfeatures.com`;
  - `profiles` ativo, com `user_id`, `funcionario_alvo_codigo` e a permissão `compras.requisicoes.create`.

  Fora disso, a mensagem é registrada como `recusada_remetente`, com resposta educada, e **a IA nem roda**.
- **Token de delegação.** A Edge gera um token opaco e aleatório **por e-mail recebido**: guarda só o hash, validade de cerca de 30 min, escopo `req_email:<inbound_id>`. Esse token é a credencial que o agente apresenta ao MCP.
  - Toda ferramenta resolve o token para `(inbound_id, requisitante_user_id)` **no servidor**.
  - O modelo **não tem parâmetro** para escolher em nome de quem cria.
  - Um e-mail que diga "crie em nome do diretor" não tem como ser obedecido.
- **Nada de credencial de usuário no robô.** Sem senha, sem JWT de alguém e sem `X-System-Secret` exposto ao modelo.

### 5.3 Agente IA

- **Modelo:** `claude-opus-5-5`, o mesmo do `nfse-ler-boleto`. Com `thinking` adaptativo (no Opus 5.5 não pode ser desligado) e `effort` explícito, começando em `medium`.
  - Ativar o `fallbacks` do servidor para recusas.
  - Custo estimado (não medido) da ordem de **US$ 0,30–0,60 por requisição**, cerca de **US$ 30–60/mês** no volume atual.
- **Etapa A — extração:** uma chamada com o corpo do e-mail e os PDFs como blocos `document`, com saída estruturada (`output_config.format`). Cada campo vem com a **citação do trecho** de onde saiu e uma lista de **pendências** (o que faltou ou ficou ambíguo).
- **Etapa B — resolução e rascunho:** uma chamada com o **conector MCP** da API:
  - `mcp_servers` apontando para `https://erp-proxy.onrender.com/requisicoes-mcp`, com `authorization_token` = token de delegação;
  - mais `tools: [{type: "mcp_toolset", ...}]`, beta `mcp-client-2025-11-20`.

  O modelo busca produto, unidade, CC e classe, chama `criar_rascunho` com `simular=true`, corrige o que a validação recusar e só então grava.
- **Duas chamadas** reduzem o risco do limite de tempo da Edge. Se ainda assim estourar, a etapa B migra para uma rota do erp-proxy (Node no Render, sem esse limite). Decisão D-5.
- **Proteção contra injeção de prompt.** E-mail e anexos são **dados**: um orçamento de fornecedor encaminhado pode conter texto hostil. A contenção é estrutural:
  - não existe ferramenta de submeter, aprovar ou enviar;
  - um único rascunho por e-mail;
  - toda escrita revalidada por RPC;
  - remetente amarrado no servidor.

### 5.4 MCP `requisicoes-mcp` (erp-proxy, roteador novo)

O `suprimentos-mcp` continua como está, só leitura e consumido pelo worker do "Prédio Financeiro". O roteador fica no gateway porque a validação de unidade precisa de `Produto/Load`, e o gateway já tem o token do Alvo e o `validarItemCadastro`.

| Ferramenta | Tipo | Faz |
|---|---|---|
| `req_contexto` | leitura | Requisitante resolvido pelo token: nome, funcionário, CC padrão, se lidera algum CC, últimas requisições (produtos, CC, classe, finalidade). **É o que mais aumenta o acerto:** as pessoas repetem o que pedem. |
| `req_buscar_produtos` | leitura | `stock_products` ativo por nome, código, código alternativo ou reduzido, com o escape `[,()]` que o `ProductCombobox` já precisou. |
| `req_unidades_produto` | leitura | Unidades válidas para compra (Fator, posição, peso), pela mesma função do gateway. |
| `req_listar_ccs` / `req_listar_classes` / `req_finalidades` | leitura | `cost_centers` (folha, ativo); `classes_rec_desp` (grupo F, Débito, ativa); as 7 finalidades fixas da tela. |
| `req_criar_rascunho` | **escrita** | `simular=true` devolve prévia e erros, sem gravar. Sem `simular`, grava pela RPC nova (§5.5). É idempotente: o mesmo e-mail nunca gera dois rascunhos. |

**Autenticação:** token de delegação em **todos** os métodos, inclusive `tools/list`. Se um dia o mesmo MCP for oferecido a pessoas pelo Claude ou pelo IA Hub, o caminho é OAuth por usuário, no molde do `estoque-mcp`, com ferramentas por papel e auditoria de origem. É um segundo modo de entrada, não este.

### 5.5 Banco (DDL a desenhar no plano, nada aplicado)

- `compras_req_email_inbox`:
  - `id`, `message_id` (UNIQUE), `remetente`, `remetente_user_id`, `autenticacao` (spf/dkim/dmarc), `assunto`, `corpo_texto`, `recebido_em`;
  - `status` (recebido → recusado_remetente | processando → proposta | rascunho_criado | erro), `proposta` jsonb, `pendencias` jsonb, `requisicao_id`;
  - `token_hash`, `token_expira_em`, `tentativas`, `erro`.
- `compras_req_email_anexos`: caminho no Storage (bucket próprio) e SHA-256.
- `compras_requisicoes.origem_criacao` (`'hub'` padrão | `'email_ia'`) e `inbound_id`. **Ler antes de escrever:** confirmar triggers (`fn_req_congelar_conteudo`, `req_completar_cabecalho`, `req_janela_guard`) para não colidir.
- **RPC `req_email_criar_rascunho(p_token, p_payload, p_simular)`:**
  - SECURITY DEFINER, `EXECUTE` só para service_role, com `revoke ... from anon` pela assinatura completa (armadilha do `pg_default_acl` no CLAUDE.md);
  - deriva `requisitante_user_id` do inbox;
  - repete as validações da tela: 100 caracteres na descrição, 255 na observação, classe somando 100%, rateio de CC (`req_replace_rateio`), CC e classe ativos, unidade completa;
  - grava itens e anexos;
  - marca `criacao_concluida=true` (o mesmo efeito do `finalizar_rascunho_requisicao`, que exige `auth.uid()`).
- **Nenhuma RPC nova de submeter, aprovar ou enviar.**

### 5.6 Pessoa no circuito

- **Fase inicial:** o requisitante recebe "Rascunho criado a partir do seu e-mail — revise e envie", com link para o detalhe.
  - O detalhe mostra o selo "Criada por IA a partir de e-mail", o e-mail original e as pendências.
  - Ele clica **Submeter** (fluxo atual, com o JWT dele). A partir daí os líderes aprovam e o gateway envia.
- **Auto-submissão** só depois de medir o acerto, por decisão do Pedro (D-3). Mesmo nesse caso, o gate dos líderes continua.
  - ⚠️ **Cuidado:** com CC único e autor líder daquele CC, a regra R4 aprova automaticamente. Ou seja, sem confirmação humana, um e-mail de um líder iria ao Alvo **sem ninguém olhar**. É mais um motivo para manter a confirmação.

## 6. "Rateio de centros de custo": qual dos três?

No Hub, a palavra cobre três coisas diferentes (§34.4–34.5 do relatório de Suprimentos):

| O quê | Tabela | Vai ao Alvo? | Uso real |
|---|---|---|---|
| **Classe por item** (divisão contábil, sem CC) | `compras_requisicoes_itens_classe_rec_desp` | **Não** (fica só no Hub) | 280 de 303 requisições |
| **CC por item** | `compras_requisicoes_itens.codigo_centro_ctrl` | Sim (`ItemReqCompChildList[].CodigoCentroCtrl`) | 24 requisições multi-CC |
| **Rateio % classe → CCs (cabeçalho)** | `compras_requisicoes_rateio_classes` / `_rateio_cc` | Sim (`ReqCompClasseRecDespChildList`) | 1 requisição desde 08/09 |

**Proposta:**
- a IA preenche sempre a **classe por item** e o **CC por item** (com padrão vindo do histórico do requisitante);
- o **rateio percentual** só quando o e-mail pedir explicitamente (por exemplo, "dividir 60% TI / 40% RH"), citando o trecho;
- regra de validação: o CC principal do cabeçalho tem de estar no rateio (`CABECALHO_FORA_RATEIO`).

Decisão D-4.

## 7. Riscos

| # | Problema | Causa | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Remetente falsificado | E-mail é forjável | Requisição em nome de outra pessoa | DMARC/DKIM obrigatório, domínio da casa, perfil ativo com permissão; recusa registrada e respondida. |
| R2 | Injeção de prompt (e-mail ou PDF de terceiro) | Conteúdo não confiável dentro do contexto do modelo | Itens inventados ou desvio de função | Nenhuma ferramenta de envio ou aprovação; requisitante amarrado no servidor; um rascunho por e-mail; revalidação por RPC; confirmação humana. |
| R3 | Produto, unidade ou CC errados | Texto livre × catálogo de ~2.800 produtos | Compra errada, orçamento no CC errado | Modo sombra com medição; histórico do requisitante; citação do trecho; pendências visíveis; revisão do requisitante + gate dos líderes. |
| R4 | Duplicidade | Reenvio, encaminhamento, retry do webhook | Duas requisições | UNIQUE `message_id`; um rascunho por inbox; aviso de "parecido com a requisição X de ontem". |
| R5 | Pipeline morre em silêncio | Precedente: `process-email-nfe`, parado desde 13/05 | Pedidos por e-mail somem | Pulsação: alerta se ficar presa em `processando` > N min, ou se houver zero recebimentos em X dias úteis com remetentes ativos. |
| R6 | Limite de tempo da Edge | Modelo + MCP em uma requisição | Processamento cortado no meio | Duas etapas, assíncronas, com estado no inbox. Plano B: etapa B no erp-proxy. |
| R7 | Login do Alvo provisório | `alvo_usuario` em 6 de 72 perfis | `CodigoUsuario=PEDRO.SCRIGNOLI` no Alvo (66× em 30 dias) | Fora do escopo, mas vale nomear: preencher `alvo_usuario` resolve para todos os canais. |
| R8 | Dados pessoais e retenção | Corpo e anexos guardados | Exposição | RLS só para o requisitante e quem tem permissão; política de retenção (ex.: 180 dias); bucket privado. |
| R9 | Deploy do gateway afeta o sync | O MCP mora no erp-proxy | Sync de compras interrompido | Deploy fora do cron de compras (de hora em hora, 08–17h BRT) e fora das janelas do CLAUDE.md. |

## 8. Decisões do Pedro

| # | Decisão | Recomendação |
|---|---|---|
| D-1 | Endereço e provedor de entrada | `requisicoes@notificapfbr.com.br` com inbound do Resend; apelido no `pfbrazil.com` depois. Confirmar o provedor do `pfbrazil.com`. |
| D-2 | Quem pode mandar | Só usuários do Hub com `compras.requisicoes.create`. Quem não tem acesso ao Hub não consegue revisar o rascunho. |
| D-3 | Confirmação humana antes de submeter | **Sim** na fase inicial; reavaliar com números do modo sombra. |
| D-4 | Qual "rateio" a IA preenche | Classe por item + CC por item sempre; % por CC só quando pedido (§6). |
| D-5 | Onde a IA roda | Edge (padrão do `nfse-ler-boleto`), em duas etapas; erp-proxy como plano B. |
| D-6 | Registro no plano | Abrir um lote novo no `PLANO-PEDIDOS.md` (ex.: "LR-EMAIL"), com a numeração de prompt do Pedro. |

## 9. Plano em fases (um repo por tarefa, cada fase reversível)

| Fase | Entrega | Repo | Rollback |
|---|---|---|---|
| F0 | Decisões D-1…D-6 + **conjunto de avaliação**: 20–30 pedidos reais que viraram requisição, com o que foi lançado de fato | — | — |
| F1 | Inbox, anexos, `origem_criacao`, RPC `req_email_*` (service_role, `revoke ... from anon`) | finances-pf (SQL) | DROP das tabelas e RPCs novas; a coluna nova com padrão `'hub'` não afeta nada |
| F2 | Edge de recepção + recibo ao remetente. **Só grava, sem IA.** Validar com e-mails reais | finances-pf (Edge) | Desligar o webhook no provedor |
| F3 | `requisicoes-mcp`: leitura + `req_criar_rascunho` só com `simular` | erp-proxy | Desmontar a rota no `index.ts` |
| F4 | Agente em **modo sombra**: grava só a `proposta` no inbox. Medir acerto por campo contra o conjunto da F0 | finances-pf (Edge) | Desligar a função |
| F5 | Rascunho real + aviso ao requisitante + selo e pendências no detalhe. Teste com usuário **sem** `is_admin` | finances-pf (Edge + src) + erp-proxy (escrita) | Uma flag de configuração (ex.: linha própria em `sync_settings`) volta ao modo sombra |
| F6 | Opcional: diálogo por e-mail (a IA pergunta o que falta) e auto-submissão nos casos de alta confiança | — | Flag |

## 10. Achados colaterais (fora do escopo, registrados para não perder)

1. `docs/aprovacao-multicc/ENTREGA.md` ainda diz "não aplicada", e a §9 do `ESTADO-REVISAO-SUPRIMENTOS.md` lista o R3 como pendente. **O banco prova o contrário:** janela `aberta` desde 07/09, 143 requisições com grupo de aprovação. A documentação está desatualizada.
2. A Edge `process-email-nfe` (fonte fora do repo, `verify_jwt=true`) e a `email_notas_fiscais` estão paradas desde 13/05/2026. O alimentador externo ("Router", Rota 1/2) parou sem alarme.
3. `suprimentos-mcp`:
   - `tools/list` responde sem autenticação;
   - o gateway aceita JWT do Hub de IA e do Cartório (`mcp-auth.ts`);
   - o `PLUGIN_SECRET` do `intercompany-mcp` é declarado e nunca usado (já citado na §38.4).
4. `cnpj_sugestao_requisicao` é gravado em 88 requisições em 90 dias, mas não vai ao Alvo.
