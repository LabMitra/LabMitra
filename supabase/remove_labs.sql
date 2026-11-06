-- Run once in Supabase SQL Editor ONLY if you already ran the old schema.sql (with lab columns).
-- Fresh projects: just run schema.sql, it no longer has labs.

create or replace function place_booking(p_name text,p_phone text,p_date date,p_slot text,p_area text,p_address text)
returns text language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_ref text; v_total int;
begin
  if auth.uid() is null then raise exception 'Please log in'; end if;
  if p_date < current_date then raise exception 'Collection date cannot be in the past'; end if;
  select coalesce(sum(t.price),0) into v_total from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  if v_total=0 then raise exception 'Your cart is empty'; end if;
  v_ref:='LM-'||nextval('booking_seq');
  insert into bookings(ref,user_id,patient_name,phone,collect_date,slot,area,address,total)
    values(v_ref,auth.uid(),p_name,p_phone,p_date,p_slot,p_area,p_address,v_total) returning id into v_id;
  insert into booking_items(booking_id,test_id,name,price)
    select v_id,t.id,t.name,t.price from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  delete from cart_items where user_id=auth.uid();
  return v_ref;
end $$;

alter table tests drop column if exists lab;
alter table booking_items drop column if exists lab;
