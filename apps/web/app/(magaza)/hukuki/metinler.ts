/**
 * HUKUKİ METİNLERİN TEK KAYNAĞI.
 *
 * ⚠️ BU DOSYADA GERÇEK METİN YOKTUR VE UYDURULMAZ. Kayıt formu iki bağlantı
 *    veriyor (`/kullanim-kosullari`, `/aydinlatma-metni`) ve ikisi de 404
 *    dönüyordu; KVKK'da metnin GÖSTERİLMİŞ olması rızanın geçerlilik şartı
 *    olduğu için 404 dönen bir bağlantı, alınan onayı da tartışmalı hale
 *    getirir. Bu yüzden sayfalar VAR — ama içlerinde uydurulmuş bir sözleşme
 *    metni değil, metnin henüz yayınlanmadığı BİLGİSİ duruyor. Yanlış bir
 *    hukuki metin, eksik olandan daha zararlıdır.
 *
 * ⚠️ SÜRÜM SABİT OLARAK BURADA KOPYA DURUYOR ve bu bilinçli bir borç:
 *    `apps/api/src/modules/me/me.schema.ts` → `CONSENT_DOCUMENT_VERSION`
 *    ('kvkk-2026-01'). O sabit `@vt/config`te değil API modülünün içinde ve
 *    frontend `@vt/api`yi import edemez. Sunucu sürümü yükselttiğinde burası
 *    KENDİLİĞİNDEN kırılmaz — sabit `@vt/config`e taşındığı gün bu kopya
 *    silinip oradan okunmalı.
 *
 * ⚠️ Kullanıcının HANGİ sürümü onayladığı burada değil, `GET /me/consents`
 *    yanıtındaki `documentVersion` alanında; gizlilik ekranı onu gösteriyor.
 *    Buradaki değer yalnızca "bugün yürürlükte olan sürüm" iddiasıdır.
 */
export const YURURLUKTEKI_SURUM = 'kvkk-2026-01';

export interface HukukiMetin {
  slug: string;
  baslik: string;
  ozet: string;
  /** Metnin bugün ne durumda olduğu — kullanıcıya dürüstçe söylenen şey. */
  durum: string;
}

export const HUKUKI_METINLER = {
  'kullanim-kosullari': {
    slug: 'kullanim-kosullari',
    baslik: 'Kullanım koşulları',
    ozet: 'Virtual Textile üzerinden alışveriş yapan, satış yapan ve sanal deneme kullanan herkes için geçerli kurallar.',
    durum: 'Kullanım koşulları metni henüz yayınlanmadı.',
  },
  'aydinlatma-metni': {
    slug: 'aydinlatma-metni',
    baslik: 'Aydınlatma metni',
    ozet: 'Kişisel verilerinizin hangi amaçla işlendiği, kimlere aktarıldığı ve haklarınızı nasıl kullanacağınız.',
    durum: 'KVKK aydınlatma metni henüz yayınlanmadı.',
  },
} as const satisfies Record<string, HukukiMetin>;

export type HukukiSlug = keyof typeof HUKUKI_METINLER;

export const HUKUKI_SLUGLAR = Object.keys(HUKUKI_METINLER) as HukukiSlug[];
