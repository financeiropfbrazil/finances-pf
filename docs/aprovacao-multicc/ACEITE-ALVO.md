# Roteiro de aceite — implantação concluída; caso Caio/Ana não iniciado

Gateway **fc505e2**, SQL integral **20260907184223**, Edge **v51** e frontend
**multicc-20260907-aceite-3** publicados e conferidos. Carregamento das unidades,
seleção automática, avanço local e bloqueio M3 validados no formulário real na sessão
de Pedro (admin), sem persistência. Evidências do commit **519739b** em
[resultado.json](tests/formulario-aceite-3/resultado.json) e capturas no mesmo diretório.

**O teste Caio/Ana ainda não começou. A operação geral permanece suspensa.**
Somente Pedro, Caio, Ana e Mirlene estão habilitados para o aceite; cron jobid 1
inativo e sync-compras-status-cron desabilitado em sync_settings. Não repetir a
implantação nem reabrir a janela: modo atual é aceite. Estado e versões completos em
[IMPLANTACAO.md](deployment/IMPLANTACAO.md). Nenhum cadastro de liderança foi alterado.

Matriz de participantes existentes, primeiro caso preenchido e checklist final em
`ACEITE-PREENCHIDO.md`; os nomes R/LA/LB abaixo são a especificação geral dos cenários.

## Pré-condições e identidades

Implantação e abertura restrita já foram autorizadas e concluídas. O usuário fará os
ensaios de requisição/aprovação e os Inserts correspondentes; o agente não criou nem
enviou requisições de teste. Antes do primeiro caso, preencher data/hora da retomada,
confirmar campos comerciais e presença dos participantes conforme ACEITE-PREENCHIDO.md.
A validação do carregamento não é aceite do fluxo completo.
Consulta e classificação dos 171 produtos concluídas, sem nova rede na análise:
194 unidades suportadas e M3/2 e M3/3 Divisor de 001.017.092 bloqueadas; M3/3 é compras.
Manter esse bloqueio até captura nativa do contrato; ver `CLASSIFICACAO-UNIDADES.md`.
O Live atual do Render foi confirmado por /health em **fc505e2**, com
`unidades=multicc-aceite-3-leitura-120s`; o frontend usa 135s e aviso de espera.
`76f67b2` é apenas o baseline anterior à implantação; `4ef34d5` foi a primeira
publicação multi-CC, substituída pela correção de leitura. Na retomada, conferir
somente por leitura se versões e restrições permanecem iguais, registrando qualquer
divergência antes de iniciar o ensaio.

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

**Todos os casos de submissão/aprovação/envio abaixo permanecem pendentes no Alvo
real.** A parte de leitura/seleção do caso J já foi validada em 519739b, mas payload
de Insert, resposta de criação, anexo enviado, ReqComp/Load do novo documento e
aprovações não foram ensaiados. LA=Caio e LB=Ana no primeiro caso preenchido.

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

## Implantação realizada e sequência de retomada

1. **Concluído:** revisão, testes locais, baselines e cópias das definições em
   deployment/antes/. Contratos não comprovados continuam bloqueados.
2. **Concluído:** pausa autorizada da criação/envio e do cron de requisições, com
   estado anterior registrado. Schedule real preservado: 0 11-20 * * 1-5 UTC;
   cron jobid 1 e sync_settings do job seguem desativados. Outros crons não foram alterados.
3. **Concluído:** gateway multi-CC publicado, incluindo bloqueio dos Inserts antigos;
   correção de leitura fc505e2 também publicada e conferida pelo /health.
4. **Concluído:** pré-voo sem transições ou envios sem confirmação, com cópias prévias.
   Nenhum registro foi reconciliado ou descartado por suposição.
5. **Concluído:** SQL-INTEGRAL.sql aplicado inteiro em transação no projeto
   hbtggrbauguukewiknew, histórico 20260907184223; verificados grupos, auditoria,
   ACLs e guards de dados/Storage. Não foi usado supabase db push.
6. **Concluído:** Edge v51 e frontend aceite-3 publicados, abertura restrita para
   quatro participantes e validação real do formulário registrada em 519739b.
7. **Próximo passo, ainda não iniciado:** preencher data/hora, confirmar campos e
   presença de Caio/Ana, conferir somente por leitura versões/restrições e executar
   A/J conforme ACEITE-PREENCHIDO.md. Depois, casos aplicáveis de Mirlene e demais
   cenários; líderes alternativos dependem de configuração adicional autorizada.
8. **Pendente de confirmação explícita do usuário após o aceite:** liberar operação
   geral e restaurar cron/sync ao estado anterior. Não reativar automaticamente ao
   terminar um caso; registrar decisão e acompanhar o primeiro ciclo quando autorizado.

## Recuperação em caso de falha

O SQL já está aplicado e a janela está em aceite. Os dois primeiros itens abaixo
são referências para falha em uma eventual nova troca; não instruem desfazer a
implantação concluída. Para qualquer falha do aceite, preservar restrições, grupos,
auditoria e tokens, e aplicar o cenário correspondente sem supor ausência de Insert.

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

Este documento registra a implantação autorizada e os ensaios ainda pendentes.
Sua atualização não altera produção nem autoriza liberação geral, atribuições novas,
limpeza de tokens ou Inserts pelo agente. A retomada dos ensaios fica com o usuário.
