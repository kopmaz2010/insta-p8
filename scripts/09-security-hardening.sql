-- ============================================================
-- 09 — GUVENLIK SERTLESTIRME (SAST bulgulari)
-- Bu index/constraint'ler CANLI DB'de elle eklenmisti ama commit'li semada
-- yoktu. Sifirdan bir Supabase'e kurulunca dedup/anti-abuse KORUMALARI
-- sessizce kaybolurdu (claimEvent her zaman true doner → cift DM). Idempotent:
-- var olan ortamda no-op, yeni ortamda korumayi geri getirir.
-- ============================================================

-- Cok kullanicili giris + hesap sahipligi (16 Tem)
CREATE TABLE IF NOT EXISTS app_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  must_change boolean NOT NULL DEFAULT true,
  sess_ver integer NOT NULL DEFAULT 0,     -- oturum rotation (change-code'da ++)
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES app_accounts(id) ON DELETE SET NULL;

-- Webhook/poller dedup — claimEvent bu partial-unique'e bagimli
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_key
  ON webhook_events (event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_type_time
  ON webhook_events (user_id, event_type, processed_at);

-- Oyunlastirma anti-abuse tekillikleri (puan-farming/cift-redeem/tekrar-cevap engeli)
-- NOT: tablolar yoksa bu blok atlanir; tablo semasi ayri migration'da.
DO $$
BEGIN
  IF to_regclass('public.point_buckets') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_point_buckets_event_key
      ON point_buckets (event_key) WHERE event_key IS NOT NULL;
  END IF;
  IF to_regclass('public.loyalty_members') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_members_user_igsid
      ON loyalty_members (user_id, igsid);
  END IF;
  IF to_regclass('public.quiz_answers') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_answers_quiz_member
      ON quiz_answers (quiz_id, member_id);
  END IF;
END $$;
