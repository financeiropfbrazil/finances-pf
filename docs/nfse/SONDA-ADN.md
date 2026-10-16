# Sonda de cobertura do ADN (NFS-e recebidas) — desenho

> **Status:** desenho aprovado em 16/10/2026 (tarefas NFSE-0.x no [PLANO-NFSE.md](../../PLANO-NFSE.md)).
> NFSE-0.1 (rota do erp-proxy) pronta para colar; nada aplicado em produção.
> **Pergunta que a sonda responde:** um importador único pelo **ADN** (Ambiente de Dados Nacional da
> NFS-e) recebe as notas de serviço dos nossos fornecedores, ou alguma prefeitura importante exige
> integração própria?
> **Certificado:** A1 do erp-proxy (CNPJ 26.602.204/0001-96) — CNPJ e validade confirmados pelo Pedro em 16/10.

---

## 1. Por que medir antes de construir

**Onde estão os fornecedores** (NFS-e recebidas em 2026 no DocFin, cidade do cadastro do fornecedor):

| Cidade | NFS-e | Acumulado |
|---|---:|---:|
| São José do Rio Preto/SP | 469 | 43,7% |
| São Paulo/SP | 286 | 70,3% |
| Campinas/SP | 45 | 74,5% |
| Curitiba/PR | 40 | 78,2% |
| Cedral/SP | 29 | 80,9% |
| Belo Horizonte, Indaiatuba, Brasília, Rio de Janeiro, Porto Alegre | 82 | 88,5% |

**O que já se sabe do ADN** (captura antiga, 30/03–07/04/2026, comparada com o DocFin do mesmo período):
Rio Preto (IBGE 3549805) e São Paulo (3550308) **aparecem** no ADN, mas só 13 de 36 notas das duas
foram achadas; Campinas, Curitiba, Cedral, Canoas e Belo Horizonte, todas achadas. As faltas se
espalham pela janela, e a captura parou em 07/04 — não dá para separar *atraso de repasse*, *nota
emitida para outro CNPJ* e *prefeitura que não repassa*. **A sonda resolve isso com 90 dias e dados de agora.**

## 2. O que a API do ADN oferece (fontes no fim)

- **Base de produção:** `https://adn.nfse.gov.br/contribuintes/` (produção restrita para testes:
  `https://adn.producaorestrita.nfse.gov.br/contribuintes/`).
- **`GET /DFe/{NSU}`** — documentos em que o CNPJ aparece como **emitente, tomador ou intermediário**,
  a partir do NSU (contador sequencial por CNPJ). Com `?lote=true` vem um lote; fim da fila =
  `NENHUM_DOCUMENTO_LOCALIZADO` (a tela antiga recebia isso como HTTP 404). `REJEICAO` é erro.
- **`GET /NFSe/{chave}/Eventos`** — eventos de uma nota (ex.: cancelamento).
- **Autenticação:** mTLS com certificado ICP-Brasil do mesmo **CNPJ raiz**; `?cnpjConsulta=` permite
  consultar outro CNPJ da mesma raiz (filial).
- **Formato:** JSON; o XML de cada documento vem **gzip + base64**. Campos vistos na tela antiga (que
  usava um serviço intermediário): `NSU`, `ChaveAcesso`, `TipoDocumento` (`NFSE`/`EVENTO`),
  `TipoEvento`, `StatusProcessamento`. ⚠️ **Os nomes exatos da resposta crua não estão confirmados
  em documentação oficial acessível** — por isso o passo 1 da sonda só mostra o formato.
  **Confirmado em produção em 16/10/2026 (NFSE-0.4):** `{StatusProcessamento, LoteDFe[50], Alertas, Erros,
  TipoAmbiente, VersaoAplicativo, DataHoraProcessamento}`; item `{NSU, ChaveAcesso, TipoDocumento, ArquivoXml,
  DataHoraGeracao}`; `DFe/{N}` devolve a partir de N+1; `DataHoraGeracao` sem fuso; fila desde set/2023.
  Detalhes no diário do PLANO-NFSE.
