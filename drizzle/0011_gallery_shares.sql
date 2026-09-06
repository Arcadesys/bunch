-- Anonymous bearer links for a deliberately narrow, read-only system gallery.
create table gallery_share (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);
create index gallery_share_owner_created_idx on gallery_share(owner_id, created_at desc);
