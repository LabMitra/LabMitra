-- Run once in Supabase SQL Editor. Safe to re-run.
-- Live tracking (like food-delivery apps): staff press "Start trip" on a booking, their phone shares
-- its location while they travel, the patient sees them moving on a map with an ETA, and admin sees
-- every active trip on one live map.
-- Privacy: location is shared ONLY during an active trip and is wiped when the trip ends.

create table if not exists trips(
  booking_id uuid primary key references bookings on delete cascade,
  staff_id uuid references auth.users,
  staff_name text,
  status text not null default 'on_the_way' check (status in ('on_the_way','arrived','ended')),
  lat double precision, lng double precision, accuracy real, heading real, speed real,
  dest_lat double precision, dest_lng double precision,
  started_at timestamptz not null default now(), arrived_at timestamptz, ended_at timestamptz,
  updated_at timestamptz not null default now());
alter table trips enable row level security;

-- Staff/admin see every trip. A patient sees the trip for their own booking, only while it is live.
drop policy if exists trips_sel on trips;
create policy trips_sel on trips for select using (
  has_role(array['admin','staff'])
  or (status<>'ended' and exists(select 1 from bookings b where b.id=booking_id and b.user_id=auth.uid())));
-- No insert/update/delete policies: only the functions below can write.

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='trips') then
    alter publication supabase_realtime add table trips; end if;
end $$;

-- Start (or restart) a trip. Destination = the patient's saved address pin if we have one,
-- otherwise the point the staff phone looked up from the written address.
drop function if exists start_trip(uuid,text,double precision,double precision,real,double precision,double precision);
create or replace function start_trip(p_booking uuid, p_name text, p_lat double precision, p_lng double precision,
  p_accuracy real default null, p_dest_lat double precision default null, p_dest_lng double precision default null)
returns void language plpgsql security definer set search_path=public as $$
declare b bookings; v_dlat double precision; v_dlng double precision;
begin
  if not has_role(array['staff','admin']) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_name),'')='' then raise exception 'Type your name first'; end if;
  if p_lat is null or p_lng is null or abs(p_lat)>90 or abs(p_lng)>180 then raise exception 'Location not available'; end if;
  select * into b from bookings where id=p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('Confirmed','Assigned') then raise exception 'This booking is already %', lower(b.status); end if;
  select a.lat,a.lng into v_dlat,v_dlng from addresses a
    where a.user_id=b.user_id and a.lat is not null and lower(trim(a.address))=lower(trim(b.address)) order by a.created_at desc limit 1;
  if v_dlat is null and p_dest_lat is not null and abs(p_dest_lat)<=90 and abs(p_dest_lng)<=180 then v_dlat:=p_dest_lat; v_dlng:=p_dest_lng; end if;
  insert into trips(booking_id,staff_id,staff_name,status,lat,lng,accuracy,dest_lat,dest_lng,started_at,arrived_at,ended_at,updated_at)
    values(p_booking,auth.uid(),trim(p_name),'on_the_way',p_lat,p_lng,p_accuracy,v_dlat,v_dlng,now(),null,null,now())
  on conflict (booking_id) do update set staff_id=excluded.staff_id,staff_name=excluded.staff_name,status='on_the_way',
    lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,dest_lat=coalesce(excluded.dest_lat,trips.dest_lat),
    dest_lng=coalesce(excluded.dest_lng,trips.dest_lng),started_at=now(),arrived_at=null,ended_at=null,updated_at=now();
  insert into booking_events(booking_id,event,detail,actor) values(p_booking,'Staff on the way','Live location shared with the patient',trim(p_name));
end $$;

-- Location ping from the staff phone (every few seconds while moving).
drop function if exists update_trip(uuid,double precision,double precision,real,real,real);
create or replace function update_trip(p_booking uuid, p_lat double precision, p_lng double precision,
  p_accuracy real default null, p_heading real default null, p_speed real default null)
returns text language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  if not has_role(array['staff','admin']) then raise exception 'Not allowed'; end if;
  if p_lat is null or p_lng is null or abs(p_lat)>90 or abs(p_lng)>180 then raise exception 'Bad location'; end if;
  update trips set lat=p_lat,lng=p_lng,accuracy=p_accuracy,heading=p_heading,speed=p_speed,updated_at=now()
    where booking_id=p_booking and status<>'ended' returning status into v_status;
  return coalesce(v_status,'ended'); -- tells the phone to stop if the trip was ended elsewhere
end $$;

-- Mark arrived, or end the trip (also used by admin to stop a forgotten trip).
drop function if exists set_trip_status(uuid,text);
create or replace function set_trip_status(p_booking uuid, p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_name text;
begin
  if not has_role(array['staff','admin']) then raise exception 'Not allowed'; end if;
  if p_status not in ('arrived','ended') then raise exception 'Unknown trip status'; end if;
  if p_status='arrived' then
    update trips set status='arrived',arrived_at=now(),updated_at=now() where booking_id=p_booking and status='on_the_way' returning staff_name into v_name;
    if found then insert into booking_events(booking_id,event,detail,actor) values(p_booking,'Staff arrived',null,v_name); end if;
  else
    update trips set status='ended',ended_at=now(),updated_at=now(),lat=null,lng=null,accuracy=null,heading=null,speed=null
      where booking_id=p_booking and status<>'ended';
  end if;
end $$;

-- When the sample is collected (or the booking is cancelled), the trip ends by itself and the location is wiped.
create or replace function end_trip_on_status() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status and new.status not in ('Confirmed','Assigned') then
    update trips set status='ended',ended_at=now(),updated_at=now(),lat=null,lng=null,accuracy=null,heading=null,speed=null
      where booking_id=new.id and status<>'ended';
  end if;
  return new;
end $$;
drop trigger if exists trg_end_trip_on_status on bookings;
create trigger trg_end_trip_on_status after update of status on bookings for each row execute function end_trip_on_status();
