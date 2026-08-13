import type { Metadata } from 'next';
import { OzetSeridi, SayfaBasligi, type OzetOgesi } from '@/components/panel/duzen';
import { listeOku, sayimEtiketi, type ListeOkumasi, type Okuma } from '@/lib/api/okuma';
import type {
  AdminModerationWire,
  AdminPayoutWire,
  AdminSellerWire,
  FraudPayloadWire,
} from '@vt/contracts';

/**
 * YÖNETİM PANOSU — "bugün ne bekliyor" ekranı.
 *
 * ⚠️ ÖĞE BÜTÇESİ 5–9 (`design-system.md`). Dört kart var ve dördü de BEKLEYEN
 *    İŞ; GMV, AI maliyeti, satış grafiği BURAYA KONMAZ. Konsaydı pano bir
 *    rapor ekranına dönerdi ve raporun içinde bekleyen dört karar kaybolurdu.
 *    Rapor ekranları ayrı: `/admin/reports` ve `/admin/reports/ai`.
 *
 * ⚠️ KARTLAR TEK TEK ÇÖKER, PANO ÇÖKMEZ. Dört ayrı uçtan besleniyor; biri 500
 *    verdiğinde `throw` etmek üç çalışan kartı da götürürdü. `listeOku` bu
 *    yüzden hata FIRLATMIYOR, döndürüyor (gerekçe `lib/api/okuma.ts` başlığında)
 *    ve düşen okuma `OzetSeridi`ye `{etiket, hata}` olarak veriliyor: hücre
 *    çöker, şerit ayakta kalır.
 *    Bu tam da bu depoda ölçülmüş bir arıza sınıfı: `seller.bridges.ts`teki
 *    `::uuid` hatası yüzünden bugün bazı satıcı uçları 500 dönüyor.
 *
 * ⚠️ ŞERİT `components/panel/duzen.tsx`TEN. Burada `Kart<T>` adlı yerel bir
 *    uygulama vardı ve rakamı `text-3xl`, etiketi `text-sm` çiziyordu; aynı
 *    kabuktaki `/admin/commission` şeridi `text-lg` + `uppercase text-xs`
 *    çiziyordu. Yönetici ekran değiştirdiğinde iki farklı uygulama görüyordu.
 *
 * ⚠️ DÖRT KARTIN DÖRDÜ DE BAĞLANTILI. Payout kartı bir dönem `href: null` ile
 *    "Payout ekranı yok; karar bugün API üzerinden veriliyor." yazıyordu —
 *    ekran (`/admin/payout`) YAZILMIŞ ve sol menüde dururken. Yöneticinin
 *    gördüğü ilk ekran, var olan bir karar kuyruğuna giden kısayolu kapatıp
 *    üstüne yanlış bir cümle basıyordu. `yan-menu.test.ts` bunu yakalayamıyordu
 *    çünkü yalnız menü dizilerini tarıyordu; test artık pano kartlarının
 *    `href`lerini de rota tablosuyla karşılaştırıyor.
 */
export const metadata: Metadata = {
  title: 'Yönetim panosu',
  // Panel girişin arkasında; yine de arama motoruna kapalı olduğu YAZILI olsun.
  robots: { index: false, follow: false },
};

/** ⚠️ `hesapFetch` `cache: 'no-store'` kullanıyor; rota zaten dinamik. */
export const dynamic = 'force-dynamic';

/**
 * Sayım için çekilen sayfa boyutu.
 *
 * ⚠️ Bu bir "ilk N" penceresidir, TOPLAM DEĞİL: yönetim uçları imleçli ve
 *    `meta.total` göndermiyor. 50 satır çekip `nextCursor` doluysa "50+"
 *    yazılıyor (`sayimEtiketi`). Daha büyük bir sayı seçmek panoyu yavaşlatır,
 *    daha küçüğü "9+" gibi anlamsız bir eşik üretir.
 */
const SAYIM_PENCERESI = 50;

/**
 * `Okuma<T>` → şerit hücresi.
 *
 * ⚠️ Hata dalı ETİKETİ KORUYOR: "Bekleyen satıcı başvurusu" başlığı düşse de
 *    yerinde durmalı, yoksa şeritte üç kart ve bir hata kutusu görünür ve
 *    yönetici hangi sayının okunamadığını bilemez.
 */
function ozetHucresi<T>(
  etiket: string,
  okuma: Okuma<ListeOkumasi<T>>,
  kart: (veri: ListeOkumasi<T>) => { sayi: string; alt: string; href: string },
): OzetOgesi {
  if (!okuma.tamam) return { etiket, hata: okuma.hata };
  const { sayi, alt, href } = kart(okuma.veri);
  // ⚠️ `rakam` sınıfı ÇAĞIRANDA: `OzetSeridi` onu basmıyor çünkü para
  //    `<Fiyat>` ile gelir ve sınıfı kendi taşır. Burada gelen bir SAYAÇ,
  //    yani hizayı çağıran kurmak zorunda.
  return { etiket, deger: <span className="rakam">{sayi}</span>, alt, href };
}

