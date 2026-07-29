create table if not exists public.auction_finalization_sends (
  auction_id uuid primary key references public.auctions(id) on delete cascade,
  winner_bidder_id uuid references public.bidder_profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  recipient text,
  final_price integer not null default 0
);

alter table public.auction_finalization_sends enable row level security;

grant all privileges on table public.auction_finalization_sends to service_role;
