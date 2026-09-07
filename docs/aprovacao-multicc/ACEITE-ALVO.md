# Roteiro de aceite — preparado, não executado

Matriz de participantes existentes, primeiro caso preenchido e checklist final em
`ACEITE-PREENCHIDO.md`; os nomes R/LA/LB abaixo são a especificação geral dos cenários.

## Pré-condições e identidades

Não executar este roteiro sem autorização posterior para implantação e Inserts.
Consulta e classificação dos 171 produtos concluídas, sem nova rede na análise:
194 unidades suportadas e M3/2 e M3/3 Divisor de 001.017.092 bloqueadas; M3/3 é compras.
Manter esse bloqueio até captura nativa do contrato; ver `CLASSIFICACAO-UNIDADES.md`.
O usuário
confirmou no Render o Live `76f67b2`, branch main, deploy 06/09/2026 às 17h28, mesmo
commit contra o qual o patch aplica. Reconfirmar Live antes da janela para detectar
novo deploy. Registrar responsáveis por gateway, SQL, frontend e Alvo.

Reservar dois CCs válidos **A e B** e um CC **C** para rateio; usar códigos reais conferidos
no cadastro. Não criar nem alterar líderes de produção para fabricar cenários sem plano
separado. Selecionar usuários existentes com esta matriz, registrando UUID e login Alvo
no checklist operacional privado, sem credenciais:

| Identidade | Configuração necessária |
|---|---|
| R | Requisitante não-admin; create e reenviar_own; não lidera A/B/C |
| LA | Não-admin; lider_departamento e compras_lideres_cc ativo em A; aprovar e create |
| LA2 | Outro líder ativo de A, não-admin, aprovar |
| LB | Líder ativo de B, não-admin, aprovar |
| LC | Líder ativo de C, não-admin, aprovar |
| X | Não-admin, create; sem liderança nos CCs do ensaio |
| ADM | Conta administrativa separada, somente no caso de exceção explícita |

LA pode cobrir C se já houver essa atribuição; registrar a matriz real antes do ensaio.
Para CC sem líder, usar apenas CC já existente sem líder/role elegível. Se não houver,
esse cenário permanece coberto localmente até autorização para montar uma configuração.
Conferir que líderes alternativos satisfazem o mesmo grupo e que ser admin autor não
dispensa automaticamente CC alheio. Nenhuma atribuição ou dispensa será inferida por nome.

Usar filial, funcionário requisitante, finalidade, classe e data válidos no Alvo,
acordados com Suprimentos. Identificar documentos com marcador único `ACEITE-MULTICC-<data>-<caso>`.
Definir previamente o destino dos documentos de teste e quem os encerrará no Alvo;
não apagar trilha nem cancelar automaticamente. Produto 001.013.00382 exige Load fresco:
UNID posição 2/Peso 0.1 e base PACOTE posição 1/Peso 1 devem continuar confirmados.
Anexo pequeno conhecido, SHA-256 registrado antes da criação; não usar dados pessoais.

## Casos e resultados esperados

| Caso | Passos | Resultado esperado |
|---|---|---|
| A: autor líder parcial | LA cria cabeçalho A, itens A/B; submete | A dispensado_autor, B pendente; zero Insert até LB aprovar |
| B: todos os CCs | R cria cabeçalho A, item B, rateio C; submete; LA aprova; LB aprova; LC aprova | Exatamente 3 grupos, apesar de repetições; somente última decisão inicia um Insert |
| C: líderes alternativos | R submete A/B; LA e LA2 decidem A; LB decide B | Uma aprovação basta em A; segunda decisão A não cobre B nem duplica envio |
| D: autor lidera todos | LA cria somente CCs que já lidera, inclusive multi-CC se aplicável | Dispensas limitadas aos CCs efetivamente liderados; um envio após fechamento |
| E: rejeição | Líder envolvido rejeita com motivo de catálogo; Outros exige observação | Rejeição terminal; nenhuma aprovação/envio posterior; clone é nova requisição |
| F: sem líder | R usa CC existente sem líder | Dispensa auditada; enquanto pendente reavaliar elegibilidade; após fechamento preservar snapshot |
| G: exceção admin | ADM cria requisição com CC alheio; depois faz aprovação explícita no caso controlado | Submissão não autoaprova só por ser admin; ação administrativa satisfaz pendências com trilha |
| H: concorrência | Duas sessões aprovam grupo final quase juntas | Decisão serializada; no máximo um token e um Insert; nenhuma duplicação |
| I: congelamento | Após submissão tentar alterar cabeçalho, item, rateio e anexos pelo app/API autenticada | Rejeição no backend; grupos, tupla e SHA permanecem iguais |
| J: unidades/anexo | Dois itens UNID posição 2, solicitadas 10/20; concluir aprovações | Payload/response e ReqComp/Load: 10/1 e 20/2; multipart preserva arquivo e CCs |
| K: clone/sync | Abrir documento enviado, sincronizar, clonar | Preservar principal, solicitada, unidade e posição; histórico incompleto exige Load original |
| L: isolamento | X tenta decidir/enviar ID alheio; JWT Hub IA/system tenta nova rota | Recusa antes do Insert; usuário não-admin envolvido acessa fila/detalhe corretos |
| M: legado | Em ambiente autorizado, testar Insert antigo e insert-multipart | 409 antes de handler legado/multer; consulta GET legada continua disponível |

