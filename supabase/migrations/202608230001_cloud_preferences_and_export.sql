create table if not exists public.twf_couple_preferences (
  couple_id uuid primary key references public.twf_couples(id) on delete cascade,
  favorites text[] not null default '{}',
  saved_lineups jsonb not null default '[]'::jsonb,
  updated_by uuid not null references public.twf_profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint twf_preferences_favorites_limit check (cardinality(favorites) <= 36),
  constraint twf_preferences_lineups_array check (jsonb_typeof(saved_lineups) = 'array')
);

alter table public.twf_couple_preferences enable row level security;

create policy twf_couple_preferences_read on public.twf_couple_preferences
for select to authenticated using (
  exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

create policy twf_couple_preferences_insert on public.twf_couple_preferences
for insert to authenticated with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

create policy twf_couple_preferences_update on public.twf_couple_preferences
for update to authenticated using (
  exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
) with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.twf_couples c
    where c.id = couple_id and (select auth.uid()) in (c.member_one, c.member_two)
  )
);

grant select, insert, update on public.twf_couple_preferences to authenticated;

create or replace function public.twf_export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_couple uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select id into v_couple from public.twf_couples
  where v_user in (member_one, member_two) limit 1;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.twf_profiles p where p.id = v_user),
    'couple', (select to_jsonb(c) from public.twf_couples c where c.id = v_couple),
    'preferences', (select to_jsonb(p) from public.twf_couple_preferences p where p.couple_id = v_couple),
    'custom_questions', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at) from public.twf_custom_questions q where q.couple_id = v_couple), '[]'::jsonb),
    'game_nights', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.twf_game_nights n where n.couple_id = v_couple), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.twf_couple_messages m where m.couple_id = v_couple), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(to_jsonb(i) - 'description' order by i.created_at) from public.twf_call_invites i where i.couple_id = v_couple), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.twf_export_my_data() from public, anon;
grant execute on function public.twf_export_my_data() to authenticated;
