create table if not exists public.twf_client_errors (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.twf_profiles(id) on delete cascade,
  message text not null check (length(message) between 1 and 500),
  source text not null check (source in ('window_error','unhandled_rejection','react_boundary','call')),
  route text not null default '/',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists twf_client_errors_created_idx on public.twf_client_errors(created_at desc);
alter table public.twf_client_errors enable row level security;
create policy twf_client_errors_own_insert on public.twf_client_errors
for insert to authenticated with check (user_id = (select auth.uid()));
grant insert on public.twf_client_errors to authenticated;

create or replace function public.twf_log_client_error(p_message text, p_source text, p_route text default '/', p_context jsonb default '{}'::jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.twf_client_errors(user_id,message,source,route,context)
  values(auth.uid(),left(coalesce(p_message,'Unknown error'),500),p_source,left(coalesce(p_route,'/'),300),coalesce(p_context,'{}'::jsonb));
end;
$$;
revoke all on function public.twf_log_client_error(text,text,text,jsonb) from public, anon;
grant execute on function public.twf_log_client_error(text,text,text,jsonb) to authenticated;
