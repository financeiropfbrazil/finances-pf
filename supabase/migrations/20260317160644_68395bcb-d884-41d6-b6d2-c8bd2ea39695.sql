
ALTER TABLE nf_entrada
  ADD COLUMN IF NOT EXISTS class_rec_desp_codigo text,
  ADD COLUMN IF NOT EXISTS class_rec_desp_nome text;

CREATE INDEX IF NOT EXISTS idx_nf_entrada_class 
  ON nf_entrada(class_rec_desp_codigo);
