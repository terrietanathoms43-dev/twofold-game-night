create or replace function private.twf_can_access_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource_id uuid;
begin
  if p_topic ~ '^twf-couple:[0-9a-f-]{36}:call$' then
    v_resource_id := split_part(p_topic, ':', 2)::uuid;
    return exists (
      select 1
      from public.twf_couples c
      where c.id = v_resource_id
        and (select auth.uid()) in (c.member_one, c.member_two)
    );
  end if;

  if p_topic ~ '^twf-room:[0-9a-f-]{36}:call$' then
    v_resource_id := split_part(p_topic, ':', 2)::uuid;
    return exists (
      select 1
      from public.twf_game_nights n
      join public.twf_couples c on c.id = n.couple_id
      where n.id = v_resource_id
        and (select auth.uid()) in (c.member_one, c.member_two)
    );
  end if;

  return false;
exception when others then
  return false;
end;
$$;

revoke all on function private.twf_can_access_realtime_topic(text)
  from public, anon;
grant execute on function private.twf_can_access_realtime_topic(text)
  to authenticated;
