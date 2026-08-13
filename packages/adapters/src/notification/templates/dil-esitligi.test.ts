import { LOCALES, type Locale } from '@vt/contracts';
import { describe, expect, it } from 'vitest';
import { smsSegmentCount } from '../template.js';
import type { NotificationTemplate, TemplateKey } from '../template.js';
import { EN_TEMPLATES, TR_TEMPLATES, templateRegistry } from './index.js';

/**
 * ŞABLON SETLERİNİN DİLLER ARASI EŞİTLİĞİ.
 *
 * ⚠️ BU DOSYA OLMADAN ÇEVİRİ EKSİĞİ HİÇ GÖRÜNMEZ. Bildirim, kullanıcının
 *    göremediği bir yüzeydir: bir değişkeni İngilizce metne koymayı unutmak,
 *    takip numarası olmayan bir kargo SMS'i göndermek demektir ve bunu ne
 *    `tsc` ne de bir sayfa çekimi gösterir. Bu depoda bildirimlerin sessizce
 *    hiç gitmemesi (BullMQ `jobId`) bir kez zaten yaşandı.
 *
 * ⚠️ Derleme kapısı `Record<TemplateKey, NotificationTemplate>` ile ANAHTARLARI
 *    zaten kapatıyor. Buradaki testler onun GÖREMEDİĞİ üç şeyi kapatıyor:
 *    değişken listeleri, kanal kümeleri ve sürüm numaraları.
 */

const SETLER: Record<Locale, Readonly<Record<TemplateKey, NotificationTemplate>>> = {
  tr: TR_TEMPLATES,
  en: EN_TEMPLATES,
};

describe('bildirim şablonları — diller arası eşitlik', () => {
  it('her dil için set var ve anahtarlar birebir eşit', () => {
    for (const locale of LOCALES) {
      expect(SETLER[locale], locale).toBeTruthy();
    }
    expect(Object.keys(EN_TEMPLATES).sort()).toEqual(Object.keys(TR_TEMPLATES).sort());
  });

  /**
   * ⚠️ EN PAHALI SESSİZ HATA. `variables` listesi çağıran tarafın SÖZLEŞMESİ:
   *    listede olmayan bir yer tutucu doldurulmaz ve metinde `{trackingNumber}`
   *    olarak kalır; listede olup metinde olmayan bir değişken ise gönderimi
   *    düşürür. İkisi de yalnızca o dildeki kullanıcıda görünür.
   */
  it('değişken listeleri iki dilde AYNI', () => {
    for (const key of Object.keys(TR_TEMPLATES) as TemplateKey[]) {
      expect([...EN_TEMPLATES[key].variables].sort(), key).toEqual(
        [...TR_TEMPLATES[key].variables].sort(),
      );
    }
  });

  it('her dilde bildirilen değişkenler gövdedeki yer tutucularla örtüşür', () => {
    for (const locale of LOCALES) {
      for (const sablon of Object.values(SETLER[locale])) {
        const govdeler = [
          sablon.sms?.body,
          sablon.email?.subject,
          sablon.email?.html,
          sablon.email?.text,
        ].filter((deger): deger is string => deger !== undefined);

        const kullanilan = new Set<string>();
        for (const govde of govdeler) {
          for (const eslesme of govde.matchAll(/\{(\w+)\}/g)) {
            if (eslesme[1]) kullanilan.add(eslesme[1]);
          }
        }

        expect([...kullanilan].sort(), `${locale}/${sablon.key}`).toEqual(
          [...sablon.variables].sort(),
        );
        expect(govdeler.length, `${locale}/${sablon.key}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * ⚠️ KANAL KÜMESİ ÇEVİRİ KARARI DEĞİL, MALİYET VE KVKK KARARI. İngilizce
   *    sette bir şablona SMS eklemek, Türkçe kullanıcıya gitmeyen bir SMS'i
   *    İngilizce kullanıcıya göndermek olurdu — ve fatura kalemi olarak
   *    görünene kadar kimse fark etmezdi.
   */
  it('kanal kümeleri iki dilde AYNI', () => {
    for (const key of Object.keys(TR_TEMPLATES) as TemplateKey[]) {
      expect(Boolean(EN_TEMPLATES[key].sms), `${key} SMS`).toBe(Boolean(TR_TEMPLATES[key].sms));
      expect(Boolean(EN_TEMPLATES[key].email), `${key} e-posta`).toBe(
        Boolean(TR_TEMPLATES[key].email),
      );
    }
  });

  /**
   * ⚠️ Sürüm, "kullanıcı tam olarak ne okudu" sorusunun aylar sonraki tek
   *    cevabı. Dile göre ayrışsaydı gönderim kaydındaki numara hangi metni
   *    gösterdiğini söylemez olurdu.
   */
  it('sürüm numaraları iki dilde AYNI', () => {
    for (const key of Object.keys(TR_TEMPLATES) as TemplateKey[]) {
      expect(EN_TEMPLATES[key].version, key).toBe(TR_TEMPLATES[key].version);
    }
  });

  /** KVKK hesap silme metni İngilizcede de DEĞİŞKENSİZ — gerekçe hukuki, üsluba dair değil. */
  it('KVKK hesap silme şablonu İngilizcede de kişisel veri taşımaz', () => {
    expect(EN_TEMPLATES['kvkk-hesap-silindi'].variables).toEqual([]);
    expect(EN_TEMPLATES['kvkk-hesap-silindi'].sms).toBeUndefined();
  });

  /**
   * ⚠️ "İngilizce nasılsa GSM-7'de kalır, sığar" VARSAYIMI TEST EDİLİR.
   *    Türkçe metinler UCS-2'ye düşüp segmenti 70 karaktere indiriyor;
   *    İngilizcede bu baskı yok ama metin uzarsa fatura yine ikiye katlanır.
   */
  it('İngilizce SMS metinleri tek segmentte kalır', () => {
    for (const sablon of Object.values(EN_TEMPLATES)) {
      if (!sablon.sms) continue;
      expect(smsSegmentCount(sablon.sms.body), sablon.key).toBe(1);
    }
  });
});

describe('templateRegistry', () => {
  it('dile göre doğru seti döndürür', () => {
    expect(templateRegistry('tr').get('hosgeldin')).toBe(TR_TEMPLATES.hosgeldin);
    expect(templateRegistry('en').get('hosgeldin')).toBe(EN_TEMPLATES.hosgeldin);
  });

  /** ⚠️ Dil verilmezse Türkçe — bugünkü davranış birebir korunuyor. */
  it('dil verilmezse Türkçe', () => {
    expect(templateRegistry().get('hosgeldin')).toBe(TR_TEMPLATES.hosgeldin);
  });
});
