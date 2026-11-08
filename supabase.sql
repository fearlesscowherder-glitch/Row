-- Run this once in Supabase → SQL Editor.
-- One table holds everything the dashboard syncs (lists, calendar
-- events, Mind items, goals, school settings, Gmail bookkeeping).
create table if not exists public.row_state (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security ON with no policies = nobody can read or write
-- this table with a public/publishable key. Only the Vercel server,
-- using the secret (service role) key, can touch it.
alter table public.row_state enable row level security;
