import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Fiyat } from '@/components/fiyat/fiyat';
import { kalanSaat, tarih, tarihSaat } from '@/lib/tarih';
import { BosSonuc, ImlecSayfalama, SayfaBasligi, Sekmeler } from '@/components/panel/duzen';
import { paketleriGetir } from '../_lib/veri';
import { PAKET_DURUMU, SUZGEC_SIRASI } from './_lib/etiketler';
import {
  imlecYolu,
  SLA_UYARI_SAATI,
  sorguyuOku,
  suzgecYolu,
  type AramaParametreleri,
  type SiparisSorgusu,
} from './_lib/sorgu';
import type { SellerPackageSummaryWire } from '@vt/contracts';

export const metadata: Metadata = { title: 'Siparişler' };

/**
 * ⚠️ `force-dynamic`: kimlikli okuma (`hesapFetch` → `cache: 'no-store'`) zaten
 *    rotayı dinamik yapıyor; açıkça yazmak bir gün birinin "neden statik değil"
 *    diye aramasını önler. Kişisel veri ÖNBELLEKLENMEZ — bir satıcının sipariş
 *    listesi başka bir satıcıya servis edilemez.
 */
export const dynamic = 'force-dynamic';

const YOL = '/seller/orders';

/** Varsayılan görünümde 5–9 öğe (design-system.md → finansal tablo). */
const SAYFA_BOYU = 9;

/**
 * SATICI SİPARİŞ LİSTESİ.
 *
 * Uç: `GET /v1/seller/orders` — satır aslında bir PAKETTİR, sipariş değil.
 * Çok satıcılı bir sipariş satıcı başına paketlere bölünür; satıcı yalnızca
 * kendi paketini görür ve yalnızca onun durumunu değiştirebilir.
 *
 * ⚠️ MAĞAZA KİMLİĞİ GÖNDERİLMEZ. `@SellerId()` yalnız `request.sellerId`
 *    okuyor; kapsam guard'da (`SellerScopeGuard`) ve Prisma `where` koşulunda
 *    iki kez kapalı. Arayüzün gövdeye/sorguya `sellerId` koyması hem gereksiz
 *    hem tehlikeli bir alışkanlık olurdu.
 *
 * ⚠️ TABLO ÜSTÜNDE ÖZET RAKAM YOK ve bu bilinçli: bu uç `meta.total`
 *    döndürmüyor, yalnızca bir sayfa satır veriyor. "12 bekleyen sipariş" gibi
 *    bir rakam ancak GÖRÜNEN SATIRLAR sayılarak üretilebilirdi ve sayfa
 *    değiştikçe değişen bir "toplam" gösterirdi. Satıcının bekleyen iş sayısını
 *    görmesi gereken yer bu; eksik olan uç raporlandı.
 */
export default async function SaticiSiparislerPage({
  searchParams,
}: {
  searchParams: Promise<AramaParametreleri>;
}) {
  const sorgu = sorguyuOku(await searchParams);

  /*
   * ⚠️ OKUMA `_lib/veri.ts`TEN GEÇİYOR. Bu ekran aynı uca kendi `hesapFetch`
   *    çağrısıyla gidiyordu, yani `/seller/orders` TEK PANELDE İKİ YOLDAN
   *    okunuyordu (diğeri panonun `paketleriGetir` çağrısı). Sorgu şekli
   *    değiştiğinde yalnız birinin güncellenmesi, bu deponun ölçülmüş kopya
   *    ayrışma sınıfının aynısıydı. `slaBreached`in `z.coerce.boolean()`
   *    tuzağı da artık orada, tek yerde yazılı.
   */
  const okuma = await paketleriGetir(
    {
      limit: SAYFA_BOYU,
      status: sorgu.durum ?? undefined,
      slaBreached: sorgu.gecikmis,
      orderNumber: sorgu.siparisNo ?? undefined,
      cursor: sorgu.imlec ?? undefined,
    },
    YOL,
  );

  if (!okuma.tamam) {
    return <SunucuHatasi govde={okuma.hata} className="max-w-xl" />;
  }

  const { paketler: items, nextCursor } = okuma.veri;

  return (
    <section className="flex flex-col gap-6">
      <SayfaBasligi
        baslik="Siparişler"
        aciklama="Hazırlık süresi aşılan paket satıcı puanınızı düşürür; süzgeç ve arama URL'de kalır."
        eylem={<SiparisNoAramasi sorgu={sorgu} />}
      />

      <Suzgecler sorgu={sorgu} />

      {items.length === 0 ? (
        <BosDurum sorgu={sorgu} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH scope="col">Sipariş</TH>
              <TH scope="col">Durum</TH>
              <TH scope="col">Hazırlık süresi</TH>
              <TH scope="col">Kargo</TH>
              <TH scope="col" sayisal>
                Kalem
              </TH>
              <TH scope="col" sayisal>
                Ürün tutarı
              </TH>
            </TR>
          </THead>
          <TBody>
            {items.map((paket) => (
              <PaketSatiri key={paket.id} paket={paket} />
            ))}
          </TBody>
        </Table>
      )}

      <ImlecSayfalama
        ilkSayfaHref={suzgecYolu(sorgu, {})}
        sonrakiHref={nextCursor ? imlecYolu(sorgu, nextCursor) : null}
        ilkSayfada={sorgu.imlec === null}
      />
    </section>
  );
}

