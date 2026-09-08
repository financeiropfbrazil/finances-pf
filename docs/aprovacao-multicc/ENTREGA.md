# Aprovação de requisições por todos os centros de custo

**Preparação local — não aplicada em produção, não commitada, sem push e sem publicação.**

## Alterações

`20260907111805_aprovacao_requisicoes_todos_ccs.sql` cria um grupo por CC distinto,
congela o conteúdo antes do envio, registra a dispensa limitada do autor e permite
decisões parciais. Líderes alternativos, rejeição terminal com catálogo, CC sem líder
auditado e exceção administrativa foram preservados. CC sem líder é reavaliado durante
a pendência e sua dispensa fica congelada no fechamento.

O wizard permite CC próprio por item e distribuição classe → CC → percentual; clonar
preserva ambos. O conjunto de CCs aparece na revisão. Fila e detalhe consultam RPCs
com autorização no backend, diferenciam pendência própria e espera pelos demais,
e só iniciam envio na aprovação final. Erro de carregamento não vira fila vazia.
A criação só é concluída após gravar itens, classes, rateio e anexos; falhas parciais
bloqueiam a submissão e pedem clonar/conferir o conteúdo e reanexar os arquivos.
Rascunhos anteriores à migração mantêm compatibilidade e devem ser conferidos no aceite.

O envio foi centralizado no gateway: navegador passa ID e JWT; gateway obtém snapshot
do banco, constrói payload com CC do item e rateio, busca anexos no Storage e confirma
resultado. As duas rotas antigas de Insert são bloqueadas pelo patch. Reserva com
token impede duas tentativas simultâneas. Timeout/409/5xx/resposta sem número não
liberam nova tentativa; erro anterior ao HTTP ou validação 412 do Alvo libera retry.
Login pessoal e fallback provisório foram transferidos ao backend, com auditoria.

### Correções da revisão (07/09/2026)

A fixture agora reproduz a constraint de eventos de produção. Antes da correção,
`native.mjs --antes` demonstrou **zero eventos novos de CC gravados** e erro **23514**
para `login_servico_provisorio` e `envio_reivindicado`. A migração preserva a expressão
vigente da constraint e acrescenta sete eventos; os 17 anteriores continuam aceitos.
As novas decisões usam `req_evento_obrigatorio`, sem captura silenciosa de erro.
Falha de auditoria reverte a decisão inteira. `_req_evento` legado permanece intacto.

Policies RESTRICTIVE no bucket privado limitam INSERT/DELETE ao rascunho do autor
ou admin com permissão de criação. UPDATE continua sem concessão permissiva, como
em produção; o upload usa `upsert:false`. O helper bloqueia o pai durante a operação
SQL para serializar com submissão. Leitura do gateway `service_role` continua válida.
Cada upload grava SHA-256; o hash/metadado congela na submissão, e o gateway confere
os bytes baixados antes de enviá-los. Hash ausente/divergente ou objeto ausente bloqueia
o HTTP ao Alvo. Anexos antigos sem hash exigem clonar e reanexar, sem backfill inventado.

### Unidades — continuação com Produto/Load real

A captura `load-gpt6-1.txt` e o contrato de Insert confirmado pelo usuário fecham o
formato **Fator**, base posição 1/Peso 1. A conversão usa o Peso do produto/unidade
selecionados: `principal = solicitada × Peso`, sem fator por código ou fator global.
O wizard consulta Produto/Load, escolhe por código **e posição** e sugere a unidade
marcada para compras quando há uma única. Na criação, o serviço consulta novamente
o cadastro antes de persistir `quantidade_solicitada`, `quantidade` (principal),
`codigo_prod_unid_med`, `posicao_prod_unid_med` e a evidência de conversão.

