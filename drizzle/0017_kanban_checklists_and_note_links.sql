-- Checklist rows and journal references are owner-scoped joins. Cascades
-- deliberately preserve notes when a todo is deleted and preserve todos when
-- a note is deleted.
create table todo_checklist_item (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  todo_id uuid not null,
  title text not null check (char_length(title) between 1 and 500),
  completed boolean not null default false,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todo_checklist_item_owner_todo_fk foreign key (owner_id, todo_id)
    references system_todo(owner_id, id) on delete cascade,
  constraint todo_checklist_item_owner_id_key unique (owner_id, id),
  constraint todo_checklist_item_position_key unique (owner_id, todo_id, position) deferrable initially immediate
);
create index todo_checklist_item_owner_todo_position_idx
  on todo_checklist_item(owner_id, todo_id, position, id);

create table todo_note_reference (
  owner_id text not null,
  todo_id uuid not null,
  note_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, todo_id, note_id),
  constraint todo_note_reference_owner_todo_fk foreign key (owner_id, todo_id)
    references system_todo(owner_id, id) on delete cascade,
  constraint todo_note_reference_owner_note_fk foreign key (owner_id, note_id)
    references system_note(owner_id, id) on delete cascade
);
create index todo_note_reference_owner_note_idx on todo_note_reference(owner_id, note_id, todo_id);
