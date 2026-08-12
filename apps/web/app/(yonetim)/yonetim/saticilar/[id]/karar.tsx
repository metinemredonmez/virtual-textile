'use client';

import * as React from 'react';
import { apiFetch } from '@/lib/api/client';
import { KararKutusu, type Karar } from '@/components/panel/karar-kutusu';
import type { SellerDecisionWire, SellerStatusWire } from '@vt/contracts';

/**
 * SATICI KARARI — onayla / reddet / askıya al / askıyı kaldır.
 *
 * ⚠️ HANGİ DÜĞMENİN ÇIKACAĞI AŞAĞIDAKİ TABLODAN OKUNUR ve bu tablo
 *    `admin-seller.service.ts:28` içindeki `SELLER_TRANSITIONS`ın AYNASIDIR.
 *    Ayna olmak istemedik, mecburuz: geçiş makinesi sunucuda ve dışarı bir uç
 *    üzerinden verilmiyor. Aynanın bedeli bilinçli olarak seçildi —
 *      • Ayna OLMASAYDI dört düğme her durumda çıkardı ve yönetici üçünde
 *        garanti 400 alırdı ("basınca hata veren düğme").
 *      • Ayna BOZULURSA en kötü sonuç, olması gereken bir düğmenin
 *        görünmemesidir; yanlış bir kararın GEÇMESİ mümkün değil, çünkü
 *        sunucu aynı kontrolü kilitli okumayla tekrar yapıyor.
 *    Sapma bir gün kapanacaksa doğru yol, satıcı yanıtına `allowedTransitions`
 *    eklemektir (raporlandı).
 *
 * ⚠️ HİÇBİRİ `Idempotency-Key` ALMIYOR — bu yollar `IdempotentPath` listesinde
 *    değil. Anahtar göndermek sahte bir güvence olurdu; gerçek koruma sunucudaki
 *    `lockAndRead` (iki yöneticinin aynı anda basması) ve `KararKutusu`nun
 *    çalışırken düğmeleri kilitlemesi.
 */

interface KararProps {
  sellerId: string;
  status: SellerStatusWire;
}

type Eylem = 'approve' | 'reject' | 'suspend' | 'reinstate';

/** ⚠️ `SELLER_TRANSITIONS` aynası — gerekçe yukarıda. */
const IZINLI: Readonly<Record<SellerStatusWire, readonly Eylem[]>> = {
  PENDING: ['approve', 'reject'],
  APPROVED: ['suspend'],
  SUSPENDED: ['reinstate', 'reject'],
  REJECTED: ['approve'],
};

export function SaticiKarari({ sellerId, status }: KararProps): React.ReactElement {
  const gonder = React.useCallback(
    async (eylem: Eylem, metin: string): Promise<void> => {
      /**
       * ⚠️ `approve` GÖVDESİ FARKLI: şeması `{note?}`, diğer üçü `{reason}` ve
       *    `reason` ZORUNLU (en az 10 karakter). Tek bir gövde şekli
       *    yazılsaydı ya onayda gereksiz gerekçe istenirdi ya da red gerekçesiz
       *    gider ve denetim kaydı boş kalırdı — `admin.schema.ts` başlığının
       *    tam olarak uyardığı şey.
       */
      const govde = eylem === 'approve' ? { note: metin || undefined } : { reason: metin };

      await apiFetch<SellerDecisionWire, `/admin/sellers/${string}/${Eylem}`>(
        `/admin/sellers/${sellerId}/${eylem}`,
        { method: 'POST', json: govde },
      );
    },
    [sellerId],
  );

  const tumKararlar: Readonly<Record<Eylem, Karar>> = {
    approve: {
      anahtar: 'approve',
      etiket: 'Onayla',
      gerekce: 'istege-bagli',
      gerekceEtiketi: 'Onay notu',
      onayEtiketi: 'Başvuruyu onayla',
      calistir: (metin) => gonder('approve', metin),
    },
    reject: {
      anahtar: 'reject',
      etiket: 'Reddet',
      yikici: true,
      gerekce: 'zorunlu',
      gerekceEtiketi: 'Red gerekçesi',
      onayEtiketi: 'Başvuruyu reddet',
      calistir: (metin) => gonder('reject', metin),
    },
    suspend: {
      anahtar: 'suspend',
      etiket: 'Askıya al',
      yikici: true,
      gerekce: 'zorunlu',
      gerekceEtiketi: 'Askı gerekçesi',
      onayEtiketi: 'Mağazayı askıya al',
      calistir: (metin) => gonder('suspend', metin),
    },
    reinstate: {
      anahtar: 'reinstate',
      etiket: 'Askıyı kaldır',
      gerekce: 'zorunlu',
      gerekceEtiketi: 'Askıyı kaldırma gerekçesi',
      onayEtiketi: 'Mağazayı geri aç',
      calistir: (metin) => gonder('reinstate', metin),
    },
  };

  const kararlar = IZINLI[status].map((eylem) => tumKararlar[eylem]);

  return (
    <div className="flex flex-col gap-3">
      <KararKutusu kararlar={kararlar} />

      {/*
        ⚠️ BU İKİ CÜMLE UYARI DEĞİL, SÖZLEŞMENİN KENDİSİ — bu yüzden uyarı rengi
           ALMIYOR. Karar iki yan etki üretiyor ve ikisi de geri alınamaz:
           satıcının üyelerinin ROLÜ değişip oturumları düşüyor
           (`syncSellerMemberRoles`) ve denetim kaydı yazılıyor. Yönetici bunu
           düğmeye bastıktan sonra öğrenirse geç öğrenmiş olur.
      */}
      <p className="max-w-prose text-xs text-metin-soluk">
        Her karar denetim kaydına yazılır ve satıcıya bildirim gönderilir. Onay ve askı, mağaza
        üyelerinin rolünü değiştirdiği için açık oturumlarını da düşürür.
      </p>

      {status === 'PENDING' ? (
        <p className="max-w-prose text-xs text-metin-soluk">
          Onay, ödeme sağlayıcısındaki alt üye işyerini açmaz; onu onay olayını dinleyen finans
          işçisi açar. Alt üye işyeri açılana kadar satıcıya hakediş aktarılamaz.
        </p>
      ) : null}
    </div>
  );
}
