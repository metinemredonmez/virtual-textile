'use client';

import * as React from 'react';
import { apiFetch } from '@/lib/api/client';
import { KararKutusu, type Karar } from '@/components/panel/karar-kutusu';
import type { ProductDecisionWire, ProductStatusWire } from '@vt/contracts';

/**
 * ÜRÜN MODERASYON KARARI.
 *
 * ⚠️ `PRODUCT_TRANSITIONS` AYNASI (`admin-seller.service.ts:37`). Gerekçesi
 *    satıcı kararındakiyle aynı; en dikkat çekeni DRAFT ve ARCHIVED'ın BOŞ
 *    olması: yönetici bir taslağa ya da arşivlenmiş ürüne dokunamaz. Bu bir
 *    eksik değil, sınır — taslak satıcının kendi çalışma alanıdır ve oraya
 *    karar yazmak, satıcının henüz göndermediği bir işi reddetmek olurdu.
 *
 * ⚠️ ÜÇÜNCÜ ÖN KOŞUL EKRANDAN GÖRÜNMÜYOR: sunucu, ürünü yayınlarken satıcının
 *    da `APPROVED` olmasını şart koşuyor (`SELLER_NOT_APPROVED`). Kuyruk kaydı
 *    satıcının DURUMUNU taşımıyor (`AdminModerationRecord` içinde `sellerName`
 *    var, `sellerStatus` yok), bu yüzden önceden uyaramıyoruz; askıdaki bir
 *    satıcının ürününde onay düğmesi çalışır görünüp 403 döner. Kuyruk kaydına
 *    `sellerStatus` eklenmesi raporlandı.
 */

type Eylem = 'approve' | 'reject';

const IZINLI: Readonly<Record<ProductStatusWire, readonly Eylem[]>> = {
  DRAFT: [],
  PENDING_REVIEW: ['approve', 'reject'],
  // Yayındaki ürün de moderasyondan geçebilir (şikâyet üzerine).
  PUBLISHED: ['reject'],
  REJECTED: ['approve'],
  ARCHIVED: [],
};

export function UrunKarari({
  productId,
  status,
  aiTagsApproved,
  imageCount,
}: {
  productId: string;
  status: ProductStatusWire;
  aiTagsApproved: boolean;
  imageCount: number;
}): React.ReactElement | null {
  // ⚠️ `useCallback` erken dönüşten ÖNCE: koşullu çağrılan bir kanca, React'ın
  //    kanca sırası kuralını kırar ve bileşen durum değiştirdiğinde çöker.
  const gonder = React.useCallback(
    async (eylem: Eylem, metin: string): Promise<void> => {
      await apiFetch<ProductDecisionWire, `/admin/products/${string}/${Eylem}`>(
        `/admin/products/${productId}/${eylem}`,
        { method: 'POST', ...(eylem === 'reject' ? { json: { reason: metin } } : {}) },
      );
    },
    [productId],
  );

  const izinli = IZINLI[status];
  if (izinli.length === 0) {
    return (
      <p className="text-xs text-metin-soluk">
        {status === 'DRAFT'
          ? 'Taslak ürüne yönetici karar veremez; satıcı incelemeye göndermeden bu ürün kuyruğa girmez.'
          : 'Arşivlenmiş ürüne yönetici karar veremez; arşivden çıkarmak satıcının işidir.'}
      </p>
    );
  }

  /**
   * ⚠️ ONAYIN İKİ ÖN KOŞULU BURADA, DÜĞMEYE BASILMADAN ÖNCE GÖSTERİLİYOR.
   *    İkisi de sunucuda 400 üretiyor ve mesajları TÜRKÇE hazır geliyor; aynı
   *    cümleyi burada da kullanmak "metin tek kaynaktan" kuralının pratikte
   *    yapılabilecek en yakın hâli (uç bu iki cümleyi ancak reddettikten sonra
   *    döndürüyor). İkisi de kuyruk kaydında ZATEN var, yani ölçmeye gerek yok.
   */
  const engel = !aiTagsApproved
    ? 'Satıcı yapay zekâ etiketlerini onaylamadan ürün yayınlanamaz.'
    : imageCount === 0
      ? 'Yayınlanacak üründe en az bir görsel olmalı.'
      : null;

  const tumKararlar: Readonly<Record<Eylem, Karar>> = {
    approve: {
      anahtar: 'approve',
      etiket: 'Yayına al',
      gerekce: 'yok',
      onayEtiketi: 'Yayına al',
      engel,
      calistir: (metin) => gonder('approve', metin),
    },
    reject: {
      anahtar: 'reject',
      etiket: 'Reddet',
      yikici: true,
      gerekce: 'zorunlu',
      gerekceEtiketi: 'Red gerekçesi',
      onayEtiketi: 'Ürünü reddet',
      calistir: (metin) => gonder('reject', metin),
    },
  };

  return <KararKutusu kararlar={izinli.map((eylem) => tumKararlar[eylem])} />;
}
