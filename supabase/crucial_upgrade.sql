-- Run once in Supabase SQL Editor. Safe to re-run.
-- Adds: patient age & gender, sample IDs, test prep/fasting instructions, slot capacity,
-- past-slot blocking, "collected by" names for cash, and cash handovers to the office.

-- ---------- 1) Patient details + sample ID on bookings ----------
alter table bookings add column if not exists patient_age int check (patient_age between 0 and 120);
alter table bookings add column if not exists patient_gender text check (patient_gender in ('Male','Female','Other'));
alter table bookings add column if not exists sample_id text unique;
alter table bookings add column if not exists collected_by_name text;
create sequence if not exists sample_seq start 1001;
update bookings set sample_id='S'||nextval('sample_seq') where sample_id is null;

-- ---------- 2) Prep / fasting instructions ----------
alter table tests add column if not exists instructions text;
alter table booking_items add column if not exists instructions text;
update tests set instructions='Fast for 10-12 hours before the sample (water is fine).' where name ilike 'Lipid Profile%' and instructions is null;
update tests set instructions='Fasting for 8-10 hours is recommended (water is fine).' where name ilike 'Liver Function%' and instructions is null;
update tests set instructions='Give the first urine of the morning, in the sterile container our staff bring.' where name ilike 'Urine Routine%' and instructions is null;
update booking_items bi set instructions=t.instructions from tests t where t.id=bi.test_id and bi.instructions is null;

-- ---------- 3) Settings: max bookings per time slot ----------
create table if not exists app_settings(key text primary key, value text not null);
insert into app_settings values('slot_capacity','5') on conflict do nothing;
alter table app_settings enable row level security;
drop policy if exists s_sel on app_settings;
create policy s_sel on app_settings for select using (true);
drop policy if exists s_all on app_settings;
create policy s_all on app_settings for all using (has_role(array['admin'])) with check (has_role(array['admin']));

-- How many bookings each slot already has on a date (counts only, no patient data).
create or replace function slot_counts(p_date date) returns table(slot text, booked int)
language sql security definer stable set search_path=public as $$
  select b.slot, count(*)::int from bookings b where b.collect_date=p_date and b.status<>'Cancelled' group by b.slot
$$;

-- ---------- 4) place_booking: age/gender, slot capacity, past slots (India time), sample ID ----------
-- Drop the older versions first; otherwise Postgres keeps them as duplicates and bookings fail.
drop function if exists place_booking(text,text,date,text,text,text);
drop function if exists place_booking(text,text,date,text,text,text,text);
drop function if exists place_booking(text,text,date,text,text,text,text,int,text);
create function place_booking(p_name text,p_phone text,p_date date,p_slot text,p_area text,p_address text,
  p_payment_method text default 'Cash',p_age int default null,p_gender text default null)
returns text language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_ref text; v_total int; v_cap int; v_booked int; v_hour int;
        v_now timestamp:=now() at time zone 'Asia/Kolkata';
begin
  if auth.uid() is null then raise exception 'Please log in'; end if;
  if p_date < v_now::date then raise exception 'Collection date cannot be in the past'; end if;
  if p_payment_method not in ('Cash','Online') then raise exception 'Invalid payment method'; end if;
  if p_age is null or p_age<0 or p_age>120 then raise exception 'Please enter the patient''s age'; end if;
  if p_gender is null or p_gender not in ('Male','Female','Other') then raise exception 'Please select the patient''s gender'; end if;
  -- Slot start hour, e.g. '7:00–8:00 AM' -> 7. Afternoon slots ending in PM (1–8) become 13–20.
  v_hour:=substring(p_slot from '^(\d{1,2}):')::int;
  if v_hour is not null and p_slot like '%PM' and v_hour<9 then v_hour:=v_hour+12; end if;
  if p_date=v_now::date and v_hour is not null and v_hour<=extract(hour from v_now) then
    raise exception 'That time slot has already started today. Please pick a later slot or another day.'; end if;
  -- Capacity check, locked per date+slot so two people can't grab the last place at once.
  perform pg_advisory_xact_lock(hashtext(p_date::text||'|'||p_slot));
  select coalesce((select value::int from app_settings where key='slot_capacity'),5) into v_cap;
  select count(*) into v_booked from bookings where collect_date=p_date and slot=p_slot and status<>'Cancelled';
  if v_booked>=v_cap then raise exception 'This time slot is fully booked. Please pick another slot or day.'; end if;
  select coalesce(sum(t.price),0) into v_total from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  if v_total=0 then raise exception 'Your cart is empty'; end if;
  v_ref:='LM-'||nextval('booking_seq');
  insert into bookings(ref,user_id,patient_name,phone,collect_date,slot,area,address,total,payment_method,patient_age,patient_gender,sample_id)
    values(v_ref,auth.uid(),p_name,p_phone,p_date,p_slot,p_area,p_address,v_total,p_payment_method,p_age,p_gender,'S'||nextval('sample_seq'))
    returning id into v_id;
  insert into booking_items(booking_id,test_id,name,price,instructions)
    select v_id,t.id,t.name,t.price,t.instructions from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  delete from cart_items where user_id=auth.uid();
  return v_ref;
end $$;

-- ---------- 5) Cash: record WHO collected it ----------
drop function if exists mark_cash_collected(uuid);
create or replace function mark_cash_collected(p_id uuid,p_collector text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_collector),'')='' then raise exception 'Enter your name before marking cash collected'; end if;
  update bookings set payment='Paid', collected_by=auth.uid(), collected_at=now(), collected_by_name=trim(p_collector)
    where id=p_id and payment_method='Cash' and payment='Pending';
  if not found then raise exception 'Already marked paid, or not a cash booking'; end if;
end $$;

-- ---------- 6) Cash handovers: staff hands cash to the office, admin confirms receipt ----------
create table if not exists cash_handovers(
  id uuid primary key default gen_random_uuid(),
  handed_by text not null, amount int not null check (amount>0), note text,
  received boolean not null default false, received_at timestamptz,
  recorded_by uuid default auth.uid() references auth.users, created_at timestamptz default now());
alter table cash_handovers enable row level security;
drop policy if exists ch_sel on cash_handovers;
create policy ch_sel on cash_handovers for select using (has_role(array['admin','staff']));
drop policy if exists ch_ins on cash_handovers;
create policy ch_ins on cash_handovers for insert with check (has_role(array['admin','staff']) and received=false);
drop policy if exists ch_upd on cash_handovers;
create policy ch_upd on cash_handovers for update using (has_role(array['admin']));
drop policy if exists ch_del on cash_handovers;
create policy ch_del on cash_handovers for delete using (has_role(array['admin']));

-- Live updates for the new table.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='cash_handovers') then
    alter publication supabase_realtime add table cash_handovers; end if;
end $$;
