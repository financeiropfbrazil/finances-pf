# NFSE-L0 — Investigação: Rastreio, NF-e e NFS-e → plano de lançamento de NFS-e pelo pedido de compra

**Data:** 19/10/2026 · **Tipo:** só leitura. Nenhum DDL, DML, deploy ou push. Consultas SELECT no projeto `hbtggrbauguukewiknew`, conferido pelo fingerprint de 2.305 pedidos.
**Objetivo do Pedro:** "fazer um plano de lançamentos de notas de serviço automaticamente, buscando pedidos de compra".
**Fontes:**
- código do `finances-pf` (`main` em `bf17be1`) e do `erp-proxy` (`cf1bed7`);
- definições do banco lidas com `pg_get_functiondef` / `pg_get_viewdef`, porque não estão versionadas;
- medições em [NFSE-L0-medicao.sql](NFSE-L0-medicao.sql), consultas 0 a 9, com os resultados anotados;
- o relatório anexado "Notas e Pedidos — Lançamento", só como contexto.

**Status:** proposta para o Pedro decidir. **Não altera nenhuma tarefa registrada no [PLANO-NFSE.md](../../PLANO-NFSE.md).** A fase de lançamento proposta aqui (§6) entra no plano só com o seu OK, como fase nova. Isso cumpre a D4: "lançamento é fase própria e passa pelo gateway".

---

## 0. Resumo executivo

1. **Dá para lançar NFS-e pelo pedido, mas não de forma 100% automática no início.** O pedido de serviço já define quase tudo:

   | O que o pedido acerta | Taxa |
   |---|---|
   | Produto | 99% |
   | Classe | 99% |
   | Centro de custo | 97% |

   A natureza sai da UF do prestador em 99,9% dos casos (1.933 em SP, 2.933 fora). Os pontos fracos são dois: **escolher o pedido certo** e **as retenções**.
2. **O casamento NFS-e → pedido foi simulado contra o vínculo real** (385 NFS-e de jun–set lançadas com pedido):

   | Nível | Regra | Notas | Acerto |
   |---|---|---|---|
   | **A** | pedido citado no texto da nota, ou pedido único com saldo exato | 27% | **98%** (103 de 105) |
   | **B** | sugestão com escolha | 35% | 79% |
   | **C** | manual | 38% | — |

   No total, a regra sugere algum pedido para 62% das notas e acerta 87%.
3. **As retenções não podem vir só do XML.** O Alvo registra PIS/COFINS/CSLL retidos em 88% dos itens, mas só ~14–24% dos XMLs do ADN declaram retenção federal. O perfil de retenção do fornecedor é estável em 92% dos itens e serve de base, com conferência do fiscal. Há um alerta: a configuração de PIS/COFINS do item **mudou em set/2026** (de 98 para 55), então o perfil precisa usar só os lançamentos recentes.
4. **O que existe hoje não lança NFS-e:**
   - a tela antiga foi removida em 15/10. Ela lançou 1 nota em toda a história, direto do navegador, com o certificado em `localStorage`;
   - a rota de gravação do gateway (`/mov-estq/save`) **exige `ChaveAcessoNFe`**, o que barra a NFS-e;
   - o gateway pode **duplicar o lançamento**, porque repete o envio em 401/403/409.
5. **O fluxo de NF-e de produto não serve de base pronta.**
   - **Nunca lançou:** 0 notas lançadas pelo Hub. O teste em produção parou com o pedido desligado (`vinculo:null`) e com o erro nulo do Alvo (417), descrito no relatório anexado.
   - **Duas falhas a evitar:** montar o item "do zero" com ~30 campos, quando o item real tem ~417, e deixar o navegador montar e enviar o lançamento.
6. **Desenho recomendado: lançamento *assistido* em três níveis, com modo sombra antes de qualquer gravação.**
   - **Nível A:** um clique para confirmar.
   - **Nível B:** o usuário escolhe o pedido.
   - **Nível C:** fila "aguardando pedido" com aviso ao comprador.

   A proposta é montada no servidor: uma cópia do último lançamento real do mesmo fornecedor, com os dados da nota e do pedido. O gateway faz a gravação com trava de duplicidade. O modo automático, sem clique, só vale depois e só para o nível A, se o Pedro quiser.
7. **Ganho esperado:** são ~120 NFS-e por mês, lançadas hoje à mão pelo usuário `FISCAL` (95%).
   - Atraso atual: **76 notas não lançadas há mais de 15 dias (R$ 244.925,68)** e 123 desde 01/07 (R$ 513.587,14).
   - O nível A cobre ~1 em cada 4 notas com confirmação em um clique.
   - O A e o B juntos cobrem ~60% das notas com pedido pré-preenchido.

---

## 1. Como funciona hoje

### 1.1 `/suprimentos/rastreio` (Rastreio Requisição → Pagamento)

