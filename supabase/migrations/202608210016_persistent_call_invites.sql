create table if not exists public.twf_call_invites (
  id uuid primary key default gen_random_uuid(),
  game_night_id uuid not null references public.twf_game_nights(id) on delete cascade,
  caller_id uuid not null references public.twf_profiles(id) on delete cascade,
  recipient_id uuid not null references public.twf_profiles(id) on delete cascade,
  mode text not null check (mode in ('audio','video')),
  description jsonb not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','ended')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes')
);

create index if not exists twf_call_invites_recipient_idx
  on public.twf_call_invites(recipient_id, status, created_at desc);

alter table public.twf_call_invites enable row level security;

create policy twf_call_invites_members_read on public.twf_call_invites
for select to authenticated using ((select auth.uid()) in (caller_id, recipient_id));

create policy twf_call_invites_caller_insert on public.twf_call_invites
for insert to authenticated with check (
  caller_id = (select auth.uid()) and caller_id <> recipient_id and exists (
    select 1 from public.twf_game_nights n join public.twf_couples c on c.id=n.couple_id
    where n.id=game_night_id
      and caller_id in (c.member_one,c.member_two)
      and recipient_id in (c.member_one,c.member_two)
  )
);

create policy twf_call_invites_members_update on public.twf_call_invites
for update to authenticated using ((select auth.uid()) in (caller_id, recipient_id))
with check ((select auth.uid()) in (caller_id, recipient_id));

grant select, insert, update on public.twf_call_invites to authenticated;
alter publication supabase_realtime add table public.twf_call_invites;
