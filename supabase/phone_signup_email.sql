-- Run once in Supabase SQL Editor. Safe to re-run.
-- Phone-number signups can now also give an email "for the record". It's saved on the profile
-- (shown in My Account and admin Users) but is NOT used for logging in; the phone + OTP is.

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,full_name,phone,email,age,gender) values(new.id,
    new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone',
    coalesce(new.email, nullif(trim(new.raw_user_meta_data->>'contact_email'),'')),
    case when (new.raw_user_meta_data->>'age') ~ '^\d{1,3}$' and (new.raw_user_meta_data->>'age')::int between 0 and 120 then (new.raw_user_meta_data->>'age')::int end,
    case when new.raw_user_meta_data->>'gender' in ('Male','Female','Other') then new.raw_user_meta_data->>'gender' end);
  return new;
end $$;
