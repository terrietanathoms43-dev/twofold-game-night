alter table public.twf_game_nights
  add column if not exists current_game_ends_at timestamptz,
  add column if not exists extension_minutes integer not null default 0 check (extension_minutes between 0 and 180);

create or replace function private.twf_set_session_deadline()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_game_count integer;v_game_seconds integer;
begin
  if new.status='playing' and old.status is distinct from 'playing' and new.session_ends_at is null then
    select count(*) into v_game_count from public.twf_selected_games where game_night_id=new.id;
    v_game_seconds:=greatest(60,(new.session_minutes*60)/greatest(v_game_count,1));
    new.session_ends_at:=now()+make_interval(mins=>new.session_minutes);
    new.current_game_ends_at:=now()+make_interval(secs=>v_game_seconds);
  end if;
  return new;
end; $$;

create or replace function public.twf_extend_game_night(p_game_night_id uuid,p_minutes integer)
returns public.twf_game_nights language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_night public.twf_game_nights%rowtype;v_remaining integer;v_share_seconds integer;
begin
  if p_minutes not in(5,10,15,30) then raise exception 'Choose a 5, 10, 15, or 30 minute extension'; end if;
  select n.* into v_night from public.twf_game_nights n join public.twf_couples c on c.id=n.couple_id
  where n.id=p_game_night_id and n.status='playing' and auth.uid() in(c.member_one,c.member_two) for update of n;
  if not found then raise exception 'This active game night is not available'; end if;
  if v_night.extension_minutes+p_minutes>180 then raise exception 'The maximum total extension is 180 minutes'; end if;
  select count(*) into v_remaining from public.twf_selected_games where game_night_id=p_game_night_id and position>=v_night.current_game_index;
  v_share_seconds:=greatest(60,(p_minutes*60)/greatest(v_remaining,1));
  update public.twf_game_nights set
    session_ends_at=session_ends_at+make_interval(mins=>p_minutes),
    current_game_ends_at=current_game_ends_at+make_interval(secs=>v_share_seconds),
    extension_minutes=extension_minutes+p_minutes
  where id=p_game_night_id returning * into v_night;
  return v_night;
end; $$;

create or replace function public.twf_extend_current_game(p_game_night_id uuid,p_minutes integer)
returns public.twf_game_nights language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_night public.twf_game_nights%rowtype;
begin
  if p_minutes not in(2,5,10,15) then raise exception 'Choose a 2, 5, 10, or 15 minute extension'; end if;
  select n.* into v_night from public.twf_game_nights n join public.twf_couples c on c.id=n.couple_id
  where n.id=p_game_night_id and n.status='playing' and auth.uid() in(c.member_one,c.member_two) for update of n;
  if not found then raise exception 'This active game night is not available'; end if;
  if v_night.extension_minutes+p_minutes>180 then raise exception 'The maximum total extension is 180 minutes'; end if;
  update public.twf_game_nights set
    session_ends_at=session_ends_at+make_interval(mins=>p_minutes),
    current_game_ends_at=current_game_ends_at+make_interval(mins=>p_minutes),
    extension_minutes=extension_minutes+p_minutes
  where id=p_game_night_id returning * into v_night;
  return v_night;
end; $$;

create or replace function public.twf_expire_current_game(p_game_night_id uuid,p_next_prompt text default null,p_next_timed boolean default false)
returns public.twf_game_nights language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_night public.twf_game_nights%rowtype;v_game public.twf_selected_games%rowtype;v_next_game_id uuid;
  v_scores jsonb;v_max integer;v_winners integer;v_winner uuid;v_last_pos integer;v_next_pos integer;
  v_game_count integer;v_game_seconds integer;v_remaining_after integer;