**Tela**
- **Arquivos:** `src/pages/SuprimentosRastreio.tsx` (só leitura) e `src/services/rastreioComprasService.ts`.
- **Acesso:** a rota exige `compras.rastreio.access` (`App.tsx:286-294`). A RPC repete o gate e recusa com 42501.
- **RPCs (todas SECURITY DEFINER):**
  - `rastreio_compras_listar`: paginada no servidor, com busca, etapas e o filtro "NF candidata";
  - `rastreio_pagamento_nf`: parcelas de uma NF;
  - `rastreio_compras_atualizar`: refresh da MV e recálculo das candidatas.
- **Exportação:** Excel em `rastreioComprasExport.ts`, com as abas "Rastreio" e "Sobre".

**Dados**

`mv_rastreio_compras` tem uma linha por pedido × NF (2.934 linhas). O vínculo NF → pedido vem de quatro fontes:

| Fonte | De onde | Estado |
|---|---|---|
| **Alvo (NF)** | `rastreio_nf_pedido`, lido do `MovEstq/Load` | vivo |
| Despesas | `desp_realizado_doc.payload_alvo` | congelado desde 06/10 |
| Intercompany | `intercompany_movestq_cache` | congelado desde 06/10 |
| Laudos | `rec_laudos` | vivo |

- No MovEstq, o pedido aparece em dois lugares, e os dois são lidos: `ItemMovEstqChildList[].NumeroPedComp` e `MovEstqPedCompChildList[].NumeroPedComp`.
- **Etapas:** Cancelado, Pago antes da NF, Pedido em aprovação, Encerrado sem NF ligada, Aguardando NF, Em inspeção (laudo), Pago (1ª parcela) e Aguardando pagamento. As etapas de requisição são criadas na RPC.

**Carga**

A Edge `sync-parcelas-pagar-cron` chama o gateway com `X-System-Secret`.

| Job | Agenda | O que faz |
|---|---|---|
| 30 | 06h40 BRT, dias úteis | modo lista: `fin_parcelas_pagar` + `rastreio_req` |
| 34 | a cada 3 min | modo nf: passos P, B1 e B2 |
| 32 | minuto :55, de hora em hora | refresh da MV + candidatas |

Os passos do modo nf:
- **P:** busca os MovEstq pelo número do pedido, no item e no cabeçalho;
- **B1:** `DocFin/Load` → `chave_movestq`;
- **B2:** `MovEstq/Load` → `rastreio_nf` + `rastreio_nf_pedido`.

As falhas vão para `rastreio_tentativa`, com espera crescente.

**Candidatas (`rastreio_atualizar_candidatas()`, só no banco)**

A cada hora, a função sugere até 3 NFs recebidas e não lançadas para cada pedido sem NF. Os motivos, por prioridade:
1. vinculada em Compras;
2. `xPed` do XML igual ao número do pedido;
3. mesma raiz de CNPJ, valor dentro de max(10%, R$ 5) e emissão entre 30 dias antes e 120 dias depois do pedido.

Hoje há 33 candidatas.

🔴 **A função só lê `compras_nfe`, ou seja, NF-e modelo 55.** Uma NFS-e recebida e não lançada nunca aparece no Rastreio. Hoje há **123 pedidos de natureza Serviço sem NF ligada** sem nenhuma sugestão possível. A NFS-e só aparece quando já está lançada no Alvo, e assim já há 917 linhas da MV com espécie NFS-e.

### 1.2 NF-e de produto (`/compras/notas-fiscais`)

**Entrada das notas**

| Caminho | Estado | Notas |
|---|---|---|
| Edge `receber-nfe` (POST externo com `x-api-key`) | **único caminho vivo** | 926 de 932 |
| Upload manual | pouco usado | 4 |
| Fila de chaves + SEFAZ | parado desde 11/06, sem cron | — |
| E-mail | quebrado: grava colunas que não existem mais | — |
| `extrair-nfe` | isolado, sem chamador | — |

**Tela**
- Na prática só o administrador entra: a `permKey` "compras" tem 0 linhas em `user_permissions`.
- O fluxo é vincular o pedido (manual, com o selo "Sugerido" por CNPJ e valor ±5%; **não usa o `xPed`**) e depois lançar pelo `LancarNfeModalV2`.

**O lançamento V2** monta o pacote no navegador e o envia ao gateway (`/mov-estq/save`).
- **0 lançamentos até hoje.**
- O pedido vai **desligado** (`vinculo:null`). A `MovEstqPedCompChildList` não é montada em lugar nenhum.
- Defeitos já identificados:
  - a condição de pagamento é gravada como "código (nome)" e quebra as parcelas;
  - a trava "itens = vNF" barra notas com IPI, frete ou ST;
  - as datas erram o dia entre 21h e meia-noite;
  - não manda anexo;
  - engole o erro ao gravar o status;
  - "Desvincular" deixa linhas órfãs em `compras_nfe_pedidos` (3 casos).
- **Nada traz o status de volta do Alvo:** 750 das 932 NF-e já estão lançadas lá, mas aparecem como "pendente" no Hub.

**O relatório anexado conta a mesma história pelo lado do teste em produção** (fire-test):
- o Alvo valida em cascata;
- o item real tem ~417 campos;
- `AtualizaItemMovimentacao` não calcula a tributação;
- o erro "Referência de objeto não definida" (417) aparece quando faltam campos tributários.

