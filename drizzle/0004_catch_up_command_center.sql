create type catch_up_item_type as enum ('NOTE', 'TODO', 'DECISION', 'THREAD');
create type catch_up_review_state as enum ('NEW', 'ACKNOWLEDGED', 'DEFERRED', 'RESOLVED');
create type important_thread_source as enum ('CODEX', 'CHATGPT');
create type important_thread_status as enum ('SUGGESTED', 'CONFIRMED', 'ARCHIVED');

create table important_thread (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  source important_thread_source not null,
  external_thread_id text not null,
  url text not null,
  title text not null,
  approved_summary text not null,
  key_decision_or_action text not null,
  flagged_by_alter_id uuid,
  status important_thread_status not null default 'SUGGESTED',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint important_thread_owner_id_id_key unique (owner_id, id),
  constraint important_thread_owner_external_key unique (owner_id, source, external_thread_id),
  constraint important_thread_owner_flagger_fk foreign key (owner_id, flagged_by_alter_id)
    references alter_profile(owner_id, id) on delete restrict
);

create table important_thread_recipient (
  owner_id text not null,
  thread_id uuid not null,
  alter_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, thread_id, alter_id),
  constraint important_thread_recipient_thread_fk foreign key (owner_id, thread_id)
    references important_thread(owner_id, id) on delete cascade,
  constraint important_thread_recipient_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete restrict
);

create table system_decision (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  title text not null,
  decision text not null,
  rationale text,
  next_action text not null,
  actor_alter_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint system_decision_owner_id_id_key unique (owner_id, id),
  constraint system_decision_owner_actor_fk foreign key (owner_id, actor_alter_id)
    references alter_profile(owner_id, id) on delete restrict
);

create table system_decision_recipient (
  owner_id text not null,
  decision_id uuid not null,
  alter_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, decision_id, alter_id),
  constraint system_decision_recipient_decision_fk foreign key (owner_id, decision_id)
    references system_decision(owner_id, id) on delete cascade,
  constraint system_decision_recipient_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete restrict
);

create table catch_up_session (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  fronting_session_id uuid not null,
  alter_id uuid not null,
  window_start timestamptz,
  window_end timestamptz not null,
  first_time boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catch_up_session_owner_id_id_key unique (owner_id, id),
  constraint catch_up_session_owner_front_key unique (owner_id, fronting_session_id),
  constraint catch_up_session_owner_front_fk foreign key (owner_id, fronting_session_id)
    references fronting_session(owner_id, id) on delete cascade,
  constraint catch_up_session_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete cascade,
  constraint catch_up_session_valid_window check (window_start is null or window_end >= window_start)
);

create table catch_up_entry (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  session_id uuid not null,
  item_type catch_up_item_type not null,
  item_id uuid not null,
  review_state catch_up_review_state not null default 'NEW',
  defer_until timestamptz,
  defer_until_next_switch boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catch_up_entry_owner_id_id_key unique (owner_id, id),
  constraint catch_up_entry_session_item_key unique (owner_id, session_id, item_type, item_id),
  constraint catch_up_entry_owner_session_fk foreign key (owner_id, session_id)
    references catch_up_session(owner_id, id) on delete cascade,
  constraint catch_up_entry_defer_state check (
    (review_state = 'DEFERRED' and ((defer_until is not null) <> defer_until_next_switch))
    or (review_state <> 'DEFERRED' and defer_until is null and defer_until_next_switch = false)
  )
);

create index catch_up_session_owner_alter_idx on catch_up_session(owner_id, alter_id, created_at desc);
create index catch_up_entry_owner_state_idx on catch_up_entry(owner_id, review_state, defer_until);
create index important_thread_owner_status_idx on important_thread(owner_id, status, updated_at desc);
create index system_decision_owner_updated_idx on system_decision(owner_id, updated_at desc);
