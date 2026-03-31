ALTER TABLE classes_rec_desp
  ADD COLUMN IF NOT EXISTS conta_contabil_reduzida integer,
  ADD COLUMN IF NOT EXISTS conta_contabil_classificacao text;

CREATE INDEX IF NOT EXISTS idx_classes_conta_reduzida 
  ON classes_rec_desp(conta_contabil_reduzida);