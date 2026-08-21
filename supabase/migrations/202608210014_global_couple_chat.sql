create table if not exists public.twf_couple_messages (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.twf_couples(id) on delete cascade,
  sender_id uuid not null references public.twf_profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists twf_couple_messages_created_idx
  on public.twf_couple_messages(couple_id, created_at desc);

alter table public.twf_couple_messages enable row level security;

create policy twf_couple_messages_read on public.twf_couple_messages
for select to authenticated using (
  exists (select 1 from public.twf_couples c where c.id = couple_id
    and (select auth.uid()) in (c.member_one, c.member_two))
);

create policy twf_couple_messages_send on public.twf_couple_messages
for insert to authenticated with check (
  sender_id = (select auth.uid()) and exists (
    select 1 from public.twf_couples c where c.id = couple_id
      and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

grant select, insert on public.twf_couple_messages to authenticated;
alter publication supabase_realtime add table public.twf_couple_messages;
