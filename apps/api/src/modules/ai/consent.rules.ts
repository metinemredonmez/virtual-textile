import type { ConsentType } from '@vt/contracts';

/**
 * SANAL DENEME RIZA KURALLARI
 *
 * ⚠️ BU DOSYA KVKK md.5 ve md.9 KARŞILIĞIDIR — ürün kararı değil, hukuki
 *    zorunluluktur. Buradaki bir gevşetme doğrudan idari para cezası riskidir.
 *
 * İki ayrı rıza gerekir ve İKİSİ DE açık olmalıdır:
 *  - PHOTO_PROCESSING      : biyometrik nitelikli görselin işlenmesi (md.6).
 *  - CROSS_BORDER_TRANSFER : fotoğraf yurt dışındaki model sağlayıcısına
 *                            gönderilir; bu bir YURT DIŞINA AKTARIMDIR (md.9).
 *
 * Sağlayıcıya çağrı yapıldıktan sonra rızayı sorgulamak anlamsızdır: veri
 * çoktan sınırı geçmiştir. Bu yüzden kontrol, zincirin EN BAŞINDA durur.
 */

/** ConsentRecord tablosunun bu kararı vermek için gereken alanları — fazlası değil. */
export interface ConsentRecordLike {
  type: ConsentType;
  granted: boolean;
  createdAt: Date;
}

export type ConsentDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Katalog kodu — servis bunu doğrudan `appError()`'a verir. */
      code: 'CONSENT_REQUIRED' | 'CONSENT_CROSS_BORDER_REQUIRED';
      missing: ConsentType;
    };

/**
 * ConsentRecord APPEND-ONLY'dir: rıza geri çekilince eski satır silinmez,
 * `granted=false` olan YENİ bir satır yazılır. Dolayısıyla geçerli durum
 * "en son satır"dır; `granted=true` satırının varlığı tek başına hiçbir şey
 * kanıtlamaz.
 *
 * ⚠️ Aynı `createdAt` ile iki satır varsa (aynı milisaniyede yazılmış rıza +
 *    geri çekme) GERİ ÇEKME kazanır. Belirsizlikte kullanıcı aleyhine değil,
 *    veri işleme aleyhine karar verilir — fail-closed.
 */
export function latestConsentByType(
  records: readonly ConsentRecordLike[],
): Map<ConsentType, boolean> {
  const latest = new Map<ConsentType, ConsentRecordLike>();

  for (const record of records) {
    const current = latest.get(record.type);
    if (!current) {
      latest.set(record.type, record);
      continue;
    }

    if (record.createdAt.getTime() > current.createdAt.getTime()) {
      latest.set(record.type, record);
      continue;
    }

    // Eşit zaman damgası: geri çekme öncelikli.
    if (record.createdAt.getTime() === current.createdAt.getTime() && !record.granted) {
      latest.set(record.type, record);
    }
  }

  return new Map([...latest].map(([type, record]) => [type, record.granted]));
}

/**
 * Sanal deneme için rıza durumunu değerlendirir.
 *
 * Kontrol sırası kasıtlıdır: önce fotoğrafın İŞLENMESİ, sonra AKTARILMASI.
 * Kullanıcıya en temel eksik önce gösterilir; ikisi birden eksikken
 * "yurt dışı aktarımı" mesajı bağlamsız kalırdı.
 *
 * ⚠️ Misafir kullanıcının ConsentRecord'u olamaz (kayıt userId'ye bağlıdır).
 *    Boş liste = rıza YOK = ret. Sanal deneme bu nedenle giriş gerektirir.
 */
export function evaluateTryOnConsent(records: readonly ConsentRecordLike[]): ConsentDecision {
  const latest = latestConsentByType(records);

  if (latest.get('PHOTO_PROCESSING') !== true) {
    return { allowed: false, code: 'CONSENT_REQUIRED', missing: 'PHOTO_PROCESSING' };
  }

  if (latest.get('CROSS_BORDER_TRANSFER') !== true) {
    return {
      allowed: false,
      code: 'CONSENT_CROSS_BORDER_REQUIRED',
      missing: 'CROSS_BORDER_TRANSFER',
    };
  }

  return { allowed: true };
}
