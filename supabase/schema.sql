-- Bet with Friends: the whole database for a fresh Supabase project.
-- Paste this file into the Supabase SQL Editor and click Run (once).
--
-- How it's secured: everyone signed in can read rows only from groups they
-- belong to (row level security). All changes to groups and bets go through
-- the functions at the bottom, which check who's asking and enforce the bet
-- rules, so nobody can, say, mark their own bet as won.

-- ============================================================
-- Tables
-- ============================================================

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  created_at    timestamptz not null default now()
);

create table public.bet_groups (
  id           bigint generated always as identity primary key,
  name         text not null check (char_length(name) between 1 and 50),
  invite_code  text not null unique,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);

create table public.group_members (
  group_id   bigint not null references public.bet_groups (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user on public.group_members (user_id);

-- status: proposed -> active -> reported -> settled
--         proposed -> declined | cancelled;  reported -> disputed -> reported
-- outcome: 'creator' | 'opponent' | 'push' (the reported result while
-- status = 'reported', the final result once settled)
create table public.bets (
  id                   bigint generated always as identity primary key,
  group_id             bigint not null references public.bet_groups (id) on delete cascade,
  creator_id           uuid not null references public.profiles (id),
  opponent_id          uuid not null references public.profiles (id),
  title                text not null check (char_length(title) between 1 and 120),
  details              text not null default '' check (char_length(details) <= 1000),
  creator_side         text not null check (char_length(creator_side) between 1 and 120),
  opponent_side        text not null check (char_length(opponent_side) between 1 and 120),
  points               integer not null check (points between 1 and 1000),
  settle_by            date,
  status               text not null default 'proposed'
                         check (status in ('proposed', 'declined', 'cancelled', 'active', 'reported', 'disputed', 'settled')),
  outcome              text check (outcome in ('creator', 'opponent', 'push')),
  outcome_reported_by  uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  accepted_at          timestamptz,
  settled_at           timestamptz,
  check (creator_id <> opponent_id)
);
create index bets_group on public.bets (group_id);
create index bets_creator on public.bets (creator_id);
create index bets_opponent on public.bets (opponent_id);

create table public.comments (
  id          bigint generated always as identity primary key,
  bet_id      bigint not null references public.bets (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id),
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index comments_bet on public.comments (bet_id);

-- ============================================================
-- New accounts get a profile automatically
-- ============================================================

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 40)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Who can see what (row level security)
-- ============================================================

-- These run with the owner's rights so policies on group_members can look at
-- group_members without recursing into their own policy.
create function public.is_group_member(gid bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid())
  );
$$;

create function public.shares_group_with(other uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

alter table public.profiles enable row level security;
alter table public.bet_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.bets enable row level security;
alter table public.comments enable row level security;

create policy "See yourself and people in your groups" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id));

create policy "Edit your own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "See groups you're in" on public.bet_groups
  for select to authenticated
  using (public.is_group_member(id));

create policy "See members of your groups" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "See bets in your groups" on public.bets
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "See comments in your groups" on public.comments
  for select to authenticated
  using (exists (select 1 from public.bets b where b.id = bet_id and public.is_group_member(b.group_id)));

create policy "Comment as yourself in your groups" on public.comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.bets b where b.id = bet_id and public.is_group_member(b.group_id))
  );

-- Supabase no longer grants table access automatically, so spell it out.
-- Signed-out visitors (anon) get nothing. Signed-in users can read (filtered
-- by the policies above), rename themselves and post comments. Everything
-- else goes through the functions below.
revoke all on public.profiles, public.bet_groups, public.group_members, public.bets, public.comments
  from anon, authenticated;
grant select on public.profiles, public.bet_groups, public.group_members, public.bets, public.comments
  to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert (bet_id, body) on public.comments to authenticated;

-- ============================================================
-- Actions (called from the app with supabase.rpc)
-- ============================================================

