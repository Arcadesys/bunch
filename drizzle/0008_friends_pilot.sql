-- Additive and closed by default. Enroll the operator before enabling the gate.
create table pilot_policy (
  id boolean primary key default true check (id),
  gate_enabled boolean not null default false,
  friends_enabled boolean not null default false,
  invitations_open boolean not null default false,
  uploads_enabled boolean not null default false,
  max_friends integer not null default 2 check (max_friends between 0 and 20),
  capacity_verified_at timestamptz,
  recovery_verified_at timestamptz,
  evidence text,
  check (not invitations_open or (gate_enabled and friends_enabled and capacity_verified_at is not null and recovery_verified_at is not null))
);
insert into pilot_policy(id) values(true);
create table pilot_account (
  owner_id text primary key,
  role text not null check(role in ('OPERATOR','FRIEND')),
  state text not null default 'ACTIVE' check(state in ('ACTIVE','REVOKED','DELETING','DELETED')),
  display_name text not null default 'My system',
  quota_bytes bigint not null default 52428800 check(quota_bytes >= 0),
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index pilot_one_operator on pilot_account(role) where role='OPERATOR';
create table pilot_invitation (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_by text references pilot_account(owner_id),
  created_at timestamptz not null default now()
);
create table pilot_upload (
  storage_key text primary key,
  owner_id text not null references pilot_account(owner_id),
  bytes bigint not null check(bytes >= 0),
  state text not null check(state in ('RESERVED','STORED')),
  created_at timestamptz not null default now()
);
create index pilot_upload_owner on pilot_upload(owner_id);
create table pilot_rate (
  owner_id text not null references pilot_account(owner_id),
  bucket text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key(owner_id,bucket)
);
-- Blocks new writes after revocation and serializes deletion against mutations.
create function pilot_guard_owner() returns trigger language plpgsql as $$
declare subject text; member pilot_account; gated boolean; friends boolean;
begin
  if TG_TABLE_NAME='app_user' then
    if TG_OP='DELETE' then subject:=OLD.id; else subject:=NEW.id; end if;
  else
    if TG_OP='DELETE' then subject:=OLD.owner_id; else subject:=NEW.owner_id; end if;
  end if;
  if current_setting('app.pilot_purge',true)=subject then
    if TG_OP='DELETE' then return OLD; else return NEW; end if;
  end if;
  select * into member from pilot_account where owner_id=subject for share;
  select gate_enabled,friends_enabled into gated,friends from pilot_policy where id;
  if (member.owner_id is not null and (member.state<>'ACTIVE' or (member.role='FRIEND' and not friends)))
    or (gated and member.owner_id is null) then
    raise exception 'Account access is unavailable' using errcode='42501';
  end if;
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
do $$ declare r record; begin
  for r in select table_name from information_schema.columns where table_schema=current_schema() and column_name='owner_id' and table_name not like 'pilot_%' loop
    execute format('create trigger pilot_access_guard before insert or update or delete on %I for each row execute function pilot_guard_owner()',r.table_name);
  end loop;
end $$;
create trigger pilot_access_guard before insert or update or delete on app_user for each row execute function pilot_guard_owner();
