/**
 * RIZA GEÇMİŞİ — SAF ÇEKİRDEK
 *
 * ⚠️ BU DOSYA BİR KVKK YÜKÜMLÜLÜĞÜNÜN KARŞILIĞIDIR (md.11).
 *
 * `ConsentRecord` APPEND-ONLY'dir. Geri çekme bir UPDATE değildir: `granted`
 * alanı `false` olan YENİ bir satır yazılır, eski satır olduğu yerde kalır.
 *
 * NEDEN: kurum, veriyi işlediği ANDA rızasının bulunduğunu ispat etmek
 * zorundadır. Satır güncellenseydi "rıza 3 Mart'ta verildi, 14 Nisan'da geri
 * çekildi" cümlesi kurulamaz, yalnızca "şu an rıza yok" bilinirdi; aradaki
 * işlemenin hukuka uygunluğu ispatlanamaz hâle gelirdi. Bu yüzden burada
 * yalnızca "şu anki durum" değil, TÜM ZAMAN ÇİZELGESİ üretilir.
 *
 * Saf fonksiyonlar — veritabanı, saat ve istek bağlamı bilmezler.
 */
import { consentTypeSchema, type ConsentType } from '@vt/contracts';
// ⚠️ Bilinçli yeniden kullanım, kopyalama DEĞİL. "Geçerli rıza = EN SON satır"
//    ve "eşit zaman damgasında geri çekme kazanır" kuralı hukuki bir karardır;
//    iki ayrı kopyası olsaydı biri gün gelip diğerinden ayrışır ve rızasını
//    geri çekmiş bir kullanıcının fotoğrafı işlenmeye devam ederdi.
//    (İçe aktarılan dosya saftır: veri erişimi ya da yan etkisi yoktur.)
import { latestConsentByType, type ConsentRecordLike } from '../ai/consent.rules.js';

/** Tüm rıza türleri — kullanıcıya hiç kaydı olmayanlar da gösterilir. */
export const ALL_CONSENT_TYPES: readonly ConsentType[] = consentTypeSchema.options;

/**
 * Fotoğrafın işlenmesini/aktarılmasını mümkün kılan rızalar.
 *
 * ⚠️ Bunlardan HERHANGİ BİRİ geri çekilirse fotoğraflar silinmek üzere
 *    işaretlenir. "İkisi de çekilsin" beklenmez: yurt dışı aktarım rızası
 *    kalkmışken fotoğrafı elde tutmak, ilk fırsatta yeniden sınır dışına
 *    çıkabilecek bir veriyi saklamak demektir.
 */
export const PHOTO_BEARING_CONSENTS: readonly ConsentType[] = [
  'PHOTO_PROCESSING',
  'CROSS_BORDER_TRANSFER',
];

/** Bir ConsentRecord satırının bu dosyanın ihtiyaç duyduğu alanları. */
export interface ConsentHistoryRecord extends ConsentRecordLike {
  /** Kullanıcının onayladığı aydınlatma metninin sürümü, ör. "kvkk-2026-01". */
  documentVersion: string;
}

/** Zaman çizelgesindeki tek bir olay. */
export interface ConsentEvent {
  granted: boolean;
  at: Date;
  documentVersion: string;
}

/** Bir rıza türünün kullanıcıya gösterilen tam durumu. */
export interface ConsentState {
  type: ConsentType;
  /** Şu an geçerli durum — EN SON satır. Hiç kayıt yoksa `false`. */
  granted: boolean;
  /** Bu duruma ne zaman girildi. Hiç kayıt yoksa `null`. */
  since: Date | null;
  /** Şu anki durumun dayandığı aydınlatma metni sürümü. */
  documentVersion: string | null;
  /** En son NE ZAMAN VERİLDİ — geri çekilmiş olsa bile dolu kalır. */
  lastGrantedAt: Date | null;
  /** En son NE ZAMAN GERİ ÇEKİLDİ — yeniden verilmiş olsa bile dolu kalır. */
  lastRevokedAt: Date | null;
  /** Tam zaman çizelgesi, yeniden eskiye. */
  history: ConsentEvent[];
}

/**
 * Görüntüleme sıralaması: yeniden eskiye.
 *
 * ⚠️ Eşit zaman damgasında GERİ ÇEKME önce gelir. Sıralama yalnızca bir
 *    görsel tercih değil: listenin ilk elemanı "geçerli durum" olarak
 *    okunabildiği için, belirsizlikte veri işleme aleyhine karar verilir
 *    (fail-closed) — `latestConsentByType` ile aynı kural.
 */
