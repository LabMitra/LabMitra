-- LabMitra schema. Run once in Supabase Dashboard > SQL Editor.
create sequence if not exists booking_seq start 26042;
create sequence if not exists sample_seq start 1001;

create table profiles(id uuid primary key references auth.users on delete cascade, full_name text, phone text, email text,
  age int check (age between 0 and 120), gender text check (gender in ('Male','Female','Other')),
  role text not null default 'patient' check (role in ('patient','staff','admin')), created_at timestamptz default now());
create table tests(id serial primary key, name text not null, category text, sample text, price int not null,
  mrp int, turnaround text, instructions text, active boolean default true);
create table cart_items(user_id uuid not null default auth.uid() references auth.users on delete cascade,
  test_id int not null references tests on delete cascade, primary key(user_id,test_id));
create table members(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, relation text,
  gender text check (gender in ('Male','Female','Other')),
  age int check (age between 0 and 120),
  age_unit text not null default 'years' check (age_unit in ('years','months','days')),
  phone text, created_at timestamptz default now());
create table bookings(id uuid primary key default gen_random_uuid(), ref text unique not null,
  user_id uuid not null references auth.users, patient_name text, phone text, collect_date date, slot text, area text, address text,
  total int not null, status text not null default 'Confirmed', payment text not null default 'Pending',
  payment_method text not null default 'Cash' check (payment_method in ('Cash','Online')),
  razorpay_order_id text, razorpay_payment_id text, collected_by uuid references profiles(id), collected_at timestamptz,
  collected_by_name text, patient_age int check (patient_age between 0 and 120),
  patient_gender text check (patient_gender in ('Male','Female','Other')), sample_id text unique,
  cancelled_at timestamptz, cancel_reason text, refund_id text, consent_at timestamptz,
  patient_age_unit text not null default 'years' check (patient_age_unit in ('years','months','days')), member_id uuid references members on delete set null,
  staff_id uuid references profiles(id), created_at timestamptz default now());
create table booking_items(booking_id uuid references bookings on delete cascade, test_id int, name text, price int, instructions text);
create table app_settings(key text primary key, value text not null);
insert into app_settings values('slot_capacity','5');
create table cash_handovers(id uuid primary key default gen_random_uuid(), handed_by text not null, amount int not null check (amount>0), note text,
  received boolean not null default false, received_at timestamptz, recorded_by uuid default auth.uid() references auth.users, created_at timestamptz default now());
create table addresses(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text, area text not null, address text not null, lat double precision, lng double precision, created_at timestamptz default now());
create table reports(id uuid primary key default gen_random_uuid(), booking_id uuid not null references bookings on delete cascade,
  path text not null, created_at timestamptz default now());

create function has_role(r text[]) returns boolean language sql security definer stable set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role=any(r)) $$;

create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as
$$ begin
  insert into profiles(id,full_name,phone,email,age,gender) values(new.id,
    new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone', new.email,
    case when (new.raw_user_meta_data->>'age') ~ '^\d{1,3}$' and (new.raw_user_meta_data->>'age')::int between 0 and 120 then (new.raw_user_meta_data->>'age')::int end,
    case when new.raw_user_meta_data->>'gender' in ('Male','Female','Other') then new.raw_user_meta_data->>'gender' end);
  return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- RLS
alter table profiles enable row level security; alter table tests enable row level security;
alter table cart_items enable row level security; alter table bookings enable row level security;
alter table booking_items enable row level security; alter table reports enable row level security;
alter table addresses enable row level security; alter table members enable row level security;
alter table app_settings enable row level security; alter table cash_handovers enable row level security;

revoke update on profiles from anon, authenticated;            -- users can never change their own role
grant update(full_name,phone,age,gender) on profiles to authenticated;

create policy p_sel on profiles for select using (id=auth.uid() or has_role(array['admin']));
create policy p_upd on profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy t_sel on tests for select using (active or has_role(array['admin']));
create policy t_all on tests for all using (has_role(array['admin'])) with check (has_role(array['admin']));
create policy c_all on cart_items for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy m_all on members for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy addr_all on addresses for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy addr_admin_sel on addresses for select using (has_role(array['admin']));
create policy b_sel on bookings for select using (user_id=auth.uid() or staff_id=auth.uid() or has_role(array['admin','staff']));
create policy b_upd on bookings for update using (has_role(array['admin']));
create policy bi_sel on booking_items for select using (exists(select 1 from bookings b where b.id=booking_id));
create policy r_sel on reports for select using (has_role(array['admin','staff']) or exists(select 1 from bookings b where b.id=booking_id and b.user_id=auth.uid()));
create policy r_ins on reports for insert with check (has_role(array['admin']));
create policy r_del on reports for delete using (has_role(array['admin']));
create policy s_sel on app_settings for select using (true);
create policy s_all on app_settings for all using (has_role(array['admin'])) with check (has_role(array['admin']));
create policy ch_sel on cash_handovers for select using (has_role(array['admin','staff']));
create policy ch_ins on cash_handovers for insert with check (has_role(array['admin','staff']) and received=false);
create policy ch_upd on cash_handovers for update using (has_role(array['admin']));
create policy ch_del on cash_handovers for delete using (has_role(array['admin']));