Submissão valida e congela esses campos. O gateway consulta Produto/Load por produto,
confere a tupla congelada e envia seus valores exatos. Mudança do fator não altera
quantidades aprovadas: bloqueia o envio e pede revisão numa nova requisição.
Sincronização pelo detalhe **e pelo cron** preserva ambos os números e a posição,
inclusive em itens existentes com CC inalterado. O detalhe mostra solicitada e principal.
Clonagem recupera ReqComp/Load quando os novos campos faltam; sem número/Load completo,
pede recriar os itens. Não há backfill por multiplicação/divisão em históricos incompletos.

Os casos reais **10 UNID → 1 principal** e **20 UNID → 2 principais**, posição 2,
passam nos testes com o Produto/Load anexado. A confirmação do Insert nativo é evidência
fornecida pelo usuário; nenhum novo Insert real foi executado por esta entrega.
**Divisor, base não normalizada, unidades dependentes/dimensionais e arredondamento
além de nove casas permanecem bloqueados**; capturas necessárias em `REVISAO.md`.


## Testes e evidências

- **100 verificações SQL aprovadas no PostgreSQL 17.4 local**, com roles, políticas RLS
  consultadas em produção e usuários sintéticos `is_admin=false`. O cenário específico
  de exceção administrativa usa uma identidade separada. Inclui duas conexões reais,
  aprovação/decisão concorrente, rejeição concorrente e mudança de item concorrente à
  submissão, exclusão concorrente de Storage, persistência de todos os sete eventos,
  rollback por falha de auditoria e manutenção dos 17 eventos anteriores. O servidor
  temporário foi encerrado ao fim.
- **111 testes de frontend/gateway aprovados** na suíte completa; os sete testes
  da barra lateral continuam falhando, como no baseline.
  O handler real do patch é exercitado com dependências substituídas; nenhuma chamada
  ao Alvo ou escrita em produção. Testes antigos de identidade foram transferidos para
  a nova fronteira: SQL valida resolução de login; frontend valida envio somente de ID;
  mapper valida identidade do operador e do requisitante separadamente. Inclui criação,
  clonagem com recuperação de Load, sincronização de itens existentes, funções reais
  do cron, tuplas 10/1 e 20/2, fator de outro produto e recusa de conversão alterada.
- **Baseline do HEAD `8f1e315`: 77 passam, 7 falham**, todos os sete em
  `sidebar-ordem.test.tsx`. Conferido em cópia temporária com o mesmo setup de testes.
- Type-check do frontend (`tsc --noEmit -p tsconfig.app.json`) e build Vite aprovados.
  Avisos existentes de tamanho de bundle, imports mistos e Browserslist permanecem.
- Patch do gateway aplica com `git apply --check` contra a cópia local em
  `76f67b2843061e7e9fb846ba8bac876901773585`; compilação TypeScript da cópia temporária
  com os três arquivos novos aprovada. Isso **não confirma** o código atualmente no Render.
- Componentes/helper/testes novos sem erros de ESLint. Arquivos legados mantêm
  ocorrências de `no-explicit-any`; não se declara lint global limpo.

## Reprodução local

As dependências de banco foram instaladas fora do projeto, em diretórios temporários;
`package.json` e lockfiles do aplicativo não mudaram. Para reproduzir no Windows:

```powershell
npm install --prefix "$env:TEMP/finances-pf-multicc-native" --no-save --package-lock=false embedded-postgres@17.4.0-beta.15 pg@8.16.3
node docs/aprovacao-multicc/tests/native.mjs
# Reproduz a falha anterior; exit 1 esperado:
node docs/aprovacao-multicc/tests/native.mjs --antes
bun run test --exclude src/test/sidebar-ordem.test.tsx
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
bun run build
```

Alternativa sem servidor nativo: instalar `@electric-sql/pglite@0.3.14` em
`$env:TEMP/finances-pf-multicc-tests` e executar `tests/run.mjs`. Essa alternativa
não executa os cenários de duas conexões e não substitui o teste de concorrência.

## Aplicação futura — exige revisão conjunta

**Não publicar componentes isoladamente.** A entrega agora inclui SQL, frontend, gateway
e `sync-compras-status-cron` com o módulo compartilhado de unidades.
O `erp-proxy.patch` está preparado neste repositório porque o plano de revisão §1.9
reserva a edição do gateway ao Pedro. Nenhum arquivo do repo externo foi alterado.

