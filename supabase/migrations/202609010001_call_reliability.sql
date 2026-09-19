alter table public.twf_call_invites
  drop constraint if exists twf_call_invites_status_check;

alter table public.twf_call_invites
  add constraint twf_call_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'ended', 'missed'));

update public.twf_call_invites
set status = 'missed', ended_at = coalesce(ended_at, expires_at)
where status = 'pending' and expires_at <= now();

create index if not exists twf_call_invites_pending_expiry_idx
  on public.twf_call_invites(expires_at)
  where status = 'pending';
