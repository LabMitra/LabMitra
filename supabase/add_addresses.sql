-- Run once in Supabase SQL Editor if you already ran schema.sql before this change.
-- Adds saved addresses: patients can store multiple collection addresses and pick one at booking time.

create table if not exists addresses(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text, area text not null, address text not null, lat double precision, lng double precision, created_at timestamptz default now());

alter table addresses enable row level security;

drop policy if exists addr_all on addresses;
create policy addr_all on addresses for all using (user_id=auth.uid()) with check (user_id=auth.uid());
