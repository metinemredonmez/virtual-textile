import type { BodyProfileWriteInput } from '../schemas/common.js';

/**
 * `/v1/me/*` — HESAP SAHİBİNİN KENDİ VERİSİ.
 *
 * ⚠️ BU DOSYA BİR SÖZLEŞMEDİR, BİR ÖLÇÜM DEĞİL. `wire/index.ts` başlığındaki
 *    ayrımla: ne "ÖLÇÜLDÜ" ne "KAYNAKTAN" — uç HENÜZ YOK. Şekli burada
 *    yazıyoruz ki motor ajanı `GET/PUT /v1/me/body-profile`ı buna GÖRE
 *    yazsın. Uç canlıya çıktığında gerçek gövde OKUNUP bu tip
 *    DOĞRULANMALIDIR; o zamana kadar iddia edilen tek şey budur.
 */

/** `fitPref` — `fitPrefSchema`dan TÜRETİLİR, elle kopyalanmaz. */
export type FitPrefWire = NonNullable<BodyProfileWriteInput['fitPref']>;

/**
 * `GET /v1/me/body-profile` → `BodyProfileWire | null`
 * (`null` = kullanıcının hiç profili yok, henüz tek satır yazılmamış).
 *
 * ⚠️ HER ÖLÇÜ ALANI `| null`. Prisma `BodyProfile`ın tüm ölçü kolonları
 *    nullable ve öyle KALMALI: kullanıcı tek tek ölçü girer, tek tek siler.
 *    `undefined` KULLANILMAZ — JSON'da alan kaybolur ve "girilmemiş" ile
 *    "silinmiş" telde ayırt edilemez hâle gelir.
 *
 * ⚠️ `userId` TAŞINMAZ. Uç kimliği HER ZAMAN `user.sub`tan okur; kimliği bir
 *    de gövdede döndürmek onu istemcinin gönderebileceği bir şey gibi
 *    gösterirdi.
 *
 * Alan sınırları (girdi hatası sınırları, vücut modeli DEĞİL)
 * `bodyProfileWriteSchema` içinde ve gerekçeleri orada yazılı.
 */
export interface BodyProfileWire {
  heightCm: number | null;
  weightKg: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  /** Omuz genişliği (cm) — VÜCUT ölçüsü. Seed `UST_BEDEN_TABLOSU.omuz` karşılığı. */
  shoulderCm: number | null;
  /** İç bacak boyu (cm) — VÜCUT ölçüsü. Seed `ALT_BEDEN_TABLOSU.icBoy` karşılığı. */
  inseamCm: number | null;
  usualSize: string | null;
  fitPref: FitPrefWire | null;
  /** ISO 8601. ⚠️ Telde `string`; `Date` DEĞİL (zarf JSON'dan geçiyor). */
  updatedAt: string;
}
