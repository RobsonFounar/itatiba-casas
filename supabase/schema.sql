-- Itatiba Casas · schema Supabase
-- Cole este arquivo no SQL Editor do Supabase (Project → SQL → New query) e execute.
--
-- Depois:
-- 1. Authentication → Providers → Email (habilitado) e Google (Client ID/Secret)
-- 2. Authentication → URL Configuration:
--      Site URL: https://itatiba-casas.onrender.com
--      Redirect URLs: https://itatiba-casas.onrender.com/**
--                     http://localhost:5173/**
-- 3. Marque o admin:
--      update public.profiles set role = 'admin' where email = 'SEU_EMAIL';
-- 4. Copie Project URL + anon key para js/config.js

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- houses
-- ---------------------------------------------------------------------------
create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  bairro text not null default '',
  address text not null default '',
  notes text not null default '',
  lat double precision not null,
  lng double precision not null,
  loc_precision text not null default 'bairro',
  to_school jsonb,
  to_centro jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists houses_user_id_idx on public.houses (user_id);

-- ---------------------------------------------------------------------------
-- list_shares
-- ---------------------------------------------------------------------------
create table if not exists public.list_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  shared_with_user_id uuid not null references auth.users (id) on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  constraint list_shares_owner_shared_unique unique (owner_id, shared_with_user_id),
  constraint list_shares_not_self check (owner_id <> shared_with_user_id)
);

create index if not exists list_shares_shared_with_idx
  on public.list_shares (shared_with_user_id);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists houses_set_updated_at on public.houses;
create trigger houses_set_updated_at
  before update on public.houses
  for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'user'
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.houses enable row level security;
alter table public.list_shares enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "houses_select_owner_share_admin" on public.houses;
create policy "houses_select_owner_share_admin"
  on public.houses for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.list_shares s
      where s.owner_id = houses.user_id
        and s.shared_with_user_id = auth.uid()
    )
  );

drop policy if exists "houses_insert_own" on public.houses;
create policy "houses_insert_own"
  on public.houses for insert
  with check (user_id = auth.uid());

drop policy if exists "houses_update_owner_or_editor" on public.houses;
create policy "houses_update_owner_or_editor"
  on public.houses for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.list_shares s
      where s.owner_id = houses.user_id
        and s.shared_with_user_id = auth.uid()
        and s.can_edit = true
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.list_shares s
      where s.owner_id = houses.user_id
        and s.shared_with_user_id = auth.uid()
        and s.can_edit = true
    )
  );

drop policy if exists "houses_delete_own" on public.houses;
create policy "houses_delete_own"
  on public.houses for delete
  using (user_id = auth.uid());

drop policy if exists "shares_select_involved" on public.list_shares;
create policy "shares_select_involved"
  on public.list_shares for select
  using (
    owner_id = auth.uid()
    or shared_with_user_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "shares_insert_owner" on public.list_shares;
create policy "shares_insert_owner"
  on public.list_shares for insert
  with check (owner_id = auth.uid());

drop policy if exists "shares_update_owner" on public.list_shares;
create policy "shares_update_owner"
  on public.list_shares for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "shares_delete_owner_or_guest" on public.list_shares;
create policy "shares_delete_owner_or_guest"
  on public.list_shares for delete
  using (owner_id = auth.uid() or shared_with_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.share_list_with_email(
  target_email text,
  p_can_edit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  share_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select id into target_id
  from public.profiles
  where lower(email) = lower(trim(target_email));

  if target_id is null then
    raise exception 'Usuário não encontrado. A pessoa precisa criar conta antes.';
  end if;

  if target_id = auth.uid() then
    raise exception 'Não é possível compartilhar consigo mesmo';
  end if;

  insert into public.list_shares (owner_id, shared_with_user_id, can_edit)
  values (auth.uid(), target_id, coalesce(p_can_edit, false))
  on conflict (owner_id, shared_with_user_id)
  do update set can_edit = excluded.can_edit
  returning id into share_id;

  return share_id;
end;
$$;

revoke all on function public.share_list_with_email(text, boolean) from public;
grant execute on function public.share_list_with_email(text, boolean) to authenticated;

create or replace function public.list_outgoing_shares()
returns table (
  id uuid,
  shared_with_user_id uuid,
  shared_with_email text,
  shared_with_name text,
  can_edit boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.shared_with_user_id,
    p.email,
    p.display_name,
    s.can_edit,
    s.created_at
  from public.list_shares s
  join public.profiles p on p.id = s.shared_with_user_id
  where s.owner_id = auth.uid()
  order by s.created_at desc;
$$;

revoke all on function public.list_outgoing_shares() from public;
grant execute on function public.list_outgoing_shares() to authenticated;

create or replace function public.list_incoming_shares()
returns table (
  id uuid,
  owner_id uuid,
  owner_email text,
  owner_name text,
  can_edit boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.owner_id,
    p.email,
    p.display_name,
    s.can_edit,
    s.created_at
  from public.list_shares s
  join public.profiles p on p.id = s.owner_id
  where s.shared_with_user_id = auth.uid()
  order by s.created_at desc;
$$;

revoke all on function public.list_incoming_shares() from public;
grant execute on function public.list_incoming_shares() to authenticated;

create or replace function public.admin_list_owners()
returns table (
  owner_id uuid,
  owner_email text,
  owner_name text,
  house_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.email,
    p.display_name,
    count(h.id)::bigint
  from public.profiles p
  left join public.houses h on h.user_id = p.id
  where public.is_admin()
  group by p.id, p.email, p.display_name
  order by p.email;
$$;

revoke all on function public.admin_list_owners() from public;
grant execute on function public.admin_list_owners() to authenticated;
