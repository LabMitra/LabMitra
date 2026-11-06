-- Run once in Supabase SQL Editor, AFTER crucial_upgrade.sql. Safe to re-run.
-- Adds: cancel / reschedule with refunds, a step-by-step booking timeline, and privacy consent.

-- ---------- New booking columns ----------
alter table bookings add column if not exists cancelled_at timestamptz;
alter table bookings add column if not exists cancel_reason text;
alter table bookings add column if not exists refund_id text;
alter table bookings add column if not exists consent_at timestamptz;
-- payment can now also be 'Refund pending' or 'Refunded' (no constraint change needed).

-- Start time of a slot on a date, e.g. ('2026-11-07','7:00–8:00 AM') -> 2026-11-07 07:00 (India time).
create or replace function slot_start(p_date date,p_slot text) returns timestamp language plpgsql immutable as $$
declare h int:=substring(p_slot from '^(\d{1,2}):')::int;
begin
  if h is null then return p_date::timestamp; end if;
  if p_slot like '%PM' and h<9 then h:=h+12; end if;
  return p_date::timestamp+make_interval(hours=>h);
end $$;

-- ---------- Timeline: every step of a booking, written automatically ----------
create table if not exists booking_events(
  id bigserial primary key, booking_id uuid not null references bookings on delete cascade,
  event text not null, detail text, actor text, created_at timestamptz not null default now());
create index if not exists booking_events_booking_idx on booking_events(booking_id,created_at);
alter table booking_events enable row level security;
drop policy if exists be_sel on booking_events;
create policy be_sel on booking_events for select using (
  has_role(array['admin','staff']) or exists(select 1 from bookings b where b.id=booking_id and b.user_id=auth.uid()));
-- No insert/update policies: only the triggers below write events, so nobody can fake history.

create or replace function actor_label() returns text language sql security definer stable set search_path=public as $$
  select case when auth.uid() is null then 'System'
    else coalesce((select case role when 'admin' then 'Admin' when 'staff' then 'Staff' else 'Patient' end from profiles where id=auth.uid()),'Patient') end
$$;

create or replace function log_booking_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into booking_events(booking_id,event,detail,actor) values(new.id,'Booking placed',
      format('Collection %s · %s · %s', to_char(new.collect_date,'DD Mon YYYY'), new.slot, coalesce(new.payment_method,'Cash')), actor_label());
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into booking_events(booking_id,event,detail,actor) values(new.id,
      case when new.status='Cancelled' then 'Booking cancelled' else new.status end,
      case when new.status='Cancelled' then new.cancel_reason end, actor_label());
  end if;
  if new.collect_date is distinct from old.collect_date or new.slot is distinct from old.slot then
    insert into booking_events(booking_id,event,detail,actor) values(new.id,'Rescheduled',
      format('From %s · %s to %s · %s', to_char(old.collect_date,'DD Mon'), old.slot, to_char(new.collect_date,'DD Mon YYYY'), new.slot), actor_label());
  end if;
  if new.payment is distinct from old.payment then
    insert into booking_events(booking_id,event,detail,actor) values(new.id,
      case new.payment when 'Paid' then 'Payment received' when 'Refund pending' then 'Refund requested'
                       when 'Refunded' then 'Refunded' else 'Payment marked '||new.payment end,
      case when new.payment='Paid' and new.payment_method='Cash' then 'Cash'||coalesce(' · collected by '||new.collected_by_name,'')
           when new.payment='Paid' then new.payment_method
           when new.payment='Refunded' then 'Refund ID '||new.refund_id end, actor_label());
  end if;
  return new;
end $$;
drop trigger if exists bookings_log on bookings;
create trigger bookings_log after insert or update on bookings for each row execute function log_booking_event();

create or replace function log_report_event() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into booking_events(booking_id,event,actor) values(new.booking_id,'Report uploaded',actor_label()); return new; end $$;
drop trigger if exists reports_log on reports;
create trigger reports_log after insert on reports for each row execute function log_report_event();

-- Fill the timeline for bookings made before this existed (only the steps we know the time of).
insert into booking_events(booking_id,event,detail,actor,created_at)
  select b.id,'Booking placed',format('Collection %s · %s',to_char(b.collect_date,'DD Mon YYYY'),b.slot),'Patient',b.created_at
  from bookings b where not exists(select 1 from booking_events e where e.booking_id=b.id);
insert into booking_events(booking_id,event,detail,actor,created_at)
  select b.id,'Payment received','Cash'||coalesce(' · collected by '||b.collected_by_name,''),'Staff',b.collected_at
  from bookings b where b.payment='Paid' and b.collected_at is not null
    and not exists(select 1 from booking_events e where e.booking_id=b.id and e.event='Payment received');
