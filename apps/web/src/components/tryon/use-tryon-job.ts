'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TryOnJobWire, TryOnStatusWire } from '@vt/contracts';
import { TRYON } from '@vt/config/constants';
import { apiFetch } from '@/lib/api/client';

/**
 * TRY-ON YOKLAMASI — tek uygulama.
 *
 * Bu döngü beş ekranda birden kullanılacak; kopyalanırsa beş farklı yoklama
 * davranışı doğar ve hangisinin doğru olduğu ancak fatura gelince anlaşılır.
 */

/** ⚠️ Sabit aralık yerine `estimatedSeconds`e demirlenmiş kademeli aralık. */
function pollInterval(elapsedMs: number, estimatedSeconds: number): number {
  const est = Math.max(estimatedSeconds, 1) * 1000;
  if (elapsedMs < est * 0.5) return 2000;
  if (elapsedMs < est * 1.5) return 1500; // sonuç en olası burada
  return 3000;
}

/**
 * ⚠️ KESME ŞART: worker süreci düşerse iş RUNNING'de ASILI kalır. Kesmesi
 *    olmayan bir istemci o sekmeyi sonsuza kadar yoklar — kullanıcı bilgisayarı
 *    kapatana kadar dakikada 20 imzalı URL üretiriz.
 */
function cutoffMs(estimatedSeconds: number, mode: 'FAST' | 'QUALITY'): number {
  return Math.max(estimatedSeconds * 3000, TRYON.timeoutMs[mode] * 2 + 30_000);
}

/**
 * ⚠️ BU LİSTE EKSİK KALIRSA İKİ ŞEY BİRDEN BOZULUR: yoklama döngüsü hiç
 *    durmaz (dakikada 20 imzalı URL) VE kesme bayrağı hiç düşmez. Sözleşmeye
 *    yeni bir bitiş durumu eklenip buraya eklenmezse arıza sessizdir — o yüzden
 *    `use-tryon-job.test.ts` listeyi union'a karşı ölçüyor.
 */
const BITEN_DURUMLAR: readonly TryOnStatusWire[] = [
  'SUCCEEDED',
  'FAILED',
  'FAILED_PERMANENT',
  'CANCELLED',
];

/** ⚠️ Sürmekte olan durumlar — bitiş listesinin tümleyeni, testte kullanılır. */
export const SUREN_DURUMLAR: readonly TryOnStatusWire[] = ['QUEUED', 'RUNNING'];

export function bitisDurumuMu(status: TryOnStatusWire): boolean {
  return BITEN_DURUMLAR.includes(status);
}

/**
 * KESME EKRANI GÖSTERİLSİN Mİ.
 *
 * ⚠️ SAF FONKSİYON OLARAK AYRILDI ÇÜNKÜ TEST EDİLEBİLİR TEK YER BURASI:
 *    `apps/web` test ortamı `node`, jsdom yok (bkz. vitel yapılandırması) ve
 *    hook'u render eden bir test yazılamıyor. Karar mantığı hook'un içinde
 *    kalsaydı, canlıda bir kez daha kırılana kadar ÖLÇÜLEMEZDİ.
 *
 * ⚠️ İŞ KİMLİĞİNE BAĞLI KARŞILAŞTIRMA, BAYRAK DEĞİL. Kesme bir işe aittir;
 *    yeni iş başlayınca kendiliğinden geçersizleşmeli. Boolean bayrak
 *    tasarımında bu sıfırlama unutulmuştu ve bir zaman aşımı, o sekmedeki
 *    bütün sonraki denemeleri zehirliyordu.
 */
export function kesmeGoster(kesilenIsId: string | null, jobId: string | null): boolean {
  return kesilenIsId !== null && kesilenIsId === jobId;
}

export interface TryOnJobState {
  job: TryOnJobWire | null;
  /** 0–95 arası. ⚠️ %100 yalnızca SUCCEEDED geldiğinde anlamlıdır. */
  progress: number;
  /** Kesmeye takıldı: yoklama durdu, kullanıcıya "Durumu kontrol et" sunulur. */
  timedOut: boolean;
  error: unknown;
  /** Elle yoklama — kesme sonrası düğme ve `<img onError>` bunu çağırır. */
  refetch: () => void;
}

