-- Existing bearer links retain their original exposure until explicitly enabled.
alter table gallery_share add column show_current_fronting boolean not null default false;
