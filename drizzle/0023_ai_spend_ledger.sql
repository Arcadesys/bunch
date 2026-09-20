alter table native_scene_render add column quality text not null default 'high' check (quality in ('low','medium','high'));
alter table native_scene_render add column cost_mode text not null default 'STANDARD' check (cost_mode in ('STANDARD','ECONOMY','PAUSED'));
alter table group_photo_render add column quality text not null default 'high' check (quality in ('low','medium','high'));
alter table group_photo_render add column cost_mode text not null default 'STANDARD' check (cost_mode in ('STANDARD','ECONOMY','PAUSED'));

alter table image_usage add column action text not null default 'generation' check (action in ('generation','repair','photo_finish'));
alter table image_usage add column route text not null default 'LEGACY' check (route in ('LEGACY','PROMPT_ONLY','IDENTITY','ECONOMY'));
alter table image_usage add column model text not null default 'gpt-image-2.5-sunburst';
alter table image_usage add column quality text not null default 'high' check (quality in ('low','medium','high'));
alter table image_usage add column size text not null default '1024x1024';
alter table image_usage add column reference_count integer not null default 0 check (reference_count between 0 and 16);
alter table image_usage add column projected_cost_microusd bigint not null default 0 check (projected_cost_microusd >= 0);
alter table image_usage add column cost_microusd bigint check (cost_microusd >= 0);
alter table image_usage add column cost_status text not null default 'ESTIMATED' check (cost_status in ('ESTIMATED','PROVIDER_CONFIRMED'));
alter table image_usage add column rate_card_version text not null default 'openai-2026-09-08';

update image_usage u set
  action=case when n.source_private_id is not null or n.source_native_id is not null or n.source_group_id is not null then 'repair' else 'generation' end,
  model=n.model,
  quality=n.quality
from native_scene_render n
where u.job_kind='native' and u.job_id=n.id;

update image_usage u set action='photo_finish',model=g.model,quality=g.quality
from group_photo_render g where u.job_kind='group' and u.job_id=g.id;

create index image_usage_spend_day_idx on image_usage(admitted_on,state,owner_id);
