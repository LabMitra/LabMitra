-- Run once in Supabase SQL Editor if you already ran schema.sql before this change.
-- Adds online (Razorpay) vs cash-on-arrival payment, and lets staff mark cash as collected.

alter table bookings add column if not exists payment_method text not null default 'Cash' check (payment_method in ('Cash','Online'));
alter table bookings add column if not exists razorpay_order_id text;
alter table bookings add column if not exists razorpay_payment_id text;
alter table bookings add column if not exists collected_by uuid references profiles(id);
alter table bookings add column if not exists collected_at timestamptz;

-- IMPORTANT: the old place_booking had a different parameter list (no payment method), so
-- "create or replace" below would NOT replace it — it would create a second overload, and
-- Supabase would then be unable to tell the two apart, causing every booking to silently fail.
-- Dropping the old one explicitly avoids that.
drop function if exists place_booking(text,text,date,text,text,text);

create or replace function place_booking(p_name text,p_phone text,p_date date,p_slot text,p_area text,p_address text,p_payment_method text default 'Cash')
returns text language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_ref text; v_total int;
begin
  if auth.uid() is null then raise exception 'Please log in'; end if;
  if p_date < current_date then raise exception 'Collection date cannot be in the past'; end if;
  if p_payment_method not in ('Cash','Online') then raise exception 'Invalid payment method'; end if;
  select coalesce(sum(t.price),0) into v_total from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  if v_total=0 then raise exception 'Your cart is empty'; end if;
  v_ref:='LM-'||nextval('booking_seq');
  insert into bookings(ref,user_id,patient_name,phone,collect_date,slot,area,address,total,payment_method)
    values(v_ref,auth.uid(),p_name,p_phone,p_date,p_slot,p_area,p_address,v_total,p_payment_method) returning id into v_id;
  insert into booking_items(booking_id,test_id,name,price)
    select v_id,t.id,t.name,t.price from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  delete from cart_items where user_id=auth.uid();
  return v_ref;
end $$;

create or replace function mark_cash_collected(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not (has_role(array['admin']) or exists(select 1 from bookings where id=p_id and staff_id=auth.uid())) then raise exception 'Not allowed'; end if;
  update bookings set payment='Paid', collected_by=auth.uid(), collected_at=now()
    where id=p_id and payment_method='Cash' and payment='Pending';
  if not found then raise exception 'Already marked paid, or not a cash booking'; end if;
end $$;
