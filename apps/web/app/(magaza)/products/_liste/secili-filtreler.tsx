import Link from 'next/link';
import { X } from 'lucide-react';
import {
  fasetiDegistir,
  listeBaglantisi,
  type Degisiklik,
  type ListeSorgusu,
  type OkumaSecenekleri,
} from './liste-sorgusu';

/**
 * SEÇİLİ FİLTRE ROZETLERİ.
 *
 * Çekmeceli mobil kalıbın bedeli şudur: filtre kapalı bir panelin içindedir ve
 * kullanıcı NEYİN açık olduğunu göremez — "ürün yok" ekranına bakıp katalogda
 * ürün olmadığını sanar. Rozetler o bedeli öder; her biri kendi kaldırma
 * bağlantısıdır.
 *
 * ⚠️ Bunlar `<Badge>` DEĞİL. `Badge` renk taşıyan tek bileşen ailesi ve renk
 *    yalnızca DURUM taşır; seçili bir filtre durum değildir. Bu yüzden burada
 *    akromatik, kendi kabuğu var.
 */
export interface SeciliFiltrelerProps {
  sorgu: ListeSorgusu;
  yol: string;
  secenekler?: OkumaSecenekleri;
}

interface Rozet {
  anahtar: string;
  etiket: string;
  degisiklik: Degisiklik;
}

export function SeciliFiltreler({
  sorgu,
  yol,
  secenekler = {},
}: SeciliFiltrelerProps): React.ReactElement | null {
  const rozetler: Rozet[] = [];

  if (sorgu.q) {
    rozetler.push({ anahtar: `q`, etiket: `“${sorgu.q}”`, degisiklik: { q: null } });
  }

  for (const alan of ['renk', 'beden', 'marka'] as const) {
    for (const deger of sorgu[alan]) {
      rozetler.push({
        anahtar: `${alan}:${deger}`,
        etiket: deger,
        degisiklik: { [alan]: fasetiDegistir(sorgu[alan], deger) },
      });
    }
  }

  if (sorgu.minFiyat !== null || sorgu.maxFiyat !== null) {
    rozetler.push({
      anahtar: 'fiyat',
      etiket: fiyatEtiketi(sorgu.minFiyat, sorgu.maxFiyat),
      degisiklik: { minFiyat: null, maxFiyat: null },
    });
  }

  if (rozetler.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-2">
      {rozetler.map((rozet) => (
        <li key={rozet.anahtar}>
          <Link
            href={listeBaglantisi(yol, sorgu, rozet.degisiklik, secenekler)}
            className="inline-flex items-center gap-1.5 rounded-sm border border-kenar px-2 py-1 text-xs text-metin hover:bg-yuzey-vurgulu"
          >
            <span className="rakam">{rozet.etiket}</span>
            <X className="size-3 text-ikon" aria-hidden />
            <span className="sr-only">filtresini kaldır</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * ⚠️ Burada `<Fiyat>` KULLANILMAZ ve kullanılamaz: bu değerler kullanıcının
 *    yazdığı TL sınırlarıdır, telden gelen bir para alanı değil — `MinorString`
 *    markası tam da bunu ayırmak için var. Yine de `rakam` sınıfı rozetin
 *    üzerinde duruyor; ekranda rakam varsa hizası tutmalı.
 */
function fiyatEtiketi(min: string | null, max: string | null): string {
  if (min !== null && max !== null) return `${min} – ${max} ₺`;
  if (min !== null) return `${min} ₺ ve üzeri`;
  return `${max} ₺ ve altı`;
}
