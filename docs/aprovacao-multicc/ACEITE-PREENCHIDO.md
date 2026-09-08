# Aceite com cadastros existentes — preparado em 07/09/2026

**Estado vigente:** gateway **fc505e2**, SQL integral **20260907184223**, Edge **v51**
e frontend **multicc-20260907-aceite-3** publicados e conferidos. Aceite restrito aberto
em 07/09/2026 às 15:59:31 BRT para Pedro, Caio, Ana e Mirlene.
**A operação geral permanece suspensa**, cron jobid 1 inativo e sincronização
automática de requisições desabilitada. Não é necessário repetir a implantação.

**O teste Caio/Ana ainda não começou.** Não há ID Hub, número Alvo ou resultado de
aprovação desse caso. Apenas o carregamento/seleção das unidades e o avanço local
do formulário foram validados na sessão de Pedro (admin), sem gravar requisições.
Evidências do commit **519739b**: [resultado real](tests/formulario-aceite-3/resultado.json),
[conversões](tests/formulario-aceite-3/conversoes.json) e capturas no mesmo diretório.
Isso não substitui o aceite de submissão, aprovação e envio com Caio/Ana não-admin.
Versões e restrições completas em [IMPLANTACAO.md](deployment/IMPLANTACAO.md).

**Origem da matriz abaixo:** levantamento somente SELECT, sem atribuições novas.
Fingerprint: projeto hbtggrbauguukewiknew,
2.038 pedidos. Conferidos profiles ativos, role lider_departamento não revogado,
permissões efetivas, vínculos ativos e CCs. Evidência: `tests/participantes-existentes.json`.

## Participantes e centros disponíveis

| Participante | Não-admin ativo | Liderança existente | Permissões confirmadas | Login de envio em profiles |
|---|---|---|---|---|
| Caio Santos Neiva (`caio.santos`) | Sim | Engenharia de Manufatura — `00010.00002.00005` | access, create, aprovar, reenviar_own, view_own, view_cc | Ausente |
| Ana Paula Sanches (`ana.sanches`) | Sim | Marketing e Comunicação — `00007.00001.00002`, mais 11 CCs de marketing | access, create, aprovar, reenviar_own, view_own, view_cc | `ANA.SANCHES` |
| Guilherme da Silva Oliveira (`guilherme.oliveira`) | Sim | TI — `00010.00002.00008` | access, create, aprovar, reenviar_own, view_own, view_cc | Ausente |
| Mirlene Coutinho Oliveira (`mirlene.oliveira`) | Sim | Nenhuma | access, create, reenviar_own, view_own, view_all; sem aprovar | `MIRLENE.OLIVEIRA` |
| Elisangela da Costa Silva (`elisangela.silva`) | Sim | Nenhuma | access, create, reenviar_own, view_own, view_all; sem aprovar | `ELISANGELA.SILVA` |

Os três CCs acima estão ativos, com início de vigência 01/01/2026 e sem término cadastrado.
Os três líderes têm papel lider_departamento vigente. A rota usa RBAC, não registros
legados de menu; a ausência desses registros não impede os acessos confirmados.
Os funcionários dos cinco participantes constam como Trabalhando no cache de 02/09/2026.
Isso confirma configuração, não disponibilidade pessoal, sessão válida ou acesso Alvo ao vivo.

| Cenário | Participantes e CCs | Disponibilidade |
|---|---|---|
| Autor líder de apenas um CC | Caio autor; Engenharia A + Marketing B; Ana aprova B | **Disponível sem atribuições**. Caio lidera somente A, inclusive no mapa completo |
| Dois líderes precisam decidir | Mirlene autora, cabeçalho A escolhido explicitamente, itens A/B; Caio decide A, Ana decide B por último | **Disponível sem atribuições**. Mirlene não lidera nenhum; duas decisões efetivas |
| Dois líderes alternativos no mesmo CC | Mirlene autora, Engenharia A + Marketing B; Caio e outro líder em A | **Indisponível hoje**. Nenhum dos 15 CCs com vínculo ativo tem dois líderes |

Para o terceiro caso, uma proposta mínima é **um vínculo ativo adicional de Guilherme
Oliveira em Engenharia `00010.00002.00005`**, preservando o vínculo de Caio. Guilherme já
tem role/permissão necessárias: não precisaria torná-lo admin nem criar outro papel.
Essa atribuição alteraria autoridade real de aprovação; exige autorização posterior e
decisão do responsável pelo cadastro. Não foi feita. Alternativamente, manter o caso
somente local até existir necessidade legítima de dois líderes. Se for autorizado,
testar em dois documentos: Caio satisfaz A em um, Guilherme satisfaz A no outro; Ana
fecha B em ambos. Um segundo clique de outro líder A nunca deve cobrir B.

