import Link from 'next/link';
import type { ProductListItemWire } from '@vt/contracts';
import { mediaUrl } from '@/lib/media';
import { Badge } from '@/components/ui/badge';
import { Fiyat } from '@/components/fiyat/fiyat';
import { UrunGorseli } from '@/components/urun/urun-gorseli';

/**
 * ÜRÜN KARTI — vitrin, liste, kategori ve koleksiyon ekranlarının TEK birimi.
 *
 * ⚠️ Bu kartın bir zamanlar İKİ kopyası vardı (`products/_liste/` ve
 *    `koleksiyon/`) ve ikisi zaten ayrışmıştı: birinde `flex-wrap` düzeltmesi
 *    ve `priority` kapısı vardı, diğerinde yoktu. Kart görselinde yapılan bir
 *    değişikliğin (oran, rozet kapısı, fiyat dizilimi) yalnızca yarısının
 *    uygulanması bu yüzden sessizdi. Yeni bir liste ekranı BU dosyayı import
 *    eder; üçüncü bir kopya yazılmaz.
 *
 * ÇOK SATICILI GÖSTERİM (design-system.md → Farfetch'ten alınan tek şey):
 *   Ürün adı  → birincil, ağırlık 600
 *   Mağaza adı→ ikincil, ağırlık 400, gri
 *   Fiyat     → birincil
 * Mağaza GÖRÜNÜR ama ürünün önüne geçmez. Bu yüzden mağaza adı ne rozet ne de
 * bağlantıdır: rozet olsaydı renk taşırdı (renk yalnız DURUM taşır), bağlantı
 * olsaydı kartın içinde ikinci bir tıklama hedefi doğar ve asıl hedefi
 * (ürünün kendisi) zayıflatırdı.
 */
export interface UrunKartiProps {
  urun: ProductListItemWire;
  /**
   * ⚠️ İlk ekranda görünen kartlarda `true`. `next/image` varsayılan olarak
   *    tembel yükler; ızgaranın ilk satırı tembel yüklenirse LCP ölçümü
   *    fotoğrafın kendisini bekler ve Core Web Vitals düşer.
   */
  oncelikli?: boolean;
  /** Izgaradaki sütun sayısına göre tarayıcıya doğru genişliği söyler. */
  boyutlar?: string;
}

const VARSAYILAN_BOYUTLAR = '(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw';

export function UrunKarti({
  urun,
  oncelikli = false,
  boyutlar = VARSAYILAN_BOYUTLAR,
}: UrunKartiProps): React.ReactElement {
  const gorsel = mediaUrl(urun.imageKey);

  return (
    <li>
      <Link href={`/product/${urun.slug}`} className="group block">
        {/* 4:5, kenarlıksız, gölgesiz — görsel hâkim olmalı.
            ⚠️ `bg-yuzey` DEĞİL `bg-urun-zemin`. `bg-yuzey` temayla koyulaşır;
            koyu temada kutu görsel inene kadar koyu durur, sonra bir anda beyaz
            fonlu fotoğrafa döner. `--urun-zemin` tema başına DEĞİŞMEZ (gerekçe
            `globals.css` → `@theme inline`), yani çerçeve fotoğrafla aynı tonda
            kalır ve ince kesim çizgileri kaybolmaz. */}
        <div className="relative aspect-urun w-full overflow-hidden rounded-md bg-urun-zemin">
          {/* ⚠️ Ham `next/image` DEĞİL: nesne kovada yoksa kullanıcı KIRIK
              RESİM İKONU görür. Gerekçenin tamamı `urun-gorseli.tsx`
              başlığında. */}
          <UrunGorseli src={gorsel} alt={urun.title} sizes={boyutlar} oncelikli={oncelikli} />
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <h3 className="text-sm font-semibold leading-snug">{urun.title}</h3>
          <p className="text-sm text-metin-soluk">{urun.brandName}</p>

          {/* Sarmalama artık `<Fiyat>`in kendisinde; gerekçesi orada yazılı. */}
          <Fiyat value={urun.priceMinor} listValue={urun.listPriceMinor} className="text-sm" />

          {/*
            ⚠️ Liste ucu kategori döndürmüyor; burada kapının yalnız YARISI var
            (`product.tryOnable`). İkinci yarısı — sağlayıcının bugünkü kategori
            yeteneği — ürün detayında kapanır ve DÜĞME orada çıkar. Rozet bir
            vaat değil, işaret (tryon-kategori-destegi.md).
          */}
          {urun.tryOnable ? (
            <Badge className="mt-1 w-fit" durum="notr">
              Üzerimde dene
            </Badge>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
