-- Deliberately separate from MCP OAuth. A leaked reference credential cannot
-- call companion tools or access work records.
alter table private_image add column reference_version integer not null default 1;

create table reference_credential (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  token_hash text not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index reference_credential_owner_active_idx on reference_credential(owner_id, revoked_at);

create table reference_credential_alter (
  credential_id uuid not null references reference_credential(id) on delete cascade,
  owner_id text not null,
  alter_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (credential_id, alter_id),
  constraint reference_credential_alter_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete cascade
);
create index reference_credential_alter_owner_idx on reference_credential_alter(owner_id, alter_id);
