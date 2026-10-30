-- Bet with Friends, migration 004: counter offers.
-- Run once in the Supabase SQL Editor, after 003.
--
-- Instead of accepting or declining a bet sent to you, you can counter it:
-- change the bet, the sides, the stakes, the deadline or the fine print and
-- send it back. The other person can then accept, decline or counter again.
-- Counters work on open bets too: countering one takes it off the board while
-- the two of you work it out, and it goes back up if either of you declines.
--
-- Every version of the terms is kept in bet_offers, so the bet page can show
-- how the back-and-forth went.

-- ============================================================
-- Whose turn it is
-- ============================================================

-- proposed_by: who made the offer now on the table (status 'proposed').
-- The other person answers it. counters: how many counters so far.
alter table public.bets
  add column proposed_by uuid references public.profiles (id),
  add column counters integer not null default 0;
update public.bets set proposed_by = creator_id where status = 'proposed';

create function public.bets_set_proposer() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'proposed' then new.proposed_by := new.creator_id; end if;
  return new;
end;
$$;

create trigger bets_set_proposer
  before insert on public.bets
  for each row execute function public.bets_set_proposer();

-- ============================================================
-- Offer history
-- ============================================================

-- kind: 'proposal' (the original bet), 'counter', or 'reposted' (a declined
-- counter on an open bet put the original terms back on the board).
create table public.bet_offers (
  id               bigint generated always as identity primary key,
  bet_id           bigint not null references public.bets (id) on delete cascade,
  kind             text not null check (kind in ('proposal', 'counter', 'reposted')),
  offered_by       uuid not null references public.profiles (id),
  opponent_id      uuid references public.profiles (id),
  title            text not null,
  details          text not null,
  creator_side     text not null,
  opponent_side    text not null,
  creator_points   integer not null,
  opponent_points  integer not null,
  settle_by        date,
  created_at       timestamptz not null default now()
);
create index bet_offers_bet on public.bet_offers (bet_id);

-- Existing bets start their history with their current terms.
insert into public.bet_offers (
  bet_id, kind, offered_by, opponent_id, title, details, creator_side, opponent_side,
  creator_points, opponent_points, settle_by, created_at
)
select id, 'proposal', creator_id, case when status = 'open' then null else opponent_id end, title, details,
       creator_side, opponent_side, creator_points, opponent_points, settle_by, created_at
from public.bets
order by id;

alter table public.bet_offers enable row level security;
revoke all on public.bet_offers from anon, authenticated;
grant select on public.bet_offers to authenticated;

create policy "See offers in your groups" on public.bet_offers
  for select to authenticated
  using (exists (select 1 from public.bets b where b.id = bet_id and public.is_group_member(b.group_id)));

-- New bets record their opening terms automatically.
create function public.bets_record_proposal() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.bet_offers (
    bet_id, kind, offered_by, opponent_id, title, details, creator_side, opponent_side,
    creator_points, opponent_points, settle_by
  )
  values (
    new.id, 'proposal', new.creator_id, new.opponent_id, new.title, new.details, new.creator_side,
    new.opponent_side, new.creator_points, new.opponent_points, new.settle_by
  );
  return new;
end;
$$;

create trigger bets_record_proposal
  after insert on public.bets
  for each row execute function public.bets_record_proposal();

-- ============================================================
-- Countering
-- ============================================================

