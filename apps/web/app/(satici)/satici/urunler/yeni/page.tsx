import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { YeniUrunFormu } from '../_bilesenler/yeni-urun-formu';
import { kategoriSecenekleri } from '../../_lib/kategoriler';
import { SayfaBasligi } from '@/components/panel/duzen';

export const metadata: Metadata = { title: 'Yeni ürün · Satıcı paneli' };

/**
 * ⚠️ `force-dynamic` YOK ve olmamalı: bu ekran yalnız kategori ağacını okuyor
 *    (genel, önbelleklenebilir uç). Kimlikli veri yok; kimlik kapısı grup
 *    düzeninde (`(satici)/layout.tsx` → `requireRole`).
 */
export default async function YeniUrunPage(): Promise<React.ReactElement> {
  const kategoriler = await kategoriSecenekleri();

  return (
    <section>
      <Link
        href="/satici/urunler"
        className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
      >
        <ChevronLeft className="size-4 text-ikon" strokeWidth={1.5} />
        Ürünler
      </Link>
      <SayfaBasligi
        baslik="Yeni ürün"
        aciklama="Ürün TASLAK olarak oluşur. Görsel yükleyip incelemeye gönderene kadar vitrinde görünmez."
      />
      <YeniUrunFormu kategoriler={kategoriler} />
    </section>
  );
}
