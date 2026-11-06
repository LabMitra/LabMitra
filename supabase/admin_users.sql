-- Run once in Supabase SQL Editor.
-- Lets admin read every user's saved addresses for the admin dashboard's Users tab.
-- Patients can still only see and edit their own addresses.

drop policy if exists addr_admin_sel on addresses;
create policy addr_admin_sel on addresses for select using (has_role(array['admin']));