- **Volume esperado:** em abril/2026 a P&F estava no NSU ~575; a ~3,5 documentos/dia, hoje deve estar
  perto de 1.300 — poucas dezenas de chamadas para ler tudo.

## 3. Arquitetura

```
Edge Function nfse-adn-sonda (manual, CRON_SECRET)
   │  POST com X-System-Secret
   ▼
erp-proxy  GET /nfse-adn/dfe/:nsu   ← certificado já existente (CERT_PFX_BASE64 / CERT_PFX_PASSWORD),
   │                                   mesmo padrão https+pfx da rota /nfe (SEFAZ)
   ▼  mTLS
ADN  GET /contribuintes/DFe/{nsu}?lote=true
```

- **Por que pelo erp-proxy:** o certificado já mora lá e a rota `/nfe` já faz mTLS com ele em Node.
  Nada de certificado no navegador (o erro da tela antiga) nem em mais um lugar.
- **A rota do erp-proxy é fina:** um lote por chamada, sem gravar nada. Quem drena e grava é a Edge.
- **A sonda é a fase 0 do importador, não código descartável:** a tabela que ela enche é o espelho do
  ADN que o importador vai usar. Se a cobertura for boa, a fase 1 só acrescenta cron, cancelamentos,
  ligação com o Alvo e tela.

### 3.1 erp-proxy — `src/routes/nfse-adn.ts` (novo, montado em `/nfse-adn` com `requireSupabaseAuth`)

| Rota | O que faz |
|---|---|
| `GET /nfse-adn/teste` | Uma chamada `DFe/{nsu}` (padrão 1) e devolve: HTTP do ADN, **lista das chaves do JSON** e a primeira entrada do lote **sem o XML** (só os nomes/tipos). Serve para confirmar o formato. |
| `GET /nfse-adn/dfe/:nsu` | Uma chamada `DFe/{nsu}?lote=true`; devolve `{ status_http, status_processamento, documentos: [{ nsu, chave, tipo_documento, tipo_evento, gerado_em, xml }] }` com o XML já descompactado. `NENHUM_DOCUMENTO_LOCALIZADO` = lista vazia, não erro; **404 sem essa marca = erro** (pode ser caminho errado — ver diário do PLANO-NFSE, 16/10). |

Regras: timeout de 30 s; nenhum dado gravado; `cnpjConsulta` não usado (certificado = matriz); erros
do ADN repassados com o código (429, rejeição → 502, conexão → 504); **só chamada de sistema**
(`X-System-Secret`) — JWT de usuário recebe 403. Implementação: [erp-proxy/nfse-adn.ts](erp-proxy/nfse-adn.ts). Edição pelo **GitHub Web** (clone local
sempre defasado), deploy automático no Render — fora das janelas do cron.

### 3.2 Banco — tabela `nfse_adn_doc` (nova)

Uma linha por documento do ADN: `nsu` (PK), `chave_acesso`, `tipo_documento`, `tipo_evento`,
`gerado_em`, `xml`, e campos extraídos do XML: `papel_pf` (`tomador`/`emitente`/`intermediario`),
`prestador_doc`, `prestador_nome`, `prestador_cmun` (IBGE), `tomador_doc`, `numero`, `data_emissao`,
`valor_servico`, `lido_em`. RLS ligada, **sem acesso para anon/authenticated** (só service_role e
klaus_readonly). Não toca em nenhuma tabela existente — `compras_nfse` fica como está.
**Definição final:** [NFSE-0.2-aplicar.sql](NFSE-0.2-aplicar.sql) — campos extraídos por gatilho no banco e
`cmun_emissor` (município emissor) como eixo da medição; detalhes no diário do PLANO-NFSE (16/10).

### 3.3 Edge Function `nfse-adn-sonda` (nova, disparo manual)

- Gate `CRON_SECRET` (mesmo padrão das outras), `verify_jwt = false` declarado no `config.toml`.
- `modo: "teste"` → chama `/nfse-adn/teste` e grava o formato em `sync_runs.detalhes`.
- `modo: "drenar"` → parte do maior `nsu` já gravado (ou do informado), chama `/nfse-adn/dfe/:nsu`
  em lotes, grava/atualiza `nfse_adn_doc`, para em `NENHUM_DOCUMENTO_LOCALIZADO`, no limite de
  lotes ou no watchdog de 110 s; em 429/5xx para e reporta (sem insistir). Reexecutável: continua de
  onde parou.
