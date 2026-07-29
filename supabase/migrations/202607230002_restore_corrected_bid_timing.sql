do $$
declare
  v_auction public.auctions;
  v_original_event public.bid_events;
  v_correction_event public.bid_events;
begin
  select * into v_auction
  from public.auctions
  where slug = 'mission-art-2026'
  for update;

  if not found then
    return;
  end if;

  select * into v_original_event
  from public.bid_events
  where auction_id = v_auction.id
    and bidder_id = v_auction.winning_bidder_id
    and kind = 'manual'
    and not is_valid
    and public_amount > v_auction.current_price
    and removed_at is not null
  order by created_at desc
  limit 1;

  if v_original_event.id is null then
    return;
  end if;

  select * into v_correction_event
  from public.bid_events
  where auction_id = v_auction.id
    and bidder_id = v_auction.winning_bidder_id
    and kind = 'manual'
    and is_valid
    and public_amount = v_auction.current_price
    and created_at >= v_original_event.removed_at
  order by created_at asc
  limit 1;

  update public.bid_events
  set public_amount = v_auction.current_price,
      is_valid = true,
      removed_at = null
  where id = v_original_event.id;

  if v_correction_event.id is not null then
    update public.bid_events
    set is_valid = false,
        removed_at = now()
    where id = v_correction_event.id;
  end if;

  insert into public.admin_audit_log (auction_id, action, reason, metadata)
  values (
    v_auction.id,
    'restore_corrected_bid_timing',
    'Restored the corrected proxy price to the original maximum-bid event time so public history remains chronological.',
    jsonb_build_object(
      'restored_event_id', v_original_event.id,
      'invalidated_correction_event_id', v_correction_event.id,
      'public_price', v_auction.current_price,
      'original_created_at', v_original_event.created_at
    )
  );
end;
$$;
