#!/usr/bin/env python3
# ============================================================
# CHATBOT YEREL KOPRU — Mac'te calisir, API anahtari GEREKMEZ.
# Dongu: InstaAuto /api/chatbot/bridge'den bekleyen DM'leri ceker,
# cevabi YEREL Ollama modeliyle uretir, ayni endpoint'e geri yollar.
# Gonderim limitleri/devre kesici/dedup SUNUCUDA uygulanir; bu script
# sadece metin uretir.
#
# Kurulum (bir kez):
#   1) Ollama kurulu olmali:  ollama pull qwen2.5:3b
#   2) Sifreyi ortam degiskeni olarak ver (Vercel'deki API_SECRET_KEY):
#        export INSTAAUTO_SECRET='...'
# Calistir:
#   python3 scripts/chatbot_kopru.py
# Durdurmak: Ctrl+C. Script kapaliyken mesajlar kuyrukta bekler (20 saat).
# ============================================================

import json
import os
import sys
import time
import urllib.request

BASE_URL = os.environ.get("INSTAAUTO_URL", "https://project-80xl4-kopmaz2010s-projects.vercel.app")
SECRET = os.environ.get("INSTAAUTO_SECRET", "")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "30"))

TEKNIK_KURALLAR = (
    "\n\nTEKNIK KURALLAR: Yanitin dogrudan Instagram DM olarak gonderilecek. "
    "Kisa tut (1-3 cumle), duz metin yaz, markdown/baslik/madde isareti kullanma. "
    "Turkce cevap ver. Emin olmadigin konuda bilgi uydurma."
)


def http_json(url, method="GET", body=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"error": str(e)}
    except Exception as e:
        return 0, {"error": str(e)}


def generate_reply(persona, history, text):
    messages = [{"role": "system", "content": persona + TEKNIK_KURALLAR}]
    messages += history
    messages.append({"role": "user", "content": text})
    status, j = http_json(
        f"{OLLAMA_URL}/api/chat",
        method="POST",
        body={"model": MODEL, "messages": messages, "stream": False,
              "options": {"num_predict": 200, "temperature": 0.7}},
    )
    if status != 200:
        print(f"  !! Ollama hatasi ({status}): {j.get('error')}")
        return None
    reply = (j.get("message") or {}).get("content", "").strip()
    return reply or None


def main():
    if not SECRET:
        sys.exit("INSTAAUTO_SECRET ortam degiskeni gerekli (Vercel'deki API_SECRET_KEY degeri).")
    auth = {"x-api-secret": SECRET}
    print(f"Kopru basladi → {BASE_URL} · model={MODEL} · her {POLL_SECONDS}sn")
    while True:
        status, j = http_json(f"{BASE_URL}/api/chatbot/bridge", headers=auth)
        if status != 200:
            print(f"!! bekleyenler alinamadi ({status}): {j.get('error')}")
        else:
            pending = j.get("pending", [])
            if pending:
                print(f"{len(pending)} bekleyen mesaj")
            for p in pending:
                print(f"  → {p['key']}: {p['text'][:60]!r}")
                reply = generate_reply(p["persona"], p.get("history", []), p["text"])
                if not reply:
                    continue  # sonraki turda tekrar denenir
                s2, r2 = http_json(
                    f"{BASE_URL}/api/chatbot/bridge", method="POST",
                    body={"key": p["key"], "reply": reply}, headers=auth,
                )
                if s2 == 200:
                    print(f"  ✅ gonderildi: {reply[:80]!r}")
                elif s2 == 429:
                    print(f"  🛑 limit: {r2.get('error')} — bu tur duruldu")
                    break
                else:
                    print(f"  !! gonderilemedi ({s2}): {r2.get('error')}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nKopru durduruldu.")