Falta de formato comprovado (Divisor/dimensional/base/precisão) deve bloquear criação/envio
com motivo explícito. Não fabricar um produto no Alvo para testar esse erro: usar um
produto real identificado pelo levantamento ou manter a comprovação local.
Timeout, 5xx, perda de confirmação e corrupção de objeto ficam no ensaio local com ERP
simulado. Não provocar falhas destrutivas ou Inserts ambíguos no Alvo de produção.

Para cada caso, guardar ID Hub, matriz/grupos antes/depois, autor/decisor, eventos reais,
token de envio em registro operacional restrito, número Alvo, request/response sem
credenciais, ReqComp/Load final, SHA dos anexos e horários. Sucesso visual sozinho não
é aceite. Consultar quantidade de Inserts nos logs do gateway/ERP e correlacionar IDs.

## Sequência futura de implantação coordenada

1. Revisão conjunta do diff, contratos não suportados e relatório de cobertura. Fixar
   SHA do frontend/Edge/gateway e SHA do deploy live anterior. Conferir dependências
   efetivas no Render (repo não tem lockfile) e testar o patch contra o SHA confirmado.
2. Janela autorizada com criação/envio suspensos operacionalmente; afastar os crons
   07h30/12h30/16h30 BRT conforme configuração vigente. Se necessário, kill-switch de
   sync somente sob autorização explícita, anotando valor anterior e responsável.
3. Instalar gateway protegido durante a janela, fechando ambos os Inserts antigos.
   Até o SQL estar aplicado, nova rota pode recusar; manter usuários fora do fluxo.
   Conferir health, SHA implantado e bloqueio das rotas antes de prosseguir.
4. Executar PREVIEW de VERIFY.sql. Se houver requisições em transição sem número,
   interromper; reconciliar caso a caso antes da migração. Salvar definições prévias.
5. Aplicar migração versionada inteira numa única transação por conexão direta.
   Nunca `supabase db push`, nunca fracionar SQL. Rodar VERIFY e conferir constraint,
   ACLs, policies, funções e tabelas; erro implica rollback transacional.
6. Instalar Edge de sync com shared de unidades e frontend correspondente. Type-check
   Deno/frontend, build e verificações locais são pré-requisitos, não comandos em produção.
   Manter bloqueio operacional até todas as versões estarem conferidas.
7. Executar primeiro A/J com não-admin, conferir Alvo/bytes/auditoria, depois demais
   casos aplicáveis. Só então liberar usuários e retomar cron com valor anterior.
   Monitorar primeiro ciclo de sync e desfechos de envio; erro silencioso não é sucesso.

## Recuperação em caso de falha

- Antes do SQL: manter Inserts fechados e corrigir gateway/configuração; não abrir rotas
  antigas para contornar o gate. Sem transações novas, pode encerrar janela e reagendar
  mediante decisão do responsável, registrando a versão que ficará disponível.
- Falha da transação SQL: rollback integral, sem marcar migração como aplicada. Manter
  fluxo suspenso enquanto componentes estiverem incompatíveis.
- Falha pré-HTTP (Load, hash, objeto ausente): reserva pode ser liberada pelo backend;
  conferir erro, corrigir causa e reenviar apenas se a tupla/conteúdo aprovado permanecer
  válido. Mudança de fator ou conteúdo exige clone/revisão, não editar aprovado.
- 412 explícito sem número: falha definitiva permite retry após corrigir causa, respeitando
  congelamento. Não generalizar essa autorização a 409, timeout, 5xx ou resposta ambígua.
- HTTP incerto: token permanece bloqueado. Nunca limpar token ou repetir Insert por
  UPDATE manual. Responsável consulta logs/Alvo e número/documento correspondente;
  confirmar existência/ausência com evidência antes de reconciliação autorizada.
- Número confirmado no Alvo e falha de persistência: repetir somente conclusão idempotente
  da mesma tentativa por mecanismo administrativo autorizado; não recriar documento.
- Após uso da nova aprovação: preservar grupos e auditoria; não restaurar funções antigas
  isoladamente. Bloquear novos envios, reconciliar todos os tokens e preparar correção
  compatível. Reverter somente o frontend/SQL reabriria o defeito multi-CC.

Este documento não autoriza nenhuma dessas ações em produção.
