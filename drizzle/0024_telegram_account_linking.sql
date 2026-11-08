create table telegram_connection (
  owner_id text primary key references app_user(id) on delete cascade,
  issuer text not null,
  subject text not null,
  telegram_user_id text not null unique,
  display_name text,
  username text,
  bot_access boolean not null default false,
  connection_revision integer not null default 1 check (connection_revision > 0),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer, subject)
);
create table telegram_connection_epoch (
  owner_id text primary key references app_user(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0)
);

create table telegram_link_transaction (
  state_hash text primary key,
  confirmation_hash text unique,
  owner_id text not null,
  session_hash text not null,
  nonce text not null,
  code_verifier text not null,
  intent_hash text,
  status text not null check (status in ('PENDING', 'EXCHANGING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'FAILED')),
  telegram_issuer text,
  telegram_subject text,
  telegram_user_id text,
  display_name text,
  username text,
  bot_access boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz
);
create index telegram_link_transaction_owner_expiry_idx on telegram_link_transaction(owner_id, expires_at) where status in ('PENDING', 'AWAITING_CONFIRMATION');

create table telegram_link_intent (
  token_hash text primary key,
  owner_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index telegram_link_intent_expiry_idx on telegram_link_intent(expires_at);

create table telegram_link_rate (
  rate_key text not null,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (rate_key, bucket, window_start)
);

create table telegram_publication_attempt (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  connection_revision integer not null,
  bot_id text not null,
  pack_name text not null,
  title_hash text not null,
  content_hash text not null,
  status text not null check (status in ('STARTED', 'UNCERTAIN', 'ACCEPTED', 'VERIFIED', 'FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, pack_name)
);
