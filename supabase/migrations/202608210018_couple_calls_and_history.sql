alter table public.twf_call_invites
  add column if not exists couple_id uuid references public.twf_couples(id) on delete cascade,
  add column if not exists answered_at timestamptz,
  add column if not exists ended_at timestamptz;

update public.twf_call_invites i
set couple_id = n.couple_id
from public.twf_game_nights n
where n.id = i.game_night_id and i.couple_id is null;

alter table public.twf_call_invites alter column couple_id set not null;
alter table public.twf_call_invites alter column game_night_id drop not null;

drop policy if exists twf_call_invites_caller_insert on public.twf_call_invites;
create policy twf_call_invites_caller_insert on public.twf_call_invites
for insert to authenticated with check (
  caller_id = (select auth.uid())
  and caller_id <> recipient_id
  and exists (
    select 1 from public.twf_couples c
    where c.id = couple_id
      and caller_id in (c.member_one,c.member_two)
      and recipient_id in (c.member_one,c.member_two)
  )
  and (
    game_night_id is null
    or exists (
      select 1 from public.twf_game_nights n
      where n.id = game_night_id and n.couple_id = couple_id
    )
  )
);

create index if not exists twf_call_invites_couple_history_idx
  on public.twf_call_invites(couple_id, created_at desc);

