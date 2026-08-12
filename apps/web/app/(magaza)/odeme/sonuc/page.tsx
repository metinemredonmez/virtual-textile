import Link from 'next/link';
import type { Metadata } from 'next';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { ThreeDsSonucDurumu } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { bekleyeniSil } from '@/lib/session/bekleyen-odeme';

/**
 * ÖDEME SONUCU — bankadan dönüşün indiği sayfa.
 *
 * Adres sözleşmesi SUNUCUDA yazılı: `checkout.service.ts` → `callbackResult()`
 *   `${APP_URL}/checkout/sonuc?siparis=<orderNumber>&durum=<paid|failed|pending>`
 * ÖLÇÜLDÜ (POST /v1/payments/3ds/callback, mdStatus=0):
 *   redirectUrl = http://localhost:3000/checkout/sonuc?siparis=VT-260812-0039&durum=failed
 *
 * ⚠️ SAYFA SUNUCUYA HİÇBİR ŞEY SORMUYOR ve soramaz: misafir siparişleri
 *    `GET /v1/orders/:orderNumber` ucundan GÖRÜNMÜYOR (denetleyici yorumu:
 *    "Misafir siparişleri bu uçlardan görünmez"), üstelik uç kimlik istiyor.
 *    Bu yüzden gösterilen bilgi sorgu dizesiyle SINIRLI. Sipariş numarası
 *    kişisel veri değil; e-posta ya da tutar URL'ye KONMAZ.
 *
 * ⚠️ `durum` DOĞRULANMIŞ BİR SONUÇ DEĞİLDİR — adres çubuğunda yazan bir dize.
 *    Kullanıcı `?durum=paid` yazarak bu sayfayı açabilir. Bu yüzden metin
 *    "ödemeniz alındı" değil, siparişin durumunun ne olduğunu ve nereden
 *    doğrulanacağını söyler. Gerçek kayıt sunucuda ve para hareketi oradan
 *    yürüyor; bu sayfa yalnızca bir bilgilendirmedir.
 *
 * ⚠️ Tanınmayan `durum` değeri sessizce "ödendi" sayılmaz; ayrı bir dala düşer.
 */
export const metadata: Metadata = {
  title: 'Ödeme sonucu',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Arama = Promise<{ siparis?: string; durum?: string }>;

export default async function OdemeSonucPage({ searchParams }: { searchParams: Arama }) {
  const { siparis, durum } = await searchParams;
  const sonuc = durumCozumle(durum);

  /**
   * ⚠️ Bekleyen ödeme kaydı BURADA silinir — akış hangi sonuçla biterse bitsin.
   *    Silinmezse kullanıcı `/odeme` sayfasına döndüğünde ödenmiş (ya da kalıcı
   *    olarak başarısız) bir siparişin ödeme ekranını görür ve `checkout/pay`
   *    ona `PAYMENT_ALREADY_CAPTURED` / `ORDER_INVALID_TRANSITION` döndürür.
   *
   * ⚠️ `pending` dalında da siliniyor: o siparişin akıbetini artık webhook ve
   *    mutabakat işi belirliyor (`complete3ds` yanıtsız kaldığında sipariş
   *    PENDING_PAYMENT bırakılıyor), kullanıcının ödemeyi tekrar başlatması
   *    ikinci bir tahsilat riski demek.
   */
  await bekleyeniSil();

  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <sonuc.Ikon className={`mx-auto size-10 ${sonuc.ikonSinifi}`} />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{sonuc.baslik}</h1>
      <p className="mt-2 text-sm text-metin-soluk">{sonuc.aciklama}</p>

      {siparis ? (
        <p className="rakam mt-4 text-sm">
          Sipariş numaranız: <span className="font-medium">{siparis}</span>
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-2">
        {sonuc.tekrar ? (
          <Button asChild size="lg">
            <Link href="/sepet">Sepete dön</Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link href="/hesabim/siparisler">Siparişlerim</Link>
          </Button>
        )}
        <Button asChild variant="ikincil">
          <Link href="/urunler">Alışverişe devam et</Link>
        </Button>
      </div>
    </section>
  );
}

interface SonucGorunumu {
  Ikon: typeof CheckCircle2;
  ikonSinifi: string;
  baslik: string;
  aciklama: string;
  /** Kullanıcı ödemeyi yeniden başlatabilir mi? */
  tekrar: boolean;
}

function durumCozumle(ham: string | undefined): SonucGorunumu {
  const durum = ham as ThreeDsSonucDurumu | undefined;

  switch (durum) {
    case 'paid':
      return {
        Ikon: CheckCircle2,
        // Renk DURUM taşıyor — tam da bu bileşenin var oluş sebebi.
        ikonSinifi: 'text-olumlu',
        baslik: 'Siparişiniz alındı',
        aciklama:
          'Ödemeniz onaylandı. Sipariş özetini e-posta adresinize gönderdik; ürünler her mağazadan ayrı kargolanır.',
        tekrar: false,
      };
    case 'failed':
      return {
        Ikon: XCircle,
        ikonSinifi: 'text-tehlike',
        baslik: 'Ödeme tamamlanamadı',
        aciklama:
          'Bankanız işlemi onaylamadı ve kartınızdan tutar çekilmedi. Sepetiniz duruyor; ödemeyi yeniden başlatabilirsiniz.',
        tekrar: true,
      };
    case 'pending':
      return {
        Ikon: Clock,
        ikonSinifi: 'text-uyari',
        baslik: 'Ödemeniz kontrol ediliyor',
        aciklama:
          // ⚠️ "Tekrar deneyin" DENMEZ: sunucu bu durumu ödeme çekilmiş
          //    OLABİLECEĞİ için açık bırakıyor. İkinci bir deneme ikinci kez
          //    para çekilmesi riskidir (`retry-policy.ts` → PAYMENT_TIMEOUT
          //    aynı gerekçeyle yönlendirmeye düşüyor).
          'Bankanızdan kesin yanıt henüz gelmedi. Ödemeyi tekrar başlatmayın; sonuç netleştiğinde sizi e-posta ile bilgilendireceğiz.',
        tekrar: false,
      };
    default:
      return {
        Ikon: Clock,
        ikonSinifi: 'text-ikon',
        baslik: 'Sipariş durumu görüntülenemedi',
        aciklama:
          'Bu sayfaya beklenmedik bir adresle gelindi. Siparişinizin güncel durumunu hesabınızdan görebilirsiniz.',
        tekrar: false,
      };
  }
}
