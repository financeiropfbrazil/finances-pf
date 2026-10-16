# NFSE-0.1 — rota `/nfse-adn` no erp-proxy (entrega para o GitHub Web)

**O que muda no erp-proxy:** 1 arquivo novo + 2 linhas no `src/index.ts`. Nada mais.
**Base:** compilado contra `origin/main` **`a790006`** (09/10/2026) — `tsc` estrito limpo e `tsc` build gerando
`dist/routes/nfse-adn.js`. Se o `main` andou desde então, as duas linhas continuam indo ao lado das linhas do `cartao`.
**Variável nova no Render:** nenhuma (usa `CERT_PFX_BASE64`, `CERT_PFX_PASSWORD` e `SYSTEM_SECRET`, que já existem).

## O que a rota faz

| Rota | Faz |
|---|---|
| `GET /nfse-adn/teste?nsu=1&lote=1` | Uma chamada ao ADN; devolve o HTTP, a **estrutura** do JSON (nomes e tipos, sem valores) e a 1ª entrada sem o XML |
| `GET /nfse-adn/dfe/:nsu` | Um lote a partir do NSU, com o XML descompactado; `NENHUM_DOCUMENTO_LOCALIZADO` = `{fim: true, documentos: []}` |

- **Só leitura:** não grava em lugar nenhum, não chama o Alvo.
- **Só sistema:** além do `requireSupabaseAuth`, o próprio router recusa (403) quem não vier com `X-System-Secret`
  — JWT de usuário do Financial Hub ou do Hub IA não acessa notas de terceiros.
- **404 do ADN sem a marca `NENHUM_DOCUMENTO_LOCALIZADO` é erro (502)**, não "fila vazia": se o caminho estiver
  errado, a sonda tem de falhar alto, não concluir "cobertura zero".
- Erros: 429 do ADN → 429; rejeição/HTTP ≠ 200/corpo não-JSON → 502 com o motivo; falha de conexão/timeout (30 s) → 504.

## Passo a passo (GitHub Web, nesta ordem)

1. **Arquivo novo** — `Add file › Create new file` → nome `src/routes/nfse-adn.ts` → colar o conteúdo **inteiro** de
   [`nfse-adn.ts`](nfse-adn.ts) → commit `feat(nfse-adn): rota de leitura do ADN (sonda NFSE-0.1)`.
   *(Sozinho não muda nada no ar: ninguém importa o arquivo ainda.)*
2. **`src/index.ts`** — editar e acrescentar **duas linhas**:
   - logo abaixo de `import cartaoRouter from "./routes/cartao";`
     ```ts
     import nfseAdnRouter from "./routes/nfse-adn";
     ```
   - logo abaixo de `app.use("/cartao", requireSupabaseAuth, cartaoRouter);`
     ```ts
     app.use("/nfse-adn", requireSupabaseAuth, nfseAdnRouter);
     ```
   → commit `feat(nfse-adn): monta /nfse-adn`. O Render publica sozinho.

**Quando:** fora de 07h30 / 12h30 / 16h30 BRT (dias úteis). O Render troca a versão sem derrubar a anterior; se o build
falhar, a versão atual continua no ar.

## Como confirmar que subiu (eu faço, sem segredo nenhum)

| Prova | Antes (medido 16/10) | Depois |
|---|---|---|
| `GET https://erp-proxy.onrender.com/nfse-adn/teste` sem auth | **404** (rota não existe) | **401** (rota existe e está protegida) |
| `GET /health` → `revision` | `a790006…` | o SHA do commit do passo 2 |
| `GET /nfe/inspect-cert-b64` sem auth | 401 | 401 (nada mais mudou) |

A primeira chamada real ao ADN (`/teste`) é a **NFSE-0.4**, pela Edge `nfse-adn-sonda` — a rota sozinha não chama o ADN.

## Rollback

GitHub Web: reverter o commit do passo 2 (tira a montagem; o arquivo fica inerte) ou apagar os dois. Render republica.
