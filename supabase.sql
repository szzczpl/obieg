-- =====================================================================
-- OBIEG – baza danych (Supabase)
-- Wklej CAŁY ten plik w Supabase: SQL Editor -> New query -> Run.
-- Można uruchomić ponownie – polecenia są bezpieczne przy powtórzeniu.
-- =====================================================================

create extension if not exists citext;

-- ---------- Profile użytkowników ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     citext unique not null check (username ~ '^[a-z0-9._]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  bio          text check (char_length(bio) <= 300),
  city         text check (char_length(city) <= 40),
  avatar_url   text,
  marketing    boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profile public read" on public.profiles;
create policy "profile public read" on public.profiles for select using (true);
drop policy if exists "profile own update" on public.profiles;
create policy "profile own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Profil powstaje automatycznie przy rejestracji (nazwa z formularza)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wanted text := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  final  text := wanted;
begin
  if final !~ '^[a-z0-9._]{3,20}$' or exists (select 1 from public.profiles where username = final) then
    final := 'uzytkownik' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, username, display_name, marketing)
  values (new.id, final, nullif(new.raw_user_meta_data->>'display_name', ''),
          coalesce((new.raw_user_meta_data->>'marketing')::boolean, false));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Ogłoszenia ----------
create table if not exists public.listings (
  id          bigint generated always as identity primary key,
  seller_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 5 and 60),
  description text check (char_length(description) <= 1000),
  category    text not null,
  audience    text not null default 'U' check (audience in ('K','M','U')),
  brand       text not null check (char_length(brand) <= 40),
  size        text not null check (char_length(size) <= 20),
  condition   text not null check (condition in ('Nowe z metką','Jak nowe','Bardzo dobry','Dobry')),
  price       numeric(10,2) not null check (price >= 10 and price <= 100000),
  parcel      text not null default 'A' check (parcel in ('A','B','C')),
  photos      text[] not null default '{}',
  status      text not null default 'active' check (status in ('active','reserved','sold','hidden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists listings_status_created on public.listings (status, created_at desc);
create index if not exists listings_seller on public.listings (seller_id);
alter table public.listings enable row level security;
drop policy if exists "listing read" on public.listings;
create policy "listing read" on public.listings for select
  using (status in ('active','reserved','sold') or seller_id = auth.uid());
drop policy if exists "listing insert own" on public.listings;
create policy "listing insert own" on public.listings for insert with check (seller_id = auth.uid());
drop policy if exists "listing update own" on public.listings;
create policy "listing update own" on public.listings for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "listing delete own" on public.listings;
create policy "listing delete own" on public.listings for delete using (seller_id = auth.uid());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists listings_touch on public.listings;
create trigger listings_touch before update on public.listings for each row execute function public.touch_updated_at();

-- ---------- Ulubione ----------
create table if not exists public.favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.favorites enable row level security;
drop policy if exists "fav own" on public.favorites;
create policy "fav own" on public.favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Liczba polubień (bez ujawniania, kto polubił)
create or replace view public.listing_likes with (security_invoker = false) as
  select listing_id, count(*)::int as likes from public.favorites group by listing_id;
grant select on public.listing_likes to anon, authenticated;

-- ---------- Portfel ----------
-- Wpisy tworzy wyłącznie serwer (integracja płatności), użytkownik tylko czyta swoje.
create table if not exists public.wallet_transactions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      numeric(10,2) not null,
  kind        text not null check (kind in ('sale','payout','refund','adjustment')),
  status      text not null default 'pending' check (status in ('pending','available','paid','cancelled')),
  listing_id  bigint references public.listings(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.wallet_transactions enable row level security;
drop policy if exists "wallet read own" on public.wallet_transactions;
create policy "wallet read own" on public.wallet_transactions for select using (user_id = auth.uid());

create table if not exists public.payout_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 20),
  iban        text not null check (iban ~ '^PL[0-9]{26}$'),
  holder_name text not null check (char_length(holder_name) between 3 and 80),
  status      text not null default 'requested' check (status in ('requested','processing','paid','rejected')),
  created_at  timestamptz not null default now()
);
alter table public.payout_requests enable row level security;
drop policy if exists "payout read own" on public.payout_requests;
create policy "payout read own" on public.payout_requests for select using (user_id = auth.uid());

-- Wypłata: serwer sprawdza dostępne saldo, zapisuje wniosek i blokuje środki
create or replace function public.request_payout(p_amount numeric, p_iban text, p_holder text)
returns public.payout_requests language plpgsql security definer set search_path = public as $$
declare
  available numeric;
  r public.payout_requests;
begin
  if auth.uid() is null then raise exception 'Zaloguj się ponownie.'; end if;
  select coalesce(sum(amount), 0) into available from wallet_transactions
    where user_id = auth.uid() and status = 'available';
  if p_amount > available then raise exception 'Kwota przekracza dostępne saldo.'; end if;
  insert into payout_requests (user_id, amount, iban, holder_name)
    values (auth.uid(), p_amount, upper(replace(p_iban, ' ', '')), trim(p_holder)) returning * into r;
  insert into wallet_transactions (user_id, amount, kind, status, note)
    values (auth.uid(), -p_amount, 'payout', 'available', 'Wypłata #' || r.id);
  return r;
end $$;
grant execute on function public.request_payout(numeric, text, text) to authenticated;

-- ---------- Zdjęcia (Storage) ----------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('listing-photos', 'listing-photos', true) on conflict (id) do nothing;

drop policy if exists "photos public read" on storage.objects;
create policy "photos public read" on storage.objects for select using (bucket_id in ('avatars','listing-photos'));
drop policy if exists "photos own upload" on storage.objects;
create policy "photos own upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars','listing-photos') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos own update" on storage.objects;
create policy "photos own update" on storage.objects for update to authenticated
  using (bucket_id in ('avatars','listing-photos') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos own delete" on storage.objects;
create policy "photos own delete" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars','listing-photos') and (storage.foldername(name))[1] = auth.uid()::text);
