create table if not exists public.twf_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.twf_profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists twf_push_subscriptions_user_idx
  on public.twf_push_subscriptions(user_id);

alter table public.twf_push_subscriptions enable row level security;

create policy twf_push_subscriptions_own_read on public.twf_push_subscriptions
for select to authenticated using ((select auth.uid()) = user_id);

create policy twf_push_subscriptions_own_insert on public.twf_push_subscriptions
for insert to authenticated with check ((select auth.uid()) = user_id);

create policy twf_push_subscriptions_own_update on public.twf_push_subscriptions
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy twf_push_subscriptions_own_delete on public.twf_push_subscriptions
for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.twf_push_subscriptions to authenticated;
