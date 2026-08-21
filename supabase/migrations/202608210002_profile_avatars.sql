alter table public.twf_profiles
  add column if not exists avatar_key text not null default 'heart'
  check (avatar_key in ('heart','sparkle','flower','moon','cherry','cloud','star','gamepad'));

create or replace function public.twf_set_avatar(p_avatar_key text)
returns public.twf_profiles
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile public.twf_profiles%rowtype;
begin
  if p_avatar_key not in ('heart','sparkle','flower','moon','cherry','cloud','star','gamepad') then
    raise exception 'Unknown avatar option';
  end if;
  update public.twf_profiles
  set avatar_key=p_avatar_key,updated_at=now()
  where id=auth.uid()
  returning * into v_profile;
  if not found then raise exception 'Profile not found'; end if;
  return v_profile;
end;
$$;

revoke execute on function public.twf_set_avatar(text) from public,anon;
grant execute on function public.twf_set_avatar(text) to authenticated;
