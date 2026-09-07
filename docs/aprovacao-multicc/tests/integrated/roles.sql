-- Exclusivamente para o banco descartável deste compose.
ALTER ROLE authenticator PASSWORD 'local-test-only';
ALTER ROLE supabase_auth_admin PASSWORD 'local-test-only';
ALTER ROLE supabase_storage_admin PASSWORD 'local-test-only';