Ele também diz que a lista "já bifurca por tipo", mas o código atual **não bifurca**: só trata modelo 55.

**Lição para a NFS-e:** não montar o item do zero no navegador. Partir de um lançamento real e montar no servidor.

### 1.3 NFS-e no Hub: o que existiu e o que existe

**Antigo (removido em `b2331f2`, 15/10)**

**Captura**
- Lia o ADN pelo `pef-nfe-service`, com o `.pfx` e a senha no `localStorage`, e gravava em `compras_nfse`.
- `compras_nfse` tem 32 linhas, uma delas lançada.

**Vínculo**
- Manual, por CNPJ e status Aberto/Parcial.
- Não conferia valor, natureza nem saldo.

**Lançamento**
- O navegador chamava o Alvo direto (`SaveMovEstqMultPart`) com até 3 tentativas em caso de 409.
- **Lançou 1 nota (a 233, em 06/04), com uma versão do código (LANCAR-6) que não é a que foi removida.**
- O payload antigo continua útil como referência:

  | Campo | Valor |
  |---|---|
  | `CodigoTipoLanc` | E0000091 |
  | Natureza | 1.933 |
  | Produto | o do 1º item do pedido |
  | `CodigoTributB` / `ClasFiscal` | 90 / 0000002 |
  | Configuração PIS/COFINS | 98 |
  | Rateio | do `classe_rateio` do pedido |
  | Parcelas | da condição de pagamento, sobre o valor bruto |
  | Anexo | obrigatório (DANFSe gerada no navegador, depois XML, depois PDF vazio) |

- **Inconsistência:** `CodigoEntidade` vinha do pedido e `CPFCNPJEntidade` do prestador. Os dois diferem quando o pedido é de outro CNPJ.

**Novo (ADN, PLANO-NFSE Fase 0 concluída)**
- **Rota `/nfse-adn` no gateway:** mTLS com o certificado do servidor, só chamada de sistema.
- **Edge `nfse-adn-sonda`:** modos `teste` e `drenar`, ainda **sem cron**.
- **Tabela `nfse_adn_doc`:** 1.645 documentos, com o XML inteiro.
- **O que o gatilho extrai:** número, emissão, prestador, município, tomador, intermediário, valor do serviço e valor líquido.
- 🔴 **O que não extrai:** ISS, retenções, código do serviço (`cTribNac`), descrição (`xDescServ`), informações complementares (`xInfComp`) nem competência. Dá para corrigir estendendo o gatilho e rodando `update … set xml = xml`. Os XPaths do parser antigo servem de base.
- **Fase 1** (permissão, `v_nfse_recebida`, RPCs, cron, tela `/suprimentos/notas-servico`): toda ⬜.
- **D4:** a Fase 1 é só leitura.
- **O espelho do ADN está parado em 16/10** (último documento 16/10 19:50 UTC).

### 1.4 Como a NFS-e é lançada hoje no Alvo (797 NFS-e E0000091 de 2026, consulta 7)

| Campo | O que os dados mostram |
|---|---|
| Quem lança | usuário **`FISCAL` em 760 (95%)**; VIVIANE.BRAMBILLA 33; outros 4 |
| Itens | **1 item em 783 (98%)** |
| Produto | `002.005` "SERVIÇO DE TERCEIROS" em 62%, mais ~7 outros `002.0xx` |
| Natureza | 1.933 com o prestador em SP (692) · 2.933 fora de SP (104) · 1 exceção → **regra pela UF: 99,9%** |
| Fiscal fixo | `CodigoTributB 90`, `CodigoClasFiscal 0000002`, `ItemServico Sim`, `ControlaEstoque Não`, unidade `UNID`, `FatorDivisor "Fator"`, `Peso 1` (gabarito 20855) |
| Configuração PIS/COFINS | 98 em 659 · 55 em 138. **Em set/2026 o 55 passou a dominar** (24 × 43; out 0 × 2). 20 fornecedores têm os dois. Regra a confirmar com o fiscal |
| Pedido | **no item E no cabeçalho em 682 (86%)**; sem pedido em 115. Nunca só em um dos dois |
| Retenções | campos `Valor*RFServico` no cabeçalho e `*RF` no item; `Deduz*ValorTotal` = Não em 629 e Sim em 70 |
| Parcela | **sempre o valor BRUTO** (695 de 695 com retenção); exemplo: 1 parcela, tipo de cobrança 0000006, `NumeroDuplicata "56/1-1"` |
| Anexo | 1 em 763 · 2 em 31 · **0 em 3** (pela tela do Alvo o anexo não é absoluto; pela API ele era exigido) |
| Datas | `DataEntrada` = dia seguinte à emissão no gabarito; a digitação é registrada em `DataHoraDigitacao` |

---

## 2. Medições que embasam o plano (19/10/2026)

