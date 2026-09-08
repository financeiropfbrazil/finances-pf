# Implantação multi-CC — estado consolidado para retomada

**Aceite-3 publicado e carregamento de unidades validado. O teste Caio/Ana ainda não começou.
A operação geral permanece suspensa.**

Esta atualização é somente documental, baseada nas verificações já registradas.
Não houve nova consulta, migração, alteração de cron/janela, deployment ou Insert
em produção nesta revisão. Evidências da validação real: commit **519739b**.

## Versões efetivamente publicadas

| Componente | Versão publicada | Evidência |
|---|---|---|
| Frontend Financial Hub | multicc-20260907-aceite-3; código da correção em 2e6d39f | Marcador /multicc-version.json HTTP 200 e JS /assets/index-D_wmRFC0.js conferidos no site finance-pf.lovable.app |
| Gateway erp-proxy | fc505e2ee0d69deb306c8aaef3e1de8f901bcfdc, main | /health confirmou revision e unidades=multicc-aceite-3-leitura-120s |
| SQL multi-CC + janela | Histórico 20260907184223, aplicado às 18:42:23 UTC de 07/09/2026 | SQL-INTEGRAL.sql inteiro em uma transação no projeto hbtggrbauguukewiknew; verificações posteriores concluídas |
| Edge sync-compras-status-cron | v51 ACTIVE; verify_jwt=false preservado | Fonte e shared recuperados após deployment e iguais aos locais; ACTIVE indica código publicado, não cron habilitado |

SHA-256 do JS publicado:
1b8e182b26f3cfc8f0f0eb5f65d824333c40266f80041079f27401fc3a560c68.

SHA-256 do bundle Edge:
d6aeba6bd9a420b33c0abf67d5af8928a528c79f45efaf5650a6852a4106a049.

O /health preserva requisicoes=multicc-20260907-aceite-1 para o contrato multi-CC
original e expõe unidades=multicc-aceite-3-leitura-120s para a correção atual.
Isso não significa que o gateway esteja desatualizado. Limites da leitura:
120s no gateway e 135s no formulário; tentativas de Insert não foram ampliadas.
Build Render: npm install && npm run build; Start: npm start.

O commit **519739b** registra evidências, testes e documentação da validação
autenticada; não representa outra versão de código a publicar no Lovable.
A implantação está concluída. Esta revisão documental também não requer Publish.

## Validação real do formulário — commit 519739b

| Produto | HTTP / duração até cabeçalhos | Resultado observado |
|---|---|---|
| 001.001.00051 — DRYPATCH | 200 / 54,794s | UNID/1 automática, seletor e avanço habilitados; concluiu acima do antigo limite de 45s |
| 001.013.00382 — AMOSTRA | 200 / 2,626s | UNID/2 compras automática; avanço local ao rateio com quantidades 10 e 20 |
| 001.017.092 — CILINDRO | 200 / 1,624s | M3/3 compras mantida e bloqueada por Divisor antes de adicionar, sem substituição automática por UNID |

Sessão real: Pedro Scrignoli, admin; frontend, gateway e Alvo reais, sem
interceptação de resposta. Temas claro/escuro e menus conferidos e capturas inspecionadas.
Formulário encerrado vazio; nenhum item/requisição persistido ou Insert executado.
O mesmo validador aplicado às respostas salvas confirmou DRYPATCH 10→10/20→20,
AMOSTRA 10→1/20→2 e bloqueio M3/3. Não houve backfill nem ampliação de conversões.

Evidências: [resultado real](../tests/formulario-aceite-3/resultado.json),
[conversões](../tests/formulario-aceite-3/conversoes.json), capturas no mesmo diretório
e [diagnóstico/correção](../CORRECAO-TIMEOUT.md).
O log anterior mostrou 48,59s entre entrada do handler e conclusão da autenticação
Alvo, ultrapassando os 45s antigos. A correção remove o prazo prematuro; não elimina
a lentidão do ERP. O sucesso do formulário não é aceite de submissão/aprovação/envio.

## Restrições, cron e sincronização — manter na retomada

| Controle | Último estado confirmado |
|---|---|
| compras_requisicoes_janela.modo | aceite, não aberta |
| Participantes habilitados | Pedro Scrignoli, Caio Santos, Ana Sanches e Mirlene Oliveira — somente esses quatro |
| Criação/alteração e início de envio | Restritos ao aceite; prefixo ACEITE-MULTICC-, documento novo da janela e autor participante |
| Cron de requisições, jobid 1 | active=false |
| sync_settings, job_name=sync-compras-status-cron | enabled=false; sincronização automática suspensa |
| Schedule preservado do jobid 1 | 0 11-20 * * 1-5 UTC; não restaurar automaticamente |
| Lideranças, RBAC, outros crons | Não alterados pela implantação/correção; a suspensão não abrange todos os syncs do gateway |

