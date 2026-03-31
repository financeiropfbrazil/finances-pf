CREATE TABLE IF NOT EXISTS compras_lancamento_auditoria (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  compras_nfse_id uuid REFERENCES compras_nfse(id),
  numero_nfse text,
  pedido_numero text,
  campo text NOT NULL,
  valor_anterior text,
  valor_novo text,
  usuario text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_nfse ON compras_lancamento_auditoria(compras_nfse_id);
CREATE INDEX idx_audit_created ON compras_lancamento_auditoria(created_at DESC);

ALTER TABLE compras_lancamento_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage audit"
  ON compras_lancamento_auditoria FOR ALL
  TO authenticated USING (true) WITH CHECK (true);