1. Executar o aceite de conversão Fator e Storage HTTP/S3, incluindo anexos legados.
   Os formatos ainda não comprovados continuam bloqueados. Conferir a versão atual do gateway e aplicar o patch em ambiente de revisão.
2. Programar uma janela curta sem criação/envios; bloquear os Inserts antigos no gateway.
3. Rodar o PREVIEW de `VERIFY.sql`. A migração aborta se houver pendentes, aprovadas
   ou envios em andamento sem número Alvo: nesse caso revisar a transição antes de aplicar.
4. Aplicar o arquivo SQL como transação integral via psql/conexão direta. **Não usar
   `supabase db push` e não fracionar a transação no SQL Editor.** Instalar o gateway e
   frontend e `sync-compras-status-cron` coordenadamente, mantendo a janela até o conjunto estar disponível.
5. Executar VERIFY e aceite real com requisitante e líderes não-admin, incluindo
   multipart, recusa do Alvo e reenvio. Essa validação real ainda não ocorreu nesta etapa.

Rollback antes de aplicar: descartar somente o diff desta entrega. Depois de uso:
primeiro bloquear novas criações no gateway e reconciliar tentativas; preservar
grupos/auditoria. As definições antigas estão em `funcoes-producao-antes.sql`, mas
restaurá-las isoladamente reabriria o defeito multi-CC e não é rollback operacional seguro.

## Limites conhecidos

A proteção cobre o fluxo de requisições do Hub. Requisições criadas diretamente no
Alvo continuam fora do gate, conforme R10. O espelhamento pode atualizar documentos
já enviados; o conjunto de aprovação permanece histórico na tabela de grupos.
Não foram modificadas as dívidas de RLS de `profiles`/cadastros ou o módulo Projetos.
Além dos testes SQL, o harness integrado executou Storage HTTP com backend de arquivos
e com S3 MinIO, Auth e PostgREST reais, e gateway com ERP HTTP simulado. A corrida
executada mantém a transação de submissão aberta antes do DELETE HTTP; não representa
todas as intercalações possíveis entre banco e backend de objetos. O hash evita envio silencioso de
bytes substituídos, mas não garante disponibilidade de um objeto removido por serviço.
Chaves service_role continuam sendo uma fronteira confiável e bypassam RLS.
Não houve login com pessoas reais nem criação de documento no Alvo: os testes de
permissão usam identidades sintéticas e o ERP é substituído nos testes do gateway.

## Diff para revisão

`diff-completo.patch` contém somente as alterações desta entrega, incluindo os
arquivos novos. `erp-proxy.patch` é o patch separado para o repositório do gateway.
Os arquivos não rastreados que já existiam no workspace foram preservados e excluídos.

## Validação integrada executada em 07/09/2026

- Deno **2.9.6** instalado em diretório temporário; check integral da Edge aprovado
  com dependências reais. Corrigidos `codigo_prod_unid_med` duplicado no mapper e
  `PedidoLeve.DataHoraDigitacao` ausente no tipo. O segundo erro foi reproduzido no HEAD.
- Docker não estava no PATH, nos caminhos usuais do Desktop, no registro nem no WSL.
  Instalados Docker **29.1.3** e Compose **2.40.3** no Ubuntu/WSL existente. Nenhuma
  instalação manual pendente. A sessão WSL precisa permanecer ativa durante o teste.
- **26 verificações HTTP aprovadas com backend file + 26 com S3 MinIO**, em bancos
  separados: Auth real, JWTs sintéticos de três usuários não-admin, PostgREST e Storage
  reais. Fixture adaptada preserva roles/schema Auth e tabelas Storage reais; a migração
  foi aplicada exclusivamente nesses bancos locais. ERP simulado via HTTP.
