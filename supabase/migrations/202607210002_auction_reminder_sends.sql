create table if not exists public.auction_reminder_sends (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  reminder_key text not null,
  sent_at timestamptz not null default now(),
  recipient_count integer not null default 0,
  primary key (auction_id, reminder_key)
);

grant all privileges on table public.auction_reminder_sends to service_role;