-- Sides and stakes are given from the creator's point of view, like create_bet.
create function public.counter_bet(
  p_bet_id bigint,
  p_title text,
  p_creator_side text,
  p_opponent_side text,
  p_creator_points integer,
  p_opponent_points integer,
  p_details text default '',
  p_settle_by date default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  b public.bets;
begin
  if uid is null then raise exception 'Please log in.'; end if;

  -- Lock the row so a counter and an accept can't cross in the mail.
  select * into b from public.bets where id = p_bet_id for update;
  if not found or not public.is_group_member(b.group_id) then raise exception 'Bet not found.'; end if;

  if b.status = 'open' then
    if b.creator_id = uid then raise exception 'You can''t counter your own bet.'; end if;
  elsif b.status = 'proposed' then
    if uid is distinct from b.creator_id and uid is distinct from b.opponent_id then
      raise exception 'Only the two people in a bet can counter it.';
    end if;
    if b.proposed_by = uid then raise exception 'It''s their turn. Wait for them to answer your offer.'; end if;
  else
    raise exception 'Only bets that haven''t been accepted yet can be countered.';
  end if;

  p_title := btrim(coalesce(p_title, ''));
  p_creator_side := btrim(coalesce(p_creator_side, ''));
  p_opponent_side := btrim(coalesce(p_opponent_side, ''));
  p_details := btrim(coalesce(p_details, ''));
  if char_length(p_title) not between 1 and 120 then raise exception 'Say what the bet is (up to 120 characters).'; end if;
  if char_length(p_creator_side) not between 1 and 120 or char_length(p_opponent_side) not between 1 and 120 then
    raise exception 'Fill in both sides (up to 120 characters each).';
  end if;
  if char_length(p_details) > 1000 then raise exception 'Fine print must be at most 1000 characters.'; end if;
  if p_creator_points is null or p_creator_points not between 1 and 1000
     or p_opponent_points is null or p_opponent_points not between 1 and 1000 then
    raise exception 'Each side puts up a whole number of points from 1 to 1000.';
  end if;

  if p_title = b.title and p_details = b.details and p_creator_side = b.creator_side
     and p_opponent_side = b.opponent_side and p_creator_points = b.creator_points
     and p_opponent_points = b.opponent_points and p_settle_by is not distinct from b.settle_by then
    raise exception 'Change something first, or accept the bet as it is.';
  end if;

  update public.bets
  set title = p_title, details = p_details, creator_side = p_creator_side, opponent_side = p_opponent_side,
      creator_points = p_creator_points, opponent_points = p_opponent_points, settle_by = p_settle_by,
      opponent_id = coalesce(b.opponent_id, uid), status = 'proposed', proposed_by = uid,
      counters = b.counters + 1
  where id = b.id;

  insert into public.bet_offers (
    bet_id, kind, offered_by, opponent_id, title, details, creator_side, opponent_side,
    creator_points, opponent_points, settle_by
  )
  values (
    b.id, 'counter', uid, coalesce(b.opponent_id, uid), p_title, p_details, p_creator_side, p_opponent_side,
    p_creator_points, p_opponent_points, p_settle_by
  );
end;
$$;

-- Same as 002, except a proposal is answered by whoever didn't make the
-- current offer, and declining a counter on an open bet puts the original
-- back on the board.
create or replace function public.bet_action(p_bet_id bigint, p_action text, p_winner text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  b public.bets;
  original public.bet_offers;
  is_creator boolean;
  is_opponent boolean;
  my_turn boolean;
  claimed text;
begin
  if uid is null then raise exception 'Please log in.'; end if;

  -- Lock the row so two people tapping at once are handled one at a time.
  -- For open bets this is what guarantees only one person can take it.
  select * into b from public.bets where id = p_bet_id for update;
  if not found or not public.is_group_member(b.group_id) then raise exception 'Bet not found.'; end if;

  is_creator := b.creator_id = uid;
  is_opponent := b.opponent_id is not distinct from uid;
  my_turn := b.status = 'proposed' and (is_creator or is_opponent) and b.proposed_by is distinct from uid;

  if p_action = 'take' then
    if b.status = 'cancelled' then raise exception 'This bet was cancelled.'; end if;
    if b.status = 'proposed' then raise exception 'Someone is working out a counter on this bet right now.'; end if;
    if b.status <> 'open' then raise exception 'Someone already took this bet.'; end if;
    if is_creator then raise exception 'You can''t take your own bet.'; end if;
    update public.bets set opponent_id = uid, status = 'active', accepted_at = now() where id = b.id;
    return;
  end if;

  if not (is_creator or is_opponent) then raise exception 'Only the two people in a bet can change it.'; end if;

  if p_action = 'accept' and my_turn then
    update public.bets set status = 'active', accepted_at = now() where id = b.id;

  elsif p_action = 'decline' and my_turn then
    select * into original from public.bet_offers where bet_id = b.id order by id limit 1;
    if found and original.opponent_id is null then
      -- It started as an open bet: put the original terms back on the board.
      update public.bets
      set status = 'open', opponent_id = null, proposed_by = null, counters = 0,
          title = original.title, details = original.details, creator_side = original.creator_side,
          opponent_side = original.opponent_side, creator_points = original.creator_points,
          opponent_points = original.opponent_points, settle_by = original.settle_by
      where id = b.id;
      insert into public.bet_offers (
        bet_id, kind, offered_by, opponent_id, title, details, creator_side, opponent_side,
        creator_points, opponent_points, settle_by
      )
      values (
        b.id, 'reposted', uid, null, original.title, original.details, original.creator_side,
        original.opponent_side, original.creator_points, original.opponent_points, original.settle_by
      );
    else
      update public.bets set status = 'declined' where id = b.id;
    end if;

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

-- ============================================================
-- Notifications
-- ============================================================

-- "Sam countered your bet" to whoever's turn it now is.
create function public.bet_offers_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  b public.bets;
  actor text;
  recipient uuid;
  mine integer;
  theirs integer;
begin
  if new.kind <> 'counter' then return new; end if;
  select * into b from public.bets where id = new.bet_id;
  select display_name into actor from public.profiles where id = new.offered_by;
  recipient := case when new.offered_by = b.creator_id then b.opponent_id else b.creator_id end;
  mine := case when recipient = b.creator_id then new.creator_points else new.opponent_points end;
  theirs := case when recipient = b.creator_id then new.opponent_points else new.creator_points end;
  perform public.queue_push(
    recipient,
    actor || case when b.counters > 1 then ' countered again' else ' countered your bet' end,
    new.title || ' · You''d put up ' || mine || ' to win ' || theirs || '.',
    '/bets/' || b.id,
    'bet-' || b.id);
  return new;
end;
$$;

create trigger bet_offers_notify
  after insert on public.bet_offers
  for each row execute function public.bet_offers_notify();

-- Same as 003, except accepting and declining can now come from either side
-- (whoever answers a counter), so both people are told, never the one acting.
create or replace function public.bets_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  creator_name text;
  opponent_name text;
  actor_name text;
  route constant text := '/bets/' || new.id;
  tag constant text := 'bet-' || new.id;
  reporter uuid;
  other uuid;
  claim text;
  winner uuid;
  loser uuid;
  won integer;
begin
  select display_name into creator_name from public.profiles where id = new.creator_id;
  select display_name into opponent_name from public.profiles where id = new.opponent_id;
  select coalesce(display_name, 'They') into actor_name from public.profiles where id = (select auth.uid());
  actor_name := coalesce(actor_name, 'They');

  if tg_op = 'INSERT' then
    if new.status = 'proposed' then
      perform public.queue_push(
        new.opponent_id,
        creator_name || ' bet you',
        new.title || ' · You''d put up ' || new.opponent_points || ' to win ' || new.creator_points || '.',
        route, tag);
    elsif new.status = 'open' then
      perform public.queue_push(
        m.user_id,
        creator_name || ' put up a bet',
        new.title || ' · ' || creator_name || ' has ' || new.creator_side || '. Take the other side to win '
          || new.creator_points || '.',
        route, tag)
      from public.group_members m
      where m.group_id = new.group_id and m.user_id <> new.creator_id;
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then return new; end if;

  if new.status = 'active' then
    if old.status = 'open' then
      perform public.queue_push(new.creator_id, opponent_name || ' took your bet', new.title || ' · It''s on.', route, tag);
    else
      perform public.queue_push(
        p,
        actor_name || case when new.counters > 0 then ' accepted your counter' else ' accepted your bet' end,
        new.title || ' · It''s on.',
        route, tag)
      from unnest(array[new.creator_id, new.opponent_id]) p;
    end if;

  elsif new.status = 'declined' then
    perform public.queue_push(p, actor_name || ' declined the bet', new.title, route, tag)
    from unnest(array[new.creator_id, new.opponent_id]) p;

  elsif new.status = 'open' and old.status = 'proposed' then
    perform public.queue_push(p, actor_name || ' passed on the counter', new.title || ' · It''s back on the board.', route, tag)
    from unnest(array[new.creator_id, old.opponent_id]) p;

  elsif new.status = 'cancelled' and old.status = 'proposed' then
    perform public.queue_push(new.opponent_id, creator_name || ' called off their bet', new.title, route, tag);

  elsif new.status = 'reported' then
    reporter := new.outcome_reported_by;
    other := case when reporter = new.creator_id then new.opponent_id else new.creator_id end;
    claim := case
      when new.outcome = 'push' then ' called it a push'
      when (new.outcome = 'creator') = (reporter = new.creator_id) then ' says they won'
      else ' says you won'
    end;
    perform public.queue_push(
      other,
      (case when reporter = new.creator_id then creator_name else opponent_name end) || claim,
      new.title || ' · Confirm or dispute it.',
      route, tag);

  elsif new.status = 'disputed' then
    reporter := new.outcome_reported_by;
    perform public.queue_push(
      reporter,
      (case when reporter = new.creator_id then opponent_name else creator_name end) || ' disputed the result',
      new.title || ' · Talk it out, then report it again.',
      route, tag);

  elsif new.status = 'settled' then
    if new.outcome = 'push' then
      perform public.queue_push(p, 'It''s a push', new.title || ' · Nobody gains or loses points.', route, tag)
      from unnest(array[new.creator_id, new.opponent_id]) p;
    else
      winner := case when new.outcome = 'creator' then new.creator_id else new.opponent_id end;
      loser := case when new.outcome = 'creator' then new.opponent_id else new.creator_id end;
      -- The winner collects whatever the loser put up.
      won := case when new.outcome = 'creator' then new.opponent_points else new.creator_points end;
      perform public.queue_push(winner, 'You won ' || won || ' pts 🎉', new.title, route, tag);
      perform public.queue_push(loser, 'You lost ' || won || ' pts', new.title || ' · Win them back.', route, tag);
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- Permissions
-- ============================================================

revoke execute on function
  public.bets_set_proposer(),
  public.bets_record_proposal(),
  public.bet_offers_notify(),
  public.counter_bet(bigint, text, text, text, integer, integer, text, date)
  from public, anon, authenticated;
grant execute on function public.counter_bet(bigint, text, text, text, integer, integer, text, date) to authenticated;
