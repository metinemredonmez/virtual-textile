'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { isApiFailure } from '@vt/contracts';
import { retryBehaviourFor } from '@/lib/api/retry-policy';
import { Button } from '@/components/ui/button';

/**
 * HATA GÖSTERİMİ — TEK GÖRSELLEŞTİRİCİ.
 *
 * ⚠️ `error.message` OLDUĞU GİBİ gösterilir. Backend her hatayı kullanıcıya
 *    gösterilebilir Türkçe mesajla döndürüyor; frontend'de yeniden yazmak İKİ
 *    metin kaynağı üretir ve ikisi zamanla ayrışır. Metin değişikliği
 *    `ERROR_CATALOG`ta yapılır.
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
  const failure = isApiFailure(error) ? error : null;
  const mesaj = failure?.userMessage ?? 'Beklenmeyen bir hata oluştu.';
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
          Tekrar dene
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
          <Link href={davranis.href}>{davranis.etiket}</Link>
        </Button>
      ) : null}

      {/* ⚠️ Geri sayımlı kodlarda DÜĞME YOK: kullanıcı 900 saniye boyunca aynı
          hataya çarpardı. `retryAfterSeconds` gelmiyorsa (TRYON_QUOTA_EXCEEDED)
          geri sayım da çıkmaz — mesajın kendisi "yarın" diyor. */}
      {davranis.kind === 'geri-sayim' && kalan !== null ? (
        <p className="rakam mt-2 text-metin-soluk">
          {Math.ceil(kalan / 60)} dakika sonra tekrar deneyebilirsiniz.
        </p>
      ) : null}

      {/* Destek için: bilinmeyen kodda bile requestId korunur, beyaz ekran yok. */}
      {failure ? (
        <p className="rakam mt-2 text-xs text-metin-soluk">İstek no: {failure.requestId}</p>
      ) : null}
    </div>
  );
}
