alter table public.twf_game_nights add column if not exists play_style text not null default 'competitive' check(play_style in('competitive','cooperative'));
alter table public.twf_game_nights add column if not exists difficulty text not null default 'standard' check(difficulty in('easy','standard','hard'));

create or replace function public.twf_create_game_night(p_game_keys text[],p_play_style text default 'competitive',p_difficulty text default 'standard')
returns public.twf_game_nights language plpgsql security definer set search_path=public,pg_temp as $$
declare v_couple public.twf_couples%rowtype;v_night public.twf_game_nights%rowtype;v_key text;
v_allowed constant text[]:=array['knows','guess','likely','would','finish','memory','timeline','said','trivia','riddle','math','word','emoji','memoryChallenge','five','charades','dontsay','truth','describe','draw','caption','story','blindRank','predictions','photoFlashback','wavelength','secretSignal','oneWordStory','matchFive','blitz','spotChange','mysteryDate','voiceImpression','scavenger','playlistMatch','appreciation'];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(cardinality(p_game_keys),0)<1 or cardinality(p_game_keys)>36 then raise exception 'Choose between 1 and 36 games'; end if;
  if p_play_style not in('competitive','cooperative') then raise exception 'Invalid play style'; end if;
  if p_difficulty not in('easy','standard','hard') then raise exception 'Invalid difficulty'; end if;
  if(select count(distinct key) from unnest(p_game_keys) key)<>cardinality(p_game_keys) then raise exception 'Each game can only be selected once'; end if;
  foreach v_key in array p_game_keys loop if not(v_key=any(v_allowed)) then raise exception 'Invalid game selection'; end if; end loop;
  select * into v_couple from public.twf_couples where auth.uid() in(member_one,member_two) for update;
  if not found or v_couple.member_two is null then raise exception 'A linked partner is required'; end if;
  if exists(select 1 from public.twf_game_nights where couple_id=v_couple.id and status in('lobby','playing')) then raise exception 'Resume or cancel the active game night before creating another'; end if;
  insert into public.twf_game_nights(couple_id,created_by,play_style,difficulty) values(v_couple.id,auth.uid(),p_play_style,p_difficulty) returning * into v_night;
  insert into public.twf_game_night_players(game_night_id,user_id,ready) values(v_night.id,auth.uid(),true),(v_night.id,case when auth.uid()=v_couple.member_one then v_couple.member_two else v_couple.member_one end,false);
  insert into public.twf_selected_games(game_night_id,game_key,position) select v_night.id,key,ordinality::integer-1 from unnest(p_game_keys) with ordinality as selected(key,ordinality);
  return v_night;
end; $$;

create table if not exists public.twf_question_reports(
  id uuid primary key default gen_random_uuid(),game_night_id uuid not null references public.twf_game_nights(id) on delete cascade,
  round_id uuid not null references public.twf_rounds(id) on delete cascade,reporter_id uuid not null references public.twf_profiles(id) on delete cascade,
  game_key text not null,prompt text not null check(length(prompt) between 3 and 500),reason text not null check(length(reason) between 3 and 500),created_at timestamptz not null default now()
);
alter table public.twf_question_reports enable row level security;
create policy twf_report_own_insert on public.twf_question_reports for insert to authenticated with check(reporter_id=auth.uid() and exists(select 1 from public.twf_game_night_players p where p.game_night_id=game_night_id and p.user_id=auth.uid()));
create policy twf_report_own_read on public.twf_question_reports for select to authenticated using(reporter_id=auth.uid());
grant select,insert on public.twf_question_reports to authenticated;

create or replace function private.twf_expanded_game_scoring()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text;v_count integer;
begin
  if new.status<>'revealed' or old.status='revealed' then return new; end if;
  select game_key into v_key from public.twf_selected_games where id=new.selected_game_id;
  if v_key in('predictions','wavelength','mysteryDate','playlistMatch','blitz') then
    select count(distinct regexp_replace(lower(trim(answer->>'value')),'[^a-z0-9]+','','g')) into v_count from public.twf_answers where round_id=new.id;
    update public.twf_answers set points=case when v_count=1 then 100 else 0 end where round_id=new.id;
  elsif v_key='matchFive' then
    update public.twf_answers set points=least(125,25*(select count(*) from(
      select lower(trim(x.value)) value from public.twf_answers a cross join lateral regexp_split_to_table(a.answer->>'value','[,;]') as x(value) where a.round_id=new.id group by lower(trim(x.value)) having count(distinct a.user_id)=2
    ) shared)) where round_id=new.id;
  elsif v_key='appreciation' then update public.twf_answers set points=75 where round_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists twf_expanded_game_scoring on public.twf_rounds;
create trigger twf_expanded_game_scoring after update of status on public.twf_rounds for each row execute function private.twf_expanded_game_scoring();

revoke all on function public.twf_create_game_night(text[],text,text) from public,anon;
grant execute on function public.twf_create_game_night(text[],text,text) to authenticated;
revoke all on function private.twf_expanded_game_scoring() from public,anon,authenticated;
