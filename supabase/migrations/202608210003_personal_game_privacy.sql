drop policy if exists twf_profiles_read_self_or_partner on public.twf_profiles;
create policy twf_profiles_read_self_or_partner on public.twf_profiles
for select to authenticated
using (
  id = (select auth.uid()) or exists (
    select 1 from public.twf_couples c
    where (c.member_one=(select auth.uid()) and c.member_two=twf_profiles.id)
       or (c.member_two=(select auth.uid()) and c.member_one=twf_profiles.id)
  )
);

drop policy if exists twf_answers_members_read on public.twf_answers;
create policy twf_answers_hidden_until_reveal on public.twf_answers
for select to authenticated
using (
  user_id=(select auth.uid()) or exists (
    select 1 from public.twf_rounds r
    join public.twf_selected_games sg on sg.id=r.selected_game_id
    where r.id=twf_answers.round_id
      and r.status='revealed'
      and twofold_private.can_access_night(sg.game_night_id)
  )
);

drop policy if exists twf_custom_members_all on public.twf_custom_questions;
create policy twf_custom_members_read on public.twf_custom_questions
for select to authenticated using (twofold_private.is_couple_member(couple_id));
create policy twf_custom_own_insert on public.twf_custom_questions
for insert to authenticated with check (twofold_private.is_couple_member(couple_id) and created_by=(select auth.uid()));
create policy twf_custom_own_update on public.twf_custom_questions
for update to authenticated using (created_by=(select auth.uid())) with check (created_by=(select auth.uid()));
create policy twf_custom_own_delete on public.twf_custom_questions
for delete to authenticated using (created_by=(select auth.uid()));

alter table public.twf_custom_questions drop constraint if exists twf_custom_question_length;
alter table public.twf_custom_questions add constraint twf_custom_question_length check (length(trim(question)) between 3 and 240);

create or replace function private.twf_personal_round_scoring()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_game_key text;
  v_night_id uuid;
  v_target uuid;
  v_same boolean;
begin
  if old.status='revealed' or new.status<>'revealed' then return new; end if;
  select sg.game_key,sg.game_night_id into v_game_key,v_night_id
  from public.twf_selected_games sg where sg.id=new.selected_game_id;
  if v_game_key<>'knows' then return new; end if;
  select case when new.round_number % 2=0 then c.member_one else c.member_two end into v_target
  from public.twf_game_nights gn join public.twf_couples c on c.id=gn.couple_id where gn.id=v_night_id;
  select count(*)=2 and count(distinct regexp_replace(lower(trim(a.answer->>'value')),'[^a-z0-9]+','','g'))=1 into v_same
  from public.twf_answers a where a.round_id=new.id;
  update public.twf_answers set points=case when user_id=v_target then 25 when v_same then 100 else 0 end where round_id=new.id;
  return new;
end;
$$;

drop trigger if exists twf_personal_round_scoring on public.twf_rounds;
create trigger twf_personal_round_scoring after update of status on public.twf_rounds
for each row execute function private.twf_personal_round_scoring();
revoke all on function private.twf_personal_round_scoring() from public,anon,authenticated;