Guilherme e Elisangela constam apenas no levantamento de cadastros: não fazem parte
dos quatro participantes habilitados na janela atual. Qualquer ensaio que dependa
deles também exige ajuste autorizado da lista do aceite; nada disso foi executado.

**Identidade de envio:** Caio/Guilherme têm alvo_usuario NULL em profiles. Isso não
impede decidir; se iniciarem envio, o contrato atual usa fallback provisório auditado.
Neste aceite Ana fará a aprovação final e iniciará envio com seu login explícito.
Não copiar codigo_usuario do cache de funcionários: os valores observados (inclusive
PEDRO.SCRIGNOLI/KEMILLY.ARAUJO) não provam o login pessoal desses requisitantes.
Para aceitar envio final pessoal de Caio/Guilherme, falta confirmação/cadastro de login
em etapa separada; não há backfill implícito nesta preparação.

## Primeiro caso preenchido: Caio dispensa apenas Engenharia

Participantes: **Caio** autor, **Ana** aprovadora final; ambos não-admin. Mirlene pode
acompanhar o espelho com view_all, sem agir como aprovadora. Presença a combinar.

**Próximo passo na retomada:** combinar presença de Caio/Ana, preencher a data/hora
real do teste em BRT, confirmar finalidade/classe e data de necessidade, e então
seguir o passo 1. Data do teste: **a preencher na retomada** (08/09/2026 BRT se o
ensaio ocorrer no dia seguinte à preparação; ajustar se houver adiamento).
Acrescentar essa data/hora à identificação do documento. Não registrar como executado
com a data da validação do formulário de Pedro.

| Campo | Valor proposto para o ensaio autorizado |
|---|---|
| Identificação | `ACEITE-MULTICC-CAIO-ANA-01` (acrescentar data/hora da janela para unicidade) |
| Data/hora do teste (BRT) | A preencher na retomada; caso ainda não iniciado |
| Filial | `1.01` (padrão do fluxo; confirmar disponibilidade operacional na janela) |
| Requisitante | Caio, funcionário `0000168`; não trocar para funcionário de Ana |
| CC cabeçalho A | `00010.00002.00005` — Engenharia de Manufatura; também é o CC do funcionário no cache |
| CC B | `00007.00001.00002` — Marketing e Comunicação |
| Produto dos dois itens | `001.013.00382` — AMOSTRA DE PERICÁRDIO BOVINO; Load já salvo |
| Item 1 | UNID, posição 2, solicitada 10, principal 1, CC A |
| Item 2 | UNID, posição 2, solicitada 20, principal 2, CC B |
| Finalidade proposta | `0000001` — ESTOQUE, opção existente no wizard |
| Classe proposta por item | `13.07` — COMPRA DE MATERIAL DE CONSUMO NA PRODUCAO, 100%; cadastro ativo, grupo F, Débito |
| Rateio geral entre CCs | Vazio neste primeiro caso; os dois CCs vêm de cabeçalho/itens |
| Data de necessidade proposta | 10/09/2026; confirmar ou ajustar na retomada conforme a data efetiva e a necessidade acordada |
| Anexo | `tests/aceite-multicc.txt`, 52 bytes |
| SHA-256 do anexo | `2c67d03a84fd56ea05f5dad71fac863fcf3d369f1cf1a4c9ce82e1c8e098fdbe` |

**Ainda confirmar com Suprimentos antes do Insert:** finalidade/classe propostas são
valores existentes, não uma associação contábil comprovada para esse produto; confirmar
se esse documento de ensaio é aceitável nesses CCs e quem o encerrará posteriormente.
Não tratar proposta preenchida como autorização comercial. Calcular novamente o hash
dos bytes anexados se houver conversão de fim de linha pelo checkout.

1. Com implantação concluída e aceite-3 conferido, Caio entra com a própria sessão.
   Confirmar perfil não-admin, acesso à criação e vínculo com funcionário 0000168.
2. Criar os dois itens acima, conferir unidade/posição e CC individual; preencher
   cabeçalho A e anexo. Revisão deve listar somente A e B, sem duplicar A.
3. Submeter. Esperado: `PENDENTE`, status pendente_aprovacao; grupo A dispensado_autor,
   grupo B pendente; autor da dispensa Caio. Nenhum número Alvo nem Insert neste ponto.
4. Caio abre detalhe/fila: vê A satisfeito e espera B. Reenvio antecipado deve ser
   recusado pelo backend e não gerar Insert. Conteúdo, quantidades, rateio e anexos
   submetidos permanecem congelados. Não provocar mutações de serviço em produção.
