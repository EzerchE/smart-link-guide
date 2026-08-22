# Akıllı Link Rehberi

Bu Chrome Manifest V3 eklentisi, reklam/yönlendirme sayfalarındaki açık hedefleri güvenli biçimde önizler ve kullanıcının doğruladığı geçişleri yalnız yerel depoda öğrenir. Sabit bir site listesine bağlı değildir.

## Çalışma modeli

1. URL içindeki `url`, `target`, `destination`, `redirect`, `next` gibi hedef parametrelerini ve URL/base64 biçimindeki benzer değerleri çözer.
2. Meta refresh ve açıkça etiketlenmiş dış hedef bağlantılarını gösterir.
3. Kısa bağlantı/geçiş sayfasından ayrıldıktan sonra ulaşılan hedef için kullanıcı doğrulaması ister.
4. Doğrulanan tam bağlantıyı 30 gün boyunca otomatik kullanabilir.
5. Aynı alan adı + hedef parametresi iki farklı doğrulama aldığında kalıbı yeni bağlantılara genelleyebilir.
6. Yüksek olasılıklı geçiş sayfalarında script kaynaklı popup'ları koşullu olarak bastırır ve dinamik hedefi 1,5/4 saniyede yeniden kontrol eder.
7. Agresif FastPass modunda yaygın sayaç değişkenlerini sıfırlar, geçiş timer'larını hızlandırır ve kilitli Continue/Get Link/I'm Human kontrollerini otomatik çalıştırır.
8. Belirgin reklam kutularını ve şeffaf tıklama katmanlarını yalnız geçiş sayfasında bastırır.
9. Seçime bağlı olarak, reklam engelleyici ayarını değiştirmeden etkin geçişi örten anti-adblock katmanını kaldırır.
10. Sayfada görünmeyen, güvenli ve tek bir açık hedefi üç saniyelik iptal edilebilir gecikmeyle aynı sekmede açar.
11. Container sayfalarının görünür sonuç bağlantılarını tamamlanmış aşama sayar ve hedef paketi olarak yerel öğrenebilir.

`#` adresli JavaScript geçiş düğmeleri gerçek tıklama olarak çalıştırılır. `/Link/1` gibi aynı alan adındaki ara uçlar nihai hedef sayılmaz.

0.3.1 sürümünde CAPTCHA metni yazılırken erken form gönderimi engellenir. PoW/CAPTCHA görünürken sayaç ve timer hızlandırması tamamen durur; doğrulama kullanıcı tarafından tamamlanınca FastPass yeniden devralır.

Eklenti hiçbir uzak öğrenme/telemetri servisi kullanmaz. Öğrenilen tam URL'ler, kalıplar ve sayaçlar `chrome.storage.local` içinde kalır.

## Güvenlik sınırları

- CAPTCHA, parola, ödeme, oturum veya sunucu tarafı erişim doğrulaması çözülmez ya da taklit edilmez.
- Agresif FastPass açıksa yalnız geçiş sayfasında sayaç/timer değişkenleri hızlandırılır ve hassas alan içermeyen devam formları gönderilebilir.
- Popup koruması yalnız geçiş puanı eşiği aşıldığında etkinleşir ve ayarlardan kapatılabilir.
- `javascript:`, `data:` ve yerel/özel ağ hedefleri kabul edilmez.
- Çalıştırılabilir/yüksek riskli dosya uzantıları otomatik açılmaz.
- Sayfa metni extension HTML'i olarak işlenmez; kullanıcıya gösterilen değerler `textContent` ile yazılır.

Hedefi şifreleyip gerçek CAPTCHA arkasında tutan servislerde doğrulama kullanıcı tarafından tamamlanmalıdır. Doğrulama kaybolduğu anda FastPass kalan adımları otomatik sürdürür ve ulaşılan doğru hedefi onayla öğrenebilir. Aynı yaklaşım parola korumalı container'lar için de geçerlidir.

## Kurulum

1. Chrome'da `chrome://extensions` adresini açın.
2. **Geliştirici modu**nu etkinleştirin.
3. **Paketlenmemiş öğe yükle** ile bu `smart-link-guide` klasörünü seçin.
4. Popup'taki ana anahtarı açık bırakın.

Eklenti tüm HTTP/HTTPS sayfalarında yalnız küçük bir geçiş sezgisi çalıştırdığı için geniş host izni ister. Normal sayfalarda DOM değişikliği yapmaz; geçiş işareti veya öğrenme onayı olduğunda küçük bir yardımcı kart gösterir.

## Lisans

MIT — ayrıntılar için `LICENSE` dosyasına bakın.