| # | Pergunta | Resultado | Consulta |
|---|---|---|---|
| M1 | Volume | ~115–125 NFS-e E0000091 por mês; 82–92% com pedido ligado | 1 |
| M2 | Relação com o pedido (2026) | 1.071 NFS-e, 916 com pedido (86%), 930 vínculos, 546 pedidos (detalhe abaixo) | 2 |
| M3 | Casamento automático simulado (385 NFS-e jun–set com pedido real) | R1 citado 57 (55 certas) · R2 com saldo exato 48 (48) · R2 com saldo parcial 66 (50) · R3 valor exato 68 (56) · sem regra 146 | 3 |
| M4 | O lançamento copia o pedido? | produto 99% · classe 99% · CC 97% | 4 |
| M5 | Retenções | PIS/COFINS/CSLL retidos em 88% dos itens no Alvo; o XML declara retenção federal em ~14–24%; `<xPed>` em **0** XMLs | 4, 5 |
| M6 | Perfil fiscal por fornecedor | retenção estável em 92% dos itens; natureza pela UF 99,9%; PIS/COFINS mudou em set/2026 | 7–9 + medição anterior |
| M7 | Atraso (ADN × Alvo, método da 0.6) | desde 01/07: **123 não lançadas, R$ 513.587,14** · há mais de 15 dias: **76, R$ 244.925,68** | 6 |
| M8 | Atraso de digitação | mediana de 3 a 8 dias, conforme o mês | medição anterior |

**Detalhe da M2 (930 vínculos):**
- pedido fora do Hub: 11%;
- pedido de outro fornecedor: 4%;
- valor igual ao do pedido: 31%;
- em pedido com 4 ou mais NFs (contratos recorrentes): 38%;
- **pedido implantado depois da emissão: 22%**.

**Conciliação da M7 com a NFSE-0.6.** Em 16/10 a 0.6 contou 39 notas há mais de 15 dias (R$ 113.154,39), numa janela de 90 dias.
- 35 dessas 39 seguem sem lançar.
- As **27 notas emitidas em 01–03/10 (R$ 133.577,12)** passaram dos 15 dias com a janela andando 3 dias. A emissão se concentra no início do mês.
- Na mesma janela de 90 dias, hoje são 61 notas (R$ 230.864,49).

**Limites das medições**
- A "verdade" da M3 é o pedido ligado no Alvo. Notas lançadas **sem** pedido (~14%) ficam fora do universo.
- Por isso, sobre **todas** as NFS-e, o nível A fica perto de 1 em cada 4.
- O saldo do pedido foi calculado com as NFs ligadas antes da entrada da nota. Em produção ele também precisa descontar os lançamentos em andamento no Hub.

---

## 3. Bloqueios e riscos encontrados

| # | Bloqueio | Evidência | Tratamento proposto |
|---|---|---|---|
| B1 | A gravação do gateway exige `ChaveAcessoNFe` e foi feita para NF-e | `erp-proxy/src/routes/movEstq.ts:232` | rota própria de NFS-e (L8) |
| B2 | 🔴 Repetição automática pode **duplicar** o MovEstq | `alvo-client.ts:17-20`: o `NAO_REPETIR` não tem `MovEstq/SaveMovEstqMultPart`; PATCH 3 escrito em `docs/erp-proxy/CARD-F-nao-repetir-criacao.md`, não aplicado | **primeira tarefa** (L1); vale também para a NF-e V2 |
| B3 | `nfse_adn_doc` não extrai ISS, retenções, `cTribNac`, `xDescServ`, `xInfComp` nem competência | gatilho da NFSE-0.2 | estender a extração (L2) |
| B4 | Retenção quase nunca está no XML; a configuração PIS/COFINS mudou em set/2026 | M5, M6, consulta 9 | perfil do fornecedor a partir dos lançamentos recentes + conferência do fiscal; nota com divergência cai para o nível B |
| B5 | A única fonte com os campos fiscais do item lançado (`desp_realizado_doc`) está **congelada desde 06/10** (sync-despesas desligado por decisão); `rastreio_nf` guarda só o cabeçalho | CLAUDE.md, crons desligados | fonte viva e estreita (L3), sem religar cron desligado |
| B6 | Espelho do ADN parado desde 16/10 (sem cron) | consulta 6 | NFSE-1.5 / 1.9 do plano |
| B7 | O XML não traz o pedido de forma estruturada (`xPed` = 0); a citação só aparece no texto livre | M5 | usar a regra R1 sobre `xDescServ`/`xInfComp` **e** pedir aos fornecedores recorrentes que citem o número do pedido na descrição (é o que mais aumenta o nível A) |
| B8 | 22% dos pedidos são implantados **depois** da emissão | M2 | fila "aguardando pedido" com aviso ao comprador; recalcula de hora em hora |
| B9 | 11% dos pedidos estão fora do Hub; 4% são de outro fornecedor (matriz/filial, terceiro) | M2 | só manual (nível C) |
| B10 | Anexo: quase sempre presente; a API exigia | consulta 7; código antigo | anexar o XML do ADN; a DANFSe oficial fica para a Fase 2 |
| B11 | Nota cancelada no fisco já foi lançada e paga (2 casos) | NFSE-0.6 §F | conferir o evento de cancelamento antes de enviar |
| B12 | Lançamento manual paralelo: o FISCAL pode lançar no Alvo enquanto o Hub prepara | processo atual | conferência no Alvo **no momento do envio** (busca por número + entidade), não no espelho |
| B13 | Só o Pedro é `is_admin` e tem bypass | CLAUDE.md | validar com usuário **sem** a flag (o papel `analista_fiscal` tem 0 usuários hoje) |

