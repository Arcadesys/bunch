-- Reviewed forward migration from db/baseline.sql.
alter table alter_profile alter column id set default gen_random_uuid();
alter table private_image alter column id set default gen_random_uuid();
alter table coverage_assignment alter column id set default gen_random_uuid();
alter table system_note alter column id set default gen_random_uuid();
alter table system_todo alter column id set default gen_random_uuid();

alter table app_user add column time_zone text;

alter table alter_profile
  add column pronouns text,
  add column communication_guidance text,
  add column strengths text[] not null default '{}',
  add column boundaries text[] not null default '{}',
  add column version integer not null default 1 check (version > 0),
  add column archived_at timestamptz;
alter table alter_profile add constraint alter_profile_owner_id_id_key unique (owner_id, id);

create table alter_alias (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  alter_id uuid not null,
  alias text not null check (char_length(alias) between 1 and 120),
  normalized_alias text not null check (char_length(normalized_alias) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint alter_alias_owner_normalized_key unique (owner_id, normalized_alias),
  constraint alter_alias_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete cascade
);

alter table private_image drop constraint private_image_alter_id_fkey;
alter table private_image add constraint private_image_owner_alter_fk
  foreign key (owner_id, alter_id) references alter_profile(owner_id, id) on delete cascade;

alter table coverage_assignment add column version integer not null default 1 check (version > 0);
alter table coverage_assignment add constraint coverage_assignment_owner_id_id_key unique (owner_id, id);
alter table coverage_assignment drop constraint coverage_assignment_alter_id_fkey;
alter table coverage_assignment add constraint coverage_assignment_owner_alter_fk
  foreign key (owner_id, alter_id) references alter_profile(owner_id, id) on delete restrict;

alter table system_note
  add column version integer not null default 1 check (version > 0),
  add column updated_at timestamptz not null default now();
alter table system_note add constraint system_note_owner_id_id_key unique (owner_id, id);
alter table system_note drop constraint system_note_alter_id_fkey;
alter table system_note drop constraint system_note_coverage_id_fkey;
alter table system_note add constraint system_note_owner_alter_fk
  foreign key (owner_id, alter_id) references alter_profile(owner_id, id) on delete restrict;
alter table system_note add constraint system_note_owner_coverage_fk
  foreign key (owner_id, coverage_id) references coverage_assignment(owner_id, id) on delete restrict;

create type todo_status as enum ('INBOX', 'OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');
create type todo_priority as enum ('LOW', 'NORMAL', 'HIGH');
alter table system_todo drop constraint system_todo_status_check;
alter table system_todo alter column status drop default;
alter table system_todo alter column status type todo_status
  using (case status when 'done' then 'DONE' else 'OPEN' end)::todo_status;
alter table system_todo alter column status set default 'INBOX';
alter table system_todo
  add column details text,
  add column due_on date,
  add column priority todo_priority,
  add column version integer not null default 1 check (version > 0),
  add column updated_at timestamptz not null default now(),
  add column archived_at timestamptz;
alter table system_todo add constraint system_todo_owner_id_id_key unique (owner_id, id);
alter table system_todo drop constraint system_todo_coverage_id_fkey;
alter table system_todo add constraint system_todo_owner_coverage_fk
  foreign key (owner_id, coverage_id) references coverage_assignment(owner_id, id) on delete restrict;

create table todo_assignee (
  owner_id text not null,
  todo_id uuid not null,
  alter_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, todo_id, alter_id),
  constraint todo_assignee_owner_todo_fk foreign key (owner_id, todo_id)
    references system_todo(owner_id, id) on delete cascade,
  constraint todo_assignee_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete restrict
);
insert into todo_assignee (owner_id, todo_id, alter_id)
  select owner_id, id, alter_id from system_todo where alter_id is not null;
alter table system_todo drop column alter_id;

create type record_source as enum ('MCP', 'WEB', 'SYSTEM');
create table activity_event (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  source record_source not null,
  changed_fields text[] not null default '{}',
  from_status text,
  to_status text,
  actor_alter_id uuid,
  request_id uuid,
  created_at timestamptz not null default now(),
  constraint activity_event_owner_actor_fk foreign key (owner_id, actor_alter_id)
    references alter_profile(owner_id, id) on delete restrict
);
create index activity_event_owner_entity_idx
  on activity_event(owner_id, entity_type, entity_id, created_at desc);

create table mutation_receipt (
  owner_id text not null references app_user(id) on delete cascade,
  request_id uuid not null,
  operation text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, request_id)
);
