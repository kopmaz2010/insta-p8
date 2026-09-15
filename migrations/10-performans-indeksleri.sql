-- 16 Eyl 2026 — performans indeksleri (14-15 Eyl DB G/C kotası tükenmesi sonrası)
-- Sıcak sorgular (her gelen webhook mesajında çalışanlar):
--   underDailyLimit / underHourlyLimit : webhook_events user_id + event_type LIKE 'send%' + processed_at >= ...  (count exact)
--   pickRandomAudio                    : webhook_events user_id + event_key LIKE 'sesgecmis|kural|kisi|%'
--   claimEvent                         : webhook_events event_key (benzersiz)
--   konuşma/mesaj yazımı               : conversations user_id + recipient_id ; messages conversation_id
-- DB yükü düşükken çalıştır. CONCURRENTLY transaction içinde çalışmaz; SQL editöründe tek tek çalıştır.

-- Gönderim sayaçları: yalnızca send% satırlarını içeren kısmi indeks (sorgunun LIKE koşuluyla birebir)
create index concurrently if not exists webhook_events_send_user_ts
  on public.webhook_events (user_id, processed_at desc)
  where event_type like 'send%';

-- event_key önek aramaları (sesgecmis|, takip1|, telafi|, ovgu| ...): LIKE 'önek%' için text_pattern_ops
create index concurrently if not exists webhook_events_user_key_pattern
  on public.webhook_events (user_id, event_key text_pattern_ops);

-- event_type + zaman (nabız, rapor sayımları)
create index concurrently if not exists webhook_events_user_type_ts
  on public.webhook_events (user_id, event_type, processed_at desc);

-- Mesajlar
create index concurrently if not exists messages_conv_created
  on public.messages (conversation_id, created_at desc);
create index concurrently if not exists messages_user_created
  on public.messages (user_id, created_at desc);

-- Konuşmalar
create index concurrently if not exists conversations_user_recipient
  on public.conversations (user_id, recipient_id);
create index concurrently if not exists conversations_user_last
  on public.conversations (user_id, last_message_at desc);

-- İstatistikleri tazele
analyze public.webhook_events;
analyze public.messages;
analyze public.conversations;
