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
