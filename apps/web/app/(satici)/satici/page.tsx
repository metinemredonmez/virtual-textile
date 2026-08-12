import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Percent, Plus, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { readMinor } from '@/lib/money';
import { OzetSeridi, SayfaBasligi } from '@/components/panel/duzen';
import { sayimEtiketi } from '@/lib/api/okuma';
import { stokDurumu } from './urunler/_lib/durum';
import { BAKIYE_ETIKETI } from './_lib/bakiye-etiketleri';
import { bakiyeGetir, magazaGetir, paketleriGetir, urunleriGetir } from './_lib/veri';

export const metadata: Metadata = { title: 'Satıcı paneli' };
export const dynamic = 'force-dynamic';

/**
 * SATICI PANELİ ÖZETİ.
 *
 * ⚠️ ÖĞE BÜTÇESİ 5-9 (`design-system.md` → "Admin panosu"). Bu ekranda
 *    yedi öğe var: mağaza durumu · dört özet kartı · düşük stok listesi ·
 *    hızlı işlemler. Sekizincisi eklenecekse yeni bir ekran gerekiyordur.
 *
 * ⚠️ SAYIMLAR PENCERE İÇİNDEDİR, TOPLAM DEĞİLDİR. Satıcı uçları `meta.total`
 *    döndürmüyor (yalnız `nextCursor`); "23 bekleyen sipariş" yazmak uydurma
 *    olurdu. Bu yüzden pencere doluysa sayı `9+` şeklinde gösteriliyor ve
 *    etiket "bekleyen" değil, "bekleyen (ilk 9)" demiyor — rakamın kendisi
 *    `9+` diyerek sınırı taşıyor.
 *
 * ⚠️ KART BAŞINA BİR OKUMA VAR ve hepsi PARALEL gidiyor. Sırayla gitselerdi
 *    panel açılışı beş turun toplamı kadar sürerdi; kartların birbirine
 *    bağımlılığı yok.
 *
 * ⚠️ BİR KART DÜŞERSE DİĞERLERİ AYAKTA KALIR: okumalar `Okuma<T>` döndürüyor,
 *    fırlatmıyor. Analitik ucu bugün 500 veriyor (`::uuid` hatası) — tek bir
 *    bozuk uç yüzünden panelin tamamını hata sınırına düşürmek, çalışan dört
 *    rakamı da satıcıdan almak olurdu.
 */
const PENCERE = 9;
/**
 * Düşük stok taraması bu kadar ürünle sınırlı — sayfalama uçları toplam vermiyor.
 *
 * ⚠️ UYARI ÜRÜN DÜZEYİNDEDİR, VARYANT DÜZEYİNDE DEĞİL: liste ucu yalnız
 *    `availableStock` (tüm varyantların toplamı) veriyor. ÖLÇÜLDÜ: tek varyantı
 *    3 adete düşmüş bir üründe toplam 12 kalıyor ve ürün burada görünmüyor.
 *    Varyant kırılımı yalnız `GET /seller/products/:id` yanıtında var, yani
 *    doğru uyarı ürün başına bir istek demek (100 ürün = 100 tur). Kalıcı
 *    çözüm liste ucuna `lowStockVariantCount` eklemek (rapor); bugün ekran
 *    ölçebildiğini söylüyor, ölçemediğini uydurmuyor.
 */
const STOK_PENCERESI = 100;

