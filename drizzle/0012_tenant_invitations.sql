-- Single-use tenant invitations are created only by the enrolled operator.
-- The token itself remains hash-only; browser links carry it in a fragment.
alter table pilot_invitation add column if not exists created_by text references pilot_account(owner_id);
alter table pilot_invitation add column if not exists used_at timestamptz;
create index if not exists pilot_invitation_creator_created_idx on pilot_invitation(created_by, created_at desc);

-- Pin the one canonical pre-pilot owner once. This reads durable private-record
-- ownership at migration time; it is deliberately not a runtime "first account"
-- rule and never derives an administrator from an email address.
create table if not exists invitation_operator (
  owner_id text primary key references app_user(id) on delete restrict,
  created_at timestamptz not null default now()
);
insert into invitation_operator(owner_id)
select u.id from app_user u
where (exists(select 1 from alter_profile where owner_id=u.id)
       or exists(select 1 from private_image where owner_id=u.id))
  and (select count(*) from app_user)=1
  and (select count(*) from app_user owner
       where exists(select 1 from alter_profile where owner_id=owner.id)
          or exists(select 1 from private_image where owner_id=owner.id))=1
  and not exists(select 1 from pilot_account)
on conflict do nothing;
