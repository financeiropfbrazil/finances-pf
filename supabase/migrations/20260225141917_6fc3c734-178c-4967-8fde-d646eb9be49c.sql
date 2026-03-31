
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.periods(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  item_description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'materia_prima' CHECK (category IN ('materia_prima','em_elaboracao','produto_acabado','embalagem','outros')),
  unit_of_measure TEXT NOT NULL DEFAULT 'UN',
  physical_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_cost NUMERIC(18,2) GENERATED ALWAYS AS (physical_quantity * unit_cost) STORED,
  location TEXT NOT NULL DEFAULT 'almoxarifado' CHECK (location IN ('almoxarifado','producao','expedicao')),
  notes TEXT,
  responsible_user UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view inventory_items" ON public.inventory_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert inventory_items" ON public.inventory_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update inventory_items" ON public.inventory_items FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete inventory_items" ON public.inventory_items FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_inventory_items_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.update_inventory_reconciliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period_id UUID;
  v_total NUMERIC(18,2);
BEGIN
  v_period_id := COALESCE(NEW.period_id, OLD.period_id);
  SELECT COALESCE(SUM(physical_quantity * unit_cost), 0) INTO v_total
  FROM public.inventory_items WHERE period_id = v_period_id;

  UPDATE public.reconciliation_summary
  SET management_balance = v_total,
      status = CASE WHEN v_total = accounting_balance THEN 'reconciled' ELSE 'divergent' END,
      updated_at = now()
  WHERE period_id = v_period_id AND module_name = 'inventory';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sync_inventory_reconciliation
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_inventory_reconciliation();