---

## 4. Desenho proposto: lançamento assistido por pedido

### 4.1 Fluxo

```
ADN ──cron──▶ nfse_adn_doc (+ campos fiscais estendidos)
                 │
                 ▼
         v_nfse_recebida (No fisco: normal/cancelada · No Alvo: não lançada)
                 │  só "normal" + "não lançada"
                 ▼
   motor de casamento (de hora em hora, junto com o job 32) ──▶ nfse_pedido_sugestao  ──▶ Rastreio: "NF candidata"
                 │  nível A / B / C
                 ▼
   montagem da proposta (servidor) ──▶ nfse_lancamento (estado + payload proposto + diferenças)
                 │
                 ▼
   tela "Para lançar" ── usuário confirma (A) / escolhe (B) / aguarda pedido (C)
                 │  só o id da proposta
                 ▼
   erp-proxy POST /nfse/lancar ── revalida · confere no Alvo · grava sem repetir · Load de confirmação
                 │
                 ▼
   nfse_lancamento = lançada (chave_movestq) ──▶ rastreio_nf_fila ──▶ espelhos confirmam (conferida)
```

### 4.2 Casamento NFS-e → pedido (motor)

**Candidatos**
- `compras_pedidos` com o **mesmo CNPJ completo** do prestador;
- não cancelado nem `excluido_alvo`;
- aprovado (`data_aprovacao_alvo` preenchida);
- natureza Serviço ou Misto;
- data do pedido entre 400 dias antes e 30 dias depois da emissão.

**Saldo do pedido** = valor do pedido − NFs já ligadas no Alvo (`rastreio_nf_pedido.valor_itens`) − propostas em andamento no Hub.

| Nível | Regra | Medido (M3) | Ação |
|---|---|---|---|
| **A1** | exatamente 1 pedido citado no texto da nota (`xDescServ`/`xInfComp`) | 57 → 55 certas | confirmação em 1 clique |
| **A2** | exatamente 1 candidato com saldo, e o saldo é igual ao valor da nota (±0,05) | 48 → 48 | confirmação em 1 clique |
| **B1** | exatamente 1 candidato com saldo, mas o saldo é maior (consumo parcial / contrato) | 66 → 50 | sugere; o usuário confirma vendo o saldo |
| **B2** | vários com saldo, 1 com valor exato | 68 → 56 | sugere; o usuário escolhe |
| **B3** | vários com saldo e nenhum exato | (no "sem regra") | lista ordenada por diferença e data |
| **C1** | nenhum candidato | — | "aguardando pedido" + aviso ao comprador/requisitante; recalcula de hora em hora |
| **C2** | candidato só pela raiz do CNPJ ou pedido de outro fornecedor | — | manual |

O motor roda depois do `refresh` do job 32, no mesmo padrão de `rastreio_atualizar_candidatas`. Ele também abastece a Fase 3 do PLANO-NFSE: NFS-e recebida como "NF candidata" no Rastreio. **Isso já entrega valor sem gravar nada no Alvo.**

### 4.3 Montagem da proposta (no servidor, nunca no navegador)

**Princípio: "gabarito por fornecedor".** A proposta parte do **último MovEstq real E0000091 do mesmo fornecedor**, lido com `MovEstq/Load`, que já está liberado no gateway. Por quê:
- traz os ~417 campos do item já certos para aquele fornecedor;
- evita a cascata de erros do teste da NF-e;
- 98% das notas têm 1 item e o perfil é estável em 92%.

Sem lançamento anterior do fornecedor, a proposta usa o gabarito padrão (20855 / produto `002.005`) e cai para o nível B.

**O que é trocado no gabarito:**

| Grupo | Origem |
|---|---|
| Identificação | `Chave` / `ChaveMovEstq` = 0 (filhos = 1); `Numero` = nNFSe; `Serie` (a confirmar: hoje "1"); `DataEmissao` = dhEmi; `DataEntrada`/`DataMovimento` = dia do lançamento **em BRT** (sem o erro das 21h); limpar `DataHoraDigitacao`, `UploadIdentify` e os campos de estado (`DocumentoHomologado`, `Integrado*`) |
| Entidade | `CodigoEntidade` do pedido **e** CNPJ conferido igual ao do prestador (corrige a inconsistência do código antigo) |
| Pedido | item: `NumeroPedComp`, `SequenciaItemPedComp`, `CodigoProdutoPedComp`, `CodigoEmpresaFilialPedComp`; cabeçalho: `MovEstqPedCompChildList` (86% das notas lançadas têm os dois; confirmar no canário se o Alvo cria a child list sozinho a partir do item) |
| Produto e fiscal | produto do item de serviço do pedido (99%); natureza pela UF (1.933 / 2.933); configuração PIS/COFINS do **perfil recente** do fornecedor; o resto vem do gabarito |
| Valores | `ValorServico` = `ValorDocumento` = vServ (bruto); item com o mesmo valor |
| Retenções | do XML quando declaradas; senão, % do perfil × base. Se o XML e o perfil divergirem, a nota cai para o nível B |
| Rateio | classe e CC do pedido (`classe_rateio`), recalculado sobre o valor da nota, resto de centavos na última linha |
| Parcelas | condição de pagamento **do pedido** (código separado do nome, sem o defeito da V2), sobre o valor **bruto**; tipo de cobrança do perfil (gabarito 0000006); `NumeroDuplicata` "nº/seq-total" |
| Anexo | XML do ADN (`nfse_adn_doc.xml`) |

