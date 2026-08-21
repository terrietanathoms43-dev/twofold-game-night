create or replace function private.twf_score_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_round public.twf_rounds%rowtype;
  v_game_key text;
  v_count integer;
  v_first_correct uuid;
begin
  select r.* into v_round from public.twf_rounds r where r.id = p_round_id for update;
  if not found or v_round.status = 'revealed' then return; end if;

  select sg.game_key into v_game_key
  from public.twf_selected_games sg where sg.id = v_round.selected_game_id;

  select count(*) into v_count from public.twf_answers where round_id = p_round_id;
  if v_count < 2 and (v_round.ends_at is null or now() < v_round.ends_at) then
    raise exception 'Waiting for both players to answer';
  end if;

  update public.twf_answers set points = 0 where round_id = p_round_id;

  if v_game_key in ('knows','guess','finish','likely','would','said') then
    if (select count(distinct regexp_replace(lower(trim(answer->>'value')), '[^a-z0-9]+', '', 'g'))
        from public.twf_answers where round_id = p_round_id) = 1 and v_count = 2 then
      update public.twf_answers set points = 100 where round_id = p_round_id;
    end if;
  elsif v_game_key in ('trivia','riddle','math','emoji','memoryChallenge','word','five') then
    update public.twf_answers a
    set points = case
      when v_game_key = 'trivia' and v_round.round_number = 0 and regexp_replace(lower(a.answer->>'value'),'[^a-z0-9]+','','g') = 'jupiter' then 100
      when v_game_key = 'trivia' and v_round.round_number = 1 and regexp_replace(lower(a.answer->>'value'),'[^a-z0-9]+','','g') in ('6','six') then 100
      when v_game_key = 'trivia' and v_round.round_number = 2 and regexp_replace(lower(a.answer->>'value'),'[^a-z0-9]+','','g') = 'kingston' then 100
      when v_game_key = 'riddle' and v_round.round_number = 0 and lower(a.answer->>'value') like '%piano%' then 100
      when v_game_key = 'riddle' and v_round.round_number = 1 and lower(a.answer->>'value') like '%towel%' then 100
      when v_game_key = 'riddle' and v_round.round_number = 2 and lower(a.answer->>'value') like '%clock%' then 100
      when v_game_key = 'math' and v_round.round_number = 0 and trim(a.answer->>'value') = '126' then 100
      when v_game_key = 'math' and v_round.round_number = 1 and trim(a.answer->>'value') = '12' then 100
      when v_game_key = 'math' and v_round.round_number = 2 and trim(a.answer->>'value') = '64' then 100
      when v_game_key = 'emoji' and v_round.round_number = 0 and regexp_replace(lower(a.answer->>'value'),'[^a-z]+','','g') = 'rainingcatsanddogs' then 100
      when v_game_key = 'emoji' and v_round.round_number = 1 and regexp_replace(lower(a.answer->>'value'),'[^a-z]+','','g') = 'timeismoney' then 100
      when v_game_key = 'emoji' and v_round.round_number = 2 and regexp_replace(lower(a.answer->>'value'),'[^a-z]+','','g') = 'bookworm' then 100
      when v_game_key = 'memoryChallenge' and v_round.round_number = 0 and regexp_replace(a.answer->>'value','\s+','','g') = '♡✦☻◈♕' then 100
      when v_game_key = 'memoryChallenge' and v_round.round_number = 1 and regexp_replace(a.answer->>'value','[^0-9]+','','g') = '72941' then 100
      when v_game_key = 'memoryChallenge' and v_round.round_number = 2 and regexp_replace(lower(a.answer->>'value'),'[^a-z]+','','g') = 'redbluegoldgreen' then 100
      when v_game_key = 'word' and v_round.round_number = 0 and lower(trim(a.answer->>'value')) ~ '^s[a-z]{5}$' then 100
      when v_game_key = 'word' and v_round.round_number = 1 and lower(trim(a.answer->>'value')) in ('light','bright','flight','might','night','right','sight','tight') then 100
      when v_game_key = 'word' and v_round.round_number = 2 and lower(trim(a.answer->>'value')) ~ '^[a-z]*a[a-z]*$' then 100
      when v_game_key = 'five' and cardinality(regexp_split_to_array(a.answer->>'value', '\s*[,;]\s*')) >= 3 then 100
      else 0 end
    where a.round_id = p_round_id;

    select a.user_id into v_first_correct
    from public.twf_answers a where a.round_id = p_round_id and a.points = 100
    order by a.submitted_at asc limit 1;
    if v_first_correct is not null then
      update public.twf_answers set points = points + 25
      where round_id = p_round_id and user_id = v_first_correct;
    end if;
  else
    update public.twf_answers set points = 50 where round_id = p_round_id;
  end if;

  update public.twf_rounds
  set status = 'revealed', state = state || jsonb_build_object('scored_at', now())
  where id = p_round_id;
