# Gizlilik bildirimi

Son güncelleme: 22 Ağustos 2026

Akıllı Link Rehberi'nin tek amacı, reklam/yönlendirme geçişlerini yerel olarak analiz etmek, güvenli görünen hedefleri göstermek veya açmak ve kullanıcının doğruladığı geçişleri cihazda öğrenmektir.

## Yerel olarak işlenen veriler

Eklenti kullanıcı tarafından etkinleştirildiğinde açık sayfanın URL'sini, görünür geçiş metinlerini, bağlantı ve form etiketlerini, yönlendirme zincirini ve kullanıcının doğruladığı hedefleri işler. Bunlar web gezinme etkinliği ve web sitesi içeriği sayılabilir.

Öğrenilen URL'ler, container hedef paketleri, ayarlar ve sayaçlar yalnız `chrome.storage.local` içinde tutulur. Geliştirici sunucusuna veya başka bir analiz/telemetri servisine gönderilmez.

## Saklama ve silme

Doğrulanan otomatik kurallar en fazla 30 gün otomatik kullanılır. Kullanıcı popup içinden öğrenilen kuralları silebilir; eklenti kaldırıldığında Chrome yerel eklenti verilerini kaldırır.

## Reklam ve satış

Eklenti kullanıcı verisini satmaz, reklam hedefleme amacıyla kullanmaz, üçüncü taraf reklam platformlarına aktarmaz ve affiliate kodu eklemez.

## İzinlerin amacı

- HTTP/HTTPS host erişimi: geçiş sayfalarındaki yerel DOM işaretlerini ve hedef bağlantıları analiz etmek.
- `webNavigation`: yalnız etkin geçişin yönlendirme zincirini yerel olarak izlemek.
- `storage`: ayarları ve kullanıcının doğruladığı hedefleri cihazda saklamak.

Bu eklentinin kullanıcı verilerini kullanımı, Chrome Web Store User Data Policy'deki Limited Use şartlarına uygundur; veriler yalnız açıklanan tek amacı sağlamak için işlenir.

Gizlilik veya silme talepleri için GitHub deposundaki Issues ya da Security kanalı kullanılabilir; destek talebine özel URL'ler, CAPTCHA görüntüleri, oturum verileri veya başka hassas bilgiler eklenmemelidir.
