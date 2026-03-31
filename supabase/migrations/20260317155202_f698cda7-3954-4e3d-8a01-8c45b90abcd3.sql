
CREATE TABLE public.classes_rec_desp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  grupo text,
  nivel text,
  natureza text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_classes_rec_desp_nivel ON public.classes_rec_desp(nivel);

ALTER TABLE public.classes_rec_desp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can select classes_rec_desp"
  ON public.classes_rec_desp FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert classes_rec_desp"
  ON public.classes_rec_desp FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update classes_rec_desp"
  ON public.classes_rec_desp FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete classes_rec_desp"
  ON public.classes_rec_desp FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_classes_rec_desp_updated_at
  BEFORE UPDATE ON public.classes_rec_desp
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
