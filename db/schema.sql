-- Fresh-database entrypoint. psql's \ir resolves both paths relative to this file.
-- Existing databases must use `npm run db:migrate` instead.
\ir baseline.sql
\ir ../drizzle/0001_mcp_crud.sql
\ir ../drizzle/0002_fronting_sessions.sql
\ir ../drizzle/0003_profile_pictures.sql
\ir ../drizzle/0004_catch_up_command_center.sql
\ir ../drizzle/0005_system_host.sql
\ir ../drizzle/0006_hosting_fronting_periods.sql
\ir ../drizzle/0007_presence_catch_up.sql
\ir ../drizzle/0008_friends_pilot.sql
\ir ../drizzle/0009_conversation_summary.sql
\ir ../drizzle/0010_episode_review.sql
\ir ../drizzle/0011_alter_appearance_references.sql
\ir ../drizzle/0011_gallery_shares.sql
\ir ../drizzle/0012_tenant_invitations.sql
\ir ../drizzle/0012_visual_identity.sql
\ir ../drizzle/0013_group_photo_composer.sql
\ir ../drizzle/0014_shared_current_fronting.sql
\ir ../drizzle/0015_group_photo_finisher.sql
\ir ../drizzle/0016_note_image_gifts.sql
\ir ../drizzle/0017_kanban_checklists_and_note_links.sql
