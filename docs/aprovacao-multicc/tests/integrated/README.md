# Aceite HTTP local

Executado em 07/09/2026: 26 verificações com file e 26 com S3 MinIO, ambas exit 0.
Resultados individuais nos dois JSONs deste diretório. Nenhuma escrita fora do ambiente
local; SELECT de cobertura de produção documentado separadamente.

## Ambiente e reprodução

Windows Node 24.18.0; Docker 29.1.3/Compose 2.40.3 no Ubuntu 26.04/WSL2.
Imagens fixadas no compose: PostgreSQL 17.6, GoTrue 2.189.0, PostgREST 14.12,
Storage 1.60.4 e MinIO RELEASE.2025-09-07T16-13-09Z. Configuração baseada nos exemplos
oficiais de [Supabase self-hosting](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)
e [Storage/MinIO](https://github.com/supabase/storage/blob/master/.docker/docker-compose-infra.yml).
Credenciais são exclusivamente sintéticas e `.env` é gerado localmente/ignorado pelo Git.

Na raiz do repo, com as dependências do aplicativo instaladas:

```powershell
npm install --prefix "$env:TEMP/finances-pf-multicc-native" --no-save --package-lock=false pg@8.16.3
node docs/aprovacao-multicc/tests/integrated/prepare.mjs
```

Em um terminal WSL mantido aberto, na pasta deste README:

```sh
docker compose -p multicc-aceite-novo -f compose.yml -f compose.s3.yml up
```

Aguardar Storage informar `Started Successfully`; em outro terminal Windows, na raiz:

```powershell
node docs/aprovacao-multicc/tests/integrated/http.mjs --s3
```

Usar um nome de projeto novo e portas 55432/55439/55430/55450 livres. O harness recusa
banco com tabela de requisições preexistente; não limpa dados. Para backend file, omitir
`-f compose.s3.yml` e `--s3`. Encerrar com Ctrl+C ou `docker compose ... stop` mantendo
os mesmos argumentos. Os volumes dos testes executados foram preservados.

O WSL desta máquina encerra serviços quando não há sessão ativa; por isso usar `up`
em primeiro plano durante o teste. Docker Desktop não estava instalado, nem fora do
PATH. Docker Engine/Compose foram instalados no Ubuntu existente. Não falta instalação
manual. Deno está em `$env:TEMP/finances-pf-deno-check/node_modules/deno/deno.exe`:

```powershell
$env:DENO_DIR = Join-Path $env:TEMP 'finances-pf-deno-cache'
& "$env:TEMP/finances-pf-deno-check/node_modules/deno/deno.exe" check --no-config --no-lock supabase/functions/sync-compras-status-cron/index.ts
```

## Fronteiras do teste

Fixture usa tabelas públicas/RLS da entrega, constraint real de auditoria e migração
versionada, preservando Auth/Storage reais. Autor lidera A, item exige B, líder B e
terceiro usam JWTs emitidos pelo GoTrue; todos `is_admin=false`. DDL/setup usa postgres,
decisões passam por HTTP autenticado e envio usa RPC service_role no handler do gateway.

O harness transpila o handler real e injeta cliente Supabase local, Router mínimo e
autenticação HTTP real pelo GoTrue. Não testa o middleware Express completo do repo
externo. O guard de URL do código de produção permanece intacto; a variável usada por
ele recebe o valor esperado, mas o cliente injetado aponta só para localhost e todo
fetch não-loopback é recusado. Nenhum arquivo `.env` do aplicativo/gateway é lido.

ERP é um servidor HTTP simulado, Produto/Load usa a captura real fornecida. SaveMultiPart
recebe bytes reais e verifica tuplas 10/1 e 20/2. Isso não substitui aceite no Alvo real.
Os bytes são relidos via Storage sem cache antes/depois de cada tentativa de alteração.

A corrida mantém a transação da submissão aberta e inicia DELETE HTTP: verifica espera
e preservação do conteúdo após commit. Não cobre exaustivamente todas as intercalações
do upload/objeto distribuído nem falhas de rede/processo. Service_role pode alterar
objetos; teste confirma que o hash divergente impede o Insert, sem prometer disponibilidade.
Versão/backend do Storage gerenciado em produção não foram equiparados a essa stack.
