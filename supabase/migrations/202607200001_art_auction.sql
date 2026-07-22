create extension if not exists pgcrypto;

create type public.auction_status as enum ('draft', 'open', 'paused', 'closed', 'cancelled');
create type public.bid_event_kind as enum ('manual', 'automatic', 'maximum_change', 'admin_removal');

create table public.auctions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  status public.auction_status not null default 'draft',
  currency text not null default 'USD' check (currency = 'USD'),
  opening_price integer not null default 0 check (opening_price >= 0 and opening_price % 10 = 0),
  bid_increment integer not null default 10 check (bid_increment = 10),
  reserve_price integer not null default 500 check (reserve_price >= 0 and reserve_price % 10 = 0),
  scheduled_ends_at timestamptz not null,
  effective_ends_at timestamptz not null,
  extension_window interval not null default interval '5 minutes',
  extension_duration interval not null default interval '5 minutes',
  current_price integer not null default 0 check (current_price >= 0 and current_price % 10 = 0),
  reserve_met boolean not null default false,
  winning_bidder_id uuid,
  approved_to_launch boolean not null default false,
  test_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bidder_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  nickname text not null,
  email text not null,
  phone text not null,
  age_terms_version text not null,
  email_consent_version text not null,
  optional_reminders boolean not null default true,
  blocked_at timestamptz,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bidder_nickname_length check (char_length(nickname) between 2 and 32)
);

create unique index bidder_profiles_email_unique on public.bidder_profiles (lower(email));
create unique index bidder_profiles_nickname_unique on public.bidder_profiles (lower(nickname));

alter table public.auctions
  add constraint auctions_winning_bidder_fk
  foreign key (winning_bidder_id) references public.bidder_profiles(id);

create table public.maximum_bids (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bidder_id uuid not null references public.bidder_profiles(id) on delete cascade,
  amount integer not null check (amount >= 10 and amount % 10 = 0),
  first_reached_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (auction_id, bidder_id)
);

create table public.bid_events (
  id bigint generated always as identity primary key,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bidder_id uuid references public.bidder_profiles(id) on delete set null,
  public_amount integer not null check (public_amount >= 0 and public_amount % 10 = 0),
  kind public.bid_event_kind not null,
  is_valid boolean not null default true,
  removed_at timestamptz,
  removed_by uuid references public.bidder_profiles(id),
  removal_reason text,
  created_at timestamptz not null default now()
);

create index bid_events_auction_created_idx on public.bid_events (auction_id, created_at desc);
create index bid_events_bidder_idx on public.bid_events (bidder_id, auction_id);

create table public.auction_extensions (
  id bigint generated always as identity primary key,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  triggered_by_bid_event_id bigint references public.bid_events(id),
  previous_ends_at timestamptz not null,
  extended_ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  auction_id uuid references public.auctions(id) on delete set null,
  admin_user_id uuid references public.bidder_profiles(id),
  action text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.email_outbox (
  id bigint generated always as identity primary key,
  auction_id uuid references public.auctions(id) on delete cascade,
  recipient text not null,
  bcc text,
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now()
);

create table public.auction_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

create or replace function public.is_auction_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.auction_admins where user_id = auth.uid()
  );
$$;

create or replace function public.get_public_auction_state(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', slug,
    'status', status,
    'current_price', current_price,
    'reserve_met', reserve_met,
    'effective_ends_at', effective_ends_at,
    'test_mode', test_mode
  )
  from public.auctions
  where slug = p_slug;
$$;

grant execute on function public.get_public_auction_state(text) to anon, authenticated;

create or replace function public.recalculate_auction(p_auction_id uuid)
returns public.auctions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions;
  v_top record;
  v_second record;
  v_price integer;
begin
  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'Auction not found'; end if;

  select bidder_id, amount, first_reached_at
    into v_top
  from public.maximum_bids
  where auction_id = p_auction_id
  order by amount desc, first_reached_at asc
  limit 1;

  select bidder_id, amount, first_reached_at
    into v_second
  from public.maximum_bids
  where auction_id = p_auction_id
    and bidder_id <> v_top.bidder_id
  order by amount desc, first_reached_at asc
  limit 1;

  if v_top.bidder_id is null then
    v_price := v_auction.opening_price;
  elsif v_second.bidder_id is null then
    v_price := least(
      v_top.amount,
      case when v_top.amount >= v_auction.reserve_price
        then v_auction.reserve_price
        else greatest(v_auction.opening_price + v_auction.bid_increment, v_auction.bid_increment)
      end
    );
  else
    v_price := least(v_top.amount, v_second.amount + v_auction.bid_increment);
    if v_top.amount >= v_auction.reserve_price and v_price < v_auction.reserve_price then
      v_price := v_auction.reserve_price;
    end if;
  end if;

  update public.auctions
  set current_price = v_price,
      reserve_met = v_price >= reserve_price,
      winning_bidder_id = v_top.bidder_id,
      updated_at = now()
  where id = p_auction_id
  returning * into v_auction;

  return v_auction;
