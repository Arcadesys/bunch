-- The earlier appearance-reference migration already adds the owner/image
-- uniqueness needed for this owner-scoped foreign key.

create table system_note_gift_image (
  owner_id text not null,
  note_id uuid not null,
  image_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, note_id, image_id),
  constraint system_note_gift_image_owner_note_fk
    foreign key (owner_id, note_id) references system_note(owner_id, id) on delete cascade,
  constraint system_note_gift_image_owner_image_fk
    foreign key (owner_id, image_id) references private_image(owner_id, id) on delete cascade
);

create index system_note_gift_image_owner_note_created_idx
  on system_note_gift_image(owner_id, note_id, created_at, image_id);
