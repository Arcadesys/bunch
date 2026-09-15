alter table alter_profile
  add column species text,
  add column visual_description text,
  add column presentation text,
  add column signature_traits text[] not null default '{}',
  add column style_tags text[] not null default '{}',
  add column image_do_not_change text[] not null default '{}';