**Travas antes de habilitar o envio:**
- soma das classes = valor da nota;
- soma dos CCs = valor da classe;
- soma das parcelas = valor da nota;
- a nota não está cancelada nem substituída no fisco;
- o pedido continua aprovado e com saldo;
- CNPJ da entidade = CNPJ do prestador;
- valor abaixo do teto definido pelo Pedro.

### 4.4 Gravação (gateway)

- A rota nova `POST /nfse/lancar` no `erp-proxy` recebe **só o id** da proposta.
  - **Autenticação:** JWT do usuário, com a permissão conferida no banco.
  - **Proposta:** relida do banco pelo servidor; o navegador não manda payload.
- **Antes de enviar, a rota:**
  1. trava a linha (`enviando`), o que bloqueia duplo clique e concorrência;
  2. revalida as travas;
  3. **consulta o Alvo naquele momento**, por número + entidade (rota `buscar-por-nf` ou `movEstq/GetListForComponents`). Se a nota já existir, marca `ja_lancada_no_alvo` e não envia.
- **O envio:** `MovEstq/SaveMovEstqMultPart?action=Insert`, **sem repetição** (B2 resolvido antes).
- **Se a resposta for incerta** (timeout ou erro de rede): status `incerto`. Antes de qualquer nova tentativa, a rota consulta o Alvo de novo.
- **Depois do sucesso:**
  - `MovEstq/Load` da chave devolvida para conferir;
  - grava `chave_movestq`, quem confirmou e quando;
  - põe a chave em `rastreio_nf_fila`.

  Os espelhos (`rastreio_nf`, `fin_parcelas_pagar`) depois confirmam o lançamento → `conferida`.
- **Não há exclusão no Alvo pelo Hub.** Um lançamento errado é corrigido no Alvo pelo fiscal (D-L2).

### 4.5 Modo sombra (antes de qualquer gravação)

Por 2 a 4 semanas (~250 a 500 NFS-e), o motor e a montagem rodam para toda nota nova, mas ninguém lança pelo Hub.
- Quando o FISCAL lança no Alvo, um relatório compara a proposta com o lançamento real, campo a campo: pedido, produto, natureza, classe, CC, configuração PIS/COFINS, cada retenção, condição de pagamento, parcelas e anexo.
- **Critério para ligar o botão do nível A:** pedido certo ≥ 98% e cada campo fiscal ≥ 97% no nível A.
- **Critério para ligar o nível B:** ≥ 90%.

O Pedro decide com o relatório na mão.

### 4.6 Automático sem clique (opcional, por último)

Só para o nível A, depois do modo sombra e de algumas semanas no modo assistido sem erro:
- kill-switch em `sync_settings`;
- teto de valor por nota;
- limite de notas por dia;
- relatório diário do que foi lançado.

**Recomendação:** começar e ficar no modo assistido. O ganho maior vem do pré-preenchimento, e o risco fiscal de uma retenção errada não compensa tirar o humano.

---

## 5. Pré-requisitos do PLANO-NFSE (Fase 1, já registrada)

| Tarefa | Para que serve aqui |
|---|---|
| NFSE-1.1 permissão `compras.nfse.access` | tela e RPCs |
| NFSE-1.2 `v_nfse_recebida` | eixo "No Alvo" = não lançada, que define quem entra no motor |
| NFSE-1.5 / 1.9 cron do ADN | sem ele o espelho fica parado (B6) |
| NFSE-1.7 tela `/suprimentos/notas-servico` | recebe a aba "Para lançar" |
| NFSE-0.7 (~23/10) | reconferir Rio Preto antes de confiar no ADN como fonte única |

---

## 6. Fase proposta: "L — Lançamento assistido de NFS-e por pedido" (para registrar no PLANO-NFSE, com OK)

Regras de sempre:
- uma tarefa por vez;
- SQL em `docs/nfse/NFSE-L<n>-*.sql` com pré-voo, conferência e rollback;
- RPC nova com `revoke … from anon` (assinatura completa);
- `bun run build` + `tsc -p tsconfig.app.json` limpos;
- deploy do gateway fora das janelas do cron;
- validação com usuário sem `is_admin`.

