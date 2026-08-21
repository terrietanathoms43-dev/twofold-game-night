create index if not exists twf_creative_ratings_voter_idx
  on public.twf_creative_ratings(voter_id);
create index if not exists twf_creative_ratings_target_idx
  on public.twf_creative_ratings(target_id);
create index if not exists twf_room_messages_sender_idx
  on public.twf_room_messages(sender_id);

drop policy if exists twf_ratings_couple_read on public.twf_creative_ratings;
create policy twf_ratings_couple_read on public.twf_creative_ratings
for select to authenticated using (
  exists (
    select 1
    from public.twf_rounds r
    join public.twf_selected_games sg on sg.id = r.selected_game_id
    join public.twf_game_nights n on n.id = sg.game_night_id
    join public.twf_couples c on c.id = n.couple_id
    where r.id = round_id
      and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

drop policy if exists twf_room_messages_read on public.twf_room_messages;
create policy twf_room_messages_read on public.twf_room_messages
for select to authenticated using (
  exists (
    select 1 from public.twf_game_nights n
    join public.twf_couples c on c.id = n.couple_id
    where n.id = game_night_id
      and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

drop policy if exists twf_room_messages_send on public.twf_room_messages;
create policy twf_room_messages_send on public.twf_room_messages
for insert to authenticated with check (
  sender_id = (select auth.uid()) and exists (
    select 1 from public.twf_game_nights n
    join public.twf_couples c on c.id = n.couple_id
    where n.id = game_night_id
      and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

create or replace function private.twf_can_access_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_night_id uuid;
begin
  if p_topic !~ '^twf-room:[0-9a-f-]{36}:call$' then return false; end if;
  v_night_id := split_part(p_topic, ':', 2)::uuid;
  return exists (
    select 1 from public.twf_game_nights n
    join public.twf_couples c on c.id = n.couple_id
    where n.id = v_night_id
      and auth.uid() in (c.member_one, c.member_two)
  );
exception when others then
  return false;
end;
$$;

revoke all on function private.twf_can_access_realtime_topic(text)
  from public, anon;
grant execute on function private.twf_can_access_realtime_topic(text)
  to authenticated;

drop policy if exists twf_private_call_receive on realtime.messages;
create policy twf_private_call_receive on realtime.messages
for select to authenticated
using (private.twf_can_access_realtime_topic(realtime.topic()));

drop policy if exists twf_private_call_send on realtime.messages;
create policy twf_private_call_send on realtime.messages
for insert to authenticated
with check (private.twf_can_access_realtime_topic(realtime.topic()));
