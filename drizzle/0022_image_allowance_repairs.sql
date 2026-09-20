alter table pilot_account add column image_daily_limit integer check (image_daily_limit between 0 and 1000);
create table image_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  job_kind text not null check (job_kind in ('native','group')),
  job_id uuid not null,
  admitted_on date not null default (now() at time zone 'America/Chicago')::date,
  state text not null default 'RESERVED' check (state in ('RESERVED','DISPATCHED','RELEASED')),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  provider_usage jsonb,
  unique(owner_id,job_kind,job_id)
);
create index image_usage_owner_day on image_usage(owner_id,admitted_on);
-- No job foreign key: deleting an image must never refund a dispatched use.
insert into image_usage(owner_id,job_kind,job_id,admitted_on,state,created_at)
select owner_id,'native',id,(created_at at time zone 'America/Chicago')::date,
case when state='QUEUED' then 'RESERVED' else 'DISPATCHED' end,created_at
from native_scene_render where (created_at at time zone 'America/Chicago')::date=(now() at time zone 'America/Chicago')::date or state='QUEUED';
insert into image_usage(owner_id,job_kind,job_id,admitted_on,state,created_at)
select owner_id,'group',id,(created_at at time zone 'America/Chicago')::date,
case when state='QUEUED' then 'RESERVED' else 'DISPATCHED' end,created_at
from group_photo_render where (created_at at time zone 'America/Chicago')::date=(now() at time zone 'America/Chicago')::date or state='QUEUED';
alter table native_scene_render add column source_private_id uuid references private_image(id) on delete cascade;
alter table native_scene_render add column source_native_id uuid references native_scene_render(id) on delete cascade;
alter table native_scene_render add column source_group_id uuid references group_photo_render(id) on delete cascade;
alter table native_scene_render add constraint native_scene_one_source check (num_nonnulls(source_private_id,source_native_id,source_group_id)<=1);
-- Cascaded deletion releases only undispatched uses; bytes remain in the upload cleanup ledger.
create function image_job_deleted() returns trigger language plpgsql as $$
begin
  update image_usage set state='RELEASED' where owner_id=old.owner_id and job_id=old.id and job_kind=case when TG_TABLE_NAME='native_scene_render' then 'native' else 'group' end and state='RESERVED';
  return old;
end $$;
create trigger native_image_deleted after delete on native_scene_render for each row execute function image_job_deleted();
create trigger group_image_deleted after delete on group_photo_render for each row execute function image_job_deleted();
