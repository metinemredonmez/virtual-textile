import Link from 'next/link';
import type { ProductListItemWire } from '@vt/contracts';
import { UrunKarti } from './urun-karti';

/**
 * ÜRÜN IZGARASI.
 *
 * ⚠️ İlk SATIR öncelikli yüklenir, ilk KART değil. Mobilde satır 2, masaüstünde
 *    4 karttır; yalnız birine `priority` vermek diğerlerini tembel bırakır ve
 *    LCP çoğu zaman ikinci karta düşer.
 */
const SUTUN_SAYISI_MASAUSTU = 4;

export interface UrunIzgarasiProps {
  urunler: ProductListItemWire[];
  boyutlar?: string;
}

export function UrunIzgarasi({ urunler, boyutlar }: UrunIzgarasiProps): React.ReactElement {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
      {urunler.map((urun, sira) => (
        <UrunKarti
          key={urun.id}
          urun={urun}
          oncelikli={sira < SUTUN_SAYISI_MASAUSTU}
          {...(boyutlar ? { boyutlar } : {})}
        />
      ))}
    </ul>
  );
}

export interface BosSonucProps {
  /** Tüm filtreleri kaldıran adres. */
  temizleHref: string;
  /** Sunucunun önerdiği düzeltme — arama sıfır sonuç verdiyse dolu gelir. */
  didYouMean: string | null;
  /** Düzeltmeyi uygulayan adres. */
  duzeltmeHref: string | null;
}

/**
 * ⚠️ BOŞ DURUM NE YAPILACAĞINI SÖYLER, "kayıt yok" demez (design-system.md).
 *    Buradaki en değerli çıkış kapısı `didYouMean`: ölçüldü, `?q=gomlekk`
 *    sıfır sonuç + "Keten Oversize Gömlek" öneriyor. Öneriyi göstermeyen bir
 *    boş ekran, sunucunun zaten yaptığı işi çöpe atar.
 */
export function BosSonuc({
  temizleHref,
  didYouMean,
  duzeltmeHref,
}: BosSonucProps): React.ReactElement {
  return (
    <div className="py-16 text-center">
      <p className="text-metin">Bu filtrelerle eşleşen ürün bulunamadı.</p>

      {didYouMean && duzeltmeHref ? (
        <p className="mt-2 text-sm text-metin-soluk">
          Bunu mu aradınız:{' '}
          <Link href={duzeltmeHref} className="text-vurgu hover:underline">
            {didYouMean}
          </Link>
        </p>
      ) : null}

      <Link href={temizleHref} className="mt-4 inline-block text-sm text-vurgu hover:underline">
        Filtreleri temizle
      </Link>
    </div>
  );
}