begin
  select * into v_night from public.twf_game_nights where id=p_game_night_id for update;
  if not found or v_night.created_by<>auth.uid() then raise exception 'Only the room creator can advance an expired game'; end if;
  if v_night.status<>'playing' then raise exception 'Game night is not active'; end if;
  if v_night.current_game_ends_at is null or now()<v_night.current_game_ends_at then raise exception 'This game still has time remaining'; end if;
  select * into v_game from public.twf_selected_games where game_night_id=p_game_night_id and position=v_night.current_game_index for update;
  update public.twf_rounds set status='revealed',state=coalesce(state,'{}'::jsonb)||jsonb_build_object('time_expired_at',now()) where selected_game_id=v_game.id and status<>'revealed';
  select coalesce(jsonb_object_agg(user_id,total),'{}'::jsonb),max(total) into v_scores,v_max from(
    select a.user_id,sum(a.points)::int total from public.twf_answers a join public.twf_rounds r on r.id=a.round_id where r.selected_game_id=v_game.id group by a.user_id
  )s;
  select count(*),(array_agg(user_id))[1] into v_winners,v_winner from(
    select a.user_id,sum(a.points)::int total from public.twf_answers a join public.twf_rounds r on r.id=a.round_id where r.selected_game_id=v_game.id group by a.user_id
  )s where total=v_max;
  update public.twf_selected_games set status='completed',scores=v_scores,winner_id=case when v_winners=1 then v_winner else null end where id=v_game.id;
  select max(position),count(*) into v_last_pos,v_game_count from public.twf_selected_games where game_night_id=p_game_night_id;
  if v_night.current_game_index>=v_last_pos then
    update public.twf_game_night_players p set total_score=coalesce((select sum(a.points) from public.twf_answers a join public.twf_rounds r on r.id=a.round_id join public.twf_selected_games sg on sg.id=r.selected_game_id where sg.game_night_id=p_game_night_id and a.user_id=p.user_id),0) where p.game_night_id=p_game_night_id;
    select max(total_score) into v_max from public.twf_game_night_players where game_night_id=p_game_night_id;
    select count(*),(array_agg(user_id))[1] into v_winners,v_winner from public.twf_game_night_players where game_night_id=p_game_night_id and total_score=v_max;
    update public.twf_game_nights set status='completed',winner_id=case when v_winners=1 then v_winner else null end,completed_at=now() where id=p_game_night_id returning * into v_night;
    return v_night;
  end if;
  v_next_pos:=v_night.current_game_index+1;
  update public.twf_selected_games set status='playing' where game_night_id=p_game_night_id and position=v_next_pos returning id into v_next_game_id;
  insert into public.twf_rounds(selected_game_id,round_number,prompt,ends_at)
  values(v_next_game_id,0,jsonb_build_object('text',coalesce(p_next_prompt,'')),case when p_next_timed then now()+interval '30 seconds' else null end)
  on conflict(selected_game_id,round_number) do nothing;
  v_game_seconds:=greatest(60,(v_night.session_minutes*60)/greatest(v_game_count,1));
  v_remaining_after:=greatest(0,v_game_count-v_next_pos-1);
  update public.twf_game_nights set current_game_index=v_next_pos,current_round=0,
    current_game_ends_at=session_ends_at-make_interval(secs=>v_game_seconds*v_remaining_after)
  where id=p_game_night_id returning * into v_night;
  return v_night;
end; $$;

create or replace function public.twf_advance_game(p_game_night_id uuid,p_next_prompt text default null,p_next_timed boolean default false)
returns public.twf_game_nights language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_night public.twf_game_nights%rowtype;v_game public.twf_selected_games%rowtype;v_round public.twf_rounds%rowtype;v_next_game_id uuid;
  v_scores jsonb;v_max integer;v_winners integer;v_winner uuid;v_last_pos integer;v_next_round integer;v_next_pos integer;v_final_round integer;
  v_game_count integer;v_game_seconds integer;v_remaining_after integer;
