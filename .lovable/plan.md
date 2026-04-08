

## Plano: Restaurar o buildPayload da versão que lançou a NFS-e 233 com sucesso

### Diagnóstico

O arquivo atual (`alvoMovEstqLancarService.ts`, 985 linhas) contém uma versão "gabarito" do payload com ~600 campos no item e classObject. Essa NÃO é a versão que lançou a NFS-e 233 com sucesso.

A versão que funcionou foi o resultado dos patches LANCAR-3A/3B/3C + LANCAR-4 + LANCAR-5 + LANCAR-6, cujo código o usuário colou no início desta conversa. As diferenças principais entre a versão que funcionou e a atual:

| Aspecto | Versão que funcionou (LANCAR-6) | Versão atual (gabarito) |
|---|---|---|
| Tamanho do item | ~60 campos essenciais | ~400 campos (muitos zerados) |
| `FatorDivisor` | `1` (número) | `"Fator"` (string) |
| `CalculaST` | `"Não"` | `"F"` |
| `IntegradoFiscal` | `"Não"` | `"Sim"` |
| `DocumentoConferido` | `"Sim"` | `"Não"` |
| Rateio header `CodigoClasseRecDesp` | `""` (vazio no rateio) | código real repetido |
| `ChaveMovEstq` nas parcelas | presente (`1`) | ausente |
| `MovEstqNfEletronicaChildList` | `[]` (vazio) | condicional com chaveAcesso |
| `ChaveAcessoNFe` | `null` | ausente |

### Plano de execução

**Arquivo único**: `src/services/alvoMovEstqLancarService.ts`

**Ação**: Substituir o conteúdo inteiro do arquivo pelo código que o usuário colou no início desta conversa — que é exatamente a versão pós-LANCAR-6 que lançou a NFS-e 233 com sucesso. Esse código inclui:

- Tipos (`CCRateioInput`, `ClasseRateioInput`, `ParcelaMovEstqInput`, `ImpostosMovEstqInput`, `LancarNfseInput`, `LancarNfseResult`)
- Helpers de data (`fmtAlvoDate`, `fmtAlvoDateFromYMD`)
- Fetchers (`fetchEntidade`, `fetchCidade`)
- `buildPayload` com item enxuto (~60 campos), `classesList` com `CodigoClasseRecDesp: ""` no rateio, `classObject` com flags corretas (`IntegradoFiscal: "Não"`, `DocumentoConferido: "Sim"`, `ChaveAcessoNFe: null`, `MovEstqNfEletronicaChildList: []`)
- `lancarNfseNoAlvo` com debug log e clipboard copy

**Nenhum outro arquivo será tocado.**