5. Ana entra na própria sessão não-admin, abre fila e detalhe da requisição (CC B),
   confere as duas quantidades e o anexo. Aprova B: esperado `FINAL` e fechamento dos
   dois grupos. Ana não precisa liderar o cabeçalho A para acessar/decidir esse caso.
6. O gateway recebe somente ID/JWT; snapshot usa requisitante Caio/0000168 e operador
   `ANA.SANCHES`. Conferir um token de reserva e **um único SaveMultiPart** no Alvo,
   com CCs A/B e tuplas UNID/2/10/1 e UNID/2/20/2. Sem login_servico_provisorio nesse envio.
7. Registrar número retornado, conferir ReqComp/Load e anexo no Alvo, espelho atualizado
   e eventos efetivamente gravados: dispensa A, pendência B, aprovação B, reserva e sucesso.
   Segundo envio do mesmo ID deve recusar sem novo Insert. Não provocar timeout real.
   O cron permanece suspenso: não aguardar ciclo automático nem reativá-lo para este
   teste. Se necessário, usar a conferência/sincronização manual prevista no detalhe
   e registrar seu resultado separadamente.
8. Guardar IDs, horários, número Alvo, payload/response sem credenciais, grupos e hash.
   Encerramento do documento de ensaio fica com o responsável previamente designado,
   preservando auditoria. Divergência em qualquer passo impede liberar o restante do rollout.

## Unidades: validação do formulário concluída, envio ainda pendente

Na versão publicada aceite-3, ao selecionar 001.017.092, a sugestão continua
**M3 posição 3 (compras)**. Ambas as M3 aparecem como indisponíveis. Aviso visível junto
ao seletor explica Divisor ainda não validado e que o item não pode ser adicionado.
Próximo/Adicionar ficam desabilitados e os handlers recusam avanço; UNID não é escolhida
automaticamente. Seleção explícita de UNID/1 permanece possível quando corresponder à
necessidade real. Nenhuma conversão nova foi implementada.

Validação autenticada registrada no commit **519739b**: DRYPATCH 001.001.00051 retornou
200 em 54,794s, com UNID/1 automática; AMOSTRA 001.013.00382 retornou 200 em 2,626s,
UNID/2 compras, e permitiu avanço ao rateio com 10 e 20; M3/3 retornou 200 em 1,624s
e manteve o bloqueio antecipado. Temas claro/escuro e menus foram inspecionados.
O mesmo validador conferiu as respostas reais: 10→10/20→20 para DRYPATCH e 10→1/20→2
para AMOSTRA. Não houve persistência, submissão ou Insert real pelo agente.
Regressão anterior da correção: 125 testes frontend (sete falhas antigas de sidebar
excluídas), 3 Node e 25 HTTP Express/JWKS; build final passou. Não foram repetidos
nesta atualização documental. A validação real usou admin; Caio/Ana continuam pendentes.

## Checklist de implantação concluída e aceite pendente

- [x] Janela, implantação coordenada e abertura restrita autorizadas e executadas.
- [ ] Reservar Caio/Ana/Mirlene, preencher data/hora e validar campos comerciais
  do caso 1. Decidir se caso de líderes alternativos fica local ou terá atribuição autorizada.
- [x] Baselines/cópias preservados; versões publicadas: gateway fc505e2, SQL integral
  20260907184223, Edge v51 e frontend aceite-3. Evidência de formulário: 519739b.
- [x] Verificações técnicas registradas: SQL, Storage HTTP/S3, Express, unidades,
  type-check/build e Deno. Datas e limites em deployment/IMPLANTACAO.md.
- [x] Criação/envio suspensos durante a troca; depois abertos somente aos 4 participantes.
  Cron e sync de requisições continuam desligados, com estado anterior preservado.
- [x] Gateway publicado com gate e bloqueio dos dois Inserts antigos.
- [x] Pré-voo sem transições/envios incertos; definições anteriores salvas.
- [x] SQL inteiro aplicado em transação e verificado, sem supabase db push.
- [x] Edge/shared e frontend publicados e conferidos; unidades validadas no formulário real.
- [ ] Executar caso 1 acima e caso de duas aprovações de Mirlene; conferir Alvo, bytes,
  trilha e não-admin. Caso alternativo só se a configuração existir/autorizada.
- [ ] Liberar operação e cron somente após aceite; conferir primeiro ciclo e erros reais.
- [ ] Em falha, manter Inserts bloqueados. Pré-HTTP/412 explícito pode permitir retry pelo
  contrato; timeout/409/5xx ambíguos exigem reconciliação, nunca limpar token manualmente.
  Se Alvo já criou, repetir só conclusão idempotente autorizada. Após uso, preservar
  grupos/auditoria e não restaurar funções antigas isoladamente. Ver ACEITE-ALVO.md.
