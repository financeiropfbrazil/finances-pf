# Correção do prazo da consulta autenticada de unidades

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
