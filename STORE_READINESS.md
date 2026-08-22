# Chrome Web Store hazırlık durumu

## Uygun olan yönler

- Manifest V3 kullanılır; çalışma mantığı paketin içindedir ve uzaktan kod çalıştırılmaz.
- Tek amaç reklam/yönlendirme geçişlerini analiz edip hedefe ulaşmayı kolaylaştırmaktır.
- Yeni kurulum varsayılan olarak kapalıdır ve veri işleme popup içinde açıklanır.
- Zorunlu izinler `storage`, `webNavigation` ve HTTP/HTTPS host erişimiyle sınırlandırılmıştır.
- Parola, ödeme ve gerçek CAPTCHA çözme kapsam dışıdır.

## Yayından önce tamamlanacaklar

- 16, 32, 48 ve 128 piksel ikonlar; mağaza ekran görüntüleri ve tanıtım görselleri hazırlanmalıdır.
- Geniş host erişimi, görünür sayfa metni analizi, otomatik tıklama, popup bastırma ve yerel URL öğrenme mağaza açıklaması ile Developer Dashboard veri beyanında açıkça anlatılmalıdır.
- Her sitenin hizmet şartları farklı olabileceğinden otomasyonun kullanıcının sorumluluğunda olduğu belirtilmelidir.
- Otomatik reklam bastırma ve geçiş adımı çalıştırma davranışı, mağaza incelemesinde yanıltıcı veya site işlevini kötüye kullanan davranış olarak değerlendirilmemesi için dar eşikler ve kullanıcı tarafından kapatılabilir ayarlarla korunmalıdır.
- Herkese açık gizlilik politikası ve destek URL'si hazırlanmalıdır.

Bu maddeler tamamlanmadan public/unlisted Chrome Web Store gönderimi yapılmamalıdır. Nihai kabul yalnız Google incelemesiyle belirlenir.

## Gelir modeli

Atlanan site reklamlarının yerine geliştirici reklamı koymak veya otomatik affiliate kodu eklemek yüksek politika ve güven riski taşır; uygulanmamalıdır. Daha uygun seçenekler açıkça belirtilen ücretli lisans, isteğe bağlı abonelik, bağış veya premium destek modelidir. Kullanıcının URL veya gezinme verisi reklam hedefleme amacıyla kullanılamaz.
