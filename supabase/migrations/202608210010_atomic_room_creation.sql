create or replace function public.twf_create_game_night(p_game_keys text[])
returns public.twf_game_nights
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_couple public.twf_couples%rowtype;
  v_night public.twf_game_nights%rowtype;
  v_key text;
  v_allowed constant text[] := array[
    'knows','guess','likely','would','finish','memory','timeline','said',
    'trivia','riddle','math','word','emoji','memoryChallenge','five',
    'charades','dontsay','truth','describe','draw','caption','story'
  ];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(cardinality(p_game_keys), 0) < 1
     or cardinality(p_game_keys) > 22 then
    raise exception 'Choose between 1 and 22 games';
  end if;
  if (select count(distinct key) from unnest(p_game_keys) key)
     <> cardinality(p_game_keys) then
    raise exception 'Each game can only be selected once';
  end if;
  foreach v_key in array p_game_keys loop
    if not (v_key = any(v_allowed)) then
      raise exception 'Invalid game selection';
    end if;
  end loop;

  select * into v_couple
  from public.twf_couples
  where auth.uid() in (member_one, member_two)
  for update;
  if not found or v_couple.member_two is null then
    raise exception 'A linked partner is required';
  end if;

  if exists (
    select 1 from public.twf_game_nights
    where couple_id = v_couple.id and status in ('lobby','playing')
  ) then
    raise exception 'Resume or cancel the active game night before creating another';
  end if;

  insert into public.twf_game_nights(couple_id, created_by)
  values(v_couple.id, auth.uid())
  returning * into v_night;

  insert into public.twf_game_night_players(game_night_id, user_id, ready)
  values
    (v_night.id, auth.uid(), true),
    (
      v_night.id,
      case when auth.uid() = v_couple.member_one
        then v_couple.member_two else v_couple.member_one end,
      false
    );

  insert into public.twf_selected_games(game_night_id, game_key, position)
  select v_night.id, key, ordinality::integer - 1
  from unnest(p_game_keys) with ordinality as selected(key, ordinality);

  return v_night;
end;
$$;

revoke all on function public.twf_create_game_night(text[])
  from public, anon;
grant execute on function public.twf_create_game_night(text[])
  to authenticated;
