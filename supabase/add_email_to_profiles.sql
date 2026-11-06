-- Run once in Supabase SQL Editor if you already ran schema.sql before this change.
-- Mirrors each user's email into profiles (like full_name/phone already are), since
-- auth.users itself isn't readable from the site's client-side code.

alter table profiles add column if not exists email text;

-- Backfill existing accounts (admin/staff/patients signed up before this column existed).
update profiles p set email=u.email from auth.users u where p.id=u.id and p.email is null;

-- New signups get it automatically from here on.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as
$$ begin insert into profiles(id,full_name,phone,email) values(new.id,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone',new.email); return new; end $$;