function PaketSatiri({ paket }: { paket: SellerPackageSummaryWire }) {
  const durum = PAKET_DURUMU[paket.status];

  return (
    <TR>
      <TD>
        <Link
          href={`/seller/orders/${paket.id}`}
          className="rakam font-medium text-metin hover:underline"
        >
          {paket.orderNumber}
        </Link>
        <span className="ml-2 text-xs text-metin-soluk">{tarih(paket.createdAt)}</span>
      </TD>

      <TD>
        <Badge durum={durum.rozet}>{durum.metin}</Badge>
      </TD>

      <TD>
        <SlaHucresi paket={paket} />
      </TD>

      <TD className="text-metin-soluk">
        {paket.trackingNo ? (
          <>
            {paket.carrier ?? 'Kargo'} · <span className="rakam">{paket.trackingNo}</span>
          </>
        ) : (
          '—'
        )}
      </TD>

      <TD sayisal>{paket.itemCount}</TD>

      {/* ⚠️ Bu tutar MÜŞTERİNİN ödediğidir, satıcının hakedişi değil. Hakediş
          kalem başına (`sellerNetMinor`) paket detayında gelir ve burada
          toplanamaz — toplamlar frontend'de hesaplanmaz. */}
      <TD sayisal>
        <Fiyat value={paket.itemsTotalMinor} className="text-sm" />
      </TD>
    </TR>
  );
}

/**
 * SLA HÜCRESİ — üç hâl, ve üçü de aynı şey değil.
 *
 * ⚠️ "Gecikti" kararı SUNUCUNUN (`slaBreached`). Burada yeniden hesaplansaydı
 *    arayüz sunucunun üç şartından yalnızca birine (tarih) bakar ve kargolanmış
 *    paketleri de gecikmiş gösterirdi.
 *
 * ⚠️ "Az kaldı" ise sunucuda YOK: sunucu ancak süre DOLDUKTAN sonra bir şey
 *    söylüyor. Satıcının işe yarar uyarıyı alması gereken an ondan öncesi;
 *    yakınlık burada, yalnız gösterim için hesaplanıyor.
 */
function SlaHucresi({ paket }: { paket: SellerPackageSummaryWire }) {
  if (paket.slaBreached) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge durum="tehlike">Süre aşıldı</Badge>
        <span className="rakam text-xs text-metin-soluk">{tarihSaat(paket.slaDeadline)}</span>
      </span>
    );
  }

  const bekleyen = paket.status === 'AWAITING_APPROVAL' || paket.status === 'PREPARING';
  if (!bekleyen) return <span className="text-metin-soluk">—</span>;

  const kalan = kalanSaat(paket.slaDeadline);
  if (kalan <= SLA_UYARI_SAATI) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge durum="uyari">
          <span className="rakam">{kalan}</span> saat kaldı
        </Badge>
      </span>
    );
  }

  return <span className="rakam text-metin-soluk">{tarihSaat(paket.slaDeadline)}</span>;
}