end;
$$;

create or replace function public.place_bid(
  p_auction_slug text,
  p_amount integer,
  p_kind text default 'maximum'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bidder public.bidder_profiles;
  v_auction public.auctions;
  v_previous public.auctions;
  v_existing public.maximum_bids;
  v_highest_recorded integer;
  v_requested_at timestamptz := clock_timestamp();
  v_manual_event_id bigint;
  v_auto_event_id bigint;
  v_event_count integer := 0;
  v_previous_leader uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_amount < 10 or p_amount % 10 <> 0 then raise exception 'Bids must be in $10 increments'; end if;
  if p_kind not in ('quick', 'maximum') then raise exception 'Unsupported bid type'; end if;

  select * into v_bidder from public.bidder_profiles where id = auth.uid();
  if not found then raise exception 'Complete bidder registration first'; end if;
  if v_bidder.blocked_at is not null then raise exception 'This bidder is not eligible to bid'; end if;

  select * into v_auction from public.auctions where slug = p_auction_slug for update;
  if not found then raise exception 'Auction not found'; end if;
  if v_auction.status <> 'open' or not v_auction.approved_to_launch then raise exception 'Bidding is not open'; end if;
  if v_requested_at >= v_auction.effective_ends_at then raise exception 'The auction has ended'; end if;

  v_previous := v_auction;
  v_previous_leader := v_auction.winning_bidder_id;

  select * into v_existing
  from public.maximum_bids
  where auction_id = v_auction.id and bidder_id = v_bidder.id;

  select coalesce(max(public_amount), 0) into v_highest_recorded
  from public.bid_events
  where auction_id = v_auction.id and bidder_id = v_bidder.id and is_valid;

  if p_amount < v_highest_recorded then
    raise exception 'A Maximum Bid cannot be reduced below your highest recorded bid';
  end if;

  if p_kind = 'quick' then
    if v_previous_leader = v_bidder.id then raise exception 'The current leader cannot bid against themselves'; end if;
    if p_amount <> v_auction.current_price + v_auction.bid_increment then
      raise exception 'The quick bid amount has changed; refresh and try again';
    end if;
  end if;

  insert into public.maximum_bids (auction_id, bidder_id, amount, first_reached_at, updated_at)
  values (v_auction.id, v_bidder.id, p_amount, v_requested_at, v_requested_at)
  on conflict (auction_id, bidder_id) do update
    set amount = excluded.amount,
        first_reached_at = case
          when excluded.amount > public.maximum_bids.amount then excluded.first_reached_at
          else public.maximum_bids.first_reached_at
        end,
        updated_at = excluded.updated_at;

  v_auction := public.recalculate_auction(v_auction.id);

  if v_auction.current_price <> v_previous.current_price or v_auction.winning_bidder_id <> v_previous_leader then
    insert into public.bid_events (auction_id, bidder_id, public_amount, kind)
    values (v_auction.id, v_bidder.id, least(p_amount, v_auction.current_price), 'manual')
    returning id into v_manual_event_id;
    v_event_count := v_event_count + 1;
  else
    insert into public.bid_events (auction_id, bidder_id, public_amount, kind)
    values (v_auction.id, v_bidder.id, v_highest_recorded, 'maximum_change');
  end if;

  if v_auction.winning_bidder_id <> v_bidder.id
     and v_auction.current_price > v_previous.current_price then
    insert into public.bid_events (auction_id, bidder_id, public_amount, kind)
    values (v_auction.id, v_auction.winning_bidder_id, v_auction.current_price, 'automatic')
    returning id into v_auto_event_id;
    v_event_count := v_event_count + 1;
  end if;

  if v_previous.effective_ends_at - v_requested_at <= v_previous.extension_window
     and v_event_count > 0 then
    update public.auctions
    set effective_ends_at = greatest(effective_ends_at, v_requested_at + extension_duration),
        updated_at = now()
    where id = v_auction.id
    returning * into v_auction;

    insert into public.auction_extensions (
      auction_id, triggered_by_bid_event_id, previous_ends_at, extended_ends_at
    ) values (
      v_auction.id,
      coalesce(v_auto_event_id, v_manual_event_id),
      v_previous.effective_ends_at,
      v_auction.effective_ends_at
    );
  end if;

  insert into public.email_outbox (auction_id, recipient, template, payload)
  values (
    v_auction.id,
    v_bidder.email,
    'bid-confirmation',
    jsonb_build_object('public_amount', v_auction.current_price, 'maximum_bid', p_amount)
  );

  insert into public.email_outbox (auction_id, recipient, template, payload)
  values (
    v_auction.id,
    'N8Darby@gmail.com',
    'admin-auction-event',
    jsonb_build_object(
      'event', p_kind,
      'bidder_id', v_bidder.id,
      'bidder_name', v_bidder.full_name,
      'nickname', v_bidder.nickname,
      'maximum_bid', p_amount,
      'public_amount', v_auction.current_price
    )
  );

  return jsonb_build_object(
    'auction_id', v_auction.id,
    'current_price', v_auction.current_price,
    'reserve_met', v_auction.reserve_met,
    'effective_ends_at', v_auction.effective_ends_at,
    'winning_bidder_id', v_auction.winning_bidder_id,
    'viewer_is_leading', v_auction.winning_bidder_id = v_bidder.id
  );
end;
$$;

create or replace function public.reset_test_auction(
  p_auction_slug text,
  p_duration_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions;
  v_end timestamptz;
  v_min_end timestamptz;
begin
  if not public.is_auction_admin() then raise exception 'Administrator access required'; end if;
  if p_duration_hours < 1 or p_duration_hours > 168 then raise exception 'Invalid test duration'; end if;

  select * into v_auction
  from public.auctions
  where slug = p_auction_slug
  for update;

  if not found then raise exception 'Auction not found'; end if;
  if not v_auction.test_mode then raise exception 'Production auctions cannot be reset'; end if;

  delete from public.email_outbox where auction_id = v_auction.id;
  delete from public.auction_reminder_sends where auction_id = v_auction.id;
  delete from public.auction_outbid_email_sends where auction_id = v_auction.id;
  delete from public.auction_extensions where auction_id = v_auction.id;
  delete from public.bid_events where auction_id = v_auction.id;
  delete from public.maximum_bids where auction_id = v_auction.id;

  v_min_end := clock_timestamp() + make_interval(hours => p_duration_hours);
  v_end := ((timezone('America/Chicago', v_min_end)::date + time '20:00') at time zone 'America/Chicago');
  if v_end < v_min_end then
    v_end := (((timezone('America/Chicago', v_min_end)::date + 1) + time '20:00') at time zone 'America/Chicago');
  end if;

  update public.auctions
  set status = 'open',
      approved_to_launch = true,
      scheduled_ends_at = v_end,
      effective_ends_at = v_end,
      current_price = opening_price,
      reserve_met = false,
      winning_bidder_id = null,
      updated_at = clock_timestamp()
  where id = v_auction.id;

  insert into public.admin_audit_log (auction_id, admin_user_id, action, reason, metadata)
  values (
    v_auction.id,
    auth.uid(),
    'reset_test_auction',
    'Started a clean family test window',
    jsonb_build_object('duration_hours', p_duration_hours, 'ends_at', v_end)
  );

  return jsonb_build_object(
    'status', 'open',
    'current_price', v_auction.opening_price,
    'reserve_met', false,
    'effective_ends_at', v_end,
    'test_mode', true
  );
end;
$$;

grant execute on function public.reset_test_auction(text, integer) to authenticated;

alter table public.auctions enable row level security;
alter table public.bidder_profiles enable row level security;
alter table public.maximum_bids enable row level security;
alter table public.bid_events enable row level security;
alter table public.auction_extensions enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.email_outbox enable row level security;
alter table public.auction_admins enable row level security;

create policy "Public can read approved auctions"
  on public.auctions for select
  using (approved_to_launch or public.is_auction_admin());

create policy "Public can read valid bid history"
  on public.bid_events for select
  using (is_valid or public.is_auction_admin());

create policy "Bidders can read their profile"
  on public.bidder_profiles for select
  using (id = auth.uid() or public.is_auction_admin());

create policy "Bidders can read their own maximum"
  on public.maximum_bids for select
  using (bidder_id = auth.uid() or public.is_auction_admin());

create policy "Admins manage auctions"
  on public.auctions for all
  using (public.is_auction_admin())
  with check (public.is_auction_admin());

create policy "Admins manage bidder profiles"
  on public.bidder_profiles for all
  using (public.is_auction_admin())
  with check (public.is_auction_admin());

create policy "Admins read audit logs"
  on public.admin_audit_log for select
  using (public.is_auction_admin());

insert into public.auctions (
  slug,
  title,
  status,
  scheduled_ends_at,
  effective_ends_at,
  test_mode
) values (
  'mission-art-2026',
  'N8Forged Mission Art Auction',
  'draft',
  '2026-08-16T01:00:00Z',
  '2026-08-16T01:00:00Z',
  true
);

comment on table public.auctions is 'Server-authoritative auction state. Never trust browser-calculated price, reserve, winner, or end time.';
comment on table public.bid_events is 'Immutable public bid ledger. Administrative removal invalidates an event without deleting it.';
comment on table public.email_outbox is 'Transactional outbox consumed by the email worker; prevents business events and email delivery from drifting.';
