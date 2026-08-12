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

const BITEN_DURUMLAR: readonly TryOnStatusWire[] = [
  'SUCCEEDED',
  'FAILED',
  'FAILED_PERMANENT',
  'CANCELLED',
];

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
  const [timedOut, setTimedOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOnce = useCallback(async (): Promise<TryOnJobWire | null> => {
    if (!jobId) return null;
    try {
      const { data } = await apiFetch<TryOnJobWire, `/tryon/${string}`>(`/tryon/${jobId}`);
      setJob(data);
      setError(null);
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
      if (BITEN_DURUMLAR.includes(veri.status)) return;

      const gecen = Date.now() - new Date(veri.queuedAt).getTime();
      if (gecen > cutoffMs(estimatedSeconds, mode)) {
        setTimedOut(true);
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
