-- sync_queue: drop restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "Auth users can view sync_queue" ON sync_queue;
DROP POLICY IF EXISTS "Auth users can insert sync_queue" ON sync_queue;
DROP POLICY IF EXISTS "Auth users can update sync_queue" ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_select" ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_insert" ON sync_queue;
DROP POLICY IF EXISTS "sync_queue_update" ON sync_queue;

CREATE POLICY "sync_queue_select" ON sync_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_queue_insert" ON sync_queue FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sync_queue_update" ON sync_queue FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- sync_log: drop restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "Auth users can view sync_log" ON sync_log;
DROP POLICY IF EXISTS "Auth users can insert sync_log" ON sync_log;
DROP POLICY IF EXISTS "Auth users can update sync_log" ON sync_log;
DROP POLICY IF EXISTS "sync_log_select" ON sync_log;
DROP POLICY IF EXISTS "sync_log_insert" ON sync_log;
DROP POLICY IF EXISTS "sync_log_update" ON sync_log;

CREATE POLICY "sync_log_select" ON sync_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_log_insert" ON sync_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sync_log_update" ON sync_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- intercompany_alvo_docs: drop restrictive update and recreate as permissive
DROP POLICY IF EXISTS "Auth users can update intercompany_alvo_docs" ON intercompany_alvo_docs;
DROP POLICY IF EXISTS "intercompany_alvo_docs_update" ON intercompany_alvo_docs;

CREATE POLICY "intercompany_alvo_docs_update" ON intercompany_alvo_docs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);