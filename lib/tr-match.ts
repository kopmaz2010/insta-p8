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

export function keywordMatches(text: string, triggerValue: string): boolean {
  const t = normalizeTr(text)
  return (triggerValue || "").split(",").some((k: string) => {
    const kw = normalizeTr(k.trim())
    if (!kw) return false
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    try {
      return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(t)
    } catch {
      return t.includes(kw)
    }
  })
}
