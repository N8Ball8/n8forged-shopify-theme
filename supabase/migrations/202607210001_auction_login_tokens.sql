create table if not exists public.auction_login_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auction_login_tokens_user_idx
  on public.auction_login_tokens (user_id, created_at desc);

grant all privileges on table public.auction_login_tokens to service_role;

