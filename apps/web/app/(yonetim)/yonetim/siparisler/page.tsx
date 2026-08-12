import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import type { OrderStatusWire } from '@vt/contracts';
import { hesapFetch } from '@/lib/api/server-authed';
import { list } from '@/lib/api/core';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { tarihSaat } from '@/lib/tarih';
import { BosSonuc, ImlecSayfalama, OzetSeridi, SayfaBasligi } from '@/components/panel/duzen';
import { SIPARIS_DURUMU } from '../_finans/etiketler';
import { sayi } from '@/lib/sayi-bicim';
import { baglanti } from '@/lib/sorgu';
import type { AdminOrderRowWire } from '@vt/contracts';

export const metadata: Metadata = { title: 'Siparişler' };
export const dynamic = 'force-dynamic';

const YOL = '/yonetim/siparisler';

const DURUMLAR = Object.keys(SIPARIS_DURUMU) as OrderStatusWire[];

/** `adminOrderListQuerySchema`: `q` en az 3 karakter. Altında istek 400 döner. */
const ARAMA_EN_AZ = 3;
const SAYFA_BOYU = 9;

/**
 * SİPARİŞ ARAMA VE LİSTE.
 *
 * ⚠️ ARAMA KUTUSU İSTEMCİ BİLEŞENİ DEĞİL, DÜZ `<form method="get">`.
 *    Vitrindeki arama kutusu istemci bileşeni çünkü orada öneri ucu var ve her
 *    tuşta çağrı yapıyor. Burada öyle bir uç yok: yönetici sipariş numarasını
 *    ya da e-postayı TAM yazıyor. JavaScript eklemek, ekranın tüm durumunu
 *    URL'de tutma kazancını (paylaşılabilir arama bağlantısı, çalışan geri
 *    tuşu) hiçbir karşılık almadan bozardı.
 *
 * ⚠️ `q` SUNUCUDA EN AZ 3 KARAKTER. İki harflik bir aramayı olduğu gibi
 *    geçirmek `VALIDATION_FAILED` üretir ve yönetici sonuç yerine hata görür;
 *    kısa terim burada düşürülüyor ve kutunun altında sebebi yazıyor.
 */
