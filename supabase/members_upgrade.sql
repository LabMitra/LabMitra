-- Run once in Supabase SQL Editor. Safe to re-run.
-- Adds saved family members (parents, children, newborns...) and lets age be in years, months or days.

-- ---------- Saved family members (private to each account) ----------
create table if not exists members(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, relation text,
  gender text check (gender in ('Male','Female','Other')),
  age int check (age between 0 and 120),
  age_unit text not null default 'years' check (age_unit in ('years','months','days')),
  phone text, created_at timestamptz default now());
alter table members enable row level security;
drop policy if exists m_all on members;
create policy m_all on members for all using (user_id=auth.uid()) with check (user_id=auth.uid());

-- ---------- Bookings remember the age unit and which member it was for ----------
alter table bookings add column if not exists patient_age_unit text not null default 'years' check (patient_age_unit in ('years','months','days'));
alter table bookings add column if not exists member_id uuid references members on delete set null;

-- ---------- place_booking: age unit + member ----------
-- Drop every older version first, so Postgres doesn't keep duplicates (which makes bookings fail).
drop function if exists place_booking(text,text,date,text,text,text);
drop function if exists place_booking(text,text,date,text,text,text,text);
drop function if exists place_booking(text,text,date,text,text,text,text,int,text);
drop function if exists place_booking(text,text,date,text,text,text,text,int,text,boolean);
drop function if exists place_booking(text,text,date,text,text,text,text,int,text,boolean,text,uuid);
create function place_booking(p_name text,p_phone text,p_date date,p_slot text,p_area text,p_address text,
  p_payment_method text default 'Cash',p_age int default null,p_gender text default null,p_consent boolean default false,
  p_age_unit text default 'years',p_member_id uuid default null)
returns text language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_ref text; v_total int; v_cap int; v_booked int; v_hour int;
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
  v_hour:=substring(p_slot from '^(\d{1,2}):')::int;
  if v_hour is not null and p_slot like '%PM' and v_hour<9 then v_hour:=v_hour+12; end if;
  if p_date=v_now::date and v_hour is not null and v_hour<=extract(hour from v_now) then
    raise exception 'That time slot has already started today. Please pick a later slot or another day.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_date::text||'|'||p_slot));
  select coalesce((select value::int from app_settings where key='slot_capacity'),5) into v_cap;
  select count(*) into v_booked from bookings where collect_date=p_date and slot=p_slot and status<>'Cancelled';
  if v_booked>=v_cap then raise exception 'This time slot is fully booked. Please pick another slot or day.'; end if;
  select coalesce(sum(t.price),0) into v_total from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  if v_total=0 then raise exception 'Your cart is empty'; end if;
  v_ref:='LM-'||nextval('booking_seq');
  insert into bookings(ref,user_id,patient_name,phone,collect_date,slot,area,address,total,payment_method,
                       patient_age,patient_age_unit,patient_gender,member_id,sample_id,consent_at)
    values(v_ref,auth.uid(),p_name,p_phone,p_date,p_slot,p_area,p_address,v_total,p_payment_method,
           p_age,coalesce(p_age_unit,'years'),p_gender,p_member_id,'S'||nextval('sample_seq'),now())
    returning id into v_id;
  insert into booking_items(booking_id,test_id,name,price,instructions)
    select v_id,t.id,t.name,t.price,t.instructions from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  delete from cart_items where user_id=auth.uid();
  return v_ref;
end $$;