- Upload e limpeza de rascunho, recusa de terceiros, DELETE/upsert/PUT/novo objeto após
  submissão, corrida de DELETE com submissão, leitura service_role, hash dos bytes,
  multipart e tuplas 10/1 e 20/2 passaram. Alteração por serviço confiável bloqueou envio;
  reenvio não duplicou Insert. Eventos de reserva e sucesso foram efetivamente gravados.
- Os **111 testes** passaram novamente com `sidebar-ordem.test.tsx` excluído. A execução
  completa anterior e seu baseline com sete falhas permanecem documentados acima.

Reprodução, versões e limites em `tests/integrated/README.md`; resultados individuais
em `resultados-http.json` e `resultados-http-s3.json` nesse diretório. Containers encerrados
após os testes, volumes preservados. Não falta infraestrutura para esse aceite local.
Continuam pendentes o aceite no Alvo real, a conferência da versão do gateway implantado
e os contratos de conversão ainda não comprovados; nenhum deles foi executado nesta etapa.

## Cobertura de unidades — consulta somente de leitura

Janela: `coalesce(data_abertura_alvo,created_at) >= date '2026-09-07' - 90`.
São **286 requisições, 363 itens e 171 produtos distintos**; 11 requisições sem itens
no espelho não permitem levantamento de produtos. O fallback `created_at` pode ser
data de importação. Dos 171 produtos, **3 (1,75%) têm escala em cache; 168 (98,25%) não**.
Nessas três escalas há apenas Fator/base 1; isso não prova suporte dos demais produtos.
O cache não contém os flags dimensionais/dependência e data de 10/08/2026.
Detalhamento e SQL reproduzível em `tests/cobertura-unidades.json` e `REVISAO.md`.

## Continuação: Produto/Load e middleware Express

Consulta real pelo gateway: **HTTP 401 na primeira chamada**, coleta interrompida.
171 produtos inconclusivos (1 tentativa, 170 não consultados); nenhum marcado incompatível
por falta de acesso. Coletor sequencial com cache de respostas, falhas separadas e
classificação pelo mesmo validador preparado em `tests/produtos-load.mjs`.
Falta credencial de leitura no ambiente local; não enviar segredos pelo chat.

Fetch do gateway confirmou HEAD/origin/main `76f67b2`; patch aplica. **20 testes com
Express/CORS/body parser e middleware JWKS reais passaram**, complementando os testes
integrados anteriores. RPC/ERP e router legado são substituídos nesse novo teste.
Render health 200, mas sem SHA; acesso autenticado ao painel/API indisponível nesta
sessão, portanto versão live não confirmada. Bloqueios e evidências detalhados em
`ACESSO-E-GATEWAY.md`; roteiro de casos, implantação e recuperação em `ACEITE-ALVO.md`.
Nenhum Insert real, alteração de cadastro, backfill, migração em produção, push ou deploy.

Atualização do Render: usuário confirmou no painel **Live `76f67b2`, branch main,
deploy 06/09/2026 às 17h28** (fuso não explicitado). Corresponde ao commit contra o
qual o patch aplica. Evidência em `tests/render-live-confirmado.json`.
Launcher `tests/coletar-com-jwt.ps1` preparado com entrada oculta e limpeza da variável;
coleta autenticada aguarda entrada local do usuário, sem token no chat ou em arquivo.

Coleta autenticada posteriormente concluída pelo launcher em 07/09/2026 às 12h23m11
BRT: 171 respostas salvas, 171 consultas conclusivas, zero inconclusivas. O silêncio
inicial era ausência de progresso intermediário. Acrescentados logs sem credenciais
para futuras execuções; nenhuma segunda coleta foi iniciada.

Classificação offline concluída: **170 produtos totalmente suportados, 1 parcial,
nenhum totalmente bloqueado; 194/196 unidades suportadas**. As duas bloqueadas são
M3/posições 2 e 3 (Divisor/Peso 10) do produto 001.017.092; posição 3 marcada para
compras. Nenhuma unidade usada nos 363 itens recentes foi bloqueada por formato.
Das 41 marcas de compras, 40 passam e 1 bloqueia; 132 produtos sem marca e 2 com marcas
múltiplas exigem conferência da seleção. Evidência, limites e pendências concretas em
`CLASSIFICACAO-UNIDADES.md`. Zero consultas novas; shared/gateway conferidos iguais.

