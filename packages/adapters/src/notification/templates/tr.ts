import type { NotificationTemplate, TemplateKey } from '../template.js';

/**
 * TÜRKÇE BİLDİRİM ŞABLONLARI — METİN, KOD DEĞİL
 *
 * Bu dosyada mantık YOKTUR ve olmamalıdır. Metinler koda gömülmediği için bir
 * ifadeyi düzeltmek (hukuk/pazarlama talebi) tek dosyada, tek satırda yapılır.
 *
 * ⚠️ VERSİYON: metni değiştiren `version` alanını da ARTIRIR. Gönderim kaydına
 *    yazılan versiyon, aylar sonra "kullanıcı tam olarak ne okudu" sorusunun
 *    tek cevabıdır.
 *
 * ⚠️ MARKA ADI METNE YAZILMAZ. Göndereni SMS'te `NETGSM_HEADER`, e-postada
 *    `MAIL_FROM` zaten belirtir. Metne ikinci kez yazmak hem segment (para)
 *    harcar hem de marka değiştiğinde dokuz şablonu birden bayatlatır.
 *
 * ⚠️ SMS metinleri KISA. Türkçe karakter mesajı UCS-2'ye düşürür ve segment
 *    70 karaktere iner; iki segmentlik bir OTP mesajı iki kat fatura demektir
 *    (bkz. `smsSegmentCount`).
 */

/** Ortak imza — e-posta metinlerinin sonunda tekrar eder. */
const IMZA_HTML = '<p style="color:#666;font-size:12px">Bu e-posta otomatik gönderilmiştir.</p>';
const IMZA_TEXT = '\n\nBu e-posta otomatik gönderilmiştir.';

