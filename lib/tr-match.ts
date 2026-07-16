/* @ts-nocheck */

// ============================================================
// Turkce-farkindalikli kelime eslestirme — TEK KAYNAK.
// Webhook (push) ve comment-poller (pull) ayni mantigi kullanir;
// kopya tutulsaydi biri duzelir digeri bozuk kalirdi.
//
// Eski kod `\b` (word boundary) kullaniyordu — JS'te \b yalnizca ASCII
// kelime karakterlerini tanir; "takası" gibi Turkce harfle biten kelimeler
// HIC eslesmiyordu. Unicode lookaround ile duzeltildi.
// ============================================================

export function normalizeTr(s: string): string {
  return (s || "").toLocaleLowerCase("tr").normalize("NFC")
}

// Eslestirme icin karakter KATLAMA: kullanicilar tetikleyiciyi ASCII yazar
// ("hayranimsin" vs "hayranımsın") — ı/i, ç/c, ş/s, ğ/g, ö/o, ü/u ayni sayilir.
// Kanit: 16 Tem, "Hayranimsin" yorumu eslesmedi cunku kural "hayranımsın"di.
export function foldTr(s: string): string {
  return (s || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // aksan/nokta isaretlerini at (ç→c, ş→s, ö→o, ü→u, ğ→g, i̇→i)
    .replace(/ı/g, "i") // ı'nin decompose karsiligi yok, elle katla
}

export function keywordMatches(text: string, triggerValue: string): boolean {
  const t = foldTr(text)
  return (triggerValue || "").split(",").some((k: string) => {
    const kw = foldTr(k.trim())
    if (!kw) return false
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    try {
      return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(t)
    } catch {
      return t.includes(kw)
    }
  })
}