export default async function SaticiPanoPage(): Promise<React.ReactElement> {
  const yol = '/satici';

  const [magaza, bakiye, bekleyenler, moderasyondakiler, stokTaramasi] = await Promise.all([
    magazaGetir(yol),
    bakiyeGetir(yol),
    paketleriGetir({ status: 'AWAITING_APPROVAL', limit: PENCERE }, yol),
    urunleriGetir({ status: 'PENDING_REVIEW', limit: PENCERE }, yol),
    urunleriGetir({ limit: STOK_PENCERESI }, yol),
  ]);

  const dusukStok = stokTaramasi.tamam
    ? stokTaramasi.veri.urunler
        .filter((urun) => stokDurumu(urun.availableStock) !== null)
        .sort((a, b) => a.availableStock - b.availableStock)
    : [];

  return (
    <section className="flex flex-col gap-8">
      {/*
        ⚠️ BAŞLIK `SayfaBasligi`DAN. Burada elle bir `<h1>` vardı; yönetim
           panosu bileşeni kullanıyordu, satıcı panosu kullanmıyordu — yani iki
           panelin İLK ekranı iki farklı başlık kalıbıyla çiziliyor, satıcı
           tarafında `border-b` ayracı hiç olmuyordu.
      */}
      <SayfaBasligi
        baslik={magaza.tamam ? magaza.veri.displayName : 'Satıcı paneli'}
        aciklama={magaza.tamam ? <MagazaDurumu magaza={magaza.veri} /> : null}
      />

      {/* Mağaza okuması düşerse durum bilinmiyor demektir; bu gizlenmez. */}
      {!magaza.tamam ? <SunucuHatasi govde={magaza.hata} className="max-w-xl" /> : null}

      {/*
        ⚠️ ŞERİT `panel/duzen.tsx`TEN. Burada `Kart` adlı yerel bir uygulama
           vardı; yönetim panosunda `Kart<T>`, uyarılarda `OzetKart`, finansta
           `OzetKarti` — aynı "tablo üstü özet şeridi" dört ayrı tipografiyle
           çiziliyordu. Kartların dördü de bir OKUMAYA bağlı olduğu için hata
           dalı `{etiket, hata}` şeklinde şeride veriliyor: hücre çöker, şerit
           ayakta kalır.
      */}
      <OzetSeridi
        rakamlar={[
          bekleyenler.tamam
            ? {
                etiket: 'Onay bekleyen sipariş',
                deger: (
                  <span className="rakam">
                    {sayimEtiketi(bekleyenler.veri.paketler.length, bekleyenler.veri.nextCursor)}
                  </span>
                ),
                /* ⚠️ SLA aşımı sunucudan gelen bir DURUM; renk taşıyabilir. */
                alt: bekleyenler.veri.paketler.some((paket) => paket.slaBreached) ? (
                  <Badge durum="uyari">SLA süresi geçen paket var</Badge>
                ) : (
                  'Kargoya verilmeyi bekliyor'
                ),
                href: '/satici/siparisler?durum=AWAITING_APPROVAL',
              }
            : { etiket: 'Onay bekleyen sipariş', hata: bekleyenler.hata },

          moderasyondakiler.tamam
            ? {
                etiket: 'İncelemedeki ürün',
                deger: (
                  <span className="rakam">
                    {sayimEtiketi(
                      moderasyondakiler.veri.urunler.length,
                      moderasyondakiler.veri.nextCursor,
                    )}
                  </span>
                ),
                alt: 'Yayın onayı bekliyor',
                href: '/satici/urunler?durum=PENDING_REVIEW',
              }
            : { etiket: 'İncelemedeki ürün', hata: moderasyondakiler.hata },

          stokTaramasi.tamam
            ? {
                etiket: 'Düşük stok',
                deger: <span className="rakam">{dusukStok.length}</span>,
                alt:
                  dusukStok.length > 0 ? (
                    <Badge durum="uyari">{`Son ${STOK_PENCERESI} ürün içinde`}</Badge>
                  ) : (
                    `Son ${STOK_PENCERESI} ürün içinde`
                  ),
                href: '/satici/urunler',
              }
            : { etiket: 'Düşük stok', hata: stokTaramasi.hata },

          bakiye.tamam
            ? {
                /*
                  ⚠️ ETİKET "BAKİYE" DEĞİL, "DEFTER TOPLAMI" — ve bu ad ortak
                     sabitten okunuyor (`_lib/bakiye-etiketleri.ts`). Aynı
                     sunucu alanı (`totalMinor`) burada "Bakiye", finans
                     ekranında "Defter toplamı" diye çıkıyordu; ikisi de aynı
                     kitleye aynı sayıyı gösterdiği için bu bir karşılık değil,
                     kopyaydı. Gerekçenin tamamı o dosyanın başlığında.
                */
                etiket: BAKIYE_ETIKETI.toplam,
                deger: <Fiyat value={bakiye.veri.totalMinor} className="text-lg" />,
                alt: (
                  <span className="flex flex-col gap-2">
                    <span>
                      {BAKIYE_ETIKETI.cekilebilir}: <Fiyat value={bakiye.veri.withdrawableMinor} />
                    </span>
                    {/*
                      ⚠️ ONAYLANAN TALEP DEFTERDEN DÜŞMÜYOR (ölçüldü: `PAYOUT`
                         türünde defter satırı yazan tek bir kod yolu yok).
                         Cümle konmazsa satıcı "talebim onaylandı ama defter
                         toplamım aynı" diye destek yazar.
                    */}
                    {bakiye.veri.hasPendingPayout ? (
                      <span>
                        Bekleyen ödeme talebiniz var; talep tutarı defter toplamınızdan henüz
                        düşülmedi.
                      </span>
                    ) : null}
                    {/*
                      ⚠️ `withdrawableMinor` 0'a KIRPILIYOR; gerçek defter
                         toplamı eksideyse yalnızca "0,00 ₺ çekilebilir" yazmak
                         borcu görünmez kılar.
                    */}
                    {readMinor(bakiye.veri.availableMinor).amountMinor < 0n ? (
                      <span className="text-uyari">
                        İade sonrası defter toplamınız eksidedir; yeni satışlarınızdan mahsup
                        edilecektir.
                      </span>
                    ) : null}
                  </span>
                ),
                href: '/satici/finans',
              }
            : { etiket: BAKIYE_ETIKETI.toplam, hata: bakiye.hata },
        ]}
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold">Stoğu azalan ürünler</h2>
        {!stokTaramasi.tamam ? (
          <SunucuHatasi govde={stokTaramasi.hata} className="max-w-xl" />
        ) : dusukStok.length === 0 ? (
          <p className="max-w-prose rounded-md border border-kenar bg-yuzey p-4 text-sm text-metin-soluk">
            Stoğu azalan ürün yok. Bir ürünün satılabilir adedi eşiğin altına düştüğünde burada
            listelenir ve varyant matrisinden stoğu güncelleyebilirsiniz.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {/* ⚠️ 5-9 öğe kuralı: en kritik beşi. Tamamı ürün listesinde. */}
            {dusukStok.slice(0, 5).map((urun) => {
              const stok = stokDurumu(urun.availableStock);
              return (
                <li
                  key={urun.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-kenar p-3 text-sm"
                >
                  <Link href={`/satici/urunler/${urun.id}`} className="font-medium hover:underline">
                    {urun.title}
                  </Link>
                  {stok ? <Badge durum={stok.rozet}>{stok.metin}</Badge> : null}
                  <span className="rakam ml-auto text-metin-soluk">
                    {urun.availableStock} satılabilir
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/*
        ⚠️ BU BLOK BİR KISAYOLDUR, GEZİNME DEĞİL — ve gerekçesi değişti.
           Yazıldığı gün kabuk menüsü (`(satici)/layout.tsx`) düz metindi ve
           "yakında" diyordu; buradaki bağlantılar yazılan ekranlara ULAŞMANIN
           TEK yoluydu. Menü artık `<Link>` taşıyor (ve `yan-menu.test.ts` iki
           yönü de kırıyor), yani blok artık bir yedek değil: panonun dördü de
           "yeni ürün / CSV" gibi menüde satırı OLMAYAN alt rotalara gidiyor.
           Eski gerekçeyi bırakmak, sonraki ajanı olmayan bir dünyaya göre
           karar verdirirdi.
      */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Hızlı işlemler</h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ikincil" size="sm">
            <Link href="/satici/urunler">
              <Boxes className="size-4" strokeWidth={1.5} />
              Ürünler
            </Link>
          </Button>
          <Button asChild variant="ikincil" size="sm">
            <Link href="/satici/urunler/yeni">
              <Plus className="size-4" strokeWidth={1.5} />
              Yeni ürün
            </Link>
          </Button>
          <Button asChild variant="ikincil" size="sm">
            <Link href="/satici/urunler/toplu-yukleme">
              <Upload className="size-4" strokeWidth={1.5} />
              CSV ile yükle
            </Link>
          </Button>
          <Button asChild variant="ikincil" size="sm">
            <Link href="/satici/kuponlar">
              <Percent className="size-4" strokeWidth={1.5} />
              Kuponlar
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/*
 * ⚠️ BURADA `sayim()` ADLI BİR YARDIMCI VARDI ve `lib/api/okuma.ts`teki
 *    `sayimEtiketi`in BİREBİR kopyasıydı (aynı davranış, iki gövde, iki panel:
 *    yönetim panosu paylaşılanı çağırıyordu, satıcı panosu kendi kopyasını).
 *    Kopya silindi. Aynı işi yapan iki yardımcının farklı adlarla yaşaması, bu
 *    deponun ölçülmüş ayrışma sınıfının tam da kendisi.
 */

function MagazaDurumu({
  magaza,
}: {
  magaza: { status: string; statusReason: string | null; vacationMode: boolean };
}): React.ReactElement | null {
  /**
   * ⚠️ ONAYLANMAMIŞ / ASKIDAKİ MAĞAZADA HER YAZMA UCU 403 DÖNER
   *    (`requireActive` → `SELLER_NOT_APPROVED` / `SELLER_SUSPENDED`).
   *    Durum panelin en üstünde durmazsa satıcı her düğmede hataya çarpar ve
   *    sebebini hiçbir ekranda göremez. Okuma açık bırakılmış (bilinçli):
   *    askıdaki satıcı ürünlerini görebilmeli, yoksa neyi düzelteceğini
   *    bilemez.
   */
  if (magaza.status === 'APPROVED' && !magaza.vacationMode) return null;

  return (
    <div className="mt-3 max-w-prose rounded-md border border-kenar bg-yuzey p-3 text-sm">
      <Badge durum={magaza.status === 'APPROVED' ? 'notr' : 'uyari'}>
        {magaza.status === 'PENDING'
          ? 'Onay bekliyor'
          : magaza.status === 'SUSPENDED'
            ? 'Askıya alındı'
            : magaza.status === 'REJECTED'
              ? 'Reddedildi'
              : 'Tatil modu'}
      </Badge>
      <p className="mt-2 text-metin">
        {magaza.status === 'APPROVED'
          ? 'Tatil modu açık: ürünleriniz vitrinde görünür ama sipariş alınmaz.'
          : 'Mağazanız onaylanana kadar ürün ekleme, kargoya verme ve para çekme işlemleri kapalıdır.'}
      </p>
      {magaza.statusReason ? <p className="mt-1 text-metin-soluk">{magaza.statusReason}</p> : null}
    </div>
  );
}
