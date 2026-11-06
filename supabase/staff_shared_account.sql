-- Run once in Supabase SQL Editor.
-- Bookings are no longer assigned to individual staff (one shared staff account), so any staff
-- account can update a booking's collection status and mark cash as collected.

create or replace function set_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  if p_status not in ('Sample collected','Handed over to lab','Lab received sample','Processing started') and not has_role(array['admin']) then raise exception 'Not allowed'; end if;
  update bookings set status=p_status where id=p_id;
  if not found then raise exception 'Booking not found'; end if;
end $$;

create or replace function mark_cash_collected(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  update bookings set payment='Paid', collected_by=auth.uid(), collected_at=now()
    where id=p_id and payment_method='Cash' and payment='Pending';
  if not found then raise exception 'Already marked paid, or not a cash booking'; end if;
end $$;
