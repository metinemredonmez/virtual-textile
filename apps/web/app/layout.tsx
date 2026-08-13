import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { appUrl } from '@/lib/env';
import { TemaBetigi } from '@/components/tema/tema-betigi';
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
   *    `alternates.canonical: '/collection'` gibi göreli değerlerin hepsi
   *    doğru köke bağlanır.
   */
  metadataBase: new URL(appUrl()),
};

/**
 * KÖK DÜZEN — tema sınıfını SUNUCU YAZMAZ, satır içi betik yazar.
 *
 * ⚠️ `<html>` üzerinde sabit bir tema sınıfı YOK ve `cookies()` de ÇAĞRILMAZ.
 *    İki ayrı sebep, ikisi de tek başına yeterli:
 *    1. `sistem` seçeneği (VARSAYILAN) sunucuda ÇÖZÜLEMEZ —
 *       `prefers-color-scheme` sunucuya gelmez, `Sec-CH-Prefers-Color-Scheme`
 *       opt-in'dir ve ilk istekte hiç gelmez. Yani sunucu tarafı bir çözüm
 *       varsayılan kullanıcı için hiçbir zaman doğru olamazdı.
 *    2. Kök düzende `cookies()` çağırmak bugün statik olan beş rotayı `ƒ`ye
 *       düşürür ve `legal/[belge]`nin `dynamicParams:false` 404 kapısını
 *       SESSİZCE devre dışı bırakır — AGENTS.md §8'in "aylarca 200 döndü"
 *       arızasının birebir aynısı. Rota tablosu bu yüzden her değişiklikten
 *       sonra çıktılanır; çözümün kendi regresyon testi odur.
 *    Gerekçenin tamamı `lib/tema.ts` başlığında.
 *
 * ⚠️ `suppressHydrationWarning` ZORUNLU: satır içi betik hidrasyondan önce
 *    `<html>`in `class`, `style` ve `data-tema*` niteliklerini yazıyor, yani
 *    sunucu çıktısı ile istemci ağacı BİLEREK ayrışıyor. Uyarı yalnız bu
 *    elemanda susuyor, alt ağaç etkilenmiyor.
 *
 * ⚠️ `<TemaBetigi/>` GÖVDENİN İLK BETİĞİ ve GÖRÜNÜR HİÇBİR İÇERİKTEN SONRA
 *    DEĞİL. Aşağı kaydırılırsa ondan önceki içerik yanlış temada boyanır —
 *    yani FOUC geri gelir, `tsc` ve `next build` sessiz kalır ve arıza yalnız
 *    ilk karede görünür. Bu yüzden `NextIntlClientProvider` yalnız
 *    `{children}`ı sarıyor: sağlayıcı bir bağlam taşıyıcısı, DOM üretmiyor,
 *    ama betiği içine almak o değişmezi okunmaz kılardı.
 *    ⚠️ DEĞİŞMEZ "`<body>`nin İLK ÇOCUĞU" DİYE YAZILAMAZ, çünkü ÜRETİLEN HTML
 *    öyle değil (ölçüldü, üretim derlemesi): Next araya kendi akış işaretçisini
 *    koyuyor — `<div hidden=""><!--$--><!--/$--></div>`. Görünmez bir düğüm
 *    olduğu için zararsız, ama yazılı değişmez ile sevk edilen çıktı ayrışırsa
 *    bir sonraki okuyan yanlış şeyi korumaya çalışır. Ölçülen gerçek sıra
 *    (`/products`, `next build && next start`, 2026-08-13): `</head>` 1490 ·
 *    `<body` 1497 · `<div hidden>` akış işaretçisi · tema betiği **1591** ·
 *    ilk görünür `<div class="flex min-h-dvh">` **2157**. Yani betik görünür
 *    ilk elemandan 566 bayt ÖNCE ve ilk TCP yığınının içinde.
 *
 * ═══ DİL ═══
 *
 * ⚠️ `lang` ARTIK SABİT DEĞİL. Sabit `lang="tr"` ekran okuyucuya İngilizce
 *    metni Türkçe sesletir ve arama motoruna yanlış dil bildirir.
 *
 * ⚠️ DİLİN OTORİTESİ URL — ÇEREZ DEĞİL, ve bu tema kuralının aynısı:
 *    `getLocale()` istek yapılandırmasından okuyor (`src/i18n/request.ts`) ve o
 *    dosya `cookies()` ÇAĞIRMIYOR. Çağırsaydı bugün statik olan beş rota `ƒ`ye
 *    düşer ve `legal/[belge]`nin 404 kapısı sessizce kapanırdı. Çerez yalnız
 *    `/` kökündeki yönlendirmeyi seçiyor (`i18n/muzakere.ts`), render'ı değil.
 *
 * ⚠️ AÇIK KALAN — ROTA GÖÇÜNE BAĞLI: `[locale]` segmenti henüz yok, bu yüzden
 *    `getLocale()` bugün her istekte varsayılana (`tr`) düşüyor ve bu, bugünkü
 *    davranışın birebir aynısı. Segment geldiğinde bu dosya
 *    `app/[locale]/layout.tsx`e taşınır ve TEK SATIR değişir: `getLocale()`
 *    yerine `next/root-params`ın `locale()` getter'ı. Ayrıntı `docs/i18n.md`.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh bg-zemin text-metin antialiased">
        <TemaBetigi />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