| ID | Tarefa | Onde | Pronto quando | Depende de |
|---|---|---|---|---|
| NFSE-L0 | Esta investigação + medições | docs | Pedro leu e decidiu §7 | — |
| NFSE-L1 | **`MovEstq/SaveMovEstqMultPart` no `NAO_REPETIR`** (PATCH 3 do CARD-F) | erp-proxy | teste com mock: 409 no Save não repete; a NF-e V2 se beneficia | — |
| NFSE-L2 | **Extração fiscal estendida** em `nfse_adn_doc`: ISS (base, %, valor, retido), retenções federais e CP, `vTotalRet`, `cTribNac`, `xDescServ`, `xInfComp`, `dCompet`, `cLocIncid`, CNPJ completo do tomador (→ filial). Reprocessar com `update … set xml = xml` | SQL | colunas preenchidas nos 1.645 documentos; `extracao_erro` vazio; rollback testado | Fase 0 |
| NFSE-L3 | **Fonte viva dos itens lançados**: o passo B2 da `sync-parcelas-pagar-cron` passa a gravar, para NFS-e, os campos fiscais do item e as retenções do cabeçalho numa tabela nova e estreita (ex.: `rastreio_nf_fiscal`). Alternativa: Pedro decide religar o sync-despesas | finances-pf (Edge) + SQL | NFS-e lançadas depois do deploy aparecem com produto, natureza, configuração, retenções e anexo | — |
| NFSE-L4 | **Perfil fiscal do fornecedor** (view): últimos lançamentos E0000091 (janela recente, por causa da mudança de set/2026) com produto, natureza, configuração PIS/COFINS, % de cada retenção, `Deduz*`, tipo de cobrança e índice de estabilidade | SQL | reproduz os 92% de estabilidade; o fiscal confere 10 fornecedores | L2, L3 |
| NFSE-L5 | **Motor de casamento** → `nfse_pedido_sugestao` (níveis A1/A2/B1/B2/B3/C1/C2, saldo, motivo), recalculado no job 32 | SQL | reproduz a M3 (A ≈ 98%) no histórico | 1.2, L2 |
| NFSE-L6 | **Rastreio — NFS-e candidata** (Fase 3 do PLANO-NFSE): `rastreio_atualizar_candidatas` passa a ler a `nfse_pedido_sugestao` | SQL + finances-pf | os pedidos de Serviço sem NF ganham sugestão; a tela e o Excel mostram a espécie | L5 |
| NFSE-L7 | **Proposta + modo sombra**: tabela `nfse_lancamento` (estado, nível, pedido, payload proposto, diferenças, quem, quando, chave), montagem pelo gabarito do fornecedor, relatório proposta × lançamento real | SQL (+ Edge, se a montagem precisar do `MovEstq/Load`) | 2–4 semanas de sombra; relatório por campo para o Pedro | L3, L4, L5 |
| NFSE-L8 | **Rota `POST /nfse/lancar`** (lê a proposta pelo id, trava, confere no Alvo, multipart com o XML, sem repetir, Load de confirmação, grava o resultado; estado `incerto`) | erp-proxy | testes com mock dos 6 caminhos (sucesso, já existe, 4xx, 5xx, timeout, nota cancelada) | L1, L7 |
| NFSE-L9 | **Permissão `compras.nfse.lancar`** + RPCs (listar propostas, confirmar, escolher pedido, descartar, marcar "aguardando pedido") | SQL | o papel definido na D-L2 confirma; um Requisitante recebe 42501; anon é recusado | 1.1, L7 |
| NFSE-L10 | **Aba "Para lançar"** em `/suprimentos/notas-servico`: níveis, motivo, saldo, proposta legível (sem JSON), diferenças XML × perfil, botões por nível; os filtros dizem o eixo | finances-pf | build/tsc limpos; usuário sem admin valida | 1.7, L9 |
| NFSE-L11 | **Canário**: 1 NFS-e nível A de baixo valor, com o fiscal ao lado → Load campo a campo × gabarito → depois 5 → depois 20 | — | 0 duplicidade; diferenças zeradas ou explicadas | L8, L10 |
| NFSE-L12 | (Opcional) **Automático do nível A** com kill-switch, teto e limite diário | SQL + erp-proxy | só depois da decisão do Pedro com os números do canário | L11 |

**Ordem sugerida**
1. L1, L2 e L3 em paralelo: nenhuma grava no Alvo, e cada uma é útil sozinha.
2. L5 + L6: entregam valor na tela do Rastreio sem nenhum risco no Alvo.
3. L4 + L7, o modo sombra.
4. Com os números do modo sombra: L8 a L11.
5. L12, se o Pedro quiser.

---

## 7. Decisões para o Pedro

