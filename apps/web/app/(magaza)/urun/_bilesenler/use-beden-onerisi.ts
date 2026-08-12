'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BodyProfileInput, SizeRecommendationWire } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * BEDEN ÖNERİSİ — okuma noktası.
 *
 * ⚠️ EŞİK BURADA YOKTUR. "Öneri gösterilsin mi" kararını sunucu veriyor
 *    (`showRecommendation`, `SIZE_ENGINE.minConfidenceToShow`). İstemcide bir
 *    eşik daha tutmak, ikisi ayrıştığı gün kullanıcıya sunucunun "gösterme"
 *    dediği zayıf öneriyi gösterirdi — ve o kullanıcı yanlış beden alıp iade eder.
 *
 * ⚠️ Uç `@Public()` ama VEKİLDEN geçer: token varsa sunucu kayıtlı vücut
 *    profilini kullanıyor. Doğrudan API'ye gitseydi giriş yapmış kullanıcı da
 *    misafir gibi cevap alır ve "ölçülerinizi girin" derdik — ölçüleri zaten
 *    kayıtlıyken.
 *
 * ⚠️ POST kullanılıyor çünkü ölçüler KİŞİSEL VERİ; query string'e konsaydı
 *    erişim loglarına, ara vekillere ve tarayıcı geçmişine yazılırdı.
 */
export interface BedenOnerisiDurumu {
  oneri: SizeRecommendationWire | null;
  yukleniyor: boolean;
  hata: unknown;
  /** Ölçü verilirse kayıtlı profili EZER; ⚠️ bu ölçüler sunucuda saklanmaz. */
  iste: (olculer?: BodyProfileInput) => void;
}

export function useBedenOnerisi(
  variantId: string | null,
  /** Girişli kullanıcıda açılışta sorulur; misafirde sorulmaz (cevabı zaten boş). */
  otomatik: boolean,
): BedenOnerisiDurumu {
  const [oneri, setOneri] = useState<SizeRecommendationWire | null>(null);
  /** ⚠️ Başlangıç değeri `otomatik`: açılışta sorulacaksa ekran ilk kareden
   *    itibaren "hesaplanıyor" der. `false` başlayıp effect içinde `true`
   *    yapmak, effect gövdesinde senkron setState demek olurdu. */
  const [yukleniyor, setYukleniyor] = useState(otomatik);
  const [hata, setHata] = useState<unknown>(null);

  /** ⚠️ Yanıt yarışı: yavaş bir istek, sonra gelen hızlı bir isteği ezmemeli. */
  const sonIstek = useRef(0);

  /**
   * ⚠️ İlk satırı setState DEĞİL, ref artırımıdır. Effect gövdesinden
   *    çağrıldığı için senkron bir state yazımı olmamalı; durum yalnızca
   *    `await`ten SONRA değişiyor.
   */
  const calistir = useCallback(
    async (olculer?: BodyProfileInput): Promise<void> => {
      if (!variantId) return;
      const sira = ++sonIstek.current;

      try {
        const { data } = await apiFetch<SizeRecommendationWire, '/size/recommend'>(
          '/size/recommend',
          { method: 'POST', json: { variantId, ...(olculer ? { measurements: olculer } : {}) } },
        );
        if (sira !== sonIstek.current) return;
        setOneri(data);
        setHata(null);
      } catch (error) {
        if (sira === sonIstek.current) setHata(error);
      } finally {
        if (sira === sonIstek.current) setYukleniyor(false);
      }
    },
    [variantId],
  );

  /**
   * ⚠️ `react-hooks/set-state-in-effect` BİLİNÇLİ OLARAK SUSTURULDU.
   *
   * Kuralın söylediği doğru: veri çekmenin yeri effect değil, çatının veri
   * katmanıdır. Burada o yol KAPALI ve sebebi ölçülmüş bir kısıt:
   *   • Uç `POST` (ölçüler kişisel veri; query string'e konamaz) → Sunucu
   *     Bileşeninden `fetch` ile çekilse bile önbelleklenemez.
   *   • Uç `@Public()` ama kayıtlı vücut profilini YALNIZCA token varken
   *     kullanıyor; token vekilin arkasında ve `lib/api/server.ts`te YOK.
   *     Sunucudan çekilseydi giriş yapmış kullanıcı da misafir cevabı alırdı.
   * Yani "beden uyumu" satırı ya açılışta istemciden sorulur ya da hiç
   * gösterilmez. Kalıcı çözüm sunucuda: `/products/:slug` yanıtına oturuma
   * göre hesaplanmış beden önerisi eklenirse bu effect SİLİNİR.
   */
  useEffect(() => {
    if (!otomatik || !variantId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void calistir();
  }, [otomatik, variantId, calistir]);

  return {
    oneri,
    yukleniyor,
    hata,
    // Kullanıcı eylemi: burada senkron setState serbest ve doğrudur.
    iste: (olculer) => {
      setYukleniyor(true);
      setHata(null);
      void calistir(olculer);
    },
  };
}
