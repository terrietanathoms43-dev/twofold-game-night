create table if not exists public.twf_custom_games (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.twf_couples(id) on delete cascade,
  created_by uuid not null references public.twf_profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 60),
  instructions text not null check (char_length(trim(instructions)) between 10 and 240),
  category text not null check (category in ('Couple','Competitive','Party','Creative','Cooperative')),
  prompts text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists twf_custom_games_couple_idx on public.twf_custom_games(couple_id, created_at desc);
create index if not exists twf_custom_games_creator_idx on public.twf_custom_games(created_by);

create or replace function private.twf_valid_custom_prompts(p_prompts text[])
returns boolean language sql immutable set search_path=pg_catalog as $$
  select cardinality(p_prompts) between 2 and 50
    and coalesce(bool_and(char_length(btrim(prompt)) between 3 and 240), false)
  from unnest(p_prompts) as prompt;
$$;

alter table public.twf_custom_games drop constraint if exists twf_custom_games_prompts_check;
alter table public.twf_custom_games add constraint twf_custom_games_prompts_check
  check (private.twf_valid_custom_prompts(prompts));

create or replace function private.twf_touch_updated_at()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists twf_custom_games_touch_updated_at on public.twf_custom_games;
create trigger twf_custom_games_touch_updated_at before update on public.twf_custom_games
for each row execute function private.twf_touch_updated_at();

alter table public.twf_custom_games enable row level security;
revoke all on public.twf_custom_games from anon;
grant select, insert, update, delete on public.twf_custom_games to authenticated;

drop policy if exists twf_custom_games_couple_read on public.twf_custom_games;
create policy twf_custom_games_couple_read on public.twf_custom_games
for select to authenticated using (
  exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

drop policy if exists twf_custom_games_creator_insert on public.twf_custom_games;
create policy twf_custom_games_creator_insert on public.twf_custom_games
for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

drop policy if exists twf_custom_games_creator_update on public.twf_custom_games;
create policy twf_custom_games_creator_update on public.twf_custom_games
for update to authenticated using (
  created_by = (select auth.uid()) and exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
) with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

drop policy if exists twf_custom_games_creator_delete on public.twf_custom_games;
create policy twf_custom_games_creator_delete on public.twf_custom_games
for delete to authenticated using (
  created_by = (select auth.uid()) and exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'twf_custom_games'
  ) then
    alter publication supabase_realtime add table public.twf_custom_games;
  end if;
end $$;

create or replace function public.twf_create_game_night(
  p_game_keys text[],
  p_play_style text default 'competitive',
  p_difficulty text default 'standard',
  p_session_minutes integer default 45,
  p_number_digits integer default 3
)
returns public.twf_game_nights language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_couple public.twf_couples%rowtype;
  v_night public.twf_game_nights%rowtype;
  v_key text;
  v_allowed constant text[] := array['knows','guess','likely','would','finish','memory','timeline','said','trivia','riddle','math','word','emoji','memoryChallenge','five','charades','dontsay','truth','describe','draw','caption','story','blindRank','predictions','photoFlashback','wavelength','secretSignal','oneWordStory','matchFive','blitz','spotChange','mysteryDate','voiceImpression','scavenger','playlistMatch','appreciation','higherLower'];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(cardinality(p_game_keys),0) < 1 or cardinality(p_game_keys) > 50 then raise exception 'Choose between 1 and 50 games'; end if;
  if p_play_style not in ('competitive','cooperative') then raise exception 'Invalid play style'; end if;
  if p_difficulty not in ('easy','standard','hard') then raise exception 'Invalid difficulty'; end if;
  if p_session_minutes not in (15,30,45,60,90,120) then raise exception 'Invalid session length'; end if;
  if p_number_digits not between 1 and 6 then raise exception 'Choose between 1 and 6 digits'; end if;
  if (select count(distinct key) from unnest(p_game_keys) key) <> cardinality(p_game_keys) then raise exception 'Each game can only be selected once'; end if;
  select * into v_couple from public.twf_couples where auth.uid() in (member_one,member_two) for update;
  if not found or v_couple.member_two is null then raise exception 'A linked partner is required'; end if;
  foreach v_key in array p_game_keys loop
    if not (v_key = any(v_allowed)) and not (
      v_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (
        select 1 from public.twf_custom_games cg
        where cg.id = substring(v_key from 8)::uuid and cg.couple_id = v_couple.id
      )
    ) then raise exception 'Invalid game selection'; end if;
  end loop;
  if exists(select 1 from public.twf_game_nights where couple_id=v_couple.id and status in ('lobby','playing')) then raise exception 'Resume or cancel the active game night before creating another'; end if;
  insert into public.twf_game_nights(couple_id,created_by,play_style,difficulty,session_minutes,number_digits)
  values(v_couple.id,auth.uid(),p_play_style,p_difficulty,p_session_minutes,p_number_digits) returning * into v_night;
  insert into public.twf_game_night_players(game_night_id,user_id,ready)
  values(v_night.id,auth.uid(),true),(v_night.id,case when auth.uid()=v_couple.member_one then v_couple.member_two else v_couple.member_one end,false);
  insert into public.twf_selected_games(game_night_id,game_key,position)
  select v_night.id,key,ordinality::integer-1 from unnest(p_game_keys) with ordinality as selected(key,ordinality);
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
  v_final_round:=case
    when v_game.game_key='higherLower' then 1
    when v_game.game_key in ('knows','charades','dontsay','describe','secretSignal','voiceImpression') then 3
    else 2
  end;
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

revoke all on function private.twf_valid_custom_prompts(text[]) from public,anon,authenticated;
revoke all on function private.twf_touch_updated_at() from public,anon,authenticated;
revoke all on function public.twf_create_game_night(text[],text,text,integer,integer) from public,anon;
grant execute on function public.twf_create_game_night(text[],text,text,integer,integer) to authenticated;
