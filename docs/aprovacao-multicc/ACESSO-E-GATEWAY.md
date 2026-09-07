# Continuação de leitura e middleware — 07/09/2026

## Produto/Load: bloqueio observado

Executado GET no gateway existente, `/produto/load?codigo=...`, para o primeiro
código do inventário salvo (ver classificação/falha para o código efetivo).
A resposta foi **HTTP 401**; a coleta parou após uma chamada para não repetir recusas.
Não há JWT/system secret configurado nas variáveis de ambiente desta execução,
nem `.env` no repo externo. O runtime do navegador não disponibilizou nenhum browser.
Não foram inspecionados cookies, armazenamento de sessão ou cofres.

**0/171 consultas conclusivas; 171 inconclusivas.** Nenhum produto foi classificado como
incompatível por falta de cache/acesso. Os 3 produtos com escala no cache do levantamento
anterior continuam sendo evidência escalar antiga, separada de Produto/Load atual.

Preparado `tests/produtos-load.mjs`: GET fixo no gateway, concorrência 1, intervalo 750ms,
timeout 45s, sem redirects, interrupção em 401/403/429/falha de transporte. Respostas
válidas são salvas por produto em `produto-load/respostas/` e reaproveitadas. Falhas
ficam em arquivos separados por execução. `classificacao.json` contém todos os 171,
unidades usadas no espelho e, quando houver Load, marca de compras e motivo de bloqueio.

O classificador executa o shared da entrega, registrando seu hash: `unidadesProduto`,
`converterSolicitada` e `validarItemCadastro`. Formato suportado é ensaiado com solicitada
1; precisão ainda depende da quantidade concreta. Dimensão/dependência em qualquer
unidade bloqueia o produto inteiro no parser atual, e isso é preservado no relatório.
Unidade usada é destacada por código: a posição histórica ausente não é deduzida.

Para retomar, disponibilizar **fora do chat**, no ambiente de execução local, um JWT
Financial Hub válido em `MULTICC_GATEWAY_JWT` ou a credencial de sistema já autorizada
em `MULTICC_GATEWAY_SYSTEM_SECRET`, usando o mecanismo seguro de segredos da máquina.
O script não imprime nem salva esses valores. Executar na raiz:

```powershell
node docs/aprovacao-multicc/tests/produtos-load.mjs
```

Não colar segredo em linha de comando/histórico nem no chat. Alternativa: disponibilizar
sessão autenticada no navegador suportado para o fluxo autorizado de leitura. A presença
de uma sessão deverá ser conferida antes de assumir que consultas podem prosseguir.
Não é necessário alterar cadastros, criar usuários de produção ou fazer backfill.

## Gateway e Render

Fetch somente de leitura das referências remotas concluído. HEAD local e origin/main:
`76f67b2843061e7e9fb846ba8bac876901773585`, commit de 06/09/2026 17:26:22 -03:00.
Repo externo limpo, sem edição. `git apply --check` do `erp-proxy.patch` passou.

GET público `/health` respondeu 200, `service=erp-proxy`, `env=production`; evidência
em `tests/render-health.json`. Esse endpoint **não informa SHA/build**. Nenhum conector
Render, credencial de API Render ou navegador autenticado estava disponível. Portanto
naquela etapa a versão implantada não foi identificada diretamente pelo agente.

**Evidência posterior confirmada pelo usuário no painel Render:** erp-proxy Live,
commit `76f67b2`, branch `main`, deploy em **06/09/2026 às 17h28**. Fuso não informado.
O prefixo corresponde ao HEAD completo conferido acima, contra o qual o patch aplica.
Registro em `tests/render-live-confirmado.json`. É confirmação do usuário no painel,
não inspeção direta do painel pelo agente. A identificação do commit Live está resolvida.

Para a coleta com JWT, `tests/coletar-com-jwt.ps1` recebe o token com Read-Host
AsSecureString, configura a variável apenas no processo local, executa o coletor
sequencial e a remove em finally. Não usar setx, .env ou token literal no comando.
Antes de copiar, desativar histórico e sincronização da área de transferência do Windows;
o launcher limpa a área de transferência atual após a entrada e ao terminar.

Diagnóstico da execução autenticada: em 07/09/2026, PID Node 15688, filho do launcher,
estava ativo. Contagem avançou de 126 respostas às 12h21m50 para 159 às 12h22m49 BRT.
O silêncio era ausência de logging intermediário: versão original imprimia só ao fim.
Não foi iniciada segunda coleta, não foram lidos token/ambiente do processo. Orientado
aguardar. Acrescentados progresso por produto/cache, heartbeat de 10s e mensagem de
timeout de 45s para execuções futuras; `node --check` aprovado sem executar coleta.

Conclusão observada às **12h23m11 BRT**: processo encerrado, **171 respostas salvas,
171 consultas conclusivas, zero inconclusivas e bloqueio null** no relatório final.
A coleta autenticada resolveu o bloqueio 401 da tentativa inicial. Não houve reinício.

## Express real executado

`node docs/aprovacao-multicc/tests/express-real.mjs`: **20 verificações aprovadas**.
Express, CORS, body parser e middleware `src/middleware/auth.ts` reais, incluindo
verificação criptográfica jose e servidor HTTP JWKS local com JWTs RSA sintéticos.
Trecho de configuração/montagem extraído do index atual, com a ordem definida no patch.
Hash dos fontes e versões das dependências em `tests/resultados-express.json`.

JWT ausente/inválido/expirado/emissor errado/sem sub recusados; Hub IA e sistema não
enviam pela rota nova; secret errado não usa JWT como fallback. Financial Hub não-admin
alcança gate SQL; Inserts antigos bloqueados antes do legado; CORS e limite 2MB exercitados.

Limites: RPC/ERP e router legado são duplos nesse teste. Isso complementa as 52
verificações anteriores com banco/Auth/Storage reais, mas não é uma única execução com
todas as dependências reais nem equivale ao middleware no Render. Não houve JWT real
de usuário de produção nem Insert no Alvo. O roteiro futuro está em `ACEITE-ALVO.md`.
