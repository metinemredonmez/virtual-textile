import { appError } from '@vt/contracts';
import type { NotificationChannel } from './notification.provider.js';

/**
 * ŞABLON MOTORU
 *
 * Şablon METİNLERİ burada değil, `templates/tr.ts` içindedir. Metin ile mantığı
 * ayırmanın sebebi pratiktir: bir ifadeyi düzeltmek (pazarlama/hukuk talebi)
 * kod incelemesi gerektirmemeli, ama doldurma kuralları tek yerde kalmalı.
 *
 * ⚠️ VERSİYONLU. Her şablonun `version` alanı vardır ve metin değişince ELLE
 *    artırılır. Gönderim kaydına yazılan versiyon, "kullanıcı hangi metni
 *    gördü" sorusunun tek cevabıdır — şikâyet veya hukuki talep geldiğinde
 *    bugünkü metne bakmak yanıltıcıdır.
 */

export type TemplateKey =
  | 'otp-dogrulama'
  | 'hosgeldin'
  | 'siparis-alindi'
  | 'siparis-kargolandi'
  | 'iade-onaylandi'
  | 'iade-reddedildi'
  | 'payout-gonderildi'
  | 'satici-yeni-siparis'
  | 'satici-onaylandi';

export interface SmsBody {
  readonly body: string;
}

export interface EmailBody {
  readonly subject: string;
  readonly html: string;
  /** ⚠️ Zorunlu: HTML engelleyen istemcide görünen TEK içerik budur. */
  readonly text: string;
}

export interface NotificationTemplate {
  readonly key: TemplateKey;
  /** Metin değişince ELLE artırılır. */
  readonly version: number;
  /**
   * Doldurulması ZORUNLU değişkenler.
   *
   * ⚠️ Yer tutucular metinden çıkarılmaz, açıkça yazılır: bir değişkeni
   *    metinden silmek onu zorunlu listeden düşürmemeli, kararın bilinçli
   *    olduğu görünmelidir.
   */
  readonly variables: readonly string[];
  readonly sms?: SmsBody;
  readonly email?: EmailBody;
}

export type TemplateVariables = Readonly<Record<string, string>>;

export interface RenderedSms {
  readonly channel: 'SMS';
  readonly templateKey: TemplateKey;
  readonly templateVersion: number;
  /** ⚠️ OTP içerebilir — LOGLANMAZ. */
  readonly body: string;
}

export interface RenderedEmail {
  readonly channel: 'EMAIL';
  readonly templateKey: TemplateKey;
  readonly templateVersion: number;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export type RenderedNotification = RenderedSms | RenderedEmail;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * ⚠️ HTML KAÇIŞI ZORUNLU.
 *
 * Şablon değişkenleri kullanıcı/satıcı verisidir: mağaza adı, iade gerekçesi,
 * isim. Kaçırılmadan HTML gövdesine konursa satıcının seçtiği bir mağaza adı
 * e-posta içeriğine etiket enjekte edebilir — alıcı bizim adımıza gönderilmiş
 * sahte bir bağlantı görür. Düz metin ve SMS gövdelerinde kaçış YAPILMAZ:
 * orada işaretleme yoktur, kaçış yalnızca metni bozar (`&amp;` görünür).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Yer tutucuları doldurur.
 *
 * ⚠️ `@vt/contracts` içindeki `interpolate()` KULLANILMAZ. O fonksiyon eksik
 *    parametrede yer tutucuyu OLDUĞU GİBİ bırakır; hata mesajları için doğru
 *    bir tercihtir (mesaj yine okunur). Bildirimde aynı davranış, kullanıcıya
 *    "Sayın {name}, siparişiniz..." SMS'i göndermek demektir. Burada eksik
 *    değişken gönderimi DURDURUR.
 */
function fill(
  template: string,
  variables: TemplateVariables,
  context: string,
  escape = false,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === '') {
      // Aile `system`: bu bir kullanıcı hatası değil, BİZİM çağrı hatamızdır.
      // Alarm üretmeli — sessizce yarım metin göndermekten iyidir.
      throw appError('INTERNAL_ERROR', {
        internalMessage: `Bildirim şablonu değişkeni eksik: ${name} (${context})`,
      });
    }
    return escape ? escapeHtml(value) : value;
  });
}