end;
$$;

create or replace function public.twf_start_game_night(p_game_night_id uuid, p_prompt text, p_timed boolean default false)
returns public.twf_game_nights
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_night public.twf_game_nights%rowtype;
  v_game_id uuid;
begin
  select * into v_night from public.twf_game_nights where id=p_game_night_id for update;
  if not found or v_night.created_by <> auth.uid() then raise exception 'Only the room creator can start'; end if;
  if (select count(*) from public.twf_game_night_players where game_night_id=p_game_night_id and ready) <> 2 then
    raise exception 'Both players must be ready';
  end if;
  select id into v_game_id from public.twf_selected_games where game_night_id=p_game_night_id and position=0;
  update public.twf_selected_games set status=case when id=v_game_id then 'playing' else 'queued' end where game_night_id=p_game_night_id;
  insert into public.twf_rounds(selected_game_id,round_number,prompt,ends_at)
  values(v_game_id,0,jsonb_build_object('text',p_prompt),case when p_timed then now()+interval '30 seconds' else null end)
  on conflict(selected_game_id,round_number) do nothing;
  update public.twf_game_nights set status='playing',current_game_index=0,current_round=0,started_at=now()
  where id=p_game_night_id returning * into v_night;
  return v_night;
end;
$$;

create or replace function public.twf_submit_answer(p_game_night_id uuid, p_answer text, p_prompt text, p_timed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_night public.twf_game_nights%rowtype;
  v_game_id uuid;
  v_round public.twf_rounds%rowtype;
  v_count integer;
begin
  if length(trim(p_answer)) = 0 or length(p_answer) > 500 then raise exception 'Answer must be between 1 and 500 characters'; end if;
  select * into v_night from public.twf_game_nights where id=p_game_night_id;
  if not found or v_night.status <> 'playing' then raise exception 'Game night is not active'; end if;
  if not exists(select 1 from public.twf_game_night_players where game_night_id=p_game_night_id and user_id=auth.uid()) then raise exception 'Not a player in this room'; end if;
  select id into v_game_id from public.twf_selected_games where game_night_id=p_game_night_id and position=v_night.current_game_index;
  insert into public.twf_rounds(selected_game_id,round_number,prompt,ends_at)
  values(v_game_id,v_night.current_round,jsonb_build_object('text',p_prompt),case when p_timed then now()+interval '30 seconds' else null end)
  on conflict(selected_game_id,round_number) do update set prompt=excluded.prompt
  returning * into v_round;
  if v_round.status = 'revealed' then raise exception 'This round is already closed'; end if;
  insert into public.twf_answers(round_id,user_id,answer,submitted_at)
  values(v_round.id,auth.uid(),jsonb_build_object('value',trim(p_answer)),now())
  on conflict(round_id,user_id) do update set answer=excluded.answer,submitted_at=excluded.submitted_at;
  select count(*) into v_count from public.twf_answers where round_id=v_round.id;
  if v_count >= 2 then perform private.twf_score_round(v_round.id); end if;
  return jsonb_build_object('round_id',v_round.id,'answer_count',v_count);
end;
$$;

create or replace function public.twf_advance_game(p_game_night_id uuid, p_next_prompt text default null, p_next_timed boolean default false)
returns public.twf_game_nights
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_night public.twf_game_nights%rowtype;
  v_game public.twf_selected_games%rowtype;
  v_round public.twf_rounds%rowtype;
  v_next_game_id uuid;
  v_scores jsonb;
  v_max integer;
  v_winners integer;
  v_winner uuid;
  v_last_pos integer;
  v_next_round integer;
  v_next_pos integer;
begin
  select * into v_night from public.twf_game_nights where id=p_game_night_id for update;
  if not found or v_night.created_by <> auth.uid() then raise exception 'Only the room creator can advance'; end if;
  if v_night.status <> 'playing' then raise exception 'Game night is not active'; end if;
  select * into v_game from public.twf_selected_games where game_night_id=p_game_night_id and position=v_night.current_game_index;
  select * into v_round from public.twf_rounds where selected_game_id=v_game.id and round_number=v_night.current_round for update;
  perform private.twf_score_round(v_round.id);

  if v_night.current_round < 2 then
    v_next_round := v_night.current_round + 1; v_next_pos := v_night.current_game_index;
  else
    select coalesce(jsonb_object_agg(user_id,total), '{}'::jsonb), max(total)
      into v_scores,v_max from (
        select a.user_id,sum(a.points)::int total from public.twf_answers a
        join public.twf_rounds r on r.id=a.round_id where r.selected_game_id=v_game.id group by a.user_id
      ) s;
    select count(*),(array_agg(user_id))[1] into v_winners,v_winner from (
      select a.user_id,sum(a.points)::int total from public.twf_answers a join public.twf_rounds r on r.id=a.round_id
      where r.selected_game_id=v_game.id group by a.user_id
    ) s where total=v_max;
    update public.twf_selected_games set status='completed',scores=v_scores,winner_id=case when v_winners=1 then v_winner else null end where id=v_game.id;
    select max(position) into v_last_pos from public.twf_selected_games where game_night_id=p_game_night_id;
    if v_night.current_game_index >= v_last_pos then
      update public.twf_game_night_players p set total_score=coalesce((select sum(a.points) from public.twf_answers a join public.twf_rounds r on r.id=a.round_id join public.twf_selected_games sg on sg.id=r.selected_game_id where sg.game_night_id=p_game_night_id and a.user_id=p.user_id),0)
      where p.game_night_id=p_game_night_id;
      select max(total_score) into v_max from public.twf_game_night_players where game_night_id=p_game_night_id;
      select count(*),(array_agg(user_id))[1] into v_winners,v_winner from public.twf_game_night_players where game_night_id=p_game_night_id and total_score=v_max;
      update public.twf_game_nights set status='completed',winner_id=case when v_winners=1 then v_winner else null end,completed_at=now()
      where id=p_game_night_id returning * into v_night;
      return v_night;
    end if;
    v_next_round := 0; v_next_pos := v_night.current_game_index + 1;
    update public.twf_selected_games set status='playing' where game_night_id=p_game_night_id and position=v_next_pos returning id into v_next_game_id;
  end if;
  if v_next_game_id is null then v_next_game_id := v_game.id; end if;
  insert into public.twf_rounds(selected_game_id,round_number,prompt,ends_at)
  values(v_next_game_id,v_next_round,jsonb_build_object('text',coalesce(p_next_prompt,'')),case when p_next_timed then now()+interval '30 seconds' else null end)
  on conflict(selected_game_id,round_number) do nothing;
  update public.twf_game_nights set current_game_index=v_next_pos,current_round=v_next_round
  where id=p_game_night_id returning * into v_night;
  return v_night;
end;
$$;

revoke all on function private.twf_score_round(uuid) from public, anon, authenticated;
revoke execute on function public.twf_start_game_night(uuid,text,boolean) from public, anon;
revoke execute on function public.twf_submit_answer(uuid,text,text,boolean) from public, anon;
revoke execute on function public.twf_advance_game(uuid,text,boolean) from public, anon;
grant execute on function public.twf_start_game_night(uuid,text,boolean) to authenticated;
grant execute on function public.twf_submit_answer(uuid,text,text,boolean) to authenticated;
grant execute on function public.twf_advance_game(uuid,text,boolean) to authenticated;