## Aceite preenchido e aviso antecipado de M3

SELECT de cadastros identificou Caio (Engenharia), Ana (Marketing) e Guilherme (TI),
todos líderes ativos não-admin. Caio autor + Ana aprovadora final cobre dispensa parcial
sem atribuições; Mirlene autora + Caio/Ana cobre duas decisões. Nenhum CC tem dois
líderes ativos; alternativa requer vínculo adicional explicitamente autorizado.
Primeiro caso preenchido, limitações de login e checklist em `ACEITE-PREENCHIDO.md`.

M3/2 e M3/3 agora mostram aviso antes de adicionar, com Próximo/Adicionar bloqueados;
M3/3 continua selecionada por ser compras, sem troca automática para UNID. Dois testes
DOM novos passaram com a resposta salva; total **113 testes aprovados** com sidebar
excluído, type-check frontend e build aprovados. Nenhuma ampliação de conversão.
# Atualização de implantação autorizada — 07/09/2026

Janela iniciada: criação/alteração de requisições e cron compras suspensos. Gateway
4ef34d5 enviado ao GitHub, aguardando comprovação Live no Render. Migração principal,
Edge e frontend ainda não publicados. Não iniciar aceite enquanto o conjunto não for
confirmado. Estado, cópias, testes repetidos e ação de painel em
[deployment/IMPLANTACAO.md](deployment/IMPLANTACAO.md). O restante abaixo registra a
preparação e as revisões anteriores, não comprova publicação.
# Publicação em andamento: SQL integral aplicado, gateway 4ef34d5 confirmado pelo
# health e Edge v51 conferida. Frontend/Lovable ainda aguardando confirmação.
# Janela fechada e cron suspenso. Estado vigente em deployment/IMPLANTACAO.md.
## Correção posterior ao primeiro aceite — seletores

Entrega frontend multicc-20260907-aceite-2: seletores do Hub nos dois temas,
carregamento/timeout/erro recuperável/ausência de unidades explícitos e seleção única
sem inventar conversões. Validação visual local e testes em CORRECAO-SELETORES.md.
Resposta real de 001.001.00051 ainda necessária; não declarar incompatibilidade ou
teste funcional desse produto como comprovados. Exige nova atualização no Lovable.
Aceite permanece restrito aos quatro participantes e cron continua suspenso.


## Correção do timeout de unidades — continuação autorizada do aceite

Log Render: autenticação Alvo levou 48,59s em 07/09/2026 às 23:37 UTC,
excedendo os antigos 45s totais do formulário. Leitura Financial Hub agora tem
120s no gateway e 135s no frontend, aviso de espera e cancelamento sem GET tardio.
Sem alterar conversões, envios, SQL/Edge, cadastros ou novo IA Hub.
Diagnóstico, testes e publicação: docs/aprovacao-multicc/CORRECAO-TIMEOUT.md.
Operação restrita a quatro participantes; cron e sync de requisições suspensos.


## Aceite-3 publicado e validação autenticada concluída

Marcador e JS index-D_wmRFC0.js confirmados; gateway fc505e2 Live. Formulário real
na sessão Pedro: DRYPATCH 200/54,794s UNID1 automática; AMOSTRA 200/2,626s UNID2
compras, avanço local com 10 e 20; M3/3 200/1,624s, bloqueada antes de adicionar.
Respostas salvas e conferidas pelo mesmo validador. Temas claro/escuro inspecionados.
Sem itens/requisições persistidos ou Insert no Alvo. Build final 32,42s passou.
Relatório atual: CORRECAO-TIMEOUT.md; evidências: tests/formulario-aceite-3/.
Usuário pode retomar aceite Caio/Ana; operação geral/cron permanecem suspensos.
Nenhuma nova publicação necessária para esta atualização de testes/evidências.
