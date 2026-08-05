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

// Uzatilmis harfleri tekle: "unutuuummm" -> "unutum". Hem mesaja hem
// tetikleyiciye uygulanir ("unuttum" -> "unutum") — iki taraf ayni sekilde
// katlandigi icin cift harfli Turkce kelimeler (elli->eli) tutarli kalir.
// Kanit: 5 Agu, boraduran'da "kulaklığımı unutuuumm" tarzi ~55 DM eslesmedi.
export function tekle(s: string): string {
  return (s || "").replace(/(\p{L})\1+/gu, "$1")
}

export function keywordMatches(text: string, triggerValue: string): boolean {
  const t = foldTr(text)
  const tK = tekle(t)
  return (triggerValue || "").split(",").some((k: string) => {
    const kw = foldTr(k.trim())
    if (!kw) return false
    const dene = (metin: string, kelime: string) => {
      const esc = kelime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      try {
        return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(metin)
      } catch {
        return metin.includes(kelime)
      }
    }
    return dene(t, kw) || dene(tK, tekle(kw))
  })
}
