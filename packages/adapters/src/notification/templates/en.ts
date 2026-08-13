import type { NotificationTemplate, TemplateKey } from '../template.js';

/**
 * İNGİLİZCE BİLDİRİM ŞABLONLARI — METİN, KOD DEĞİL.
 *
 * `tr.ts`in birebir karşılığı. Aynı kurallar geçerli ve tekrarlanmayacak;
 * burada yalnızca İngilizceye ÖZGÜ olanlar yazılı.
 *
 * ⚠️ `variables` DİZİLERİ İKİ DİLDE AYNI OLMAK ZORUNDA ve testle kapalı
 *    (`templates.test.ts`). Bir değişkeni İngilizce metne koymayı unutmak,
 *    kullanıcıya takip numarasız bir kargo bildirimi göndermek demektir —
 *    ve hiçbir derleme bunu göremez, çünkü iki metin de `string`.
 *
 * ⚠️ `version` ALANI DA AYNI. Sürüm, "kullanıcı tam olarak ne okudu"
 *    sorusunun aylar sonraki tek cevabı; dile göre ayrışsaydı gönderim kaydına
 *    yazılan numara hangi metni gösterdiğini söylemez olurdu.
 *
 * ⚠️ SMS SEGMENTİ — İNGİLİZCENİN TEK GERÇEK AVANTAJI. Türkçe karakter mesajı
 *    UCS-2'ye düşürüp segmenti 70 karaktere indiriyor (fatura kalemi);
 *    İngilizce metinler GSM-7 alfabesinde kalır ve segment 160 karakter olur.
 *    Yine de kısa yazılıyor: `smsSegmentCount` her iki dilde de kontrol edilir,
 *    "İngilizce nasılsa sığar" varsayımı ilk uzun şablonda çöker.
 *
 * ⚠️ TÜRKÇE ŞABLONLARDAKİ SMS METİNLERİ AKSANSIZ ("dogrulama", "gecerli") ve
 *    bu bilinçliydi — segment kazanmak için. İngilizcede böyle bir baskı yok,
 *    metin normal yazılır.
 */

/** Ortak imza — `tr.ts`teki `IMZA_HTML`/`IMZA_TEXT` karşılığı. */
const SIGNATURE_HTML =
  '<p style="color:#666;font-size:12px">This e-mail was sent automatically.</p>';
const SIGNATURE_TEXT = '\n\nThis e-mail was sent automatically.';