-- How many bookings each slot already has on a date (counts only, no patient data).
create function slot_counts(p_date date) returns table(slot text, booked int)
language sql security definer stable set search_path=public as $$
  select b.slot, count(*)::int from bookings b where b.collect_date=p_date and b.status<>'Cancelled' group by b.slot
$$;

-- Booking is created server-side from the cart: prices can't be tampered with from the browser.
-- Also enforces: privacy consent, patient age/gender, slot capacity, no past slots (India time), and assigns a sample ID.
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

-- Staff (or admin) confirms they physically collected cash on arrival, and records their name.
create function mark_cash_collected(p_id uuid,p_collector text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_collector),'')='' then raise exception 'Enter your name before marking cash collected'; end if;
  update bookings set payment='Paid', collected_by=auth.uid(), collected_at=now(), collected_by_name=trim(p_collector)
    where id=p_id and payment_method='Cash' and payment='Pending';
  if not found then raise exception 'Already marked paid, or not a cash booking'; end if;
end $$;

-- Staff (or admin) status updates
create function set_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  if p_status not in ('Sample collected','Handed over to lab','Lab received sample','Processing started') and not has_role(array['admin']) then raise exception 'Not allowed'; end if;
  update bookings set status=p_status where id=p_id;
  if not found then raise exception 'Booking not found'; end if;
end $$;

-- Staff (or admin) upload a report PDF for ANY booking, not just their own assigned ones.
-- Records the file (already uploaded to storage by the caller) and marks the booking ready, in one step.
create function staff_upload_report(p_booking_id uuid,p_path text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not has_role(array['admin','staff']) then raise exception 'Not allowed'; end if;
  if not exists(select 1 from bookings where id=p_booking_id) then raise exception 'Booking not found'; end if;
  insert into reports(booking_id,path) values(p_booking_id,p_path);
  update bookings set status='Report ready' where id=p_booking_id;
end $$;

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

-- Private bucket for PDF reports. Files live at <booking_id>/<file>.pdf
insert into storage.buckets(id,name,public) values('reports','reports',false) on conflict do nothing;
create policy rep_admin on storage.objects for all to authenticated
  using (bucket_id='reports' and has_role(array['admin'])) with check (bucket_id='reports' and has_role(array['admin']));
create policy rep_staff_ins on storage.objects for insert to authenticated
  with check (bucket_id='reports' and has_role(array['staff']));
create policy rep_staff_sel on storage.objects for select to authenticated
  using (bucket_id='reports' and has_role(array['staff']));
create policy rep_owner on storage.objects for select to authenticated
  using (bucket_id='reports' and exists(select 1 from bookings b where b.id::text=(storage.foldername(name))[1] and b.user_id=auth.uid()));

insert into tests(name,category,sample,price,mrp,turnaround,instructions) values
('Complete Blood Count (CBC)','Blood Tests','Blood',299,450,'24 hours',null),
('Thyroid Profile (T3, T4, TSH)','Thyroid','Blood',399,650,'24 hours',null),
('Vitamin D (25-OH)','Vitamins','Blood',699,1100,'48 hours',null),
('Liver Function Test (LFT)','Liver & Kidney','Blood',499,750,'24 hours','Fasting for 8-10 hours is recommended (water is fine).'),
('Kidney Function Test (KFT)','Liver & Kidney','Blood',449,700,'24 hours',null),
('HbA1c','Diabetes','Blood',349,550,'24 hours',null),
('Lipid Profile','Blood Tests','Blood',399,600,'24 hours','Fast for 10-12 hours before the sample (water is fine).'),
('Vitamin B12','Vitamins','Blood',599,950,'48 hours',null),
('Urine Routine & Microscopy','Urine Tests','Urine',149,250,'Same day','Give the first urine of the morning, in the sterile container our staff bring.');

-- Live updates between the admin and staff dashboards.
alter publication supabase_realtime add table bookings, reports, cash_handovers;
