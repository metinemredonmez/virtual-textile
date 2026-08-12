'use client';

import * as React from 'react';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';

/**
 * ÜRÜN GÖRSELİ — `next/image` + YEDEK.
 *
 * ⚠️ NEDEN VAR: nesne kovada yoksa kullanıcı KIRIK RESİM İKONU görüyordu.
 *    ÖLÇÜLDÜ (2026-08-12, /urunler): dört kartın dördü de boş gri kutu, ürün
 *    detayında galeri tamamen boş, konsolda sayfa başına 6–10 adet
 *    `Failed to load resource: 500`. Zincir şöyle:
 *      R2 nesnesi yok        → pub-….r2.dev/... 404
 *      `next/image` bunu     → /_next/image?... 500
 *      tarayıcı              → kırık `<img>`
 *    `blurhash` de seed'de `null` olduğu için hiçbir ara görsel yok.
 *
 * ⚠️ ASIL SEBEP FRONTEND'DE DEĞİL: demo nesneleri kovaya hiç yüklenmemiş
 *    (`apps/web/AGENTS.md` §11). Bu bileşen o eksikliği GİZLEMEZ, yalnızca
 *    kullanıcıya kırık ikon yerine anlaşılır bir kutu gösterir. Nesneler
 *    yüklendiği gün burada değişecek hiçbir şey yok.
 *
 * ⚠️ İSTEMCİ BİLEŞENİ OLMAK ZORUNDA: `onError` yalnızca tarayıcıda çalışır.
 *    Bedeli dürüstçe: liste ekranlarına küçük bir istemci yaprağı giriyor.
 *    Sunucuda `imageKey` doğrulaması alternatifti ama her kart için kovaya bir
 *    HEAD isteği demekti — ızgara başına 24 tur.
 *
 * ⚠️ Yedek kutu METİN TAŞIR (`sr-only`): görsel yokluğu bir DURUM değil ama
 *    ekran okuyucu için "burada bir şey vardı" bilgisi kaybolmamalı. İkon
 *    renksiz ve metinden bir ton soluk — renk yalnız durum taşır.
 */
export interface UrunGorseliProps {
  /** `mediaUrl()` çıktısı. `null` → hiç adres yok, doğrudan yedek çizilir. */
  src: string | null;
  alt: string;
  sizes: string;
  oncelikli?: boolean;
  className?: string;
}

export function UrunGorseli({
  src,
  alt,
  sizes,
  oncelikli = false,
  className = 'object-cover',
}: UrunGorseliProps): React.ReactElement | null {
  /**
   * ⚠️ Adres değişince yedek durumu SIFIRLANIR. Sıfırlanmasaydı aynı bileşen
   *    örneği yeniden kullanıldığında (galeride açı değişimi, listede
   *    sayfalama) bir kez bozulan yer sonsuza kadar boş kalırdı.
   *
   * ⚠️ `useEffect` DEĞİL, RENDER SIRASINDA AYARLAMA. Effect ile yazmak
   *    kademeli render üretir (lint kuralı `react-hooks/set-state-in-effect`
   *    bunu zaten reddediyor) ve daha kötüsü bir kare boyunca ESKİ yedek
   *    durumuyla çizim yapar: yeni görsel sağlamken bir an "yüklenemedi"
   *    kutusu görünür. React'in "adjusting state during render" kalıbı bu iş
   *    için var; `setDurum` render'ı hemen yeniden başlatır, DOM'a
   *    dokunulmaz.
   */
  const [durum, setDurum] = React.useState({ src, bozuk: false });
  if (durum.src !== src) setDurum({ src, bozuk: false });
  const bozuk = durum.src === src && durum.bozuk;

  if (!src || bozuk) {
    return (
      <span className="absolute inset-0 flex items-center justify-center bg-yuzey">
        <ImageOff className="size-5 text-ikon" aria-hidden />
        <span className="sr-only">{alt} — görsel yüklenemedi</span>
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={oncelikli}
      className={className}
      onError={() => setDurum({ src, bozuk: true })}
    />
  );
}
