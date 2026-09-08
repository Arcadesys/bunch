alter table alter_profile add column appearance_reference_image_id uuid;
alter table alter_profile add constraint alter_profile_appearance_reference_fk
  foreign key (appearance_reference_image_id) references private_image(id) on delete set null;
