-- Fresh-database entrypoint. psql's \ir resolves both paths relative to this file.
-- Existing databases must use `npm run db:migrate` instead.
\ir baseline.sql
\ir ../drizzle/0001_mcp_crud.sql
\ir ../drizzle/0002_fronting_sessions.sql