insert into booking_events(booking_id,event,actor,created_at)
  select r.booking_id,'Report uploaded','Staff',r.created_at from reports r
  where not exists(select 1 from booking_events e where e.booking_id=r.booking_id and e.event='Report uploaded');

-- ---------- Cancel (patient before the slot starts, admin any time before collection) ----------
create or replace function cancel_booking(p_id uuid,p_reason text default null) returns text
language plpgsql security definer set search_path=public as $$
declare b bookings; v_now timestamp:=now() at time zone 'Asia/Kolkata';
begin
  select * into b from bookings where id=p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.user_id<>auth.uid() and not has_role(array['admin']) then raise exception 'Not allowed'; end if;
  if b.status not in ('Confirmed','Assigned') then raise exception 'This booking can no longer be cancelled because the sample has already been collected.'; end if;
  if not has_role(array['admin']) and v_now>=slot_start(b.collect_date,b.slot) then
    raise exception 'Your collection time has already started. Please call us to cancel.'; end if;
  update bookings set status='Cancelled', cancelled_at=now(), cancel_reason=nullif(trim(p_reason),''),
    payment=case when payment='Paid' and payment_method='Online' then 'Refund pending' else payment end
    where id=p_id;
  return (select payment from bookings where id=p_id);
end $$;

-- ---------- Reschedule (same rules; new slot must be in the future and not full) ----------
create or replace function reschedule_booking(p_id uuid,p_date date,p_slot text) returns void
language plpgsql security definer set search_path=public as $$
declare b bookings; v_now timestamp:=now() at time zone 'Asia/Kolkata'; v_cap int; v_booked int;
begin
  select * into b from bookings where id=p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.user_id<>auth.uid() and not has_role(array['admin']) then raise exception 'Not allowed'; end if;
  if b.status not in ('Confirmed','Assigned') then raise exception 'This booking can no longer be rescheduled because the sample has already been collected.'; end if;
  if not has_role(array['admin']) and v_now>=slot_start(b.collect_date,b.slot) then
    raise exception 'Your collection time has already started. Please call us to reschedule.'; end if;
  if slot_start(p_date,p_slot)<=v_now then raise exception 'Please pick a future date and time slot.'; end if;
  if p_date=b.collect_date and p_slot=b.slot then raise exception 'That is already your booked slot.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_date::text||'|'||p_slot));
  select coalesce((select value::int from app_settings where key='slot_capacity'),5) into v_cap;
  select count(*) into v_booked from bookings where collect_date=p_date and slot=p_slot and status<>'Cancelled' and id<>p_id;
  if v_booked>=v_cap then raise exception 'That time slot is fully booked. Please pick another.'; end if;
  update bookings set collect_date=p_date, slot=p_slot where id=p_id;
end $$;

-- ---------- place_booking: now also records privacy consent ----------
drop function if exists place_booking(text,text,date,text,text,text);
drop function if exists place_booking(text,text,date,text,text,text,text);
drop function if exists place_booking(text,text,date,text,text,text,text,int,text);
drop function if exists place_booking(text,text,date,text,text,text,text,int,text,boolean);
create function place_booking(p_name text,p_phone text,p_date date,p_slot text,p_area text,p_address text,
  p_payment_method text default 'Cash',p_age int default null,p_gender text default null,p_consent boolean default false)
returns text language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_ref text; v_total int; v_cap int; v_booked int; v_hour int;
        v_now timestamp:=now() at time zone 'Asia/Kolkata';
begin
  if auth.uid() is null then raise exception 'Please log in'; end if;
  if not coalesce(p_consent,false) then raise exception 'Please accept the Privacy Policy to continue'; end if;
  if p_date < v_now::date then raise exception 'Collection date cannot be in the past'; end if;
  if p_payment_method not in ('Cash','Online') then raise exception 'Invalid payment method'; end if;
  if p_age is null or p_age<0 or p_age>120 then raise exception 'Please enter the patient''s age'; end if;
  if p_gender is null or p_gender not in ('Male','Female','Other') then raise exception 'Please select the patient''s gender'; end if;
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
  insert into bookings(ref,user_id,patient_name,phone,collect_date,slot,area,address,total,payment_method,patient_age,patient_gender,sample_id,consent_at)
    values(v_ref,auth.uid(),p_name,p_phone,p_date,p_slot,p_area,p_address,v_total,p_payment_method,p_age,p_gender,'S'||nextval('sample_seq'),now())
    returning id into v_id;
  insert into booking_items(booking_id,test_id,name,price,instructions)
    select v_id,t.id,t.name,t.price,t.instructions from cart_items c join tests t on t.id=c.test_id where c.user_id=auth.uid() and t.active;
  delete from cart_items where user_id=auth.uid();
  return v_ref;
end $$;
