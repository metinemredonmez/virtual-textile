import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { appUrl } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Virtual Textile', template: '%s · Virtual Textile' },
  description: 'Sanal deneme destekli çok satıcılı moda platformu.',

  /**
   * ⚠️ `metadataBase` BURADA, TEK YERDE. Üç sayfa (koleksiyon dizini,
   *    koleksiyon detayı, hesaplayıcı) bunu kendi `metadata`sında AYRI AYRI
   *    veriyordu ve eksikliğin bedeli sessiz: verilmeyen bir sayfada Next
   *    göreli `canonical`ı `http://localhost:3000` ile birleştirir, konsola
   *    uyarı basar ama derlemeyi KIRMAZ — yani üretime yanlış canonical çıkar
   *    ve hatayı ilk gören arama motoru olur. Kök düzende bir kez verilince
   *    `alternates.canonical: '/koleksiyon'` gibi göreli değerlerin hepsi
   *    doğru köke bağlanır.
   */
  metadataBase: new URL(appUrl()),
};

/**
 * KÖK DÜZEN — tema BURADA seçilmez.
 *
 * ⚠️ `<html>` üzerinde koyu tema sınıfı YOK: koyu tema yalnızca (yonetim)
 *    bölgesinde geçerli ve orayı o bölgenin kendi layout'u açıyor. Burada
 *    açılsaydı vitrin de koyulaşır, ürün fotoğraflarının beyaz fonu kesim
 *    çizgilerini yutardı.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-dvh bg-zemin text-metin antialiased">{children}</body>
    </html>
  );
}