- Cada execução grava `sync_runs` (`job_type = 'nfse_adn_sonda'`) com lotes, documentos, NSU final e
  carimbo de versão. **Sem cron** nesta fase.

## 4. A medição (somente leitura)

1. **Cobertura por cidade, 90 dias:** NFS-e do DocFin (`fin_parcelas_pagar`, espécie `NFS-e`) ×
   `nfse_adn_doc` (como tomador), casando por **CNPJ do prestador + número**; resultado por cidade do
   cadastro e por IBGE do ADN: notas no DocFin, achadas no ADN, %.
2. **Ao contrário:** notas no ADN com a P&F como tomadora que **não estão no DocFin** (recebidas e não
   lançadas no Alvo) — o valor que o importador vai entregar.
3. **Para cada falta nas cidades principais:** a nota existe no ADN para outro CNPJ da raiz (filial)?
   Foi gerada no ADN muito depois da emissão (atraso de repasse)? Ou não existe?

**Critério de decisão:** cidade com ≥ 95% de cobertura → atendida pelo importador do ADN. Abaixo disso
→ investigar a causa antes de pensar em integração própria (São Paulo tem web service de notas
recebidas; Rio Preto usa GISS).

## 5. Riscos e cuidados

| Risco | Cuidado |
|---|---|
| Certificado vencido ou de outro CNPJ | Passo 0 com o Pedro; o `teste` falha cedo, sem gravar nada |
| Limite de requisições do ADN (429) | Lotes, pausa entre chamadas, para no primeiro 429 |
| Formato da resposta diferente do esperado | `teste` antes de drenar; a Edge só grava o que reconhece e registra o resto |
| Dados fiscais de terceiros no banco | RLS sem acesso do app; só service_role e leitura do klaus_readonly |
| Efeito em produção | Nenhum: só leitura no ADN e no Alvo; tabela e função novas; nenhum dado existente muda |

**Rollback:** remover a rota `/nfse-adn` do erp-proxy (revert no GitHub), apagar a Edge `nfse-adn-sonda`
e a tabela `nfse_adn_doc`.

## 6. Passo a passo (cada escrita com OK do Pedro)

0. **Pedro:** confirmar CNPJ e validade do A1 do erp-proxy.
1. **erp-proxy:** eu escrevo `nfse-adn.ts` + a linha de montagem no `index.ts`; Pedro cola pelo GitHub
   Web; Render publica.
2. **Banco:** criar `nfse_adn_doc` (SQL com pré-voo e rollback).
3. **Edge:** deploy da `nfse-adn-sonda` (kill-switch não se aplica: não há cron).
4. **`modo: teste`:** confirmar o formato real; ajustar o parser se preciso.
5. **`modo: drenar`:** ler tudo até o fim da fila.
6. **Medição (seção 4)** e relatório por cidade → decisão sobre o importador.

---

### Fontes
- [Manual dos Contribuintes — APIs do ADN (gov.br, fev/2026)](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf)
- [Fórum ACBr — rota `/contribuintes/DFe/{NSU}`](https://www.projetoacbr.com.br/forum/topic/74320-acesso-%C3%A0-api-para-baixar-as-nfs-e-nacional-adn/)
- [nfse4j PR #4 — distribuição por lote (`?lote=true`, `NENHUM_DOCUMENTO_LOCALIZADO`, `REJEICAO`, gzip+base64)](https://github.com/omartelo/nfse4j/pull/4)
- [Fórum NFS-e Brasil — consulta sequencial por NSU](https://forum.nfsebrasil.com.br/t/consulta-sequencial-em-lote-de-nfs-e-no-ambiente-nacional-via-nsu/1421)
- Código: `erp-proxy/src/routes/nfe.ts` (mTLS com `CERT_PFX_BASE64`), tela antiga `ComprasNotasServico.tsx` (git `b2331f2~1`).
