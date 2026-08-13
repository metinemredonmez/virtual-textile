import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { UrunTablosu } from './_bilesenler/urun-tablosu';
import { DURUM_SEKMELERI, durumMu } from './_lib/durum';
import { urunleriGetir } from '../_lib/veri';
import { BosSonuc, ImlecSayfalama, SayfaBasligi, Sekmeler } from '@/components/panel/duzen';

/**
 * ÜRÜN LİSTESİ — satıcı panelinin ana çalışma ekranı.
 *
 * Ekranın tüm durumu URL'dedir (durum sekmesi, arama, imleç); `/products`
 * referans sayfasındaki kararın aynısı. Global durum kütüphanesi yok ve
 * paylaşılan bir bağlantı aynı listeyi açmalı.
 *
 * ⚠️ `robots: noindex` DEĞİL, `metadata` bile yeterli değil — bu bölge zaten
 *    kimliğin arkasında ve `hesapFetch` oturumsuz kullanıcıyı `/login`e atıyor.
 *    Yine de başlık veriliyor: sekmede "Satıcı paneli" yazması, aynı anda açık
 *    olan vitrin sekmesinden ayırt etmeyi sağlar.
 *
 * ⚠️ Bu rotada `loading.tsx` YOK ve olmayacak: `(satici)/loading.tsx` grup
 *    kökünde duruyor ve alt rotaları zaten kapsıyor. İkinci bir iskelet
 *    eklemek aynı geçişte iki kez şekil değiştiren bir ekran üretir.
 */
export const metadata: Metadata = { title: 'Ürünler · Satıcı paneli' };

/** ⚠️ Kimlikli okuma; önbelleklenmemeli. `hesapFetch` zaten `no-store`. */
export const dynamic = 'force-dynamic';

/** Varsayılan görünümde 5-9 öğe (design-system.md) — sayfa başına 9 satır. */
const SAYFA_BOYU = 9;

interface AramaParametreleri {
  durum?: string;
  q?: string;
  imlec?: string;
}

function baglanti(params: AramaParametreleri): string {
  const arama = new URLSearchParams();
  if (params.durum) arama.set('durum', params.durum);
  if (params.q) arama.set('q', params.q);
  if (params.imlec) arama.set('imlec', params.imlec);
  const qs = arama.toString();
  return qs ? `/seller/products?${qs}` : '/seller/products';
}

export default async function SaticiUrunlerPage({
  searchParams,
}: {
  searchParams: Promise<AramaParametreleri>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const durum = durumMu(params.durum) ? params.durum : undefined;
  const q = params.q?.trim() ? params.q.trim() : undefined;
  const imlec = params.imlec ?? undefined;

  const sonuc = await urunleriGetir(
    { status: durum, q, cursor: imlec, limit: SAYFA_BOYU },
    baglanti(params),
  );

  return (
    <section>
      <SayfaBasligi
        baslik="Ürünler"
        aciklama="Ürün taslak olarak doğar; görselleri yükleyip incelemeye gönderdiğinizde yayına alınır."
        eylem={
          <div className="flex gap-2">
            <Button asChild variant="ikincil" size="sm">
              <Link href="/seller/products/bulk-upload">
                <Upload className="size-4" strokeWidth={1.5} />
                CSV ile yükle
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/seller/products/new">
                <Plus className="size-4" strokeWidth={1.5} />
                Yeni ürün
              </Link>
            </Button>
          </div>
        }
      />

      {/* ⚠️ `imlec` sekme değişince DÜŞER — `<DurumSekmeleri>` bunu kendi yapar. */}
      <Sekmeler
        etiket="Ürün durumu"
        sekmeler={DURUM_SEKMELERI.map((sekme) => ({
          etiket: sekme.etiket,
          yol: baglanti({ durum: sekme.deger ?? undefined, q }),
          secili: (sekme.deger ?? undefined) === durum,
        }))}
      />

      {/*
        ARAMA — `GET` formu. İstemci bileşeni gerekmiyor: sorgu URL'ye yazılıyor
        ve sayfa sunucuda yeniden çiziliyor.
        ⚠️ `imlec` forma KONMUYOR: yeni arama ilk sayfadan başlar. Taşınsaydı
           arama sonucu başka bir listenin ortasından açılırdı.
      */}
      <form action="/seller/products" className="mt-4 flex gap-2">
        {durum ? <input type="hidden" name="durum" value={durum} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Ürün adı veya SKU ara"
          className="h-10 w-full max-w-sm rounded-md border border-kenar bg-zemin px-3 text-sm text-metin placeholder:text-metin-soluk"
        />
        <Button type="submit" variant="ikincil" size="md">
          Ara
        </Button>
      </form>

      <div className="mt-6">
        {!sonuc.tamam ? (
          <SunucuHatasi govde={sonuc.hata} className="max-w-xl" />
        ) : sonuc.veri.urunler.length === 0 ? (
          <BosDurum durum={durum} aranan={q} />
        ) : (
          <>
            <UrunTablosu urunler={sonuc.veri.urunler} />

            <ImlecSayfalama
              ilkSayfaHref={baglanti({ durum, q })}
              sonrakiHref={
                sonuc.veri.nextCursor ? baglanti({ durum, q, imlec: sonuc.veri.nextCursor }) : null
              }
              ilkSayfada={imlec === undefined}
            />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * BOŞ DURUM — "kayıt yok" DEMEZ, NE YAPILACAĞINI söyler (design-system.md).
 *
 * ⚠️ Üç ayrı boşluk var ve üçü aynı cümleyle geçiştirilmez:
 *      • hiç ürün yok            → ilk ürünü eklemenin İKİ yolu gösterilir
 *      • sekmede ürün yok        → o durumun ne anlama geldiği söylenir
 *      • arama sonuç vermedi     → aramayı temizleme çıkışı verilir
 *    Tek bir "Ürün bulunamadı" cümlesi, mağazasına ilk ürününü ekleyecek
 *    satıcıyı boş bir ekranda bırakırdı.
 */
function BosDurum({
  durum,
  aranan,
}: {
  durum: string | undefined;
  aranan: string | undefined;
}): React.ReactElement {
  if (aranan) {
    return (
      <BosSonuc
        baslik={`“${aranan}” aramasıyla eşleşen ürün yok.`}
        aciklama="Arama ürün adında ve SKU'da geçiyor mu diye bakar; kısaltarak tekrar deneyin."
        eylem={
          <Button asChild variant="ikincil" size="sm">
            <Link href={durum ? `/seller/products?durum=${durum}` : '/seller/products'}>
              Aramayı temizle
            </Link>
          </Button>
        }
      />
    );
  }

  if (durum) {
    return (
      <BosSonuc
        baslik="Bu durumda ürününüz yok."
        aciklama="Ürünler taslak olarak doğar; incelemeye gönderdiğinizde “İncelemede”, onaylandığında “Yayında” sekmesinde görünür."
        eylem={
          <Button asChild variant="ikincil" size="sm">
            <Link href="/seller/products">Tüm ürünleri göster</Link>
          </Button>
        }
      />
    );
  }

  return (
    <BosSonuc
      baslik="Mağazanızda henüz ürün yok."
      aciklama="Tek ürünü formla ekleyebilir, hazır bir listeniz varsa CSV ile toplu yükleyebilirsiniz."
      eylem={
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/seller/products/new">Ürün ekle</Link>
          </Button>
          <Button asChild variant="ikincil" size="sm">
            <Link href="/seller/products/bulk-upload">CSV ile toplu yükle</Link>
          </Button>
        </div>
      }
    />
  );
}
