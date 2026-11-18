-- =====================================================================================
-- LabMitra v2.1: choose the lab for EACH test (mixed labs in one booking).
-- Run once in Supabase > SQL Editor, AFTER labs_v2.sql.  Safe to re-run.
-- =====================================================================================
--  * cart_items.lab_id     : the lab the patient picked for that test (empty = default lab).
--  * booking_items.lab_id / lab_name : which lab tests each sample (staff take each tube there).
--  * bookings.lab_name     : all labs in the booking, e.g. "Hypatho Lab, Thyrocare".
--  * place_booking         : charges each test at ITS lab's price (checked on the server).
--  Default lab for a test = the Recommended lab (BYOS) if it offers the test, otherwise the cheapest lab.

alter table cart_items add column if not exists lab_id int references labs on delete set null;
alter table booking_items add column if not exists lab_id int references labs;
alter table booking_items add column if not exists lab_name text;

drop function if exists place_booking(text,text,date,text,text,text,text,int,text,boolean,text,uuid,int);
create function place_booking(p_name text,p_phone text,p_date date,p_slot text,p_area text,p_address text,
  p_payment_method text default 'Cash',p_age int default null,p_gender text default null,p_consent boolean default false,
  p_age_unit text default 'years',p_member_id uuid default null,p_lab_id int default null)   -- p_lab_id kept for old pages; not used
returns text language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_ref text; v_total int; v_n int; v_cap int; v_booked int; v_hour int; v_labs text; v_lab_id int; v_nlabs int; v_missing text;
        v_now timestamp:=now() at time zone 'Asia/Kolkata';
begin
  if auth.uid() is null then raise exception 'Please log in'; end if;
  if not coalesce(p_consent,false) then raise exception 'Please accept the Privacy Policy to continue'; end if;
  if p_date < v_now::date then raise exception 'Collection date cannot be in the past'; end if;
  if p_payment_method not in ('Cash','Online') then raise exception 'Invalid payment method'; end if;
  if coalesce(p_age_unit,'years') not in ('years','months','days') then raise exception 'Invalid age unit'; end if;
  if p_age is null or p_age<0
     or (coalesce(p_age_unit,'years')='years' and p_age>120)
     or (p_age_unit='months' and p_age>24) or (p_age_unit='days' and p_age>90) then
    raise exception 'Please enter a valid age for the patient'; end if;
  if p_gender is null or p_gender not in ('Male','Female','Other') then raise exception 'Please select the patient''s gender'; end if;
  if p_member_id is not null and not exists(select 1 from members where id=p_member_id and user_id=auth.uid()) then
    raise exception 'That family member was not found'; end if;

  -- Tests without a chosen lab get the default lab (Recommended first, then cheapest).
  update cart_items c set lab_id=(select lt.lab_id from lab_tests lt join labs l on l.id=lt.lab_id
      where lt.test_id=c.test_id and lt.active and l.active order by l.recommended desc, lt.price asc limit 1)
    where c.user_id=auth.uid() and c.lab_id is null;
  -- Every test must still be offered by its lab.
  select string_agg(t.name||coalesce(' at '||l.name,''),', ') into v_missing from cart_items c join tests t on t.id=c.test_id
    left join labs l on l.id=c.lab_id
    left join lab_tests lt on lt.test_id=c.test_id and lt.lab_id=c.lab_id and lt.active
    where c.user_id=auth.uid() and (lt.id is null or not coalesce(l.active,false));
  if v_missing is not null then raise exception '% is no longer available. Remove it or pick another lab in your cart.',v_missing; end if;

  v_hour:=substring(p_slot from '^(\d{1,2}):')::int;
  if v_hour is not null and p_slot like '%PM' and v_hour<9 then v_hour:=v_hour+12; end if;
  if p_date=v_now::date and v_hour is not null and v_hour<=extract(hour from v_now) then
    raise exception 'That time slot has already started today. Please pick a later slot or another day.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_date::text||'|'||p_slot));
  select coalesce((select value::int from app_settings where key='slot_capacity'),5) into v_cap;
  select count(*) into v_booked from bookings where collect_date=p_date and slot=p_slot and status<>'Cancelled';
  if v_booked>=v_cap then raise exception 'This time slot is fully booked. Please pick another slot or day.'; end if;

  -- Each test at its own lab's price, never the browser's.
  select coalesce(sum(lt.price),0),count(*),count(distinct c.lab_id),string_agg(distinct l.name,', '),min(c.lab_id)
    into v_total,v_n,v_nlabs,v_labs,v_lab_id
    from cart_items c join lab_tests lt on lt.test_id=c.test_id and lt.lab_id=c.lab_id and lt.active
    join labs l on l.id=c.lab_id where c.user_id=auth.uid();
  if v_n=0 then raise exception 'Your cart is empty'; end if;

  v_ref:='LM-'||nextval('booking_seq');
  insert into bookings(ref,user_id,patient_name,phone,collect_date,slot,area,address,total,payment_method,
                       patient_age,patient_age_unit,patient_gender,member_id,sample_id,consent_at,lab_id,lab_name)
    values(v_ref,auth.uid(),p_name,p_phone,p_date,p_slot,p_area,p_address,v_total,p_payment_method,
           p_age,coalesce(p_age_unit,'years'),p_gender,p_member_id,'S'||nextval('sample_seq'),now(),
           case when v_nlabs=1 then v_lab_id end,v_labs)
    returning id into v_id;
  insert into booking_items(booking_id,test_id,name,price,instructions,lab_id,lab_name)
    select v_id,t.id,t.name,lt.price,t.instructions,l.id,l.name from cart_items c join tests t on t.id=c.test_id
      join lab_tests lt on lt.test_id=c.test_id and lt.lab_id=c.lab_id and lt.active
      join labs l on l.id=c.lab_id where c.user_id=auth.uid();
  delete from cart_items where user_id=auth.uid();
  return v_ref;
end $$;
