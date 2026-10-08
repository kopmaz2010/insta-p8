-- ============================================================
-- 11 — TikTok Business Messaging (8 Eki 2026)
-- Instagram tarafina DOKUNMAZ. Tasarim: "hesap = sanatci, kanal = platform".
-- Bir TikTok hesabi mevcut users satirina (Instagram id) BAGLANIR; boylece
-- automations / webhook_events / gunluk rapor ayni user_id altinda toplanir.
-- (users.id BIGINT = Instagram id oldugu icin TikTok open_id oraya yazilamaz.)
-- ============================================================

create table if not exists public.tiktok_accounts (
  open_id            text primary key,                 -- TikTok business_id / open_id
  user_id            bigint not null references public.users(id) on delete cascade,
  username           text,
  display_name       text,
  profile_image      text,
  access_token       text,                             -- ~24 saat
  refresh_token      text,                             -- ~30 gun
  token_expires_at   timestamptz,
  refresh_expires_at timestamptz,
  scope              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists tiktok_accounts_user_idx on public.tiktok_accounts (user_id);

-- Servis anahtari RLS'i gecer; anon/authenticated icin kapali.
alter table public.tiktok_accounts enable row level security;

-- automations.trigger_source CHECK'ine 'tiktok_dm' ekle (mevcut ad: automations_trigger_source_check)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.automations'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%trigger_source%'
  loop
    execute format('alter table public.automations drop constraint %I', c.conname);
  end loop;
  alter table public.automations
    add constraint automations_trigger_source_check
    check (trigger_source in ('comment', 'dm', 'story', 'tiktok_dm'));
end $$;

-- webhook_events: tt_* olaylari icin ek indeks (rapor + gunluk limit sayimi)
create index if not exists webhook_events_tt_idx
  on public.webhook_events (user_id, processed_at desc)
  where event_type like 'tt_%';