function newestFirst(a: ConsentHistoryRecord, b: ConsentHistoryRecord): number {
  const diff = b.createdAt.getTime() - a.createdAt.getTime();
  if (diff !== 0) return diff;
  if (a.granted === b.granted) return 0;
  return a.granted ? 1 : -1;
}

/**
 * Kullanıcının tüm rıza kayıtlarından tür bazlı durum listesi üretir.
 *
 * Hiç kaydı olmayan tür de listede döner (`granted: false`, `since: null`):
 * eksik satır "sormadık" demektir ve arayüzde "rıza verilmedi" ile aynı
 * anlama gelir; türü listeden düşürmek kullanıcıya rızayı verme imkânını da
 * göstermezdi.
 */
export function buildConsentStates(
  records: readonly ConsentHistoryRecord[],
  types: readonly ConsentType[] = ALL_CONSENT_TYPES,
): ConsentState[] {
  const effective = latestConsentByType(records);

  const byType = new Map<ConsentType, ConsentHistoryRecord[]>();
  for (const record of records) {
    const bucket = byType.get(record.type);
    if (bucket) bucket.push(record);
    else byType.set(record.type, [record]);
  }

  return types.map((type) => {
    const sorted = [...(byType.get(type) ?? [])].sort(newestFirst);
    const granted = effective.get(type) === true;
    const current = sorted[0] ?? null;

    return {
      type,
      granted,
      since: current?.createdAt ?? null,
      documentVersion: current?.documentVersion ?? null,
      lastGrantedAt: sorted.find((record) => record.granted)?.createdAt ?? null,
      lastRevokedAt: sorted.find((record) => !record.granted)?.createdAt ?? null,
      history: sorted.map((record) => ({
        granted: record.granted,
        at: record.createdAt,
        documentVersion: record.documentVersion,
      })),
    };
  });
}

/** Tek bir türün şu anki geçerli durumu — "en son satır" kuralıyla. */
export function currentConsent(
  records: readonly ConsentHistoryRecord[],
  type: ConsentType,
): boolean {
  return latestConsentByType(records).get(type) === true;
}

/**
 * Yeni satır GEÇERLİ DURUMU değiştiriyor mu?
 *
 * ⚠️ Bu bir "yazma ya da yazma" kararı DEĞİLDİR — satır her hâlükârda yazılır
 *    (aşağıdaki nota bakın). Yalnızca yan etkilerin (fotoğraf silme işareti,
 *    bildirim) gereksiz yere tetiklenmemesi ve yanıtta kullanıcıya "durum
 *    değişti mi" bilgisinin verilmesi için kullanılır.
 */
export function changesEffectiveConsent(
  records: readonly ConsentHistoryRecord[],
  type: ConsentType,
  granted: boolean,
): boolean {
  return currentConsent(records, type) !== granted;
}

/**
 * Bu geri çekme, fotoğrafların silinmesini gerektirir mi?
 *
 * ⚠️ Yalnızca DURUM DEĞİŞTİREN bir geri çekmede `true`. Zaten geri çekilmiş
 *    bir rızanın tekrar çekilmesi, süresi henüz dolmamış fotoğrafları ikinci
 *    kez işaretlemek dışında bir şey yapmaz; yine de zararsız olduğu için
 *    burada değil, çağıran tarafta `changesEffectiveConsent` ile birlikte
 *    değerlendirilir.
 */
export function revocationPurgesPhotos(type: ConsentType, granted: boolean): boolean {
  return !granted && PHOTO_BEARING_CONSENTS.includes(type);
}

/**
 * Rıza geri çekildiğinde fotoğraflara yazılacak `expiresAt`.
 *
 * ⚠️ SENKRON SİLME YAPILMAZ. Depodan silmeyi `PhotoRetentionJob` yapar; o iş
 *    `expiresAt <= now AND deletedAt IS NULL` satırlarını toplar ve türetilmiş
 *    try-on çıktılarını da aynı turda temizler. Bizim işimiz, kaydı o sorgunun
 *    kapsamına SOKMAK.
 *
 * ⚠️ Bir saniye GERİYE çekiliyor, `now` yazılmıyor: API ile worker farklı
 *    makinelerde çalışır ve saatleri milisaniye düzeyinde ayrışabilir. Tam
 *    `now` yazılsaydı, saati birkaç milisaniye geride olan bir worker turu
 *    kaydı "henüz dolmadı" sayıp atlayabilirdi.
 */
export function revocationExpiresAt(now: Date): Date {
  return new Date(now.getTime() - 1000);
}