/**
 * SÜZGEÇ SEKMELERİ.
 *
 * ⚠️ Sekmeler RENKSİZ (`design-system.md`: renk yalnızca durum taşır; sekme
 *    listede "renk taşımaz" tarafında). Seçili sekme hafif bir arka planla
 *    ayrılır, çerçeve veya vurgu rengiyle değil.
 */
function Suzgecler({ sorgu }: { sorgu: SiparisSorgusu }) {
  /*
   * ⚠️ SORGUSU İKİ PARAMETRELİ (`durum` + `gecikmis`), bu yüzden
   *    `<DurumSekmeleri>` değil doğrudan `<Sekmeler>` kullanılıyor ve yollar
   *    `suzgecYolu` ile üretiliyor — o fonksiyon imleci BİLEREK taşımıyor
   *    (yeni süzgeç, yeni sayfa 1).
   */
  return (
    <Sekmeler
      etiket="Sipariş süzgeci"
      sekmeler={[
        {
          etiket: 'Tümü',
          yol: suzgecYolu(sorgu, { durum: null, gecikmis: false }),
          secili: sorgu.durum === null && !sorgu.gecikmis,
        },
        ...SUZGEC_SIRASI.map((durum) => ({
          etiket: PAKET_DURUMU[durum].metin,
          yol: suzgecYolu(sorgu, { durum, gecikmis: false }),
          secili: sorgu.durum === durum && !sorgu.gecikmis,
        })),
        {
          etiket: 'Süresi aşılanlar',
          yol: suzgecYolu(sorgu, { durum: null, gecikmis: true }),
          secili: sorgu.gecikmis,
        },
      ]}
    />
  );
}

/**
 * SİPARİŞ NUMARASI ARAMASI.
 *
 * ⚠️ Düz `method="get"` formu — İstemci Bileşeni DEĞİL. JavaScript indirmeden
 *    çalışır ve sonuç URL'de kalır; satıcı adresi kopyalayıp destek ekibine
 *    gönderebilir.
 *
 * ⚠️ Süzgeçler gizli alanlarla TAŞINIR: taşınmasaydı arama yapan satıcı sessizce
 *    "Tümü" sekmesine düşerdi.
 */
function SiparisNoAramasi({ sorgu }: { sorgu: SiparisSorgusu }) {
  return (
    <form action={YOL} method="get" className="flex items-center gap-2">
      {sorgu.durum ? <input type="hidden" name="durum" value={sorgu.durum} /> : null}
      {sorgu.gecikmis ? <input type="hidden" name="gecikmis" value="1" /> : null}

      <label htmlFor="siparis-no" className="sr-only">
        Sipariş numarası
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ikon" />
        <Input
          id="siparis-no"
          name="siparisNo"
          defaultValue={sorgu.siparisNo ?? ''}
          placeholder="VT-260811-0042"
          className="rakam w-full pl-9 sm:w-56"
        />
      </div>
      <Button type="submit" variant="ikincil" size="md">
        Ara
      </Button>
    </form>
  );
}

/** ⚠️ Boş durum NE YAPILACAĞINI söyler; "kayıt yok" bir çıkmaz sokaktır. */
function BosDurum({ sorgu }: { sorgu: SiparisSorgusu }) {
  const suzgecliMi = sorgu.durum !== null || sorgu.gecikmis || sorgu.siparisNo !== null;

  if (suzgecliMi) {
    return (
      <BosSonuc
        baslik="Bu süzgece uyan sipariş yok."
        aciklama="Süzgeci temizleyerek tüm siparişlere dönebilirsiniz."
        eylem={
          <Button variant="ikincil" size="sm" asChild>
            <Link href={YOL}>Süzgeci temizle</Link>
          </Button>
        }
      />
    );
  }

  return (
    <BosSonuc
      baslik="Mağazanıza henüz sipariş gelmedi."
      aciklama="Sipariş geldiğinde bu listede görünür ve hazırlık süreniz işlemeye başlar."
    />
  );
}
