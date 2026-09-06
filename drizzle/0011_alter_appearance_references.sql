alter table private_image add constraint private_image_owner_id_id_key unique (owner_id, id);

create table if not exists alter_appearance (
  owner_id text not null,
  alter_id uuid not null,
  appearance_notes text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, alter_id),
  foreign key (owner_id, alter_id) references alter_profile(owner_id, id) on delete cascade
);

create table if not exists alter_appearance_reference (
  owner_id text not null,
  alter_id uuid not null,
  image_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, alter_id, image_id),
  foreign key (owner_id, alter_id) references alter_profile(owner_id, id) on delete cascade,
  foreign key (owner_id, image_id) references private_image(owner_id, id) on delete cascade
);
