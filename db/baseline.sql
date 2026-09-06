-- Captured pre-CRUD baseline. Apply only to a temporary empty database when
-- rehearsing drizzle/0001_mcp_crud.sql. Production already has this schema.
create extension if not exists pgcrypto;

create table app_user (
  id text primary key,
  google_subject text unique not null,
  created_at timestamptz not null default now()
);

create table alter_profile (
  id uuid primary key,
  owner_id text not null references app_user(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  self_described_gender text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private_image (
  id uuid primary key,
  owner_id text not null references app_user(id) on delete cascade,
  alter_id uuid not null references alter_profile(id) on delete cascade,
  storage_key text unique not null,
  content_type text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table alter_appearance (
  owner_id text not null,
  alter_id uuid not null,
  appearance_notes text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, alter_id),
  foreign key (owner_id, alter_id) references alter_profile(owner_id, id) on delete cascade
);

create table alter_appearance_reference (
  owner_id text not null,
  alter_id uuid not null,
  image_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, alter_id, image_id),
  foreign key (owner_id, alter_id) references alter_profile(owner_id, id) on delete cascade,
  foreign key (owner_id, image_id) references private_image(owner_id, id) on delete cascade
);

create type coverage_status as enum ('draft', 'confirmed', 'rejected');
create table coverage_assignment (
  id uuid primary key,
  owner_id text not null references app_user(id) on delete cascade,
  alter_id uuid references alter_profile(id) on delete restrict,
  starts_on date not null,
  ends_on date,
  status coverage_status not null default 'draft',
  suggestion_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint coverage_date_order check (ends_on is null or ends_on >= starts_on),
  constraint confirmed_coverage_needs_alter check (status <> 'confirmed' or alter_id is not null)
);

create index coverage_confirmed_owner_dates
  on coverage_assignment(owner_id, starts_on, ends_on)
  where status = 'confirmed';

create table system_note (
  id uuid primary key,
  owner_id text not null references app_user(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  alter_id uuid references alter_profile(id) on delete set null,
  coverage_id uuid references coverage_assignment(id) on delete set null,
  created_at timestamptz not null default now()
);

create table system_todo (
  id uuid primary key,
  owner_id text not null references app_user(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  alter_id uuid references alter_profile(id) on delete set null,
  coverage_id uuid references coverage_assignment(id) on delete set null,
  status text not null check (status in ('open', 'done')) default 'open',
  created_at timestamptz not null default now()
);

create table system_preference (
  owner_id text not null references app_user(id) on delete cascade,
  preference_key text not null check (char_length(preference_key) between 1 and 120),
  preference_value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, preference_key)
);