export const TR_TEMPLATES: Readonly<Record<TemplateKey, NotificationTemplate>> = {
  /**
   * ⚠️ TEK KRİTİK ŞABLON: bu metin gitmezse kayıt akışı çalışmaz.
   *
   * "Kimseyle paylaşmayın" cümlesi süs değildir — dolandırıcının kullanıcıyı
   * arayıp kodu istemesi Türkiye'de en yaygın hesap ele geçirme yöntemidir.
   * Sağlayıcı da yalnızca SMS: OTP'yi e-postaya düşürmek, telefon doğrulama
   * iddiasını çürütür.
   */
  'otp-dogrulama': {
    key: 'otp-dogrulama',
    version: 1,
    variables: ['code', 'minutes'],
    sms: {
      body: '{code} dogrulama kodunuz. {minutes} dakika gecerli. Kimseyle paylasmayin.',
    },
  },

  hosgeldin: {
    key: 'hosgeldin',
    version: 1,
    variables: ['name'],
    email: {
      subject: 'Aramıza hoş geldiniz',
      html: `<p>Merhaba {name},</p><p>Hesabınız oluşturuldu. Artık ürünleri sanal olarak deneyebilir, favorilerinizi kaydedebilirsiniz.</p>${IMZA_HTML}`,
      text: `Merhaba {name},\n\nHesabınız oluşturuldu. Artık ürünleri sanal olarak deneyebilir, favorilerinizi kaydedebilirsiniz.${IMZA_TEXT}`,
    },
  },

  'siparis-alindi': {
    key: 'siparis-alindi',
    version: 1,
    variables: ['orderNumber', 'total'],
    sms: {
      body: '{orderNumber} nolu siparisiniz alindi. Tutar: {total}',
    },
    email: {
      subject: '{orderNumber} numaralı siparişiniz alındı',
      html: `<p>Siparişiniz alındı.</p><p><b>Sipariş no:</b> {orderNumber}<br><b>Tutar:</b> {total}</p><p>Kargoya verildiğinde tekrar bilgilendirileceksiniz.</p>${IMZA_HTML}`,
      text: `Siparişiniz alındı.\n\nSipariş no: {orderNumber}\nTutar: {total}\n\nKargoya verildiğinde tekrar bilgilendirileceksiniz.${IMZA_TEXT}`,
    },
  },

  'siparis-kargolandi': {
    key: 'siparis-kargolandi',
    version: 1,
    variables: ['orderNumber', 'carrier', 'trackingNumber'],
    sms: {
      body: '{orderNumber} nolu siparisiniz kargoda. {carrier} takip no: {trackingNumber}',
    },
    email: {
      subject: '{orderNumber} numaralı siparişiniz kargoya verildi',
      html: `<p>Siparişiniz kargoya verildi.</p><p><b>Sipariş no:</b> {orderNumber}<br><b>Kargo firması:</b> {carrier}<br><b>Takip numarası:</b> {trackingNumber}</p>${IMZA_HTML}`,
      text: `Siparişiniz kargoya verildi.\n\nSipariş no: {orderNumber}\nKargo firması: {carrier}\nTakip numarası: {trackingNumber}${IMZA_TEXT}`,
    },
  },

  /**
   * İade onayı SMS ile de gider: para iadesi bekleyen kullanıcı e-postasını
   * saatlerce açmayabilir ve bu bekleyiş doğrudan destek aramasına dönüşür.
   */
  'iade-onaylandi': {
    key: 'iade-onaylandi',
    version: 1,
    variables: ['orderNumber', 'amount'],
    sms: {
      body: '{orderNumber} nolu siparisin iadesi onaylandi. {amount} kartiniza iade edilecek.',
    },
    email: {
      subject: 'İade talebiniz onaylandı',
      html: `<p>{orderNumber} numaralı siparişinize ait iade talebiniz onaylandı.</p><p><b>İade tutarı:</b> {amount}</p><p>Tutarın kartınıza yansıması bankanıza bağlı olarak birkaç iş günü sürebilir.</p>${IMZA_HTML}`,
      text: `{orderNumber} numaralı siparişinize ait iade talebiniz onaylandı.\n\nİade tutarı: {amount}\n\nTutarın kartınıza yansıması bankanıza bağlı olarak birkaç iş günü sürebilir.${IMZA_TEXT}`,
    },
  },

  /**
   * ⚠️ Ret gerekçesi metne KONUR. Gerekçesiz ret, kullanıcının yapabileceği
   *    tek şeyi (itiraz mı, yeniden gönderim mi) belirsiz bırakır ve destek
   *    yükünü artırır.
   */
  'iade-reddedildi': {
    key: 'iade-reddedildi',
    version: 1,
    variables: ['orderNumber', 'reason'],
    email: {
      subject: 'İade talebiniz sonuçlandı',
      html: `<p>{orderNumber} numaralı siparişinize ait iade talebiniz onaylanmadı.</p><p><b>Gerekçe:</b> {reason}</p><p>Karara itiraz etmek için destek ekibimizle iletişime geçebilirsiniz.</p>${IMZA_HTML}`,
      text: `{orderNumber} numaralı siparişinize ait iade talebiniz onaylanmadı.\n\nGerekçe: {reason}\n\nKarara itiraz etmek için destek ekibimizle iletişime geçebilirsiniz.${IMZA_TEXT}`,
    },
  },

  /**
   * ⚠️ IBAN METNE YAZILMAZ — son dört hanesi bile. Satıcının IBAN'ı şifreli
   *    saklanıyor (FIELD_ENCRYPTION_KEY); e-posta ile düz metne dökmek o
   *    şifrelemeyi anlamsız kılar. Satıcı hangi hesabını verdiğini zaten bilir.
   */
  'payout-gonderildi': {
    key: 'payout-gonderildi',
    version: 1,
    variables: ['amount', 'date'],
    email: {
      subject: 'Ödemeniz gönderildi',
      html: `<p>Hakediş ödemeniz bankaya iletildi.</p><p><b>Tutar:</b> {amount}<br><b>Gönderim tarihi:</b> {date}</p><p>Hesabınıza geçiş süresi bankanıza bağlıdır.</p>${IMZA_HTML}`,
      text: `Hakediş ödemeniz bankaya iletildi.\n\nTutar: {amount}\nGönderim tarihi: {date}\n\nHesabınıza geçiş süresi bankanıza bağlıdır.${IMZA_TEXT}`,
    },
  },

  /**
   * Satıcıya SMS gider: yeni sipariş, kargo süresini başlatan olaydır ve
   * satıcının paneli açık beklemesi beklenemez.
   */
  'satici-yeni-siparis': {
    key: 'satici-yeni-siparis',
    version: 1,
    variables: ['orderNumber', 'itemCount'],
    sms: {
      body: 'Yeni siparis: {orderNumber} ({itemCount} urun). Panelden hazirlayin.',
    },
    email: {
      subject: 'Yeni sipariş: {orderNumber}',
      html: `<p>Mağazanıza yeni bir sipariş geldi.</p><p><b>Sipariş no:</b> {orderNumber}<br><b>Ürün adedi:</b> {itemCount}</p><p>Siparişi satıcı panelinden hazırlayıp kargoya verebilirsiniz.</p>${IMZA_HTML}`,
      text: `Mağazanıza yeni bir sipariş geldi.\n\nSipariş no: {orderNumber}\nÜrün adedi: {itemCount}\n\nSiparişi satıcı panelinden hazırlayıp kargoya verebilirsiniz.${IMZA_TEXT}`,
    },
  },

  'satici-onaylandi': {
    key: 'satici-onaylandi',
    version: 1,
    variables: ['storeName'],
    email: {
      subject: 'Mağaza başvurunuz onaylandı',
      html: `<p><b>{storeName}</b> mağazanız onaylandı.</p><p>Artık ürün ekleyebilir ve satışa başlayabilirsiniz.</p>${IMZA_HTML}`,
      text: `{storeName} mağazanız onaylandı.\n\nArtık ürün ekleyebilir ve satışa başlayabilirsiniz.${IMZA_TEXT}`,
    },
  },

  // ── KVKK ────────────────────────────────────────────────────────────────

  /**
   * HESAP SİLİNDİ — KVKK m.7 / m.11 bildirimi.
   *
   * ⚠️ DEĞİŞKENSİZ ve bu bilinçlidir. Bu e-posta, kişisel verisi az önce
   *    silinmiş bir kişiye gider; içine ad, sipariş numarası veya herhangi
   *    bir kimlik alanı koymak, silinen veriyi e-posta sağlayıcısının
   *    kayıtlarında yeniden var etmek olurdu. Alıcı adresi zaten zorunlu
   *    asgari; ötesi yazılmaz.
   *
   * ⚠️ SMS yok: silme kullanıcının kendi talebidir, duyurulması için segment
   *    (para) harcanmaz — işin kendisi de aynı gerekçeyle SMS göndermiyor.
   */
  'kvkk-hesap-silindi': {
    key: 'kvkk-hesap-silindi',
    version: 1,
    variables: [],
    email: {
      subject: 'Hesabınız silindi',
      html: `<p>Hesap silme talebiniz tamamlandı. Hesabınız ve kişisel verileriniz kalıcı olarak silindi.</p><p>Mevzuat gereği saklanması zorunlu olan fatura ve muhasebe kayıtları, kimlik bilgilerinizden ayrıştırılmış biçimde tutulmaya devam eder.</p>${IMZA_HTML}`,
      text: `Hesap silme talebiniz tamamlandı. Hesabınız ve kişisel verileriniz kalıcı olarak silindi.\n\nMevzuat gereği saklanması zorunlu olan fatura ve muhasebe kayıtları, kimlik bilgilerinizden ayrıştırılmış biçimde tutulmaya devam eder.${IMZA_TEXT}`,
    },
  },

  /**
   * VERİ İNDİRME HAZIR — KVKK m.11 veri taşınabilirliği.
   *
   * ⚠️ `link` KISA ÖMÜRLÜ İMZALI bir adrestir ve metne yazılan tek hassas
   *    alandır. `{hours}` metne AYRICA yazılır: bağlantının ne zaman öleceğini
   *    söylemeyen bir e-posta, kullanıcıyı çalışmayan bir bağlantıyla baş başa
   *    bırakır ve ikinci bir talep üretir.
   *
   * ⚠️ SMS yok: imzalı URL uzundur, SMS'te birden çok segment tutar ve
   *    operatör kısaltıcıları imzayı bozabilir.
   */
  'kvkk-veri-indirme-hazir': {
    key: 'kvkk-veri-indirme-hazir',
    version: 1,
    variables: ['link', 'hours'],
    email: {
      subject: 'Verileriniz indirmeye hazır',
      html: `<p>Kişisel verilerinizi içeren arşiv hazırlandı.</p><p><a href="{link}">Arşivi indir</a></p><p>Bağlantı <b>{hours} saat</b> geçerlidir; süre dolduğunda yeni bir talep oluşturmanız gerekir. Bağlantıyı kimseyle paylaşmayın.</p>${IMZA_HTML}`,
      text: `Kişisel verilerinizi içeren arşiv hazırlandı.\n\nArşivi indir: {link}\n\nBağlantı {hours} saat geçerlidir; süre dolduğunda yeni bir talep oluşturmanız gerekir. Bağlantıyı kimseyle paylaşmayın.${IMZA_TEXT}`,
    },
  },
};