begin
  select * into v_night from public.twf_game_nights where id=p_game_night_id for update;
  if not found or v_night.created_by<>auth.uid() then raise exception 'Only the room creator can advance'; end if;
  if v_night.status<>'playing' then raise exception 'Game night is not active'; end if;
  select * into v_game from public.twf_selected_games where game_night_id=p_game_night_id and position=v_night.current_game_index;
  select * into v_round from public.twf_rounds where selected_game_id=v_game.id and round_number=v_night.current_round for update;
  perform private.twf_score_round(v_round.id);
  v_final_round:=case when v_game.game_key='higherLower' then 1 else 2 end;
  if v_night.current_round<v_final_round then
    v_next_round:=v_night.current_round+1;v_next_pos:=v_night.current_game_index;
  else
    select coalesce(jsonb_object_agg(user_id,total),'{}'::jsonb),max(total) into v_scores,v_max from(select a.user_id,sum(a.points)::int total from public.twf_answers a join public.twf_rounds r on r.id=a.round_id where r.selected_game_id=v_game.id group by a.user_id)s;
    select count(*),(array_agg(user_id))[1] into v_winners,v_winner from(select a.user_id,sum(a.points)::int total from public.twf_answers a join public.twf_rounds r on r.id=a.round_id where r.selected_game_id=v_game.id group by a.user_id)s where total=v_max;
    update public.twf_selected_games set status='completed',scores=v_scores,winner_id=case when v_winners=1 then v_winner else null end where id=v_game.id;
    select max(position),count(*) into v_last_pos,v_game_count from public.twf_selected_games where game_night_id=p_game_night_id;
    if v_night.current_game_index>=v_last_pos then
      update public.twf_game_night_players p set total_score=coalesce((select sum(a.points) from public.twf_answers a join public.twf_rounds r on r.id=a.round_id join public.twf_selected_games sg on sg.id=r.selected_game_id where sg.game_night_id=p_game_night_id and a.user_id=p.user_id),0) where p.game_night_id=p_game_night_id;
      select max(total_score) into v_max from public.twf_game_night_players where game_night_id=p_game_night_id;
      select count(*),(array_agg(user_id))[1] into v_winners,v_winner from public.twf_game_night_players where game_night_id=p_game_night_id and total_score=v_max;
      update public.twf_game_nights set status='completed',winner_id=case when v_winners=1 then v_winner else null end,completed_at=now() where id=p_game_night_id returning * into v_night;
      return v_night;
    end if;
    v_next_round:=0;v_next_pos:=v_night.current_game_index+1;
    update public.twf_selected_games set status='playing' where game_night_id=p_game_night_id and position=v_next_pos returning id into v_next_game_id;
  end if;
  if v_next_game_id is null then v_next_game_id:=v_game.id;end if;
  insert into public.twf_rounds(selected_game_id,round_number,prompt,ends_at) values(v_next_game_id,v_next_round,jsonb_build_object('text',coalesce(p_next_prompt,'')),case when p_next_timed then now()+interval '30 seconds' else null end) on conflict(selected_game_id,round_number) do nothing;
  if v_next_pos<>v_night.current_game_index then
    if v_game_count is null then select count(*) into v_game_count from public.twf_selected_games where game_night_id=p_game_night_id;end if;
    v_game_seconds:=greatest(60,(v_night.session_minutes*60)/greatest(v_game_count,1));
    v_remaining_after:=greatest(0,v_game_count-v_next_pos-1);
    update public.twf_game_nights set current_game_index=v_next_pos,current_round=v_next_round,current_game_ends_at=session_ends_at-make_interval(secs=>v_game_seconds*v_remaining_after) where id=p_game_night_id returning * into v_night;
  else
    update public.twf_game_nights set current_game_index=v_next_pos,current_round=v_next_round where id=p_game_night_id returning * into v_night;
  end if;
  return v_night;
end; $$;

revoke all on function public.twf_extend_game_night(uuid,integer) from public,anon;
revoke all on function public.twf_extend_current_game(uuid,integer) from public,anon;
revoke all on function public.twf_expire_current_game(uuid,text,boolean) from public,anon;
grant execute on function public.twf_extend_game_night(uuid,integer) to authenticated;
grant execute on function public.twf_extend_current_game(uuid,integer) to authenticated;
grant execute on function public.twf_expire_current_game(uuid,text,boolean) to authenticated;
