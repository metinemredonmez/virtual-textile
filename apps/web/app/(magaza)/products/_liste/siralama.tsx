import Link from 'next/link';
import {
  KULLANILABILIR_SIRALAMALAR,
  listeBaglantisi,
  SIRALAMA_ETIKETLERI,
  type ListeSorgusu,
  type OkumaSecenekleri,
} from './liste-sorgusu';
import { cn } from '@/lib/utils';

/**
 * SIRALAMA — açılır kutu değil, BAĞLANTI ŞERİDİ.
 *
 * Gerekçe: `<select>` seçim yapıldığında kendiliğinden gitmez; ya bir "uygula"
 * düğmesi ya da `onChange` gerekir — yani bu küçük iş için bir İstemci Bileşeni.
 * Dört seçenek dört adrese karşılık geliyorsa doğru öğe bağlantıdır: sunucuda
 * çizilir, taranabilir, yeni sekmede açılabilir, JavaScript'siz çalışır.
 *
 * ⚠️ Sıralama değişirken imleç DÜŞER (`listeBaglantisi` bunu kendi yapıyor).
 *    Korunsaydı `sort=price_asc&cursor=<relevance imleci>` isteği sunucuda
 *    `BigInt("0.5")` çağrısına dönüşüp HTTP 500 üretirdi — ölçüldü.
 */
export interface SiralamaProps {
  sorgu: ListeSorgusu;
  yol: string;
  secenekler?: OkumaSecenekleri;
}

export function Siralama({ sorgu, yol, secenekler = {} }: SiralamaProps): React.ReactElement {
  return (
    <nav aria-label="Sıralama" className="flex items-center gap-4 overflow-x-auto">
      {KULLANILABILIR_SIRALAMALAR.map((secenek) => {
        const aktif = secenek === sorgu.sirala;
        return (
          <Link
            key={secenek}
            href={listeBaglantisi(yol, sorgu, { sirala: secenek }, secenekler)}
            aria-current={aktif ? 'true' : undefined}
            className={cn(
              'whitespace-nowrap text-sm',
              // Hiyerarşi RENKLE değil AĞIRLIKLA kuruluyor; seçili sıralama bir
              // durum değil, yalnızca bulunduğunuz yer.
              aktif ? 'font-semibold text-metin' : 'text-metin-soluk hover:text-metin',
            )}
          >
            {SIRALAMA_ETIKETLERI[secenek]}
          </Link>
        );
      })}
    </nav>
  );
}
