

## Diagnosis

The `NFSE-FIX-LANCAR-3A` rewrite stripped the `buildPayload` function back to a simpler version, removing fields that are **mandatory** for the Alvo ERP's `validasalvar` check. These fields were previously added based on a comparison with a successful MovEstq (chave 15683).

### Missing fields causing `validasalvar`:

**Header (classObject):**
- `RefazParcelas: "Sim"` — marked CRITICAL in earlier analysis
- `OrigemModulo: "Estoque"`
- `IntegradoFiscal: "Não"`, `IntegraFiscal: "Não"`
- `ControlaEstoque: "Não"`, `ModalidadeFrete: "Sem Frete"`, `NaturezaFrete: "N"`
- `IndicadorPresenca: "Nenhum"`, `MovEstqUserFieldsObject: {}`
- `DocumentoHomologado: "Sim"`
- Empty child lists: `MovEstqAcordVendChildList`, `MovEstqAdiantChildList`, `MovEstqCctrlChildList`, `MovEstqDocComplemChildList`, `MovEstqEmpChildList`, `MovEstqNfEletronicaChildList`
- `MovEstqPedCompChildList` with purchase order linking

**ICMS (IcmsMovEstqChildList):**
- `CodigoEmpresaFilial` should be `"1.01"` (currently `""`)
- Missing `BaseCalculoICMS`, `ValorICMS`, `IcmsMovEstqUserFieldsObject`, `UploadIdentify`

**Item (ItemMovEstqChildList):**
- Missing: `FatorDivisor`, `BaseCustoMedio`, `CustoUnitario`, `ChaveOrdenacao`, `SequenciaItemContrato`, `NumeroVersaoContrato`, `SequenciaItemNotaFiscal`, `CalculaST`, reduction fields (`ReducaoICMS`, `ReducaoPIS`, etc.)
- Missing empty child lists: `CompItemMovEstqChildList`, `CtrlLoteItemMovEstqChildList`, etc.

**Classes (MovEstqClasseRecDespChildList):**
- Missing `ExcluiCentroControleValorZero: "Sim"` and `MovEstqClasseRecDespUserFieldsObject: {}`
- Missing `RateioMovEstqUserFieldsObject: {}` in each rateio entry

## Plan

### Step 1 — Restore missing header fields in classObject
In `alvoMovEstqLancarService.ts`, add to classObject:
- `RefazParcelas: "Sim"`, `OrigemModulo: "Estoque"`, `IntegradoFiscal: "Não"`, `IntegraFiscal: "Não"`, `ControlaEstoque: "Não"`, `ModalidadeFrete: "Sem Frete"`, `NaturezaFrete: "N"`, `IndicadorPresenca: "Nenhum"`, `DocumentoHomologado: "Sim"`, `MovEstqUserFieldsObject: {}`
- Empty child lists: `MovEstqAcordVendChildList: []`, `MovEstqAdiantChildList: []`, `MovEstqCctrlChildList: []`, `MovEstqDocComplemChildList: []`, `MovEstqEmpChildList: []`, `MovEstqNfEletronicaChildList: []`
- `MovEstqPedCompChildList` with purchase order data

### Step 2 — Fix ICMS child list
Change `IcmsMovEstqChildList` to use `CodigoEmpresaFilial: "1.01"` and add missing sub-fields.

### Step 3 — Restore missing item fields
Add `FatorDivisor`, `BaseCustoMedio`, `CustoUnitario`, reduction fields, and all empty child lists to the item object.

### Step 4 — Restore missing classe/rateio fields
Add `ExcluiCentroControleValorZero: "Sim"` and `UserFieldsObject` entries to classesList and rateio entries.

All changes are in a single file: `src/services/alvoMovEstqLancarService.ts`.

