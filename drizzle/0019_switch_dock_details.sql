-- Optional details reported after a switch is recorded. Both stay null unless
-- someone explicitly reports them; a missing value never means "none".
alter table presence_period
  add column energy smallint,
  add column trigger_label text,
  add constraint presence_period_energy check (energy is null or energy between 1 and 5),
  add constraint presence_period_trigger_label check (trigger_label is null or char_length(trigger_label) between 1 and 60);

-- A retraction restores the previous hosting period itself inside one
-- transaction, so the period trigger must not also open or close one. The flag
-- is transaction-local and set only by the retraction service.
create or replace function record_hosting_period() returns trigger language plpgsql as $$
declare boundary timestamptz;
begin
  if current_setting('bunch.retracting_hosting', true) = 'on' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;
  if TG_OP = 'UPDATE' and NEW.alter_id is not distinct from OLD.alter_id then
    return NEW;
  end if;
  if TG_OP = 'DELETE' then
    boundary := date_trunc('milliseconds', clock_timestamp());
    update presence_period set ended_at = greatest(boundary, started_at),
      version = version + 1, updated_at = boundary
      where owner_id = OLD.owner_id and kind = 'HOSTING' and ended_at is null;
    return OLD;
  end if;
  boundary := NEW.recorded_at;
  update presence_period set ended_at = boundary, version = version + 1, updated_at = boundary
    where owner_id = NEW.owner_id and kind = 'HOSTING' and ended_at is null;
  if NEW.alter_id is not null then
    insert into presence_period(owner_id, alter_id, kind, started_at)
      values (NEW.owner_id, NEW.alter_id, 'HOSTING', boundary);
  end if;
  return NEW;
end;
$$;
