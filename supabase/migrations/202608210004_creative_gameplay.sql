create or replace function private.twf_creative_round_scoring()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game_key text;
  v_game_night_id uuid;
  v_member_one uuid;
  v_member_two uuid;
  v_actor uuid;
  v_guesser uuid;
  v_guessed boolean;
begin
  if new.status <> 'revealed' or old.status = 'revealed' then return new; end if;
  select sg.game_key, sg.game_night_id, c.member_one, c.member_two
    into v_game_key, v_game_night_id, v_member_one, v_member_two
  from twf_selected_games sg
  join twf_game_nights gn on gn.id = sg.game_night_id
  join twf_couples c on c.id = gn.couple_id
  where sg.id = new.selected_game_id;
  if v_game_key <> 'charades' then return new; end if;
  if mod(new.round_number, 2) = 0 then v_actor := v_member_one; v_guesser := v_member_two;
  else v_actor := v_member_two; v_guesser := v_member_one; end if;
  select coalesce(a.answer->>'value' = 'guessed', false) into v_guessed
  from twf_answers a where a.round_id = new.id and a.user_id = v_guesser;
  update twf_answers set points = case when v_guessed then case when user_id = v_guesser then 100 else 75 end else 0 end
  where round_id = new.id;
  update twf_game_night_players p set total_score = coalesce((
    select sum(a.points) from twf_answers a join twf_rounds r on r.id = a.round_id
    join twf_selected_games sg on sg.id = r.selected_game_id
    where sg.game_night_id = v_game_night_id and a.user_id = p.user_id
  ),0) where p.game_night_id = v_game_night_id;
  return new;
end;
$$;
drop trigger if exists twf_creative_round_scoring on public.twf_rounds;
create trigger twf_creative_round_scoring after update of status on public.twf_rounds
for each row execute function private.twf_creative_round_scoring();
revoke all on function private.twf_creative_round_scoring() from public, anon, authenticated;