export default async function SiparislerPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    durum?: string;
    from?: string;
    to?: string;
    cursor?: string;
  }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const terim = (params.q ?? '').trim();
  const gecerliTerim = terim.length >= ARAMA_EN_AZ ? terim : undefined;
  const seciliDurum = DURUMLAR.find((deger) => deger === params.durum);

  /*
   * ⚠️ SÜZGEÇLER TEK YERDE TOPLANIYOR. Sayfalama bağlantısı bunları TAŞIMAK
   *    zorunda: taşımasaydı "sonraki sayfa" süzgeci düşürür ve yönetici aradığı
   *    listenin ortasından tüm siparişlere savrulurdu.
   */
  const suzgecler = {
    q: gecerliTerim ?? null,
    durum: seciliDurum ?? null,
    from: params.from ?? null,
    to: params.to ?? null,
  };

  let siparisler: AdminOrderRowWire[];
  let nextCursor: string | null;

  try {
    const sonuc = await hesapFetch<unknown, '/admin/orders'>(
      '/admin/orders',
      '/yonetim/siparisler',
      {
        query: {
          limit: SAYFA_BOYU,
          ...(gecerliTerim ? { q: gecerliTerim } : {}),
          ...(seciliDurum ? { status: seciliDurum } : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
      },
    );
    const cozulmus = list<AdminOrderRowWire>(sonuc);
    siparisler = cozulmus.items;
    nextCursor = cozulmus.nextCursor;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const odenmis = siparisler.filter((siparis) => siparis.paidAt !== null).length;
  const iadeIptal = siparisler.filter(
    (siparis) => siparis.status === 'REFUNDED' || siparis.status === 'CANCELLED',
  ).length;

  return (
    <section className="flex flex-col gap-6">
      <SayfaBasligi
        baslik="Siparişler"
        aciklama="Sipariş numarası ya da müşteri e-postasıyla arayın. Bu ekran salt okunurdur; sipariş durumunu yalnızca sipariş akışı değiştirir."
      />

      {/* ── Arama ────────────────────────────────────────────────────── */}
      <form
        method="get"
        action="/yonetim/siparisler"
        role="search"
        className="grid gap-3 rounded-lg border border-kenar p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="siparis-q">Sipariş numarası veya e-posta</Label>
          <Input
            id="siparis-q"
            type="search"
            name="q"
            defaultValue={terim}
            minLength={ARAMA_EN_AZ}
            maxLength={120}
            placeholder="VT-260812-0046"
          />
          {terim !== '' && gecerliTerim === undefined ? (
            <p className="text-xs text-uyari">
              Arama terimi en az <span className="rakam">{ARAMA_EN_AZ}</span> karakter olmalı; bu
              terim uygulanmadı.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="siparis-durum">Durum</Label>
          <select
            id="siparis-durum"
            name="durum"
            defaultValue={seciliDurum ?? ''}
            className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
          >
            <option value="">Tümü</option>
            {DURUMLAR.map((durum) => (
              <option key={durum} value={durum}>
                {SIPARIS_DURUMU[durum].metin}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="siparis-from">Başlangıç</Label>
          <Input
            id="siparis-from"
            type="date"
            name="from"
            className="rakam"
            defaultValue={params.from ?? ''}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="siparis-to">Bitiş</Label>
          <Input
            id="siparis-to"
            type="date"
            name="to"
            className="rakam"
            defaultValue={params.to ?? ''}
          />
        </div>

        <div className="flex items-end lg:col-span-5">
          <Button type="submit" size="sm">
            <Search />
            Ara
          </Button>
        </div>
      </form>

      <OzetSeridi
        rakamlar={[
          {
            etiket: 'Bu sayfada',
            deger: <span className="rakam">{sayi(siparisler.length)}</span>,
            alt: 'sipariş satırı',
          },
          {
            etiket: 'Ödemesi alınmış',
            deger: <span className="rakam">{sayi(odenmis)}</span>,
            alt: 'bu sayfadaki satırlar',
          },
          {
            etiket: 'İptal / iade',
            deger: <span className="rakam">{sayi(iadeIptal)}</span>,
            alt: 'bu sayfadaki satırlar',
          },
        ]}
      />

      {siparisler.length === 0 ? (
        <BosSonuc
          baslik="Sipariş bulunamadı."
          aciklama={
            gecerliTerim || seciliDurum || params.from || params.to
              ? 'Arama ve filtreleri gevşetip tekrar deneyin.'
              : 'Henüz hiç sipariş oluşmamış.'
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Sipariş</TH>
              <TH>Durum</TH>
              <TH>Müşteri</TH>
              <TH>Satıcı</TH>
              <TH sayisal>Kalem</TH>
              <TH sayisal>Toplam</TH>
              <TH>Tarih</TH>
            </TR>
          </THead>
          <TBody>
            {siparisler.map((siparis) => {
              const durum = SIPARIS_DURUMU[siparis.status];
              return (
                <TR key={siparis.id}>
                  <TD>
                    <Link
                      href={`/yonetim/siparisler/${encodeURIComponent(siparis.orderNumber)}`}
                      className="rakam font-medium text-metin hover:underline"
                    >
                      {siparis.orderNumber}
                    </Link>
                  </TD>
                  <TD>
                    <Badge durum={durum.rozet}>{durum.metin}</Badge>
                  </TD>
                  <TD className="text-metin-soluk">{siparis.email}</TD>
                  {/* ⚠️ Çok satıcılı sipariş normaldir (sepet paketlere
                      bölünüyor); tek isim gösterip gerisini yutmak yanıltıcı
                      olurdu. */}
                  <TD className="text-metin-soluk">
                    {siparis.sellerNames.length === 0 ? '—' : siparis.sellerNames.join(', ')}
                  </TD>
                  <TD sayisal>{sayi(siparis.itemCount)}</TD>
                  <TD sayisal>
                    <Fiyat value={siparis.grandTotalMinor} />
                  </TD>
                  <TD className="text-metin-soluk">{tarihSaat(siparis.createdAt)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <ImlecSayfalama
        ilkSayfaHref={baglanti(YOL, suzgecler)}
        sonrakiHref={
          nextCursor !== null && siparisler.length > 0
            ? baglanti(YOL, { ...suzgecler, cursor: nextCursor })
            : null
        }
        ilkSayfada={params.cursor === undefined || params.cursor === ''}
      />
    </section>
  );
}
