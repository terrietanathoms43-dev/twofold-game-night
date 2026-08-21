create or replace function public.twf_pick_fresh_prompt(p_game_night_id uuid, p_game_key text, p_candidates text[])
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_couple_id uuid; v_prompt text;
begin
  if coalesce(cardinality(p_candidates),0)=0 or cardinality(p_candidates)>100 then raise exception 'A valid question bank is required'; end if;
  if exists(select 1 from unnest(p_candidates) value where length(trim(value)) not between 3 and 500) then raise exception 'Questions must be between 3 and 500 characters'; end if;
  select n.couple_id into v_couple_id from public.twf_game_nights n join public.twf_couples c on c.id=n.couple_id
  where n.id=p_game_night_id and auth.uid() in(c.member_one,c.member_two);
  if v_couple_id is null then raise exception 'Not a player in this room'; end if;
  select candidate into v_prompt from unnest(p_candidates) candidate where not exists(
    select 1 from public.twf_rounds r join public.twf_selected_games sg on sg.id=r.selected_game_id
    join public.twf_game_nights n on n.id=sg.game_night_id where n.couple_id=v_couple_id and sg.game_key=p_game_key
    and lower(trim(r.prompt->>'text'))=lower(trim(candidate))) order by random() limit 1;
  if v_prompt is null then
    select candidate into v_prompt from unnest(p_candidates) candidate left join lateral(
      select count(*) uses,max(n.created_at) last_used from public.twf_rounds r join public.twf_selected_games sg on sg.id=r.selected_game_id
      join public.twf_game_nights n on n.id=sg.game_night_id where n.couple_id=v_couple_id and sg.game_key=p_game_key
      and lower(trim(r.prompt->>'text'))=lower(trim(candidate))) history on true
    order by history.uses,history.last_used nulls first,random() limit 1;
  end if;
  return v_prompt;
end; $$;

create or replace function public.twf_request_question_skip(p_round_id uuid,p_replacement_prompt text)
returns public.twf_rounds language plpgsql security definer set search_path=public,pg_temp as $$
declare v_round public.twf_rounds%rowtype;
begin
  if length(trim(p_replacement_prompt)) not between 3 and 500 then raise exception 'A replacement question is required'; end if;
  select r.* into v_round from public.twf_rounds r join public.twf_selected_games sg on sg.id=r.selected_game_id
  join public.twf_game_nights n on n.id=sg.game_night_id join public.twf_couples c on c.id=n.couple_id
  where r.id=p_round_id and n.status='playing' and auth.uid() in(c.member_one,c.member_two) for update of r;
  if not found then raise exception 'This round is not available'; end if;
  if v_round.status='revealed' then raise exception 'A revealed question cannot be skipped'; end if;
  if exists(select 1 from public.twf_answers where round_id=p_round_id) then raise exception 'Ask to skip before either player locks an answer'; end if;
  update public.twf_rounds set state=coalesce(state,'{}'::jsonb)||jsonb_build_object('skip_status','requested','skip_requested_by',auth.uid(),'skip_replacement',trim(p_replacement_prompt),'skip_requested_at',now())
  where id=p_round_id returning * into v_round; return v_round;
end; $$;

create or replace function public.twf_respond_question_skip(p_round_id uuid,p_approve boolean)
returns public.twf_rounds language plpgsql security definer set search_path=public,pg_temp as $$
declare v_round public.twf_rounds%rowtype; v_requester uuid; v_replacement text; v_timed boolean;
begin
  select r.* into v_round
  from public.twf_rounds r join public.twf_selected_games sg on sg.id=r.selected_game_id join public.twf_game_nights n on n.id=sg.game_night_id
  join public.twf_couples c on c.id=n.couple_id where r.id=p_round_id and n.status='playing' and auth.uid() in(c.member_one,c.member_two) for update of r;
  if not found then raise exception 'This round is not available'; end if;
  select sg.game_key in('trivia','riddle','math','word','emoji','memoryChallenge','five') into v_timed
  from public.twf_selected_games sg where sg.id=v_round.selected_game_id;
  if v_round.state->>'skip_status'<>'requested' then raise exception 'There is no skip request'; end if;
  v_requester=(v_round.state->>'skip_requested_by')::uuid;
  if v_requester=auth.uid() then raise exception 'Your partner must decide'; end if;
  if not p_approve then
    update public.twf_rounds set state=(coalesce(state,'{}'::jsonb)-'skip_requested_by'-'skip_replacement'-'skip_requested_at')||jsonb_build_object('skip_status','declined','skip_responded_at',now()) where id=p_round_id returning * into v_round; return v_round;
  end if;
  v_replacement=v_round.state->>'skip_replacement';
  delete from public.twf_answers where round_id=p_round_id; delete from public.twf_creative_ratings where round_id=p_round_id;
  update public.twf_rounds set prompt=jsonb_build_object('text',v_replacement),ends_at=case when v_timed then now()+interval '30 seconds' else null end,
  state=(coalesce(state,'{}'::jsonb)-'skip_requested_by'-'skip_replacement'-'skip_requested_at')||jsonb_build_object('skip_status','approved','skip_approved_by',auth.uid(),'skip_responded_at',now())
  where id=p_round_id returning * into v_round; return v_round;
end; $$;

revoke all on function public.twf_pick_fresh_prompt(uuid,text,text[]) from public,anon;
revoke all on function public.twf_request_question_skip(uuid,text) from public,anon;
revoke all on function public.twf_respond_question_skip(uuid,boolean) from public,anon;
grant execute on function public.twf_pick_fresh_prompt(uuid,text,text[]) to authenticated;
grant execute on function public.twf_request_question_skip(uuid,text) to authenticated;
grant execute on function public.twf_respond_question_skip(uuid,boolean) to authenticated;
