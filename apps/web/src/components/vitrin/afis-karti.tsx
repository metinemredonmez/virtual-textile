import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { SiteImageCardWire } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { SepeteEkle } from '@/components/urun/sepete-ekle';
import { kartDenenebilir } from './site-gorseli';

/**
 * AFİŞ KARTI — vitrin görselinin ÜZERİNDE duran ürün kartı.
 *
 * ⚠️ `UrunKarti` KULLANILAMAZ, ÖLÇÜLDÜ. Kap `mx-auto w-full max-w-7xl px-4`,
 *    yani 1280px ekranda içerik 1248px ve `md:aspect-[16/7]` afişi 546px
 *    yüksekliğe getiriyor. 240px'lik bir kartta `UrunKarti`: 4:5 görsel 300 +
 *    metin ~84 + iki `lg` düğme 104 + `p-4`×2 32 ≈ 520px; 24px iç boşlukla
 *    kullanılabilir 498px kalıyor → TAŞAR. 1024px'te afiş 434px, hiç sığmaz.
 *
 * ⚠️ KARTTA ÜRÜN GÖRSELİ YOK, ve eksiklik değil KARAR. Afiş zaten o parçayı
 *    gösteriyor; aynı şeyi kartın içinde ikinci kez göstermek, kartı afişin
 *    içine sığmayacak kadar büyütmek pahasına hiçbir bilgi eklemezdi.
 *
 * ⚠️ ZEMİN OPAK (`bg-zemin`), yarı saydam DEĞİL. `bg-zemin/80 + backdrop-blur`
 *    denemeye bile girmez: satıcının afişi koyu da gelebilir ve koyu fotoğraf
 *    yarı saydam zeminin içinden okunur. Aynı gerekçeyle GÖRSELE KARARTMA DA
 *    KONMAZ — karartmak, asıl işi yapan şeyi (fotoğrafı) bozmaktır. Kart opak
 *    olduğu için gerek de yok.
 *
 * ⚠️ KENARLIK VAR, GÖLGE YOK. Ürün kartında kenarlık yok çünkü orada kart
 *    sayfa zemininin üstünde duruyor; burada kart RASTGELE BİR FOTOĞRAFIN
 *    üstünde duruyor ve açık zeminli bir afişte opak beyaz kartın nerede
 *    bittiği kenarlıksız görünmez.
 */
export interface AfisKartiProps {
  kart: SiteImageCardWire;
}

export async function AfisKarti({ kart }: AfisKartiProps): Promise<React.ReactElement> {
  /**
   * ⚠️ `urun` SÖZLÜĞÜ — `vitrin` DEĞİL. `urun.uzerimdeDene` ve
   *    `urun.sepeteEkle` sözlükte ZATEN yazılıydı ve HİÇBİR YERDEN
   *    OKUNMUYORDU (ölçüldü: tek çağıran yok; düğmeler ürün detayında JSX'e
   *    gömülü). Vitrin için üçüncü bir kopya açmak aynı düğmenin iki ekranda
   *    ayrışması demekti — bu depoda ürün kartıyla birebir yaşanmış bir hata.
   */
  const t = await getTranslations('urun');
  const deneme = kartDenenebilir(kart);

  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-kenar bg-zemin p-4">
      <div className="flex flex-col gap-1">
        {/* Ürün adı birincil, mağaza ikincil gri, fiyat birincil —
            `design-system.md` çok satıcılı gösterim kuralı. */}
        <Link href={`/product/${kart.slug}`} className="hover:underline">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{kart.title}</h3>
        </Link>
        <p className="text-sm text-metin-soluk">{kart.brandName}</p>
        <Fiyat value={kart.priceMinor} listValue={kart.listPriceMinor} className="text-sm" />
      </div>

      {/*
        ⚠️ ALT ALTA, YAN YANA DEĞİL — ve bu, eşit ağırlık kuralının KORUNMASI.
           240px kartta yarı genişlik 112px; "Üzerimde Dene" 14px'te ~95px +
           `px-3` 24 = 119px eder, yani yan yana TAŞAR. Metni "Dene"ye kısaltmak
           düğmeyi ikincilleştirmenin metinsel hâli olurdu (`button.tsx`
           başlığındaki değişmez metni de kapsar). İkisi de `birincil`, ikisi de
           `lg`, ikisi de `w-full` → aynı sınıf dizisi.

        ⚠️ `SepeteEkle` `size="lg"`i KENDİ İÇİNDE sabitliyor; deneme düğmesinin
           `lg` olması bu yüzden zorunlu — `md` yazmak iki düğmeyi sessizce
           farklı yükseklikte çizerdi.
      */}
      <div className="mt-auto flex flex-col gap-2">
        {deneme && kart.defaultVariantId ? (
          <Button asChild variant="birincil" size="lg" className="w-full">
            <Link href={`/product/${kart.slug}/try-on?varyant=${kart.defaultVariantId}`}>
              {t('uzerimdeDene')}
            </Link>
          </Button>
        ) : null}

        {/*
          ⚠️ Denenemeyen kategoride (ayakkabı · takı · çanta) düğme HİÇ ÇİZİLMEZ
             — devre dışı da çizilmez, gri de çizilmez. Basılınca
             `PRODUCT_NOT_TRYONABLE` dönen bir düğme, olmayan düğmeden kötüdür.
             Aynı kural ürün detayında da uygulanıyor (`urun-eylemleri.tsx`).
        */}
        <SepeteEkle
          variantIdler={kart.defaultVariantId ? [kart.defaultVariantId] : []}
          etiket={t('sepeteEkle')}
        />
      </div>
    </article>
  );
}
