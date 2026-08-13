import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { TopluYuklemeFormu } from '../_bilesenler/toplu-yukleme-formu';
import { SayfaBasligi } from '@/components/panel/duzen';

export const metadata: Metadata = { title: 'CSV ile yükle · Satıcı paneli' };

export default function TopluYuklemePage(): React.ReactElement {
  return (
    <section>
      <Link
        href="/seller/products"
        className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
      >
        <ChevronLeft className="size-4 text-ikon" strokeWidth={1.5} />
        Ürünler
      </Link>
      <SayfaBasligi
        baslik="CSV ile toplu yükleme"
        aciklama="Dosyadaki her satır bir varyanttır. Hatalı satır varsa HİÇBİRİ yazılmaz; hata tablosu satır ve sütun numarasıyla gösterilir."
      />
      <TopluYuklemeFormu />
    </section>
  );
}
