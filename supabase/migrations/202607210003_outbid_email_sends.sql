create table if not exists public.auction_outbid_email_sends (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bidder_id uuid not null references public.bidder_profiles(id) on delete cascade,
  last_sent_at timestamptz not null default now(),
  primary key (auction_id, bidder_id)
);

alter table public.auction_outbid_email_sends enable row level security;

grant all privileges on table public.auction_outbid_email_sends to service_role;
