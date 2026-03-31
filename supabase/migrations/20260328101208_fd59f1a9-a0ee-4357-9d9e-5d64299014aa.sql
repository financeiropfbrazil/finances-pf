CREATE TABLE IF NOT EXISTS contas_pagar (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo_empresa_filial text NOT NULL DEFAULT '1.01',
  chave_docfin integer NOT NULL,
  sequencia integer NOT NULL DEFAULT 1,
  parcial integer NOT NULL DEFAULT 0,
  numero text,
  especie text,
  serie text,
  origem text,
  projecao text DEFAULT 'Não',
  codigo_entidade text,
  nome_entidade text,
  nome_fantasia_entidade text,
  cnpj_cpf text,
  categorias text,
  valor_bruto numeric DEFAULT 0,
  valor_original numeric DEFAULT 0,
  valor_pago numeric DEFAULT 0,
  valor_juros numeric DEFAULT 0,
  valor_multa numeric DEFAULT 0,
  valor_desconto numeric DEFAULT 0,
  valor_irrf numeric DEFAULT 0,
  valor_pis_rf numeric DEFAULT 0,
  valor_cofins_rf numeric DEFAULT 0,
  valor_csll_rf numeric DEFAULT 0,
  valor_inss numeric DEFAULT 0,
  valor_iss numeric DEFAULT 0,
  data_emissao date,
  data_vencimento date,
  data_prorrogacao date,
  data_pagamento date,
  data_competencia date,
  data_entrada date,
  codigo_situacao text,
  nome_situacao text,
  tipo_pag_rec text,
  nome_tipo_pag_rec text,
  tipo_cobranca text,
  nome_tipo_cobranca text,
  cond_pagamento text,
  nome_cond_pagamento text,
  classe_rec_desp text,
  centro_custo text,
  observacao text,
  observacao_docfin text,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(codigo_empresa_filial, chave_docfin, sequencia, parcial)
);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_vencimento ON contas_pagar(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_situacao ON contas_pagar(codigo_situacao);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_entidade ON contas_pagar(nome_entidade);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_competencia ON contas_pagar(data_competencia);

ALTER TABLE contas_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON contas_pagar
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);