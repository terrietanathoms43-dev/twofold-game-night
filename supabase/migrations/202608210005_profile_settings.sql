create or replace function public.twf_set_display_name(p_display_name text)
returns public.twf_profiles language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.twf_profiles;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  p_display_name := trim(p_display_name);
  if length(p_display_name) < 2 or length(p_display_name) > 40 then raise exception 'Display name must be between 2 and 40 characters'; end if;
  update public.twf_profiles set display_name=p_display_name,updated_at=now() where id=auth.uid() returning * into v_profile;
  if not found then raise exception 'Profile not found'; end if;
  return v_profile;
end; $$;
revoke all on function public.twf_set_display_name(text) from public, anon;
grant execute on function public.twf_set_display_name(text) to authenticated;
