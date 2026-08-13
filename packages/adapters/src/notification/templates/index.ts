import { VARSAYILAN_LOCALE, type Locale } from '@vt/contracts';
import type { NotificationTemplate, TemplateKey, TemplateRegistry } from '../template.js';
import { EN_TEMPLATES } from './en.js';
import { TR_TEMPLATES } from './tr.js';

/**
 * ŞABLON KAYIT DEFTERİ
 *
 * Bir arayüzün arkasında duruyor. Sebep test: şablon doldurma kuralları gerçek
 * metinlerden BAĞIMSIZ doğrulanabilmeli, yoksa her metin düzeltmesi testleri
 * kırar ve testler zamanla metnin kopyasına dönüşür.
 *
 * ⚠️ `Record<Locale, …>` AÇIK TİP ANNOTASYONU, `satisfies` DEĞİL: `LOCALES`
 *    listesine yeni bir dil eklendiği gün eksik şablon seti TAM BU SATIRDA
 *    derlemeyi kırsın diye. `satisfies` yazılsaydı eksik dil ancak çalışma
 *    zamanında, hem de "bildirim HİÇ GİTMEDİ" biçiminde görünürdü — bu depoda
 *    BullMQ `jobId` yüzünden bir kez tam olarak bu yaşandı.
 */
const SETLER: Record<Locale, Readonly<Record<TemplateKey, NotificationTemplate>>> = {
  tr: TR_TEMPLATES,
  en: EN_TEMPLATES,
};

/**
 * ⚠️ WORKER'DA `Accept-Language` YOKTUR. Bildirim gönderen kod bir HTTP
 *    isteğinin içinde değil, bir BullMQ işinin içinde çalışıyor; dil tek
 *    kaynaktan gelebilir: `User.locale`. O sütun bugüne kadar ÖLÜYDÜ (yalnız
 *    KVKK dışa aktarımına dökülüyordu, hiçbir davranışı belirlemiyordu).
 *
 * ⚠️ DİL İŞ YÜKÜNE (`job payload`) YAZILMAK ZORUNDA; iş çalışırken
 *    veritabanından okumakla YETİNİLMEZ. İki sebep, ikincisi öldürücü:
 *      1. Kullanıcı iş kuyruğa girdikten sonra dilini değiştirirse bildirim,
 *         olayın yaşandığı andaki dilde değil şimdiki dilde gider.
 *      2. HESAP SİLME işinde kullanıcı satırı ARTIK YOKTUR — okuma `undefined`
 *         döner ve KVKK bildirimi varsayılan dile düşer ya da hiç gitmez.
 */
export function templateRegistry(locale: Locale = VARSAYILAN_LOCALE): TemplateRegistry {
  const set = SETLER[locale] ?? TR_TEMPLATES;
  return { get: (key: TemplateKey): NotificationTemplate | undefined => set[key] };
}

/** Türkçe kayıt defteri — GERİYE UYUM. İkinci bir tablo DEĞİL, `templateRegistry('tr')`. */
export const TR_TEMPLATE_REGISTRY: TemplateRegistry = templateRegistry('tr');

/**
 * Bir şablonun hangi kanalları desteklediği — çağıran taraf buna göre seçer.
 *
 * ⚠️ DİLE BAĞLI DEĞİL ve olmamalı: bir bildirimin SMS mi e-posta mı gideceği
 *    MALİYET ve KVKK kararıdır, çeviri kararı değil. İngilizce sette bir
 *    şablona SMS eklemek, Türkçe kullanıcıya gitmeyen bir SMS'i İngilizce
 *    kullanıcıya göndermek olurdu — ve fatura kalemi olarak görünene kadar
 *    kimse fark etmezdi. Kanal kümelerinin iki dilde AYNI olduğu testle kapalı.
 */
export function templateChannels(key: TemplateKey): readonly ('SMS' | 'EMAIL')[] {
  const template = TR_TEMPLATES[key];
  return [
    ...(template.sms ? (['SMS'] as const) : []),
    ...(template.email ? (['EMAIL'] as const) : []),
  ];
}

export { TR_TEMPLATES } from './tr.js';
export { EN_TEMPLATES } from './en.js';
