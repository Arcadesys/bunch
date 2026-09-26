create table alter_sticker_pack (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  alter_id uuid not null,
  communication_profile text,
  status text not null default 'DRAFT',
  slots jsonb not null,
  telegram_url text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alter_sticker_pack_owner_alter_fk
    foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id)
    on delete cascade,
  constraint alter_sticker_pack_owner_alter_key unique (owner_id, alter_id),
  constraint alter_sticker_pack_status_check check (status in ('DRAFT','APPROVED','PUBLISHED')),
  constraint alter_sticker_pack_version_check check (version > 0),
  constraint alter_sticker_pack_slots_array check (jsonb_typeof(slots) = 'array'),
  constraint alter_sticker_pack_slots_count check (jsonb_array_length(slots) = 10),
  constraint alter_sticker_pack_telegram_url check (
    telegram_url is null or telegram_url ~ '^https://t\.me/addstickers/[A-Za-z0-9_]+$'
  )
);

create index alter_sticker_pack_owner_updated_idx
  on alter_sticker_pack(owner_id, updated_at desc);
