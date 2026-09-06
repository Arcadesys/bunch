-- Additive: preserve legacy summaries and catch-up review history.
alter table catch_up_session add column narrative_revision integer not null default 0;
alter table conversation_summary alter column start_at drop not null;
alter table conversation_summary add column catch_up_session_id uuid;
alter table conversation_summary add column revision integer;
alter table conversation_summary add column generated_at timestamptz;
alter table conversation_summary add column source_client text;
alter table conversation_summary add column source_references jsonb not null default '[]';
alter table conversation_summary add constraint summary_session_owner_fk foreign key(owner_id,catch_up_session_id) references catch_up_session(owner_id,id) on delete cascade;
create unique index conversation_summary_session_revision on conversation_summary(owner_id,catch_up_session_id,revision);
