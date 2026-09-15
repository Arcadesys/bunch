alter table private_image
  add column if not exists is_profile_picture boolean not null default false;

with single_image_profiles as (
  select owner_id, alter_id
  from private_image
  group by owner_id, alter_id
  having count(*) = 1
)
update private_image image
set is_profile_picture = true
from single_image_profiles profile
where image.owner_id = profile.owner_id
  and image.alter_id = profile.alter_id;

create unique index if not exists private_image_one_profile_picture
  on private_image (owner_id, alter_id)
  where is_profile_picture = true;
