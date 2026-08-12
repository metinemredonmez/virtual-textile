import type { Metadata } from 'next';
import Link from 'next/link';
import { list } from '@/lib/api/core';
import { mediaUrl } from '@/lib/media';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { hesapFetch } from '@/lib/api/server-authed';
import { SIPARIS_DURUMU } from '../_lib/etiketler';
import { tarih } from '@/lib/tarih';
import type { OrderListItemWire } from '@vt/contracts';

export const metadata: Metadata = { title: 'Siparişlerim' };

export const dynamic = 'force-dynamic';

const YOL = '/hesabim/siparisler';

/**
 * SİPARİŞ LİSTESİ.
 *
 * ⚠️ `list()` ile açılıyor, `data.items` ELLE OKUNMUYOR. Ölçüldü: bu uçta zarf
 *    `data`yı ÇIPLAK DİZİ yapıyor ve `nextCursor` `meta`ya taşınıyor
 *    (`{"data":[],"meta":{…,"nextCursor":null}}`). `data.items` okuyan bir
 *    ekran burada sessizce `undefined` görür ve "hiç siparişiniz yok" der.
 *
 * ⚠️ SAYFALAMA CURSOR İLE. Offset kullanılsaydı, araya yeni bir sipariş
 *    girdiğinde kullanıcı ikinci sayfada aynı siparişi tekrar görürdü
 *    (`order.service.ts` → `listForUser` başlığındaki gerekçe).
 */
export default async function SiparislerPage({
  searchParams,
}: {
  searchParams: Promise<{ imlec?: string }>;
}) {
  const { imlec } = await searchParams;

  let sonuc;
  try {
    sonuc = await hesapFetch<unknown, '/orders'>('/orders', YOL, {
      query: { limit: 20, cursor: imlec },
    });
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const { items, nextCursor } = list<OrderListItemWire>(sonuc);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Siparişlerim</h1>

      {items.length === 0 ? (
        // ⚠️ Boş durum NE YAPILACAĞINI söyler. "Kayıt yok" bir çıkmaz sokaktır.
        <div className="rounded-lg border border-kenar p-8 text-center">
          <p className="text-sm text-metin">Henüz bir siparişiniz yok.</p>
          <Button variant="ikincil" size="sm" className="mt-4" asChild>
            <Link href="/urunler">Ürünleri keşfet</Link>
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((siparis) => (
            <li key={siparis.id}>
              <SiparisKarti siparis={siparis} />
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div>
          <Button variant="ikincil" size="sm" asChild>
            <Link href={`${YOL}?imlec=${encodeURIComponent(nextCursor)}`}>
              Daha eski siparişler
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function SiparisKarti({ siparis }: { siparis: OrderListItemWire }) {
  const durum = SIPARIS_DURUMU[siparis.status];

  return (
    <Link
      href={`/hesabim/siparisler/${siparis.orderNumber}`}
      className="flex flex-col gap-4 rounded-lg border border-kenar p-4 hover:bg-yuzey"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-3">
          {/* Sipariş numarası bir SAYIDIR: `rakam` sınıfı olmadan listedeki
              numaralar hizalanmaz ve göz onları tarayamaz. */}
          <span className="rakam text-sm font-semibold text-metin">{siparis.orderNumber}</span>
          <Badge durum={durum.rozet}>{durum.metin}</Badge>
        </div>
        <Fiyat value={siparis.grandTotalMinor} className="text-sm" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {siparis.previewItems.map((kalem) => {
          const gorsel = mediaUrl(kalem.imageKey);
          return (
            <div
              key={kalem.id}
              className="relative aspect-urun w-12 shrink-0 overflow-hidden rounded-sm bg-yuzey"
            >
              {/* ⚠️ Ham `next/image` DEĞİL — gerekçe `components/urun/urun-gorseli.tsx`te. */}
              <UrunGorseli src={gorsel} alt={kalem.productTitle} sizes="48px" />
            </div>
          );
        })}

        <p className="text-sm text-metin-soluk">
          {tarih(siparis.createdAt)} · <span className="rakam">{siparis.itemCount}</span> ürün
          {siparis.packageCount > 1 ? (
            <>
              {' · '}
              <span className="rakam">{siparis.packageCount}</span> paket
            </>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
