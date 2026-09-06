-- Generated summaries are ephemeral; never copy their body into mutation receipts.
create table conversation_summary (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  alter_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  time_zone text not null,
  summary text not null check (char_length(summary) between 1 and 20000),
  coverage text not null check (char_length(coverage) between 1 and 4000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '720 hours'),
  foreign key (owner_id,alter_id) references alter_profile(owner_id,id) on delete cascade,
  check (end_at >= start_at),
  check (expires_at = created_at + interval '720 hours')
);
create index conversation_summary_owner_created on conversation_summary(owner_id,created_at desc);
create index conversation_summary_expiry on conversation_summary(expires_at);
create trigger pilot_access_guard before insert or update or delete on conversation_summary
  for each row execute function pilot_guard_owner();
