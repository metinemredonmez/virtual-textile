'use client';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * ÜRÜN GÖRSELİ — `next/image` + İKİ KATMANLI YEDEK.
 *
 * ⚠️ NEDEN VAR: nesne kovada yoksa kullanıcı KIRIK RESİM İKONU görüyordu.
 *    Zincir şöyle:
 *      R2 nesnesi yok        → pub-….r2.dev/... erişilemiyor
 *      `next/image` bunu     → /_next/image?... 404 YA DA 500
 *      tarayıcı              → kırık `<img>`
 *    ⚠️ Eski yorum "her zaman 500" diyordu; ÖLÇÜLDÜ (2026-08-13, üretim
 *    derlemesi, /products, 24 kart): aynı sayfada hem 404 hem 500 çıkıyor —
 *    kod yukarı akıştaki hatanın türüne göre değişiyor. Yani yedeği HTTP
 *    koduna dallandıran bir çözüm yanlış olurdu; tek güvenilir sinyal
 *    `<img>`in çizilememesidir.
 *    `blurhash` de seed'de `null` olduğu için hiçbir ara görsel yok.
 *
 * ⚠️ ASIL SEBEP FRONTEND'DE DEĞİL — VE BU YEDEK BİR SEED SORUNUNUN DEĞİL, BİR
 *    ÜRÜN SORUNUNUN karşılığıdır. Seed nesneleri artık kovada (2026-08-13
 *    ölçümü: seed görselleri yüklü, vitrindeki 25 `/_next/image` adresinin
 *    24'ü 200) ama YEDEK GEREKLİ OLMAYA DEVAM EDİYOR: aynı ölçümde vitrinin
 *    ilk sayfasında bir e2e artığı ürünün görseli üç denemenin üçünde de 500
 *    döndü. Üretimde de aynısı olur — satıcının yüklediği bir nesne silinir,
 *    taşınır ya da CDN'de düşer. Bu bileşen eksikliği GİZLEMEZ (ürün adını
 *    taşır), yalnızca kırık ikon yerine anlaşılır bir kutu gösterir.
 *
 * ⚠️ DEĞİŞEN ŞEY GÖRÜNÜŞ DEĞİL, YEDEĞİN NE ZAMAN GELDİĞİ. Ölçüldü (üretim
 *    derlemesi, /products — o gün `/urunler`, 3 kırık görsel):
 *    `<img>` hatası 226 ms, JS yedeği
 *    542 ms → KIRIK İKON PENCERESİ 316 ms; x4 CPU'da 501 ms; JS kapalıyken
 *    yedek HİÇ gelmiyor. `onError` bir React sentetik olayı ve hidrasyon
 *    tamamlanana kadar bağlanmıyor; React kaçırdığı `error` olayını geri
 *    OYNATMAZ. Bu yüzden yedeğin BİRİNCİ katmanı CSS'e indi
 *    (`globals.css` → `.gorsel-yedek`, gerekçenin tamamı orada) ve SSR
 *    HTML'inde bulunuyor: `<img>` üzerindeki sınıf + `data-yedek-ad`.
 *
 * ⚠️ `onError` YOLU KALDIRILMADI ve kaldırılmamalı: CSS örtüsünün dayandığı
 *    "değiştirilmiş elemanda üretilmiş içerik" davranışı Safari'de tarihsel
 *    olarak tutarsız. İki katman aynı sınıfı kullanıyor, yani GÖRSEL OLARAK
 *    ayrışamazlar.
 *
 * ⚠️ İSTEMCİ BİLEŞENİ OLMAK ZORUNDA: `onError` yalnızca tarayıcıda çalışır.
 *    Sunucuda `imageKey` doğrulaması alternatifti ama her kart için kovaya bir
 *    HEAD isteği demekti — ızgara başına 24 tur.
 *
 * ⚠️ Yedek kutu ÜRÜN ADINI TAŞIR. Adsız bir kutu "boş gri kare"dir ve
 *    ızgarada hangi ürünün eksik olduğunu söylemez. İkon ve ad renksiz, ürün
 *    fotoğrafı çerçevesiyle aynı zeminde (`--urun-zemin`) — renk yalnız DURUM
 *    taşır ve eksik görsel bir durum değildir.
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
      /*
       * ⚠️ SINIF `<img>` ÜZERİNDEKİYLE AYNI (`gorsel-yedek`) — kutu ve ad
       *    aynı iki CSS kuralından çiziliyor. Ayrı bir kopya yazılsaydı fark
       *    yalnızca hidrasyondan önceki 316 ms'lik pencerede görünürdü, yani
       *    pratikte hiç fark edilmezdi.
       *
       * ⚠️ `role="img"` + `aria-label`: metin CSS ile üretiliyor ve üretilmiş
       *    içeriğin ekran okuyucuya nasıl ulaştığı tarayıcıya bağlı. Etiket
       *    burada AÇIKÇA veriliyor; ek bir `sr-only` düğümü konmuyor ki aynı
       *    cümle iki kez okunmasın.
       */
      <span
        role="img"
        aria-label={alt ? `${alt} — görsel yüklenemedi` : 'Görsel yüklenemedi'}
        data-yedek-ad={alt}
        className="gorsel-yedek absolute inset-0"
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={oncelikli}
      /*
       * ⚠️ `data-yedek-ad` ve `gorsel-yedek` SSR HTML'inde bulunmak zorunda:
       *    örtünün tamamı CSS ve hidrasyondan önce çiziliyor. Bunları
       *    `useEffect` ile eklemek örtüyü tam da kapatması gereken pencerede
       *    yok ederdi.
       */
      data-yedek-ad={alt}
      className={cn('gorsel-yedek', className)}
      onError={() => setDurum({ src, bozuk: true })}
    />
  );
}
