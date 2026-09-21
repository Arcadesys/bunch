-- Immutable, owner-scoped display renditions reduce transfer without replacing
-- the original private image. Exactly one source owns each rendition, and every
-- source deletion cascades through its derived storage records.
alter table native_scene_render
  add constraint native_scene_render_owner_id_id_key unique(owner_id,id);
alter table group_photo_render
  add constraint group_photo_render_owner_id_id_key unique(owner_id,id);

create table image_rendition (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  source_private_id uuid,
  source_native_id uuid,
  source_group_id uuid,
  rendition text not null check(rendition in ('w256-v1','w512-v1','w1024-v1')),
  storage_key text not null unique,
  content_type text not null check(content_type in ('image/webp','image/avif')),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  width integer not null check(width > 0 and width <= 1024),
  height integer not null check(height > 0),
  byte_size bigint not null check(byte_size > 0),
  created_at timestamptz not null default now(),
  constraint image_rendition_one_source check(
    num_nonnulls(source_private_id,source_native_id,source_group_id)=1
  ),
  foreign key(owner_id,source_private_id)
    references private_image(owner_id,id) on delete cascade,
  foreign key(owner_id,source_native_id)
    references native_scene_render(owner_id,id) on delete cascade,
  foreign key(owner_id,source_group_id)
    references group_photo_render(owner_id,id) on delete cascade
);

create unique index image_rendition_private_unique
  on image_rendition(owner_id,source_private_id,rendition)
  where source_private_id is not null;
create unique index image_rendition_native_unique
  on image_rendition(owner_id,source_native_id,rendition)
  where source_native_id is not null;
create unique index image_rendition_group_unique
  on image_rendition(owner_id,source_group_id,rendition)
  where source_group_id is not null;
create index image_rendition_owner_created
  on image_rendition(owner_id,created_at desc);

create trigger pilot_access_guard before insert or update or delete
  on image_rendition for each row execute function pilot_guard_owner();
