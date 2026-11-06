-- Run once in Supabase SQL Editor if you already ran schema.sql before this change.
-- Moves PDF report uploading from admin to staff: staff can now see every booking
-- and upload a report for any of them (not just the jobs assigned to them).

drop policy if exists b_sel on bookings;
create policy b_sel on bookings for select using (user_id=auth.uid() or staff_id=auth.uid() or has_role(array['admin','staff']));

create or replace function staff_upload_report(p_booking_id uuid,p_path text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  if not exists(select 1 from bookings where id=p_booking_id) then raise exception 'Booking not found'; end if;
  insert into reports(booking_id,path) values(p_booking_id,p_path);
  update bookings set status='Report ready' where id=p_booking_id;
end $$;

drop policy if exists rep_staff_ins on storage.objects;
create policy rep_staff_ins on storage.objects for insert to authenticated
  with check (bucket_id='reports' and has_role(array['staff']));
drop policy if exists rep_staff_sel on storage.objects;
create policy rep_staff_sel on storage.objects for select to authenticated
  using (bucket_id='reports' and has_role(array['staff']));
