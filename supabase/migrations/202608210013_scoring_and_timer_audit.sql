create or replace function private.twf_expanded_game_scoring()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text;v_count integer;v_member_one uuid;v_member_two uuid;v_actor uuid;v_guesser uuid;v_guessed boolean;
begin
  if new.status<>'revealed' or old.status='revealed' then return new; end if;
  select sg.game_key,c.member_one,c.member_two into v_key,v_member_one,v_member_two
  from public.twf_selected_games sg join public.twf_game_nights n on n.id=sg.game_night_id join public.twf_couples c on c.id=n.couple_id where sg.id=new.selected_game_id;
  if v_key in('predictions','wavelength','mysteryDate','playlistMatch','blitz') then
    select count(distinct regexp_replace(lower(trim(answer->>'value')),'[^a-z0-9]+','','g')) into v_count from public.twf_answers where round_id=new.id;
    update public.twf_answers set points=case when v_count=1 then 100 else 0 end where round_id=new.id;
  elsif v_key='matchFive' then
    update public.twf_answers set points=least(125,25*(select count(*) from(
      select lower(trim(x.value)) value from public.twf_answers a cross join lateral regexp_split_to_table(a.answer->>'value','[,;]') as x(value)
      where a.round_id=new.id group by lower(trim(x.value)) having count(distinct a.user_id)=2
    ) shared)) where round_id=new.id;
  elsif v_key='appreciation' then
    update public.twf_answers set points=75 where round_id=new.id;
  elsif v_key in('secretSignal','voiceImpression') then
    if mod(new.round_number,2)=0 then v_actor:=v_member_one;v_guesser:=v_member_two;else v_actor:=v_member_two;v_guesser:=v_member_one;end if;
    select coalesce(answer->>'value'='guessed',false) into v_guessed from public.twf_answers where round_id=new.id and user_id=v_guesser;
    update public.twf_answers set points=case when v_guessed then case when user_id=v_guesser then 100 else 75 end else 0 end where round_id=new.id;
  elsif v_key='spotChange' then
    update public.twf_answers set points=case
      when mod(new.round_number,3)=0 and lower(answer->>'value') ~ '(square|■|circle.*square)' then 100
      when mod(new.round_number,3)=1 and regexp_replace(answer->>'value','[^0-9]+','','g')='3' then 100
      when mod(new.round_number,3)=2 and lower(answer->>'value') like '%green%' then 100 else 0 end where round_id=new.id;
  elsif v_key='scavenger' then
    update public.twf_answers set points=50 where round_id=new.id and length(trim(answer->>'value'))>0;
  end if;
  return new;
end; $$;

create or replace function private.twf_sync_live_totals()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_night uuid;
begin
  if new.status<>'revealed' or old.status='revealed' then return new; end if;
  select game_night_id into v_night from public.twf_selected_games where id=new.selected_game_id;
  update public.twf_game_night_players p set total_score=coalesce((
    select sum(a.points) from public.twf_answers a join public.twf_rounds r on r.id=a.round_id join public.twf_selected_games sg on sg.id=r.selected_game_id
    where sg.game_night_id=v_night and a.user_id=p.user_id
  ),0) where p.game_night_id=v_night;
  return new;
end; $$;

drop trigger if exists zz_twf_sync_live_totals on public.twf_rounds;
create trigger zz_twf_sync_live_totals after update of status on public.twf_rounds for each row execute function private.twf_sync_live_totals();
revoke all on function private.twf_expanded_game_scoring() from public,anon,authenticated;
revoke all on function private.twf_sync_live_totals() from public,anon,authenticated;
