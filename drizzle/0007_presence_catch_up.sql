-- Keep old catch-up sessions linked to their original legacy source.
alter table presence_period add constraint presence_period_owner_id_id_key unique(owner_id, id);
alter table catch_up_session alter column fronting_session_id drop not null;
alter table catch_up_session add column presence_period_id uuid;
alter table catch_up_session add constraint catch_up_session_owner_presence_fk
  foreign key(owner_id, presence_period_id) references presence_period(owner_id, id) on delete cascade;
alter table catch_up_session add constraint catch_up_session_owner_presence_key unique(owner_id, presence_period_id);
alter table catch_up_session add constraint catch_up_session_one_source check
  ((fronting_session_id is not null)::int + (presence_period_id is not null)::int = 1);
