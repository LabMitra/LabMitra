-- Run once in Supabase SQL Editor. Safe to re-run.
-- Lets staff set ANY booking status from the staff dashboard (Reports section), the same list admin has,
-- except "Cancelled": cancelling can trigger a refund, so it stays admin-only (via cancel_booking).

create or replace function set_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  if p_status not in ('Confirmed','Assigned','Sample collected','Handed over to lab','Lab received sample','Processing started','Report ready','Cancelled') then
    raise exception 'Unknown status'; end if;
  if p_status='Cancelled' and not has_role(array['admin']) then raise exception 'Only admin can cancel a booking'; end if;
  update bookings set status=p_status where id=p_id;
  if not found then raise exception 'Booking not found'; end if;
end $$;
