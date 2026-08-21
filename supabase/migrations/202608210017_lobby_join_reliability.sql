create or replace function public.twf_join_game_night(p_game_night_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  if not exists (
    select 1
    from public.twf_game_nights n
    join public.twf_couples c on c.id = n.couple_id
    where n.id = p_game_night_id
      and n.status = 'lobby'
      and auth.uid() in (c.member_one, c.member_two)
  ) then
    raise exception 'This room is unavailable or you are not one of its players';
  end if;

  update public.twf_game_night_players
  set ready = true
  where game_night_id = p_game_night_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Your player place was not found in this room';
  end if;
end;
$$;

revoke all on function public.twf_join_game_night(uuid) from public, anon;
grant execute on function public.twf_join_game_night(uuid) to authenticated;