export default async function YonetimPanoPage(): Promise<React.ReactElement> {
  const yol = '/admin';

  const [basvurular, moderasyon, payoutlar, uyarilar] = await Promise.all([
    listeOku<AdminSellerWire, '/admin/sellers'>('/admin/sellers', yol, {
      query: { status: 'PENDING', limit: SAYIM_PENCERESI },
    }),
    listeOku<AdminModerationWire, '/admin/products/moderation'>('/admin/products/moderation', yol, {
      query: { status: 'PENDING_REVIEW', limit: SAYIM_PENCERESI },
    }),
    listeOku<AdminPayoutWire, '/admin/payouts'>('/admin/payouts', yol, {
      query: { status: 'REQUESTED', limit: SAYIM_PENCERESI },
    }),
    listeOku<never, '/admin/fraud/alerts'>('/admin/fraud/alerts', yol, {
      query: { limit: SAYIM_PENCERESI },
    }),
  ]);

  return (
    <section>
      <SayfaBasligi
        baslik="Yönetim panosu"
        aciklama="Karar bekleyen işler. Sayılar imleçli uçlardan okunduğu için üst sınırı gösterir: sonunda “+” varsa listede en az bu kadar kayıt var, tamamı için bölüme girin."
      />

      <OzetSeridi
        rakamlar={[
          ozetHucresi('Bekleyen satıcı başvurusu', basvurular, (veri) => ({
            sayi: sayimEtiketi(veri.items.length, veri.nextCursor),
            alt: 'Onay, red ve belge incelemesi',
            href: '/admin/sellers?durum=PENDING',
          })),

          ozetHucresi('İncelemedeki ürün', moderasyon, (veri) => ({
            sayi: sayimEtiketi(veri.items.length, veri.nextCursor),
            alt: 'Yayına alma ve red gerekçesi',
            href: '/admin/moderation',
          })),

          ozetHucresi('Bekleyen para çekme talebi', payoutlar, (veri) => ({
            sayi: sayimEtiketi(veri.items.length, veri.nextCursor),
            /*
              ⚠️ TUTAR GÖSTERİLMİYOR ve bu bilinçli. Satırların toplamını burada
                 hesaplamak "toplam frontend'de hesaplanmaz" kuralını çiğnerdi;
                 dahası ödenebilir bakiyenin satıcı ve admin tarafında İKİ FARKLI
                 kuralı var (satıcı defterin tamamını, admin onayı yalnızca
                 `availableAt IS NOT NULL` satırlarını sayıyor). Ekranda üçüncü
                 bir rakam üretmek yanlış olurdu.
            */
            alt: 'Onay ve red kararı',
            // ⚠️ Kuyruk sekmesi ADRESTE: pano "bekleyen"i sayıyor, ekran
            //    varsayılan olarak başka bir sekmede açılırsa yönetici saydığı
            //    listeyi bulamaz.
            href: '/admin/payout?durum=REQUESTED',
          })),

          ozetHucresi('Dolandırıcılık uyarısı', uyarilar, (veri) => {
            // ⚠️ `data` NESNE: `counts`/`range`/`derived` kardeş alanları olduğu
            //    için zarf `items`i dışarı çıkarmadı. `list()` bunları `extra`ya
            //    koyuyor (ÖLÇÜLDÜ — `admin/sellers` dizi, bu uç nesne).
            const extra = veri.extra as Partial<FraudPayloadWire>;
            const sayimlar = extra.counts ?? { high: 0, medium: 0, low: 0 };
            return {
              sayi: String(sayimlar.high + sayimlar.medium + sayimlar.low),
              alt: `Yüksek ${sayimlar.high} · orta ${sayimlar.medium} · düşük ${sayimlar.low}`,
              href: '/admin/alerts',
            };
          }),
        ]}
      />

      {/*
        ⚠️ BU CÜMLE BİR DİPNOT DEĞİL. Uyarılar kalıcı bir tablodan değil,
           mevcut sipariş/ödeme kayıtlarından TÜRETİLİYOR (`derived: true`) ve
           varsayılan pencere son 7 gün. "Uyarı yok" ifadesi "hiç uyarı
           oluşmadı" anlamına gelmiyor; bunu yazmazsak pano sessizce güven verir.
      */}
      <p className="mt-6 max-w-prose text-sm text-metin-soluk">
        Dolandırıcılık uyarıları kalıcı bir kayıt değildir; her istekte mevcut sipariş ve ödeme
        kayıtlarından yeniden türetilir ve varsayılan pencere son 7 gündür.
      </p>
    </section>
  );
}
