-- Bet with Friends, migration 002: open bets and uneven odds.
-- Run once in the Supabase SQL Editor, after 001.
--
-- Open bets: post a bet to your group without picking an opponent. It sits on
-- the group's board with status 'open' until one member takes the other side.
--
-- Odds: each side puts up its own stake (creator_points, opponent_points).
-- The winner collects the loser's stake. So backing a long shot can mean
-- risking 10 to win 50.

-- ============================================================
-- Stakes
-- ============================================================

alter table public.bets rename column points to creator_points;
alter table public.bets rename constraint bets_points_check to bets_creator_points_check;
alter table public.bets add column opponent_points integer;
update public.bets set opponent_points = creator_points;
alter table public.bets
  alter column opponent_points set not null,
  add constraint bets_opponent_points_check check (opponent_points between 1 and 1000);

-- ============================================================
-- Open bets
-- ============================================================

alter table public.bets alter column opponent_id drop not null;

alter table public.bets drop constraint bets_status_check;
alter table public.bets add constraint bets_status_check
  check (status in ('open', 'proposed', 'declined', 'cancelled', 'active', 'reported', 'disputed', 'settled'));

-- Open bets have no opponent yet; a cancelled bet may never have had one;
-- every other bet has one.
alter table public.bets add constraint bets_opponent_matches_status check (
  case
    when status = 'open' then opponent_id is null
    when status = 'cancelled' then true
    else opponent_id is not null
  end
);

-- ============================================================
-- Functions
-- ============================================================

drop function public.create_bet(bigint, uuid, text, text, text, integer, text, date);

-- p_opponent_id null posts an open bet to the group's board.
create function public.create_bet(
  p_group_id bigint,
  p_opponent_id uuid,
  p_title text,
  p_creator_side text,
  p_opponent_side text,
  p_creator_points integer,
  p_opponent_points integer,
  p_details text default '',
  p_settle_by date default null
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  new_id bigint;
begin
  if uid is null then raise exception 'Please log in.'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'Group not found.'; end if;
  if p_opponent_id = uid then raise exception 'You can''t bet against yourself.'; end if;
  if p_opponent_id is not null
     and not exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_opponent_id) then
    raise exception 'Pick someone in this group to bet against.';
  end if;

  p_title := btrim(coalesce(p_title, ''));
  p_creator_side := btrim(coalesce(p_creator_side, ''));
  p_opponent_side := btrim(coalesce(p_opponent_side, ''));
  p_details := btrim(coalesce(p_details, ''));
  if char_length(p_title) not between 1 and 120 then raise exception 'Say what the bet is (up to 120 characters).'; end if;
  if char_length(p_creator_side) not between 1 and 120 then raise exception 'Fill in your side (up to 120 characters).'; end if;
  if char_length(p_opponent_side) not between 1 and 120 then raise exception 'Fill in the other side (up to 120 characters).'; end if;
  if char_length(p_details) > 1000 then raise exception 'Fine print must be at most 1000 characters.'; end if;
  if p_creator_points is null or p_creator_points not between 1 and 1000
     or p_opponent_points is null or p_opponent_points not between 1 and 1000 then
    raise exception 'Each side puts up a whole number of points from 1 to 1000.';
  end if;

  insert into public.bets (
    group_id, creator_id, opponent_id, title, details, creator_side, opponent_side,
    creator_points, opponent_points, settle_by, status
  )
  values (
    p_group_id, uid, p_opponent_id, p_title, p_details, p_creator_side, p_opponent_side,
    p_creator_points, p_opponent_points, p_settle_by,
    case when p_opponent_id is null then 'open' else 'proposed' end
  )
  returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.create_bet(bigint, uuid, text, text, text, integer, integer, text, date)
  from public, anon, authenticated;
grant execute on function public.create_bet(bigint, uuid, text, text, text, integer, integer, text, date)
  to authenticated;

-- Same as 001, plus 'take' (any other member claims an open bet) and 'cancel'
-- for open bets. Same signature, so its permissions carry over.
create or replace function public.bet_action(p_bet_id bigint, p_action text, p_winner text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  b public.bets;
  is_creator boolean;
  is_opponent boolean;
  claimed text;
begin
  if uid is null then raise exception 'Please log in.'; end if;

  -- Lock the row so two people tapping at once are handled one at a time.
  -- For open bets this is what guarantees only one person can take it.
  select * into b from public.bets where id = p_bet_id for update;
  if not found or not public.is_group_member(b.group_id) then raise exception 'Bet not found.'; end if;

  is_creator := b.creator_id = uid;
  is_opponent := b.opponent_id is not distinct from uid;

  if p_action = 'take' then
    if b.status = 'cancelled' then raise exception 'This bet was cancelled.'; end if;
    if b.status <> 'open' then raise exception 'Someone already took this bet.'; end if;
    if is_creator then raise exception 'You can''t take your own bet.'; end if;
    update public.bets set opponent_id = uid, status = 'active', accepted_at = now() where id = b.id;
    return;
  end if;

  if not (is_creator or is_opponent) then raise exception 'Only the two people in a bet can change it.'; end if;

  if p_action = 'accept' and b.status = 'proposed' and is_opponent then
    update public.bets set status = 'active', accepted_at = now() where id = b.id;

  elsif p_action = 'decline' and b.status = 'proposed' and is_opponent then
    update public.bets set status = 'declined' where id = b.id;

  elsif p_action = 'cancel' and b.status in ('proposed', 'open') and is_creator then
    update public.bets set status = 'cancelled' where id = b.id;

  elsif p_action = 'report' and b.status in ('active', 'disputed') then
    if p_winner is null or p_winner not in ('me', 'them', 'push') then
      raise exception 'Say who won: me, them or push.';
    end if;
    claimed := case
      when p_winner = 'push' then 'push'
      when (p_winner = 'me') = is_creator then 'creator'
      else 'opponent'
    end;
    if p_winner = 'them' then
      -- Conceding needs no confirmation from the winner.
      update public.bets
      set status = 'settled', outcome = claimed, outcome_reported_by = uid, settled_at = now()
      where id = b.id;
    else
      update public.bets
      set status = 'reported', outcome = claimed, outcome_reported_by = uid
      where id = b.id;
    end if;

  elsif p_action = 'confirm' and b.status = 'reported' and b.outcome_reported_by <> uid then
    update public.bets set status = 'settled', settled_at = now() where id = b.id;

  elsif p_action = 'dispute' and b.status = 'reported' and b.outcome_reported_by <> uid then
    update public.bets set status = 'disputed' where id = b.id;

  else
    raise exception 'That action isn''t available on this bet right now.';
  end if;
end;
$$;
