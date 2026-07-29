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
      greatest(v_auction.opening_price + v_auction.bid_increment, v_auction.bid_increment)
    );
  else
    v_price := least(v_top.amount, v_second.amount + v_auction.bid_increment);
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

do $$
declare
  v_before public.auctions;
  v_after public.auctions;
  v_incorrect_event_id bigint;
begin
  select * into v_before
  from public.auctions
  where slug = 'mission-art-2026'
    and status = 'open'
  for update;

  if not found then
    return;
  end if;

  select id into v_incorrect_event_id
  from public.bid_events
  where auction_id = v_before.id
    and is_valid
    and kind in ('manual', 'automatic')
    and public_amount = v_before.current_price
  order by created_at desc
  limit 1;

  v_after := public.recalculate_auction(v_before.id);

  if v_after.current_price < v_before.current_price then
    if v_incorrect_event_id is not null then
      update public.bid_events
      set is_valid = false,
          removed_at = now()
      where id = v_incorrect_event_id;
    end if;

    insert into public.bid_events (auction_id, bidder_id, public_amount, kind)
    values (v_after.id, v_after.winning_bidder_id, v_after.current_price, 'manual');

    insert into public.admin_audit_log (auction_id, action, reason, metadata)
    values (
      v_after.id,
      'proxy_pricing_correction',
      'Removed the reserve-price override so the visible bid is one increment above the next-highest maximum.',
      jsonb_build_object(
        'previous_public_price', v_before.current_price,
        'corrected_public_price', v_after.current_price,
        'invalidated_bid_event_id', v_incorrect_event_id
      )
    );
  end if;
end;
$$;
