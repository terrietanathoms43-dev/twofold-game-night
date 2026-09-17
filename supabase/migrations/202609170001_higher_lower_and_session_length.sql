alter table public.twf_game_nights
  add column if not exists session_minutes integer not null default 45 check (session_minutes between 15 and 120),
  add column if not exists session_ends_at timestamptz,
  add column if not exists number_digits integer not null default 3 check (number_digits between 1 and 6);

create table if not exists public.twf_number_secrets (
  round_id uuid primary key references public.twf_rounds(id) on delete cascade,
  owner_id uuid not null references public.twf_profiles(id) on delete cascade,
  secret_number integer not null check (secret_number between 0 and 999999),
  created_at timestamptz not null default now()
);

create table if not exists public.twf_number_guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.twf_rounds(id) on delete cascade,
  secret_owner_id uuid not null references public.twf_profiles(id) on delete cascade,
  guesser_id uuid not null references public.twf_profiles(id) on delete cascade,
  guess integer not null check (guess between 0 and 999999),
  feedback text check (feedback in ('higher','lower','correct')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists twf_number_one_pending_guess
  on public.twf_number_guesses(round_id) where feedback is null;
create index if not exists twf_number_guesses_round_created
  on public.twf_number_guesses(round_id, created_at);
create index if not exists twf_number_secrets_owner_idx
  on public.twf_number_secrets(owner_id);
create index if not exists twf_number_guesses_owner_idx
  on public.twf_number_guesses(secret_owner_id);
create index if not exists twf_number_guesses_guesser_idx
  on public.twf_number_guesses(guesser_id);

alter table public.twf_number_secrets enable row level security;
alter table public.twf_number_guesses enable row level security;

drop policy if exists twf_number_secret_owner_read on public.twf_number_secrets;
create policy twf_number_secret_owner_read on public.twf_number_secrets
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists twf_number_guesses_players_read on public.twf_number_guesses;
create policy twf_number_guesses_players_read on public.twf_number_guesses
  for select to authenticated using (
    exists (
      select 1
      from public.twf_rounds r
      join public.twf_selected_games sg on sg.id = r.selected_game_id
      join public.twf_game_night_players p on p.game_night_id = sg.game_night_id
      where r.id = round_id and p.user_id = (select auth.uid())
    )
  );

grant select on public.twf_number_secrets, public.twf_number_guesses to authenticated;
revoke insert, update, delete on public.twf_number_secrets, public.twf_number_guesses from anon, authenticated;

create or replace function private.twf_set_session_deadline()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
  if new.status = 'playing' and old.status is distinct from 'playing' and new.session_ends_at is null then
    new.session_ends_at := now() + make_interval(mins => new.session_minutes);
  end if;
  return new;
end; $$;

drop trigger if exists twf_set_session_deadline on public.twf_game_nights;
create trigger twf_set_session_deadline before update of status on public.twf_game_nights
for each row execute function private.twf_set_session_deadline();

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
  if coalesce(cardinality(p_game_keys),0) < 1 or cardinality(p_game_keys) > 37 then raise exception 'Choose between 1 and 37 games'; end if;
  if p_play_style not in ('competitive','cooperative') then raise exception 'Invalid play style'; end if;
  if p_difficulty not in ('easy','standard','hard') then raise exception 'Invalid difficulty'; end if;
  if p_session_minutes not in (15,30,45,60,90,120) then raise exception 'Invalid session length'; end if;
  if p_number_digits not between 1 and 6 then raise exception 'Choose between 1 and 6 digits'; end if;
  if (select count(distinct key) from unnest(p_game_keys) key) <> cardinality(p_game_keys) then raise exception 'Each game can only be selected once'; end if;
  foreach v_key in array p_game_keys loop
    if not (v_key = any(v_allowed)) then raise exception 'Invalid game selection'; end if;
  end loop;
  select * into v_couple from public.twf_couples where auth.uid() in (member_one,member_two) for update;
  if not found or v_couple.member_two is null then raise exception 'A linked partner is required'; end if;
  if exists(select 1 from public.twf_game_nights where couple_id=v_couple.id and status in ('lobby','playing')) then raise exception 'Resume or cancel the active game night before creating another'; end if;
  insert into public.twf_game_nights(couple_id,created_by,play_style,difficulty,session_minutes,number_digits)
  values(v_couple.id,auth.uid(),p_play_style,p_difficulty,p_session_minutes,p_number_digits) returning * into v_night;
  insert into public.twf_game_night_players(game_night_id,user_id,ready)
  values(v_night.id,auth.uid(),true),(v_night.id,case when auth.uid()=v_couple.member_one then v_couple.member_two else v_couple.member_one end,false);
  insert into public.twf_selected_games(game_night_id,game_key,position)
  select v_night.id,key,ordinality::integer-1 from unnest(p_game_keys) with ordinality as selected(key,ordinality);
  return v_night;
end; $$;

create or replace function public.twf_set_number_secret(p_round_id uuid,p_secret integer)
returns public.twf_rounds language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_round public.twf_rounds%rowtype;
  v_owner uuid;
  v_digits integer;
  v_min integer;
  v_max integer;
begin
  select r.* into v_round
  from public.twf_rounds r
  join public.twf_selected_games sg on sg.id=r.selected_game_id and sg.game_key='higherLower'
  join public.twf_game_nights n on n.id=sg.game_night_id and n.status='playing'
  where r.id=p_round_id for update of r;
  if not found then raise exception 'This number round is not available'; end if;
  select case when mod(v_round.round_number,2)=0 then c.member_one else c.member_two end,n.number_digits
    into v_owner,v_digits
  from public.twf_selected_games sg
  join public.twf_game_nights n on n.id=sg.game_night_id
  join public.twf_couples c on c.id=n.couple_id
  where sg.id=v_round.selected_game_id;
  if auth.uid() is distinct from v_owner then raise exception 'Only the number setter can lock the secret'; end if;
  if v_round.status='revealed' then raise exception 'This round is already complete'; end if;
  v_min := case when v_digits=1 then 0 else power(10,v_digits-1)::integer end;
  v_max := power(10,v_digits)::integer-1;
  if p_secret not between v_min and v_max then raise exception 'Enter a % digit number between % and %',v_digits,v_min,v_max; end if;
  insert into public.twf_number_secrets(round_id,owner_id,secret_number) values(p_round_id,v_owner,p_secret)
  on conflict(round_id) do nothing;
  if not found then raise exception 'The secret number is already locked'; end if;
  update public.twf_rounds set state=coalesce(state,'{}'::jsonb)||jsonb_build_object('number_secret_ready','true') where id=p_round_id returning * into v_round;
  return v_round;
end; $$;

create or replace function public.twf_make_number_guess(p_round_id uuid,p_guess integer)
returns public.twf_number_guesses language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_guess public.twf_number_guesses%rowtype;
  v_owner uuid;
  v_guesser uuid;
  v_digits integer;
  v_min integer;
  v_max integer;
begin
  select case when mod(r.round_number,2)=0 then c.member_one else c.member_two end,
         case when mod(r.round_number,2)=0 then c.member_two else c.member_one end,n.number_digits
    into v_owner,v_guesser,v_digits
  from public.twf_rounds r
  join public.twf_selected_games sg on sg.id=r.selected_game_id and sg.game_key='higherLower'
  join public.twf_game_nights n on n.id=sg.game_night_id and n.status='playing'
  join public.twf_couples c on c.id=n.couple_id
  where r.id=p_round_id and r.status<>'revealed';
  if not found then raise exception 'This number round is not available'; end if;
  if auth.uid() is distinct from v_guesser then raise exception 'Only the guesser can send a guess'; end if;
  if not exists(select 1 from public.twf_number_secrets where round_id=p_round_id) then raise exception 'Wait for the secret number to be locked'; end if;
  if exists(select 1 from public.twf_number_guesses where round_id=p_round_id and feedback is null) then raise exception 'Wait for feedback on the current guess'; end if;
  v_min := case when v_digits=1 then 0 else power(10,v_digits-1)::integer end;
  v_max := power(10,v_digits)::integer-1;
  if p_guess not between v_min and v_max then raise exception 'Guess a number between % and %',v_min,v_max; end if;
  insert into public.twf_number_guesses(round_id,secret_owner_id,guesser_id,guess)
  values(p_round_id,v_owner,v_guesser,p_guess) returning * into v_guess;
  return v_guess;
end; $$;

create or replace function public.twf_respond_number_guess(p_guess_id uuid,p_feedback text)
returns public.twf_number_guesses language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_guess public.twf_number_guesses%rowtype;
  v_secret integer;
  v_expected text;
  v_attempts integer;
  v_points integer;
begin
  select g.* into v_guess from public.twf_number_guesses g where g.id=p_guess_id for update;
  if not found or v_guess.feedback is not null then raise exception 'This guess is no longer waiting for feedback'; end if;
  select secret_number into v_secret from public.twf_number_secrets where round_id=v_guess.round_id;
  if auth.uid() is distinct from v_guess.secret_owner_id then raise exception 'Only the number setter can give feedback'; end if;
  v_expected := case when v_guess.guess<v_secret then 'higher' when v_guess.guess>v_secret then 'lower' else 'correct' end;
  if p_feedback is distinct from v_expected then raise exception 'That hint does not match the secret number'; end if;
  update public.twf_number_guesses set feedback=p_feedback,responded_at=now() where id=p_guess_id returning * into v_guess;
  if p_feedback='correct' then
    select count(*) into v_attempts from public.twf_number_guesses where round_id=v_guess.round_id;
    v_points := greatest(25,110-(v_attempts*10));
    insert into public.twf_answers(round_id,user_id,answer,points,submitted_at) values
      (v_guess.round_id,v_guess.guesser_id,jsonb_build_object('value','Found the number in '||v_attempts||case when v_attempts=1 then ' guess' else ' guesses' end),v_points,now()),
      (v_guess.round_id,v_guess.secret_owner_id,jsonb_build_object('value','Secret number: '||v_secret),50,now())
    on conflict(round_id,user_id) do update set answer=excluded.answer,points=excluded.points,submitted_at=excluded.submitted_at;
    update public.twf_rounds set status='revealed',state=coalesce(state,'{}'::jsonb)||jsonb_build_object('number_solved_at',now(),'number_attempts',v_attempts) where id=v_guess.round_id;
  end if;
  return v_guess;
end; $$;

create or replace function public.twf_finish_timed_game_night(p_game_night_id uuid)
returns public.twf_game_nights language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_night public.twf_game_nights%rowtype;v_max integer;v_winners integer;v_winner uuid;
begin
  select * into v_night from public.twf_game_nights where id=p_game_night_id for update;
  if not found or v_night.created_by is distinct from auth.uid() then raise exception 'Only the room creator can close the session'; end if;
  if v_night.status<>'playing' then return v_night; end if;
  if v_night.session_ends_at is null or now()<v_night.session_ends_at then raise exception 'The session timer has not ended'; end if;
  update public.twf_game_night_players p set total_score=coalesce((select sum(a.points) from public.twf_answers a join public.twf_rounds r on r.id=a.round_id join public.twf_selected_games sg on sg.id=r.selected_game_id where sg.game_night_id=p_game_night_id and a.user_id=p.user_id),0) where p.game_night_id=p_game_night_id;
  select max(total_score) into v_max from public.twf_game_night_players where game_night_id=p_game_night_id;
  select count(*),(array_agg(user_id))[1] into v_winners,v_winner from public.twf_game_night_players where game_night_id=p_game_night_id and total_score=v_max;
  update public.twf_game_nights set status='completed',winner_id=case when v_winners=1 then v_winner else null end,completed_at=now() where id=p_game_night_id returning * into v_night;
  return v_night;
end; $$;

create or replace function public.twf_advance_game(p_game_night_id uuid,p_next_prompt text default null,p_next_timed boolean default false)
returns public.twf_game_nights language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_night public.twf_game_nights%rowtype;v_game public.twf_selected_games%rowtype;v_round public.twf_rounds%rowtype;v_next_game_id uuid;
  v_scores jsonb;v_max integer;v_winners integer;v_winner uuid;v_last_pos integer;v_next_round integer;v_next_pos integer;v_final_round integer;
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
    select max(position) into v_last_pos from public.twf_selected_games where game_night_id=p_game_night_id;
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
  update public.twf_game_nights set current_game_index=v_next_pos,current_round=v_next_round where id=p_game_night_id returning * into v_night;
  return v_night;
end; $$;

revoke all on function private.twf_set_session_deadline() from public,anon,authenticated;
revoke all on function public.twf_create_game_night(text[],text,text,integer,integer) from public,anon;
revoke all on function public.twf_set_number_secret(uuid,integer) from public,anon;
revoke all on function public.twf_make_number_guess(uuid,integer) from public,anon;
revoke all on function public.twf_respond_number_guess(uuid,text) from public,anon;
revoke all on function public.twf_finish_timed_game_night(uuid) from public,anon;
grant execute on function public.twf_create_game_night(text[],text,text,integer,integer) to authenticated;
grant execute on function public.twf_set_number_secret(uuid,integer) to authenticated;
grant execute on function public.twf_make_number_guess(uuid,integer) to authenticated;
grant execute on function public.twf_respond_number_guess(uuid,text) to authenticated;
grant execute on function public.twf_finish_timed_game_night(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.twf_number_guesses;
exception when duplicate_object then null; end $$;