export interface TemplateRegistry {
  get(key: TemplateKey): NotificationTemplate | undefined;
}

/**
 * Şablonu doldurur.
 *
 * Fırlatma koşulları — hepsi BİZİM hatamız, hepsi gönderimi durdurur:
 *  - şablon yok
 *  - şablon bu kanalı desteklemiyor (ör. OTP e-posta ile istendi)
 *  - zorunlu değişken verilmemiş
 */
export function renderNotification(
  registry: TemplateRegistry,
  key: TemplateKey,
  channel: NotificationChannel,
  variables: TemplateVariables,
): RenderedNotification {
  const template = registry.get(key);
  if (!template) {
    throw appError('INTERNAL_ERROR', {
      internalMessage: `Bildirim şablonu bulunamadı: ${key}`,
    });
  }

  for (const name of template.variables) {
    if (variables[name] === undefined || variables[name] === '') {
      throw appError('INTERNAL_ERROR', {
        internalMessage: `Bildirim şablonu değişkeni eksik: ${name} (${key}/${channel})`,
      });
    }
  }

  if (channel === 'SMS') {
    if (!template.sms) {
      // ⚠️ Sessizce e-postaya düşmek YOK: OTP'yi e-posta ile göndermek,
      //    kullanıcının telefonunu doğruladığı iddiasını çürütür.
      throw appError('INTERNAL_ERROR', {
        internalMessage: `Şablon SMS kanalını desteklemiyor: ${key}`,
      });
    }
    return {
      channel: 'SMS',
      templateKey: key,
      templateVersion: template.version,
      body: fill(template.sms.body, variables, `${key}/SMS`),
    };
  }

  if (!template.email) {
    throw appError('INTERNAL_ERROR', {
      internalMessage: `Şablon e-posta kanalını desteklemiyor: ${key}`,
    });
  }

  return {
    channel: 'EMAIL',
    templateKey: key,
    templateVersion: template.version,
    subject: fill(template.email.subject, variables, `${key}/EMAIL/subject`),
    html: fill(template.email.html, variables, `${key}/EMAIL/html`, true),
    text: fill(template.email.text, variables, `${key}/EMAIL/text`),
  };
}

// ── SMS uzunluğu ──────────────────────────────────────────────────────────

/**
 * GSM-7 alfabesinde OLMAYAN Türkçe harfler. Biri bile geçerse mesaj UCS-2
 * kodlanır ve segment başına 160 değil 70 karakter düşer.
 *
 * ⚠️ 'İ', 'ı', 'ş', 'Ş' GSM-7'de yoktur; 'ğ', 'Ğ', 'ç', 'Ç', 'ö', 'Ö', 'ü',
 *    'Ü' Türkçe eklentisinde vardır ama operatör tarafında güvenilir değildir.
 *    Bu yüzden hepsi UCS-2 tetikleyicisi sayılır — maliyeti OLDUĞUNDAN DÜŞÜK
 *    tahmin etmektense yüksek tahmin etmek yeğdir.
 */
const NON_GSM7 = /[İıŞşĞğÇçÖöÜü]/;

/**
 * Mesajın kaç SMS segmenti tuttuğu. Netgsm segment başına faturalandırır;
 * şablon metnini kısaltma kararı ancak bu sayı ölçülünce verilebilir.
 */
export function smsSegmentCount(body: string): number {
  const unicode = NON_GSM7.test(body);
  const single = unicode ? 70 : 160;
  const concatenated = unicode ? 67 : 153;
  const length = [...body].length;

  if (length === 0) return 0;
  if (length <= single) return 1;
  return Math.ceil(length / concatenated);
}
