create table if not exists public.twf_room_messages (
  id uuid primary key default gen_random_uuid(),
  game_night_id uuid not null references public.twf_game_nights(id) on delete cascade,
  sender_id uuid not null references public.twf_profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists twf_room_messages_night_created
  on public.twf_room_messages(game_night_id, created_at);

alter table public.twf_room_messages enable row level security;

drop policy if exists twf_room_messages_read on public.twf_room_messages;
create policy twf_room_messages_read on public.twf_room_messages
for select to authenticated using (
  exists (
    select 1 from public.twf_game_nights n
    join public.twf_couples c on c.id = n.couple_id
    where n.id = game_night_id
      and auth.uid() in (c.member_one, c.member_two)
  )
);

drop policy if exists twf_room_messages_send on public.twf_room_messages;
create policy twf_room_messages_send on public.twf_room_messages
for insert to authenticated with check (
  sender_id = auth.uid() and exists (
    select 1 from public.twf_game_nights n
    join public.twf_couples c on c.id = n.couple_id
    where n.id = game_night_id
      and auth.uid() in (c.member_one, c.member_two)
  )
);

grant select, insert on public.twf_room_messages to authenticated;

alter publication supabase_realtime add table public.twf_room_messages;
