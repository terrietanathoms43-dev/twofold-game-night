alter table public.twf_profiles add column if not exists avatar_url text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('twf-avatars','twf-avatars',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists twf_avatar_insert_own on storage.objects;
create policy twf_avatar_insert_own on storage.objects for insert to authenticated
with check(bucket_id='twf-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists twf_avatar_update_own on storage.objects;
create policy twf_avatar_update_own on storage.objects for update to authenticated
using(bucket_id='twf-avatars' and owner_id=auth.uid()::text)
with check(bucket_id='twf-avatars' and owner_id=auth.uid()::text);
drop policy if exists twf_avatar_delete_own on storage.objects;
create policy twf_avatar_delete_own on storage.objects for delete to authenticated
using(bucket_id='twf-avatars' and owner_id=auth.uid()::text);
drop policy if exists twf_avatar_read_couple on storage.objects;
create policy twf_avatar_read_couple on storage.objects for select to authenticated using(
  bucket_id='twf-avatars' and exists(
    select 1 from public.twf_profiles p where p.id::text=(storage.foldername(name))[1] and (
      p.id=auth.uid() or exists(select 1 from public.twf_couples c where auth.uid() in(c.member_one,c.member_two) and p.id in(c.member_one,c.member_two))
    )
  )
);

create or replace function public.twf_set_profile_photo(p_avatar_path text)
returns public.twf_profiles language plpgsql security definer set search_path=public,pg_temp as $$
declare v_profile public.twf_profiles;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_avatar_path is not null and (p_avatar_path !~ ('^'||auth.uid()::text||'/[A-Za-z0-9._-]+$') or length(p_avatar_path)>300) then raise exception 'Invalid profile photo path'; end if;
  update twf_profiles set avatar_url=p_avatar_path,updated_at=now() where id=auth.uid() returning * into v_profile;
  return v_profile;
end; $$;

create table if not exists public.twf_creative_ratings(
  round_id uuid not null references public.twf_rounds(id) on delete cascade,
  voter_id uuid not null references public.twf_profiles(id) on delete cascade,
  target_id uuid not null references public.twf_profiles(id) on delete cascade,
  rating integer not null check(rating between 1 and 3),
  created_at timestamptz not null default now(),
  primary key(round_id,voter_id),
  check(voter_id<>target_id)
);
alter table public.twf_creative_ratings enable row level security;
drop policy if exists twf_ratings_couple_read on public.twf_creative_ratings;
create policy twf_ratings_couple_read on public.twf_creative_ratings for select to authenticated using(
  exists(select 1 from twf_rounds r join twf_selected_games sg on sg.id=r.selected_game_id join twf_game_nights n on n.id=sg.game_night_id join twf_couples c on c.id=n.couple_id where r.id=round_id and auth.uid() in(c.member_one,c.member_two))
);

create or replace function public.twf_rate_creative_answer(p_round_id uuid,p_target_id uuid,p_rating integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_night uuid;v_key text;v_status text;
begin
  if p_rating not between 1 and 3 then raise exception 'Rating must be 1 to 3'; end if;
  select sg.game_night_id,sg.game_key,r.status into v_night,v_key,v_status from twf_rounds r join twf_selected_games sg on sg.id=r.selected_game_id where r.id=p_round_id;
  if v_status<>'revealed' or v_key not in('draw','caption','story') then raise exception 'This round cannot be rated'; end if;
  if not exists(select 1 from twf_game_night_players where game_night_id=v_night and user_id=auth.uid()) or not exists(select 1 from twf_game_night_players where game_night_id=v_night and user_id=p_target_id) or auth.uid()=p_target_id then raise exception 'Invalid rating'; end if;
  if not exists(select 1 from twf_answers where round_id=p_round_id and user_id=p_target_id) then raise exception 'Answer not found'; end if;
  insert into twf_creative_ratings(round_id,voter_id,target_id,rating) values(p_round_id,auth.uid(),p_target_id,p_rating)
  on conflict(round_id,voter_id) do update set target_id=excluded.target_id,rating=excluded.rating,created_at=now();
  update twf_answers a set points=coalesce((select sum(cr.rating)*25 from twf_creative_ratings cr where cr.round_id=p_round_id and cr.target_id=a.user_id),0) where a.round_id=p_round_id;
  update twf_game_night_players p set total_score=coalesce((select sum(a.points) from twf_answers a join twf_rounds r on r.id=a.round_id join twf_selected_games sg on sg.id=r.selected_game_id where sg.game_night_id=v_night and a.user_id=p.user_id),0) where p.game_night_id=v_night;
end; $$;

revoke all on function public.twf_set_profile_photo(text) from public,anon;
revoke all on function public.twf_rate_creative_answer(uuid,uuid,integer) from public,anon;
grant execute on function public.twf_set_profile_photo(text) to authenticated;
grant execute on function public.twf_rate_creative_answer(uuid,uuid,integer) to authenticated;
