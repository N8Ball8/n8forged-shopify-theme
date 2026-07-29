create table if not exists public.auction_presence (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  user_id uuid not null references public.bidder_profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (auction_id, user_id)
);

create index if not exists auction_presence_recent_idx
  on public.auction_presence (auction_id, last_seen_at desc);

alter table public.auction_presence enable row level security;

grant all privileges on public.auction_presence to service_role;
