-- Run once in Supabase SQL Editor. Safe to re-run.
-- Lets an admin give or remove STAFF access from the admin dashboard ("Staff access" tab).
-- Only admins can call it; it only switches between patient and staff, never touches admin accounts.

drop function if exists set_user_role(text,text);
create or replace function set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path=public as $$
declare v_current text;
begin
  if not has_role(array['admin']) then raise exception 'Not allowed'; end if;
  if p_role not in ('patient','staff') then raise exception 'Only patient or staff access can be set here'; end if;
  if p_user=auth.uid() then raise exception 'You can''t change your own access'; end if;
  select role into v_current from profiles where id=p_user;
  if not found then raise exception 'Account not found'; end if;
  if v_current='admin' then raise exception 'Admin accounts can''t be changed here'; end if;
  update profiles set role=p_role where id=p_user;
end $$;