export const EN_TEMPLATES: Readonly<Record<TemplateKey, NotificationTemplate>> = {
  'otp-dogrulama': {
    key: 'otp-dogrulama',
    version: 1,
    variables: ['code', 'minutes'],
    sms: {
      // "Do not share with anyone" — Türkçesindeki gerekçe aynen geçerli.
      body: '{code} is your verification code. Valid for {minutes} minutes. Do not share it with anyone.',
    },
  },

  hosgeldin: {
    key: 'hosgeldin',
    version: 1,
    variables: ['name'],
    email: {
      subject: 'Welcome',
      html: `<p>Hello {name},</p><p>Your account has been created. You can now try products on virtually and save your favourites.</p>${SIGNATURE_HTML}`,
      text: `Hello {name},\n\nYour account has been created. You can now try products on virtually and save your favourites.${SIGNATURE_TEXT}`,
    },
  },

  'siparis-alindi': {
    key: 'siparis-alindi',
    version: 1,
    variables: ['orderNumber', 'total'],
    sms: {
      body: 'Your order {orderNumber} has been received. Total: {total}',
    },
    email: {
      subject: 'Your order {orderNumber} has been received',
      html: `<p>Your order has been received.</p><p><b>Order no:</b> {orderNumber}<br><b>Total:</b> {total}</p><p>We will let you know again once it ships.</p>${SIGNATURE_HTML}`,
      text: `Your order has been received.\n\nOrder no: {orderNumber}\nTotal: {total}\n\nWe will let you know again once it ships.${SIGNATURE_TEXT}`,
    },
  },

  'siparis-kargolandi': {
    key: 'siparis-kargolandi',
    version: 1,
    variables: ['orderNumber', 'carrier', 'trackingNumber'],
    sms: {
      body: 'Your order {orderNumber} has shipped. {carrier} tracking no: {trackingNumber}',
    },
    email: {
      subject: 'Your order {orderNumber} has shipped',
      html: `<p>Your order has shipped.</p><p><b>Order no:</b> {orderNumber}<br><b>Carrier:</b> {carrier}<br><b>Tracking number:</b> {trackingNumber}</p>${SIGNATURE_HTML}`,
      text: `Your order has shipped.\n\nOrder no: {orderNumber}\nCarrier: {carrier}\nTracking number: {trackingNumber}${SIGNATURE_TEXT}`,
    },
  },

  'iade-onaylandi': {
    key: 'iade-onaylandi',
    version: 1,
    variables: ['orderNumber', 'amount'],
    sms: {
      body: 'The return for order {orderNumber} was approved. {amount} will be refunded to your card.',
    },
    email: {
      subject: 'Your return request was approved',
      html: `<p>Your return request for order {orderNumber} has been approved.</p><p><b>Refund amount:</b> {amount}</p><p>Depending on your bank, it may take a few business days for the amount to appear on your card.</p>${SIGNATURE_HTML}`,
      text: `Your return request for order {orderNumber} has been approved.\n\nRefund amount: {amount}\n\nDepending on your bank, it may take a few business days for the amount to appear on your card.${SIGNATURE_TEXT}`,
    },
  },

  'iade-reddedildi': {
    key: 'iade-reddedildi',
    version: 1,
    variables: ['orderNumber', 'reason'],
    email: {
      subject: 'Your return request has been resolved',
      html: `<p>Your return request for order {orderNumber} was not approved.</p><p><b>Reason:</b> {reason}</p><p>You can contact our support team to appeal this decision.</p>${SIGNATURE_HTML}`,
      text: `Your return request for order {orderNumber} was not approved.\n\nReason: {reason}\n\nYou can contact our support team to appeal this decision.${SIGNATURE_TEXT}`,
    },
  },

  'payout-gonderildi': {
    key: 'payout-gonderildi',
    version: 1,
    variables: ['amount', 'date'],
    email: {
      subject: 'Your payout has been sent',
      html: `<p>Your earnings payout has been submitted to the bank.</p><p><b>Amount:</b> {amount}<br><b>Sent on:</b> {date}</p><p>The time it takes to reach your account depends on your bank.</p>${SIGNATURE_HTML}`,
      text: `Your earnings payout has been submitted to the bank.\n\nAmount: {amount}\nSent on: {date}\n\nThe time it takes to reach your account depends on your bank.${SIGNATURE_TEXT}`,
    },
  },

  'satici-yeni-siparis': {
    key: 'satici-yeni-siparis',
    version: 1,
    variables: ['orderNumber', 'itemCount'],
    sms: {
      body: 'New order: {orderNumber} ({itemCount} items). Prepare it from your dashboard.',
    },
    email: {
      subject: 'New order: {orderNumber}',
      html: `<p>Your store received a new order.</p><p><b>Order no:</b> {orderNumber}<br><b>Item count:</b> {itemCount}</p><p>You can prepare and ship the order from your seller dashboard.</p>${SIGNATURE_HTML}`,
      text: `Your store received a new order.\n\nOrder no: {orderNumber}\nItem count: {itemCount}\n\nYou can prepare and ship the order from your seller dashboard.${SIGNATURE_TEXT}`,
    },
  },

  'satici-onaylandi': {
    key: 'satici-onaylandi',
    version: 1,
    variables: ['storeName'],
    email: {
      subject: 'Your store application was approved',
      html: `<p>Your store <b>{storeName}</b> has been approved.</p><p>You can now add products and start selling.</p>${SIGNATURE_HTML}`,
      text: `Your store {storeName} has been approved.\n\nYou can now add products and start selling.${SIGNATURE_TEXT}`,
    },
  },

  // ── KVKK ────────────────────────────────────────────────────────────────

  /**
   * ⚠️ DEĞİŞKENSİZ KALIR. Türkçesindeki gerekçe hukukidir, üsluba dair değil:
   *    bu e-posta kişisel verisi az önce silinmiş birine gider; içine ad ya da
   *    sipariş numarası koymak silinen veriyi e-posta sağlayıcısının
   *    kayıtlarında yeniden var etmek olurdu. Çeviri bu kararı DEĞİŞTİREMEZ.
   *
   * ⚠️ KVKK metni İngilizceye çevrilirken mevzuat atfı KORUNUYOR ama hukuki
   *    metnin kendisi ÇEVRİLMİYOR — bu bir bildirimdir, sözleşme değil.
   *    İngilizce hukuki metinler hukukçu işidir (`docs/i18n.md`).
   */
  'kvkk-hesap-silindi': {
    key: 'kvkk-hesap-silindi',
    version: 1,
    variables: [],
    email: {
      subject: 'Your account has been deleted',
      html: `<p>Your account deletion request has been completed. Your account and personal data have been permanently deleted.</p><p>Invoice and accounting records that must be retained by law continue to be kept, separated from your identifying information.</p>${SIGNATURE_HTML}`,
      text: `Your account deletion request has been completed. Your account and personal data have been permanently deleted.\n\nInvoice and accounting records that must be retained by law continue to be kept, separated from your identifying information.${SIGNATURE_TEXT}`,
    },
  },

  'kvkk-veri-indirme-hazir': {
    key: 'kvkk-veri-indirme-hazir',
    version: 1,
    variables: ['link', 'hours'],
    email: {
      subject: 'Your data is ready to download',
      html: `<p>The archive containing your personal data is ready.</p><p><a href="{link}">Download the archive</a></p><p>The link is valid for <b>{hours} hours</b>; once it expires you will need to make a new request. Do not share the link with anyone.</p>${SIGNATURE_HTML}`,
      text: `The archive containing your personal data is ready.\n\nDownload the archive: {link}\n\nThe link is valid for {hours} hours; once it expires you will need to make a new request. Do not share the link with anyone.${SIGNATURE_TEXT}`,
    },
  },
};
