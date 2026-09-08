-- Fresh-database entrypoint. psql's \ir resolves both paths relative to this file.
-- Existing databases must use `npm run db:migrate` instead.
\ir baseline.sql
\ir ../drizzle/0001_mcp_crud.sql
\ir ../drizzle/0002_fronting_sessions.sql
\ir ../drizzle/0003_profile_pictures.sql
\ir ../drizzle/0004_catch_up_command_center.sql
\ir ../drizzle/0005_system_host.sql
\ir ../drizzle/0006_hosting_fronting_periods.sql
\ir ../drizzle/0007_episode_catch_up.sql
\ir ../drizzle/0008_visual_identity.sql
\ir ../drizzle/0009_group_photo_composer.sql
\ir ../drizzle/0010_selected_appearance_reference.sql
