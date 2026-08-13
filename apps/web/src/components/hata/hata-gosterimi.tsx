'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { isApiFailure, type Locale } from '@vt/contracts';
import { retryBehaviourFor } from '@/lib/api/retry-policy';
import { Button } from '@/components/ui/button';

/**
 * HATA GÖSTERİMİ — TEK GÖRSELLEŞTİRİCİ.
 *
 * ⚠️ METİN KATALOGDAN GELİR — ve çok dilde de öyle. Kural hiçbir zaman "metin
 *    telde gelir" değildi, "metin `ERROR_CATALOG`ta yazılır"dı. Değişen tek
 *    şey kataloğun artık iki dili olması: `failure.mesaj(locale)` yine
 *    katalogdan okuyor. Burada elle bir cümle yazmak İKİ metin kaynağı üretir
 *    ve ikisi zamanla ayrışır.
 *
 * ⚠️ ESKİDEN BURADA ELLE YAZILMIŞ BİR TÜRKÇE CÜMLE VARDI
 *    (`'Beklenmeyen bir hata oluştu.'`) ve zarfsız hatanın tek metniydi. Çok
 *    dilde o cümle İngilizce arayüzde Türkçe kalırdı; artık sözlükten geliyor.
 *
 * ⚠️ `error.code` yalnızca DAVRANIŞ seçer (`retry-policy.ts`), metin seçmez.
 *
 * ⚠️ Başarısız try-on işleri de BU bileşenden geçer. `TryOnJobView.errorCode`
 *    gerçek bir `ErrorCode` taşıyor; ayrı bir metin yazılsaydı aynı "fotoğrafta
 *    kişi yok" durumu senkron kapıda katalog mesajını, asenkron sonuçta başka
 *    bir cümleyi gösterirdi.
 */
export interface HataGosterimiProps {
  error: unknown;
  /** Yeniden deneme davranışı 'dugme' ise çağrılır. */
  onRetry?: () => void;
  className?: string;
}

export function HataGosterimi({
  error,
  onRetry,
  className,
}: HataGosterimiProps): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  const failure = isApiFailure(error) ? error : null;
  /**
   * ⚠️ `failure.userMessage` DEĞİL `failure.mesaj(locale)`. İlki sunucunun
   *    Türkçe metni ve artık yalnızca SÜRÜM SAPMASI yedeği: katalogda olmayan
   *    bir kod geldiğinde `mesaj()` zaten ona düşüyor.
   */
  const mesaj = failure ? failure.mesaj(locale) : t('hata.beklenmeyen');
  const davranis = retryBehaviourFor(failure?.code ?? '');
  const kalan = failure?.retryAfterSeconds ?? null;

  return (
    <div
      role="alert"
      className={['rounded-md border border-kenar bg-yuzey p-4 text-sm', className]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="flex items-start gap-2 text-metin">
        {/* Uyarı ikonu DURUM taşıyor — bu yüzden renkli olmasına izin var. */}
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-uyari" />
        <span>{mesaj}</span>
      </p>

      {/*
        Bilinmeyen/zarfsız hatada da düğme çıkar: katalog kararı yoksa tek
        makul davranış kullanıcıya tekrar denemesini önermektir.

        ⚠️ `otomatik` DE BU DALA GİRER, ve bu bir çelişki değil: otomatik
           tekrar `otomatikTekrarla()` ile ÇAĞRI YERİNDE olur (bkz.
           `retry-policy.ts`). Kullanıcı bu kutuyu görüyorsa o denemeler ZATEN
           TÜKENMİŞTİR. Geriye düğme koymamak, "İsteğiniz işleniyor, lütfen
           bekleyin." cümlesini düğmesiz gösterip kullanıcıyı çıkışsız
           bırakmak olurdu — ölçüldü: iade formunda tam olarak bu oluyordu.
      */}
      {onRetry &&
      (davranis.kind === 'dugme' || davranis.kind === 'otomatik' || failure === null) ? (
        <Button variant="ikincil" size="sm" className="mt-3" onClick={onRetry}>
          {t('ortak.tekrarDene')}
        </Button>
      ) : null}

      {/*
        ⚠️ YÖNLENDİRME DALI. PAYMENT_TIMEOUT mesajı "Siparişlerinizi kontrol
           edin, tutar çekildiyse siparişiniz oluşmuştur." diyor; bu ekranda
           hiçbir çıkış yokken kullanıcının en olası davranışı ödemeyi BAŞTAN
           denemektir — yani ikinci tahsilat riski. Katalog metni bir yere
           işaret ediyorsa o yer TIKLANABİLİR olmak zorunda.
      */}
      {davranis.kind === 'yonlendir' ? (
        <Button asChild variant="ikincil" size="sm" className="mt-3">
          {/*
            ⚠️ Etiket ANAHTAR olarak geliyor, hazır metin olarak değil.
               `retry-policy.ts` bir DAVRANIŞ tablosu; oraya Türkçe cümle
               yazılırsa katalog dışında ikinci bir metin kaynağı doğar ve
               İngilizce arayüzde Türkçe bir düğme kalır.
          */}
          <Link href={davranis.href}>{t(davranis.etiketAnahtari)}</Link>
        </Button>
      ) : null}

      {/* ⚠️ Geri sayımlı kodlarda DÜĞME YOK: kullanıcı 900 saniye boyunca aynı
          hataya çarpardı. `retryAfterSeconds` gelmiyorsa (TRYON_QUOTA_EXCEEDED)
          geri sayım da çıkmaz — mesajın kendisi "yarın" diyor. */}
      {davranis.kind === 'geri-sayim' && kalan !== null ? (
        <p className="rakam mt-2 text-metin-soluk">
          {t('hata.geriSayim', { dakika: Math.ceil(kalan / 60) })}
        </p>
      ) : null}

      {/* Destek için: bilinmeyen kodda bile requestId korunur, beyaz ekran yok. */}
      {failure ? (
        <p className="rakam mt-2 text-xs text-metin-soluk">
          {t('hata.istekNo', { requestId: failure.requestId })}
        </p>
      ) : null}
    </div>
  );
}