A abertura restrita foi executada em 07/09/2026 às 15:59:31 BRT
(18:59:31.536119 UTC). Admin não ignora a janela, e ser participante não dispensa
aprovações de CCs alheios. A tabela da janela e o corpo original de envio não são
editáveis/chamáveis diretamente pelos clientes ou service_role.

Os últimos pré-voos registrados estavam sem transições e sem tokens de envio sem
confirmação; não houve reconciliação nem descarte por suposição. Na retomada,
reconferir versões e restrições somente por leitura e investigar qualquer divergência.
Não executar novamente ABRIR-SOMENTE-ACEITE.sql nem SQL-INTEGRAL.sql.

**A operação geral permanece suspensa até confirmação explícita do usuário após o
aceite. Cron e sincronização automática não devem ser religados para executar Caio/Ana.**

## Etapas concluídas e histórico preservado

| Etapa | Registro |
|---|---|
| Baselines e cópias | Financial Hub 8f1e315b898e5164d22dca96e7c8acc79d77c946; gateway 76f67b2843061e7e9fb846ba8bac876901773585; Edge v50 e definições SQL/ACLs/policies em antes/ |
| Pausa durante a troca | PAUSAR.sql em 07/09 16:24:27 UTC; suspensão da criação/envio e jobid 1/sync desativados, estado anterior salvo em antes/preflight.json |
| Primeiro gateway multi-CC | 4ef34d5 confirmado por /health; divergência inicial do Render resolvida antes de aplicar SQL |
| SQL integral e Edge | 20260907184223 em transação, sem supabase db push; Edge v51 publicada e conferida |
| Primeiro frontend e abertura | Aceite-1 e JS conferidos; aberta somente a janela restrita, em 07/09 15:59:31 BRT |
| Correção de seletores | Aceite-2 publicado; estados de carregamento/erro e componentes de tema corrigidos |
| Correção de timeout | Gateway fc505e2 Live confirmado em 08/09 00:04 UTC (07/09 21:04 BRT); frontend aceite-3 publicado e validado |
| Evidências finais | Commit 519739b: formulário autenticado, três produtos, conversões e capturas |

A cronologia detalhada anterior permanece no histórico Git do documento em 519739b,
e nos arquivos antes/, render-divergencia.json, lovable-verificacao.json e
aceite-aberto.json. Os antigos estados de espera não são instruções vigentes.

Verificações já executadas, não repetidas nesta revisão documental:
112 SQL na implantação; 52 Storage HTTP/S3 na preparação; 125 regressões frontend
(sete falhas antigas de sidebar excluídas); 3 testes Node de autenticação/cancelamento;
25 HTTP Express/JWKS incluindo não-admin; type-check frontend/gateway, Deno integral
e builds aprovados. Build final da validação: 32,42s, com avisos legados de bundle.
Não declarar o ensaio HTTP local não-admin como teste Caio/Ana em produção.

Na implantação foram observados 7 arquivos de rascunhos sem hash e 50 itens sem
tupla histórica completa. Não houve backfill: exigir reanexo/Load original conforme
o contrato. Esses números são observações daquele pré-voo, não contagem nova.

## Próximo passo: primeiro caso Caio/Ana, ainda não iniciado

Seguir [ACEITE-PREENCHIDO.md](../ACEITE-PREENCHIDO.md). Na retomada, preencher
data/hora real do teste em BRT e ajustar a data de necessidade; confirmar presença,
finalidade/classe e responsável pelo encerramento do documento de ensaio.

Caio deve submeter Engenharia A + Marketing B: somente A dispensado_autor, B pendente,
sem número/Insert no Alvo. Ana aprova B: fechamento de todos os grupos e um único
envio, preservando UNID/2 e tuplas 10/1 e 20/2, anexo e auditoria. O teste ainda não
tem ID Hub, número Alvo ou resultado. Casos seguintes, inclusive Mirlene com duas
decisões, continuam pendentes. Líderes alternativos exigem configuração adicional
autorizada e, se necessário, inclusão do participante na janela; não feita.

Não aguardar cron para a conferência do documento; registrar eventual sincronização
manual separadamente. Qualquer falha mantém a operação geral suspensa.

## Recuperação e liberação posterior

Seguir [ACEITE-ALVO.md](../ACEITE-ALVO.md). Preservar grupos/auditoria, não abrir
Inserts antigos, não limpar tokens nem repetir Insert com resposta incerta.
Número já criado no Alvo com falha de persistência permite somente conclusão
idempotente por mecanismo autorizado. Não restaurar SQL antigo isoladamente.

Somente após o aceite e confirmação explícita do usuário: reconferir envios incertos,
registrar decisão e restaurar modo aberta, active=true e enabled=true conforme
estado anterior, preservando o schedule e o histórico da pausa. Acompanhar o primeiro
ciclo de sincronização. Nenhuma dessas mudanças foi feita nesta atualização.
