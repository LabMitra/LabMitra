-- Run once in Supabase SQL Editor. Safe to re-run.
-- Adds age and gender to user profiles (bookings already have patient_age / patient_gender).

alter table profiles add column if not exists age int check (age between 0 and 120);
alter table profiles add column if not exists gender text check (gender in ('Male','Female','Other'));

-- Users may edit their own name, phone, age and gender (still never their role or email).
revoke update on profiles from anon, authenticated;
grant update(full_name,phone,age,gender) on profiles to authenticated;

-- New signups: copy age/gender too if the signup sent them.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,full_name,phone,email,age,gender) values(new.id,
    new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone', new.email,
    case when (new.raw_user_meta_data->>'age') ~ '^\d{1,3}$' and (new.raw_user_meta_data->>'age')::int between 0 and 120 then (new.raw_user_meta_data->>'age')::int end,
    case when new.raw_user_meta_data->>'gender' in ('Male','Female','Other') then new.raw_user_meta_data->>'gender' end);
  return new;
end $$;

-- Fill existing profiles from the user's most recent booking for themselves
-- (only where the patient name matches the account name, so we don't copy a family member's details).
update profiles p set age=coalesce(p.age,b.patient_age), gender=coalesce(p.gender,b.patient_gender)
from (select distinct on (user_id) user_id, patient_name, patient_age, patient_gender
      from bookings where patient_age is not null order by user_id, created_at desc) b
where b.user_id=p.id and (p.age is null or p.gender is null)
  and lower(trim(b.patient_name))=lower(trim(p.full_name));
