
-- Create sync_queue table
CREATE TABLE public.sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_batch_id uuid NOT NULL,
  doc_type text NOT NULL,
  doc_number text NOT NULL,
  api_params jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  result_summary text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create sync_log table
CREATE TABLE public.sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_batch_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  total_items integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  divergent_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  created_by uuid
);

-- Indexes
CREATE INDEX idx_sync_queue_batch_id ON public.sync_queue(sync_batch_id);
CREATE INDEX idx_sync_queue_status ON public.sync_queue(status);
CREATE UNIQUE INDEX idx_sync_log_batch_id ON public.sync_log(sync_batch_id);
CREATE INDEX idx_sync_log_status ON public.sync_log(status);

-- RLS sync_queue
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view sync_queue" ON public.sync_queue FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert sync_queue" ON public.sync_queue FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update sync_queue" ON public.sync_queue FOR UPDATE USING (auth.uid() IS NOT NULL);

-- RLS sync_log
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view sync_log" ON public.sync_log FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert sync_log" ON public.sync_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update sync_log" ON public.sync_log FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_queue;
