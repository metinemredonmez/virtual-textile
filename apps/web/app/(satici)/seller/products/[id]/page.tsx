import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { SayfaBasligi } from '@/components/panel/duzen';
import { DurumEylemleri } from '../_bilesenler/durum-eylemleri';
import { TryOnUygunluk } from '../_bilesenler/tryon-uygunluk';
import { UrunFormu } from '../_bilesenler/urun-formu';
import { VaryantMatrisi } from '../_bilesenler/varyant-matrisi';
import { urunDurumu } from '../_lib/durum';
import { kategoriSecenekleri } from '../../_lib/kategoriler';
import { urunGetir } from '../../_lib/veri';

export const metadata: Metadata = { title: 'Ürün · Satıcı paneli' };
export const dynamic = 'force-dynamic';

/**
 * ÜRÜN DETAYI — üç blok: durum, bilgi formu, varyant matrisi.
 *
 * Görseller AYRI EKRANDA (`./images`). Öğe bütçesi (`design-system.md`)
 * "bütçe aşılıyorsa yeni bir ekran gerekiyordur, sıkıştırma değil" diyor:
 * yükleme akışı kendi başına üç adım (bilet → PUT → onay) ve her adımın kendi
 * hatası var; bu ekranın altına dördüncü blok olarak sıkıştırılsaydı satıcı
 * ürün formunu kaydetmeden görsel yüklemeye başlar, kaydetmeyi unuturdu.
 *
 * ⚠️ `notFound()` ÇAĞRILMIYOR ve bu bilinçli: `(satici)/loading.tsx` grup
 *    kökünde duruyor, yani bu rota bir Suspense sınırının ARDINDA. AGENTS.md
 *    §8'de ölçülmüş kural: sınırın ardındaki `notFound()` HTTP 200 döndürür —
 *    kullanıcı doğru ekranı görür ama durum kodu yalan söyler. Grup kökündeki
 *    iskelet başka ekranların (bu ajanın sahibi olmadığı dosya) işine yarıyor,
 *    o yüzden burada 404 İDDİA EDİLMİYOR: bulunamayan ürün, zarfın kendi
 *    Türkçe mesajıyla ("Kayıt bulunamadı.") sayfa gövdesinde gösteriliyor.
 *    Kalıcı çözüm: iskelet rota bazına indirilip bu rotanın üstünden
 *    kaldırılmalı (rapor).
 */
export default async function SaticiUrunDetayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const donusYolu = `/seller/products/${id}`;

  const [sonuc, kategoriler] = await Promise.all([urunGetir(id, donusYolu), kategoriSecenekleri()]);

  if (!sonuc.tamam) {
    return (
      <section>
        <GeriBaglantisi />
        <SunucuHatasi govde={sonuc.hata} className="mt-4 max-w-xl" />
      </section>
    );
  }

  const urun = sonuc.veri;
  const durum = urunDurumu(urun.status);

  return (
    <section className="flex flex-col gap-8">
      {/*
        ⚠️ BAŞLIK `SayfaBasligi`DAN — elle `<h1>` yazan beş panel sayfasından
           biriydi ve ayracı (`border-b border-kenar pb-4`) taşımıyordu.
      */}
      <SayfaBasligi
        ustBaglanti={<GeriBaglantisi />}
        baslik={
          <span className="flex flex-wrap items-center gap-3">
            {urun.title}
            <Badge durum={durum.rozet}>{durum.metin}</Badge>
          </span>
        }
        aciklama={
          <>
            <p>{durum.aciklama}</p>

            {/*
              ⚠️ RET GEREKÇESİ AÇIKÇA GÖSTERİLİR. `statusReason`, ürünün neden
                 reddedildiğini söyleyen TEK alan; gösterilmezse satıcı aynı ürünü
                 aynı eksikle tekrar tekrar gönderir.
            */}
            {urun.status === 'REJECTED' && urun.statusReason ? (
              <p className="mt-3 rounded-md border border-kenar bg-yuzey p-3 text-metin">
                <span className="font-medium">Ret gerekçesi:</span> {urun.statusReason}
              </p>
            ) : null}

            <div className="mt-4">
              <DurumEylemleri urun={urun} />
            </div>
          </>
        }
      />

      <TryOnUygunluk
        skor={urun.tryOnScore}
        sorunlar={urun.tryOnIssues}
        gorsellerHref={`/seller/products/${urun.id}/images`}
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold">Ürün bilgileri</h2>
        <UrunFormu urun={urun} kategoriler={kategoriler} />
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Varyantlar</h2>
          <p className="text-xs text-metin-soluk">
            <span className="rakam">{urun.variantCount}</span> varyant ·{' '}
            <span className="rakam">{urun.availableStock}</span> satılabilir adet
          </p>
        </div>
        {urun.variants.length === 0 ? (
          /*
            ⚠️ Bu boşluk pratikte oluşmaz (`createProductSchema` en az bir
               varyant istiyor) ama CSV yolu ya da ileride eklenecek bir uç
               varyantsız ürün üretirse ekran "kayıt yok" demek yerine ne
               yapılacağını söylemeli.
          */
          <p className="rounded-md border border-kenar bg-yuzey p-4 text-sm text-metin-soluk">
            Bu üründe varyant yok. Renk ve beden seçenekleri olmadan ürün satılamaz; CSV toplu
            yükleme ile aynı ürün referansına varyant satırları ekleyebilirsiniz.
          </p>
        ) : (
          <VaryantMatrisi variants={urun.variants} />
        )}
      </div>
    </section>
  );
}

function GeriBaglantisi(): React.ReactElement {
  return (
    <Link
      href="/seller/products"
      className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
    >
      <ChevronLeft className="size-4 text-ikon" strokeWidth={1.5} />
      Ürünler
    </Link>
  );
}
