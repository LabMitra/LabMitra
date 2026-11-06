-- Run once in Supabase SQL Editor.
-- Keeps the admin and staff dashboards in sync live.

-- 1) Only admin edits bookings directly. Staff go through set_status() / mark_cash_collected(),
--    which only let them change status and cash payment, nothing else (e.g. not the amount).
drop policy if exists b_upd on bookings;
create policy b_upd on bookings for update using (has_role(array['admin']));

-- 2) Staff may see report records, so uploaded PDFs show as "View PDF" on their side too.
drop policy if exists r_sel on reports;
create policy r_sel on reports for select using (
  has_role(array['admin','staff'])
  or exists(select 1 from bookings b where b.id=booking_id and b.user_id=auth.uid()));

-- 3) Turn on live updates (Supabase Realtime) for bookings and reports.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='bookings') then
    alter publication supabase_realtime add table bookings; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='reports') then
    alter publication supabase_realtime add table reports; end if;
end $$;
