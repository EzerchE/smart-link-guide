# Güvenli güncelleme akışı

Her kod değişikliğinde:

1. Tüm JavaScript dosyalarında `node --check` ve `tests/*.test.cjs` testleri çalıştırılır.
2. `powershell -ExecutionPolicy Bypass -File scripts/repository-audit.ps1` çalıştırılır.
3. Kullanıcı davranışı değiştiyse `manifest.json` sürümü, `README.md` ve `PRIVACY.md` güncellenir.
4. Yalnız audit başarılıysa commit oluşturulup GitHub deposuna push edilir.
5. Chrome Web Store ZIP'i yalnız manifestte kullanılan çalışma zamanı dosyaları, ikonlar ve gerekli belgelerden oluşturulur.

Kimlik bilgileri, kişisel veriler ve makineye özgü dosyalar depoya eklenmez.
