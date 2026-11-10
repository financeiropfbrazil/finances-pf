# NFSE-1.17 — `cnpjConsulta` na leitura do ADN (entrega para o GitHub Web)

**Problema:** desde segunda, 02/11/2026, toda leitura do ADN falha. O Hub não recebe NFS-e novas desde 30/10, 16h BRT
(última nota: NSU 1728).
**Causa:** o ADN passou a exigir, na distribuição por NSU (`GET /contribuintes/DFe/{nsu}?lote=true`), o parâmetro
`cnpjConsulta` — de quem são as notas. Sem ele responde **HTTP 400** com
`{"StatusProcessamento":"REJEICAO","Erros":[],"TipoConsulta":"InscricaoCertificado",…}`. Medido em 10/11 pelo modo
`teste` da sonda: NSU 1728 **e NSU 1700** (que em outubro trazia documentos) dão o mesmo 400 → recusa de toda consulta,
não fim de fila; o campo `TipoConsulta` (20 caracteres = "InscricaoCertificado") não existia na resposta de 16/10.
A conexão mTLS e o certificado estão bons (o ADN responde em JSON). Outros projetos que leem o ADN viram o mesmo a
partir de 03/11 e resolveram com `cnpjConsulta` = CNPJ do certificado (o ADN passa a tratar como `TipoConsulta
CnpjBase`).
**Correção:** a rota passa a mandar `cnpjConsulta=26602204000196` (CNPJ do A1, a matriz) em toda chamada e a mostrar o
`TipoConsulta` na resposta de diagnóstico. Nada mais muda: mesmo formato, mesma Edge, mesma tabela.

**Arquivo:** só `src/routes/nfse-adn.ts` (+9 −1). O arquivo no `main` (`74eeaf0`) foi conferido **idêntico** à entrega de
16/10 (`docs/nfse/erp-proxy/nfse-adn.ts` antes desta mudança). `tsc --noEmit` estrito limpo no `main` com a mudança.
**Variável nova no Render:** nenhuma (opcional: `NFSE_ADN_CNPJ_CONSULTA`, para trocar o CNPJ sem mexer no código).

## Passo a passo (GitHub Web)

1. Abrir `src/routes/nfse-adn.ts` no `main` → lápis (Edit).
2. Selecionar tudo e colar o conteúdo **inteiro** de [`nfse-adn.ts`](nfse-adn.ts) (desta pasta).
3. Commit: `fix(nfse-adn): manda cnpjConsulta na distribuição por NSU (ADN exige desde 03/11/2026)`.
   O Render publica sozinho.

As 3 mudanças, se preferir editar à mão:
- abaixo de `const TIMEOUT_MS = 30_000;`
  ```ts
  // CNPJ cujas notas a P&F consulta: o do certificado (matriz). NFSE-1.17 — obrigatório no ADN desde 02–03/11/2026.
  const CNPJ_CONSULTA = (process.env.NFSE_ADN_CNPJ_CONSULTA || "26602204000196").replace(/\D/g, "");
  ```
- a função `caminhoDfe` inteira vira:
  ```ts
  function caminhoDfe(nsu: number, lote: boolean): string {
    const q = [lote ? "lote=true" : null, `cnpjConsulta=${CNPJ_CONSULTA}`].filter(Boolean).join("&");
    return `${ADN_BASE}/DFe/${nsu}?${q}`;
  }
  ```
- (diagnóstico) nas duas respostas, logo abaixo da linha de `status_processamento`:
  `tipo_consulta: json ? campo(json, ["TipoConsulta"]) ?? null : null,`

**Quando:** fora de 07h30 / 12h30 / 16h30 BRT (dias úteis). Se o build falhar, a versão atual continua no ar.

## Como confirmar (eu faço depois do commit)

| Prova | Hoje | Depois |
|---|---|---|
| `GET https://erp-proxy.onrender.com/health` → `revision` | `74eeaf0…` | o SHA do commit |
| Sonda `teste` NSU 1728 | HTTP 400 · REJEICAO · TipoConsulta (20 car.) | HTTP 200 · DOCUMENTOS_LOCALIZADOS (ou 404 NENHUM_DOCUMENTO_LOCALIZADO) · TipoConsulta `CnpjBase` |
| Sonda `teste` NSU 1700 | HTTP 400 · REJEICAO | 1º NSU 1701 — mesmo tipo e mesma data de geração da linha 1701 já gravada (a numeração não mudou) |
| Drenar (manual, depois das duas provas) | — | lê as notas de 30/10 até hoje e volta a "fim da fila"; o cron segue sozinho |

## Rollback

GitHub Web: reverter o commit (volta a rota de 16/10 — que hoje não funciona no ADN). Nada a desfazer no banco.