| # | Pergunta | Recomendação |
|---|---|---|
| D-L1 | Assistido (um humano confirma) ou automático? | **Assistido.** O automático fica só para o nível A, depois do canário (L12) |
| D-L2 | Quem confirma no Hub e quem corrige no Alvo? Hoje 95% é o usuário `FISCAL`; o papel `analista_fiscal` tem 0 usuários | dar `compras.nfse.lancar` ao fiscal; correção e exclusão sempre no Alvo, pelo fiscal |
| D-L3 | O lançamento pelo gateway aparece no Alvo com o usuário do gateway, não o do fiscal. Aceitável? | sim, com o "quem confirmou" gravado no Hub (`nfse_lancamento`) |
| D-L4 | Data de entrada = dia do lançamento? E a competência (`dCompet`)? | entrada = dia do lançamento (como hoje); competência do XML, a confirmar com a contabilidade |
| D-L5 | Retenções: o XML manda quando declara; senão, o perfil. Divergência → nível B. Quem confirma a mudança 98 → 55 de set/2026? | o fiscal confirma a regra antes do modo sombra |
| D-L6 | Pedido implantado depois da nota (22%): esperar ou lançar sem pedido? | esperar, com aviso ao comprador; depois de N dias, manual |
| D-L7 | Saldo parcial (contratos): pode ser nível A? | não. Nível A só com saldo exato ou pedido citado (medido: 100% e 96%) |
| D-L8 | Pedido de outro CNPJ (matriz/filial): pode ser automático? | não, só manual |
| D-L9 | Anexo: XML do ADN agora e DANFSe oficial na Fase 2? | sim |
| D-L10 | Teto de valor para o nível A | o Pedro define (sugestão inicial: R$ 20 mil) |
| D-L11 | Fonte viva dos itens (L3) ou religar o sync-despesas? | L3: é estreita e não mexe nos crons desligados por decisão |
| D-L12 | Pedir aos fornecedores recorrentes que citem o nº do pedido na descrição da NFS-e? | sim; é o maior alavancador do nível A, a custo zero |

---

## 8. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| MovEstq duplicado (repetição do gateway, duplo clique, lançamento manual em paralelo) | título a pagar em dobro | L1 antes de tudo; trava `enviando`; conferência no Alvo na hora do envio; estado `incerto` sem nova tentativa cega |
| Retenção errada | erro fiscal, imposto recolhido a menos ou a mais | modo sombra com métrica por retenção; divergência XML × perfil → nível B; o fiscal confirma o perfil |
| Pedido errado | saldo e contábil errados | nível A só com prova forte (citado ou saldo exato); modo sombra |
| Gabarito defasado (o fornecedor mudou a regra; o Alvo mudou campos) | erro 417 ou campo herdado errado | perfil com janela recente; lista explícita de campos trocados e campos zerados; canário com Load campo a campo |
| Lançamento irreversível pelo Hub | correção manual no Alvo | canário pequeno; o fiscal acompanha; teto de valor |
| Espelhos defasados (DocFin 1×/dia; ADN sem cron) | proposta para nota já lançada | conferência no Alvo na hora; NFSE-1.5/1.9 |
| Nota cancelada depois de lançada | pagamento indevido | destaque `cancelada_e_lancada` (D6 do plano) + alerta |
| Permissão nunca testada sem bypass | tela quebrada para o fiscal | teste com usuário sem `is_admin` em L9/L10 |

---

## 9. Achados à parte (fora do escopo; registrar, não corrigir agora)

- **NF-e V2:**
  - condição de pagamento "código (nome)" quebra as parcelas (`LancarNfePagamento.tsx:145-149`);
  - a trava "itens = vNF" barra IPI, frete e ST;
  - datas erram entre 21h e meia-noite;
  - `catch {}` engole o erro do status;
  - vínculo com o pedido desligado.
- **`compras_nfe`:**
  - "Desvincular" deixa `compras_nfe_pedidos` órfão (3 casos);
  - 750 de 932 notas lançadas no Alvo seguem "pendente" no Hub.
- **Acesso:** `/compras/notas-fiscais` é só para administrador na prática (`permKey` "compras" com 0 linhas).
- **Código quebrado ou morto:** `import-email-nfe-to-compras` grava colunas que não existem; `nfse-sync.ts` está duplicado no gateway; o fluxo SEFAZ não tem cron; `types.ts` está defasado para `compras_nfe`.
- **Rastreio:**
  - as candidatas comparam o valor sem converter a moeda;
  - ignoram o vínculo com vários pedidos (`compras_nfe_pedidos`);
  - a etapa "Pago (NF não ligada)" ficou inalcançável depois da F1.
- **Lotes da NF-e:** são lidos com `MovEstq/Load` **direto do navegador** com a credencial local (F4/F5 do plano de Suprimentos).

---

## Anexo — reprodução

Todas as medições estão em [NFSE-L0-medicao.sql](NFSE-L0-medicao.sql), com o resultado de 19/10 anotado em cada consulta:

| Consulta | Conteúdo |
|---|---|
| 0 | fingerprint |
| 1–2 | volume e relação com o pedido |
| 3 | simulação do casamento |
| 4–5 | o lançamento copia o pedido? e retenções no XML |
| 6 | atraso e conciliação com a 0.6 |
| 7 | como a NFS-e é lançada hoje |
| 8 | natureza × UF |
| 9 | configuração PIS/COFINS por mês |

Rodar sempre no `hbtggrbauguukewiknew`, depois do fingerprint.