create function public.create_group(group_name text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  bytes bytea;
  new_id bigint;
begin
  if uid is null then raise exception 'Please log in.'; end if;
  group_name := btrim(coalesce(group_name, ''));
  if char_length(group_name) not between 1 and 50 then
    raise exception 'Group name must be 1-50 characters.';
  end if;

  -- Six characters from an alphabet without look-alikes (no 0/O, 1/I/L),
  -- using gen_random_uuid() as a source of strong randomness.
  loop
    bytes := uuid_send(gen_random_uuid());
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + get_byte(bytes, i) % char_length(alphabet), 1);
    end loop;
    exit when not exists (select 1 from public.bet_groups where invite_code = code);
  end loop;

  insert into public.bet_groups (name, invite_code, created_by)
  values (group_name, code, uid)
  returning id into new_id;
  insert into public.group_members (group_id, user_id) values (new_id, uid);
  return new_id;
end;
$$;

create function public.join_group(code text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  gid bigint;
begin
  if uid is null then raise exception 'Please log in.'; end if;
  select id into gid from public.bet_groups where invite_code = upper(btrim(coalesce(code, '')));
  if gid is null then raise exception 'No group with that invite code.'; end if;
  insert into public.group_members (group_id, user_id) values (gid, uid) on conflict do nothing;
  return gid;
end;
$$;

create function public.create_bet(
  p_group_id bigint,
  p_opponent_id uuid,
  p_title text,
  p_creator_side text,
  p_opponent_side text,
  p_points integer,
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
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_opponent_id) then
    raise exception 'Pick someone in this group to bet against.';
  end if;

  p_title := btrim(coalesce(p_title, ''));
  p_creator_side := btrim(coalesce(p_creator_side, ''));
  p_opponent_side := btrim(coalesce(p_opponent_side, ''));
  p_details := btrim(coalesce(p_details, ''));
  if char_length(p_title) not between 1 and 120 then raise exception 'Say what the bet is (up to 120 characters).'; end if;
  if char_length(p_creator_side) not between 1 and 120 then raise exception 'Fill in your side (up to 120 characters).'; end if;
  if char_length(p_opponent_side) not between 1 and 120 then raise exception 'Fill in their side (up to 120 characters).'; end if;
  if char_length(p_details) > 1000 then raise exception 'Fine print must be at most 1000 characters.'; end if;
  if p_points is null or p_points not between 1 and 1000 then raise exception 'Points must be a whole number from 1 to 1000.'; end if;

  insert into public.bets (group_id, creator_id, opponent_id, title, details, creator_side, opponent_side, points, settle_by)
  values (p_group_id, uid, p_opponent_id, p_title, p_details, p_creator_side, p_opponent_side, p_points, p_settle_by)
  returning id into new_id;
  return new_id;
end;
$$;

-- The bet state machine. p_winner is only used by 'report' and is from the
-- caller's point of view: 'me', 'them' or 'push'.
create function public.bet_action(p_bet_id bigint, p_action text, p_winner text default null) returns void
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
  select * into b from public.bets where id = p_bet_id for update;
  if not found or not public.is_group_member(b.group_id) then raise exception 'Bet not found.'; end if;

  is_creator := b.creator_id = uid;
  is_opponent := b.opponent_id = uid;
  if not (is_creator or is_opponent) then raise exception 'Only the two people in a bet can change it.'; end if;

  if p_action = 'accept' and b.status = 'proposed' and is_opponent then
    update public.bets set status = 'active', accepted_at = now() where id = b.id;

  elsif p_action = 'decline' and b.status = 'proposed' and is_opponent then
    update public.bets set status = 'declined' where id = b.id;

  elsif p_action = 'cancel' and b.status = 'proposed' and is_creator then
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

-- Functions are executable by everyone by default. Only signed-in users may
-- call the app's functions, and nobody may call the trigger function directly.
revoke execute on function
  public.handle_new_user(),
  public.is_group_member(bigint),
  public.shares_group_with(uuid),
  public.create_group(text),
  public.join_group(text),
  public.create_bet(bigint, uuid, text, text, text, integer, text, date),
  public.bet_action(bigint, text, text)
  from public, anon, authenticated;
grant execute on function
  public.is_group_member(bigint),
  public.shares_group_with(uuid),
  public.create_group(text),
  public.join_group(text),
  public.create_bet(bigint, uuid, text, text, text, integer, text, date),
  public.bet_action(bigint, text, text)
  to authenticated;
