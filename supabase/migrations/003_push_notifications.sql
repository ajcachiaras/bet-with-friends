-- Bet with Friends, migration 003: push notifications.
-- Run once in the Supabase SQL Editor, after 002.
--
-- How it works:
-- 1. Each phone or browser that turns notifications on is saved in
--    push_subscriptions (through save_push_subscription below).
-- 2. When a bet changes or someone comments, triggers write a message for each
--    person who should hear about it into push_outbox. Only people with at
--    least one device get one, and never the person who caused it.
-- 3. A statement trigger on push_outbox pings the send-push Edge Function,
--    which claims the queued messages (claim_push_outbox), sends them, and
--    forgets devices the push service says are gone.
--
-- The ping carries no data. The function only sends what's already queued, so
-- calling it from anywhere is harmless, and it needs no secret of its own.

create extension if not exists pg_net with schema extensions;

-- ============================================================
-- Tables (private: no access for signed-in users or visitors)
-- ============================================================

create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

create table public.push_outbox (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  body        text not null,
  url         text not null,  -- app route to open, e.g. /bets/12
  tag         text,           -- notifications with the same tag replace each other
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index push_outbox_pending on public.push_outbox (id) where sent_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.push_outbox enable row level security;
revoke all on public.push_subscriptions, public.push_outbox from anon, authenticated;

-- ============================================================
-- Turning notifications on and off (called from the app)
-- ============================================================

-- Saves this device for the signed-in user. A device belongs to whoever
-- turned notifications on last, so a shared phone follows its current login.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
begin
  if uid is null then raise exception 'Please log in.'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 1 and 200
     or coalesce(char_length(p_auth), 0) not between 1 and 200 then
    raise exception 'That push subscription doesn''t look right.';
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (uid, p_endpoint, p_p256dh, p_auth);

  -- Keep the 10 most recent devices per person.
  delete from public.push_subscriptions
  where user_id = uid
    and id not in (select id from public.push_subscriptions where user_id = uid order by id desc limit 10);
end;
$$;

create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
$$;

-- ============================================================
-- Writing the messages
-- ============================================================

-- Queues one message for one person, unless they caused it or have no device.
create function public.queue_push(p_user uuid, p_title text, p_body text, p_url text, p_tag text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.push_outbox (user_id, title, body, url, tag)
  select p_user, left(p_title, 120), left(p_body, 240), p_url, p_tag
  where p_user is not null
    and p_user is distinct from (select auth.uid())
    and exists (select 1 from public.push_subscriptions where user_id = p_user);
$$;

create function public.bets_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  creator_name text;
  opponent_name text;
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
    perform public.queue_push(
      new.creator_id,
      opponent_name || case when old.status = 'open' then ' took your bet' else ' accepted your bet' end,
      new.title || ' · It''s on.',
      route, tag);

  elsif new.status = 'declined' then
    perform public.queue_push(new.creator_id, opponent_name || ' declined your bet', new.title, route, tag);

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

create trigger bets_notify
  after insert or update of status on public.bets
  for each row execute function public.bets_notify();

-- Comments go to the two people in the bet (just the poster, while it's open).
create function public.comments_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  b public.bets;
  commenter text;
begin
  select * into b from public.bets where id = new.bet_id;
  select display_name into commenter from public.profiles where id = new.user_id;
  perform public.queue_push(
    p,
    commenter || ' on "' || rtrim(left(b.title, 40)) || case when char_length(b.title) > 40 then '…"' else '"' end,
    new.body,
    '/bets/' || b.id,
    'bet-' || b.id)
  from unnest(array[b.creator_id, b.opponent_id]) p;
  return new;
end;
$$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function public.comments_notify();

-- ============================================================
-- Sending
-- ============================================================

-- Pings the send-push Edge Function when messages were queued: at most once
-- per transaction, and not at all when nobody had a device. pg_net only makes
-- the request after the transaction commits, so the function always sees the
-- new rows. (If you set this up on your own Supabase project, change the
-- project address below.)
create function public.push_outbox_ping() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from queued) then return null; end if;
  if current_setting('bwf.push_pinged', true) = 'yes' then return null; end if;
  perform set_config('bwf.push_pinged', 'yes', true);

  perform net.http_post(
    url := 'https://uzjxghdvhvycalucakok.supabase.co/functions/v1/send-push',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return null;
end;
$$;

create trigger push_outbox_ping
  after insert on public.push_outbox
  referencing new table as queued
  for each statement execute function public.push_outbox_ping();

-- Used by the send-push function. Claims up to 200 waiting messages exactly
-- once (two overlapping calls can't both get the same message) and returns
-- one row per device to send to. Messages that waited over an hour are
-- dropped instead of arriving late, and old history is cleared out.
create function public.claim_push_outbox()
returns table (subscription_id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language sql security definer set search_path = ''
as $$
  delete from public.push_outbox where sent_at < now() - interval '7 days';

  update public.push_outbox set sent_at = now()
  where sent_at is null and created_at < now() - interval '1 hour';

  with claimed as (
    update public.push_outbox o
    set sent_at = now()
    where o.id in (
      select id from public.push_outbox
      where sent_at is null
      order by id
      limit 200
      for update skip locked
    )
    returning o.user_id, o.title, o.body, o.url, o.tag
  )
  select s.id, s.endpoint, s.p256dh, s.auth, c.title, c.body, c.url, c.tag
  from claimed c
  join public.push_subscriptions s on s.user_id = c.user_id;
$$;

-- Also used by send-push: forgets devices the push service says no longer exist.
create function public.delete_push_subscriptions(p_ids bigint[]) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where id = any (p_ids);
$$;

-- ============================================================
-- Permissions
-- ============================================================

revoke execute on function
  public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text),
  public.queue_push(uuid, text, text, text, text),
  public.bets_notify(),
  public.comments_notify(),
  public.push_outbox_ping(),
  public.claim_push_outbox(),
  public.delete_push_subscriptions(bigint[])
  from public, anon, authenticated;

grant execute on function
  public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text)
  to authenticated;

grant execute on function
  public.claim_push_outbox(),
  public.delete_push_subscriptions(bigint[])
  to service_role;