export function useTryOnJob(
  jobId: string | null,
  /**
   * ⚠️ POST yanıtından SUBMIT ANINDA yakalanır. `GET /tryon/:jobId` bu alanı
   *    DÖNDÜRMEZ; bileşen state'inde tutulursa sayfa yenilemesinde/remount'ta
   *    kaybolur ve ilerleme çubuğu sıfırlanır. Çağıran taraf bunu jobId ile
   *    anahtarlanmış bir önbellekte tutmalı.
   */
  estimatedSeconds: number,
  mode: 'FAST' | 'QUALITY' = 'FAST',
): TryOnJobState {
  const [job, setJob] = useState<TryOnJobWire | null>(null);
  const [error, setError] = useState<unknown>(null);
  /**
   * ⚠️ BOOLEAN DEĞİL, HANGİ İŞİN KESİLDİĞİ TUTULUYOR — ve bu bir hata onarımı.
   *
   *    Önce `useState(false)` idi ve `setTimedOut(true)` vardı; `false`a çeken
   *    TEK BİR SATIR YOKTU. İki ayrı arıza doğuruyordu:
   *
   *      1. Kesmeden sonra "Durumu kontrol et"e basıldığında sunucu SUCCEEDED
   *         + resultUrl dönüyordu (ağ sekmesinde görülüyordu) ama EKRAN
   *         DEĞİŞMİYORDU. Sonuç elde, kullanıcıya gösterilmiyordu.
   *
   *      2. DAHA KÖTÜSÜ: bayrak İŞLER ARASI SIZIYORDU. Bir kez kesmeye takılan
   *         kullanıcı yeni bir deneme başlattığında, `jobId` değişmesine rağmen
   *         bayrak `true` kaldığı için ekran ANINDA "beklenenden uzun sürdü"
   *         diyordu. Yani bir zaman aşımı, o sekmedeki BÜTÜN sonraki denemeleri
   *         zehirliyordu.
   *
   *    Çözüm bayrağı sıfırlamak DEĞİL: kesilen işin kimliğini tutmak. Böylece
   *    `jobId` değişir değişmez karşılaştırma kendiliğinden `false` verir —
   *    sıfırlamayı unutmak MÜMKÜN DEĞİL. Bayrak + elle sıfırlama tasarımında
   *    her yeni çıkış yolu bir sıfırlama daha unutturur.
   */
  const [timedOutFor, setTimedOutFor] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOnce = useCallback(async (): Promise<TryOnJobWire | null> => {
    if (!jobId) return null;
    try {
      const { data } = await apiFetch<TryOnJobWire, `/tryon/${string}`>(`/tryon/${jobId}`);
      setJob(data);
      setError(null);
      /**
       * ⚠️ SONUÇ GELDİYSE KESME DÜŞER. Kesmeye takılan kullanıcının tek çıkışı
       *    "Durumu kontrol et" düğmesi ve o düğme buraya iniyor; burada
       *    düşürülmezse iş BİTMİŞ olduğu hâlde ekran kesme kutusunda kalırdı —
       *    sonuç sunucudan gelmiş, kullanıcıya gösterilmemiş olurdu.
       */
      if (bitisDurumuMu(data.status)) setTimedOutFor(null);
      return data;
    } catch (err) {
      setError(err);
      return null;
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    let iptal = false;

    const dongu = async (): Promise<void> => {
      const veri = await fetchOnce();
      if (iptal || !veri) return;

      setNow(Date.now());
      if (bitisDurumuMu(veri.status)) return;

      const gecen = Date.now() - new Date(veri.queuedAt).getTime();
      if (gecen > cutoffMs(estimatedSeconds, mode)) {
        setTimedOutFor(jobId);
        return;
      }

      timer.current = setTimeout(() => void dongu(), pollInterval(gecen, estimatedSeconds));
    };

    void dongu();

    /**
     * ⚠️ SEKME ARKA PLANA ALINIRSA tarayıcılar `setTimeout`u ≥1 sn'ye kısar,
     *    iOS Safari tamamen dondurur. Yoklamayı durdurup görünürlük dönüşünde
     *    HEMEN bir yoklama yapmak, "geri döndüm ve hâlâ dönüyor" hissini önler.
     *
     * ⚠️ İş SUCCEEDED olsa BİLE yeniden çağrılır: `resultUrl` imzalı ve ömrü
     *    900 saniye (`SIGNED_URL_TTL_SECONDS.tryOnResult`). Sekme yarım saat
     *    gizli kalıp dönerse eldeki adres ÖLÜDÜR ve görsel kırık ikona döner.
     */
    const gorunurluk = (): void => {
      if (document.visibilityState !== 'visible') {
        if (timer.current) clearTimeout(timer.current);
        return;
      }
      void dongu();
    };

    document.addEventListener('visibilitychange', gorunurluk);
    return () => {
      iptal = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', gorunurluk);
    };
  }, [jobId, estimatedSeconds, mode, fetchOnce]);

  // ⚠️ Geçen süre SUNUCUDAN gelen `queuedAt`tan hesaplanır, bir sayaç
  //    değişkeninden değil: remount sonrası çubuk sıfırlanmasın.
  const gecenMs = job ? now - new Date(job.queuedAt).getTime() : 0;
  const oran = estimatedSeconds > 0 ? gecenMs / (estimatedSeconds * 1000) : 0;

  /**
   * ⚠️ TÜRETİLİYOR, SAKLANMIYOR. `jobId` değiştiği an bu karşılaştırma `false`
   *    olur; yani yeni deneme eski denemenin kesmesini DEVRALAMAZ.
   */
  const timedOut = kesmeGoster(timedOutFor, jobId);

  return {
    job,
    // ⚠️ %95'te DURUR. Dolu çubuk + hâlâ bekleyen ekran, belirsiz çarkın
    //    hatasının aynısıdır: kullanıcı bittiğini sanar ve sekmeyi kapatır.
    progress: job?.status === 'SUCCEEDED' ? 100 : Math.min(95, Math.round(oran * 100)),
    timedOut,
    error,
    refetch: () => void fetchOnce(),
  };
}

/** ⚠️ Durum union'ı ALTI değerli; switch'lerde bu çağrı derleme kapısıdır. */
export function assertNever(value: never): never {
  throw new Error(`Ele alınmayan durum: ${String(value)}`);
}
