# Correção do prazo da consulta autenticada de unidades

## Estado vigente: publicado e validado no formulário real

Aceite-3 confirmado no marcador e no JS `/assets/index-D_wmRFC0.js` (SHA-256
1b8e182b26f3cfc8f0f0eb5f65d824333c40266f80041079f27401fc3a560c68).
Gateway fc505e2 Live confirmado. Sessão real de Pedro, autenticada pelo próprio Chrome:

| Produto | HTTP / duração até cabeçalhos | Resultado |
|---|---|---|
| 001.001.00051 | 200 / 54,794s | UNID/1 automática, seletor e avanço habilitados |
| 001.013.00382 | 200 / 2,626s | UNID/2 compras automática; avanço ao rateio com 10 e 20 |
| 001.017.092 | 200 / 1,624s | M3/3 compras preservada e bloqueada por Divisor antes de adicionar |

A primeira leitura excedeu o limite antigo de 45s e concluiu normalmente: evidência
real da correção, sem simulação/interceptação. Isso não elimina a lentidão do ERP.
As três respostas reais salvas foram passadas ao mesmo validador: DRYPATCH 10→10 e
20→20; AMOSTRA 10→1 e 20→2; M3/3 recusada. Não foram persistidas requisições.

Temas claro/escuro e menus do Hub conferidos, com capturas inspecionadas. Tema original
restaurado; formulário fechado vazio. Evidências em `tests/formulario-aceite-3/` e
reprodução da validação das capturas em `tests/validar-capturas-aceite-3.mjs`.

Build final passou em 32,42s. Nesta etapa só testes/launcher/evidências foram alterados;
não é necessário publicar novamente. Operação segue restrita a 4 participantes e cron
e sync de requisições suspensos. O aceite de criação/aprovação/envio permanece com o
usuário; a sessão real usada aqui é admin, não substitui esse teste não-admin.
As pendências de publicação descritas abaixo são históricas e foram superadas.

## Causa comprovada pelo log fornecido pelo usuário

Em 07/09/2026 (UTC), `GET /produto/load` entrou às 23:37:48.339.
A autenticação Financial Hub terminou e o handler de 001.001.00051 começou às
23:37:48.727. A autenticação Alvo (Login + SelectCompany) terminou às
23:38:37.318: **48,59 segundos depois da entrada no handler**. O formulário tinha
prazo total de 45 segundos, abortando antes de o gateway poder consultar o produto.

Esse orçamento insuficiente explica a falha observada. Não demonstra por que o ERP
levou esse tempo. O sync de estoque aparece em outro intervalo; não foi comprovada
causalidade nem alterado seu cron. O Laboratório chama o ERP diretamente, com outra
sessão; seu sucesso não prova o caminho do gateway.

## Mudança e escopo

- Gateway `fc505e2`: somente GET `/produto/load` autenticado pelo Financial Hub usa
  orçamento total de 120s, cobrindo espera pelo token, GET e corpo da resposta.
  Ao expirar responde 504. Cancelamento do navegador aborta a leitura; autenticação
  compartilhada não é cancelada e pode abastecer os demais leitores normalmente.
  Um leitor cancelado durante login não dispara GET tardio.
- Etapas autenticacao/consulta/resposta, duração e requestId são registradas, sem
  token, senha, cabeçalhos ou corpo. Falhas de rede retornam mensagem e etapa.
- Frontend `multicc-20260907-aceite-3`: 135s, deixando margem para o gateway responder;
  após 15s explica a espera e permite cancelar/trocar produto. Retry segue explícito.
- Mesmo Produto/Load com `loadChild=All`, mesmo validador, unidades e posições.
  Sem novo fator, cache de cadastro, fallback UNID ou backfill.
- Cliente genérico, autenticação compartilhada, POSTs/Insert, gateway de envio,
  SQL/Edge, auditoria, anexos, lideranças e projeto do novo IA Hub não foram alterados.

## Verificação

- Formulário publicado aceite-2: dois GETs 200 (10,457s e 10,448s), UNID/1 DRYPATCH
  e UNID/2 compras AMOSTRA, avanço ao rateio sem persistência. Depois reproduzido
  timeout real; separado do atraso controlado em `tests/formulario-real/`.
- Teste com módulo de autenticação real do gateway e ERP simulado: Login+empresa
  em 48,6s e Load em 10,5s termina em 59,1s; limite antigo abortava antes disso.
- Cancelamento concorrente preserva o outro leitor e produz só um GET; timeout
  durante leitura aborta HTTP sem retry. Três testes Node passaram.
- 25 testes HTTP Express/JWKS, incluindo não-admin em Produto/Load, passaram.
- Type-check frontend/gateway e build frontend passaram. Avisos anteriores de
  tamanho de bundle/imports/Browserslist permanecem.
- Pré-voo: zero envios sem confirmação e zero transições; aceite para 4 usuários,
  cron de requisições inativo, sync de requisições desabilitado.

## Publicação e recuperação

Gateway enviado ao main em `fc505e2`. Conferir `/health` com esse SHA e
`unidades=multicc-aceite-3-leitura-120s`; push não comprova Live.
Frontend: Publish → Update no Financial Hub após sincronizar o main. Conferir
`/multicc-version.json` aceite-3 e JS contendo 135s/aviso de espera prolongada.
Validação autenticada após publicação ainda pendente nesta preparação.

Recuperação: `git revert` do commit desta correção em cada repo, build/push e
republicação correspondente. Não reverter migração multi-CC nem abrir operação ou
cron. Reverter o frontend restaura o timeout insuficiente de 45s; registrar esse limite.
Nenhuma requisição foi criada ou submetida e nenhum Insert real foi realizado pelo agente.


## Resultado da preparação e ações de painel

Frontend enviado ao main em **2e6d39f**. Regressão final: **125 testes passaram**,
excluídas somente as sete falhas antigas de sidebar. Suítes específicas: 14 frontend,
3 Node gateway e 25 Express/JWKS. Build do gateway (`npm run build`) também passou.

Última conferência pública desta etapa: Render ainda 4ef34d5 e Lovable ainda aceite-2.
Solicitado ao usuário Render → Manual Deploy → Deploy latest commit fc505e2 e
Lovable Financial Hub → Publish → Update, main com 2e6d39f. A validação posterior
no formulário será retomada após essas publicações; não declarar Live por push.

Patches: correcao-timeout-frontend.patch e correcao-timeout-gateway.patch.


## Gateway Live confirmado

Em 2026-09-08T00:04:29.768Z (07/09 21:04 BRT), /health confirmou
fc505e2ee0d69deb306c8aaef3e1de8f901bcfdc e unidades=multicc-aceite-3-leitura-120s.
Não é mais necessário acionar deploy no Render. Lovable ainda serve aceite-2;
falta Publish → Update de aceite-3 e validação final do formulário autenticado.
