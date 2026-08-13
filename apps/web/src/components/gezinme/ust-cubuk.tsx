import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Layers, ShoppingBag, Shirt, Sparkles, User } from 'lucide-react';
import type { CategoryNodeWire } from '@vt/contracts';
import { readSid } from '@/lib/session/cookies';
import { loadSession } from '@/lib/session/store';
import { kategoriAgaci } from '@/lib/kategori';
import { GezinmeBaglantisi } from '@/components/gezinme/gezinme-baglantisi';
import { AramaKutusu } from '../../../app/(magaza)/products/_liste/arama-kutusu';

/**
 * ÜST ÇUBUK — pazaryeri gezinmesi.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ ÜÇ ARIZA ÖLÇÜLDÜ VE ÜÇÜ DE BURADA KAPANIYOR.
 *
 *  1. ÇUBUK HİÇ ÇEVRİLMEMİŞTİ. `layout.tsx` etiketleri düz Türkçe yazıyordu
 *     (`etiket="Ürünler"`). Site iki dilli, çubuk tek dilliydi.
 *
 *  2. SÖZLÜKTEKİ GEZİNME KELİMELERİNİN 12'Sİ ÖLÜYDÜ. Ölçüldü — `gezinme` ad
 *     alanında 14 anahtar var, yalnızca ikisi (`kategoriler`, `koleksiyonlar`)
 *     bir yerden okunuyordu:
 *         urunler · stilDanismani · hesaplayici · sepet · hesabim · giris
 *         kayit · cikis · saticiPaneli · yonetimPaneli · menuAc · menuKapat
 *     Yani çubuğun ZENGİN HÂLİ bir kez TASARLANMIŞ (giriş/kayıt, satıcı
 *     paneli, mobil menü hepsi sözlükte) ama HİÇ YAZILMAMIŞ. Deponun altı kez
 *     yaşadığı sınıfın bir örneği daha.
 *
 *  3. ARAMA YALNIZCA ANA SAYFANIN KAHRAMAN BÖLÜMÜNDEYDİ. Sayfa kaydırılınca
 *     ya da ürün sayfasına girilince arama YOK oluyordu. Bir pazaryerinde
 *     arama, gezinmenin kendisidir.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ İKİ SATIR, ÜÇ DEĞİL. Üst şerit (hesap/satıcı) + ana çubuk (logo, kategori,
 *    arama, sepet). Üçüncü bir satır 375px'te ekranın dörtte birini gezinmeye
 *    verirdi; ölçüldü, iki satır 92px ediyor ve bu kabul edilebilir sınır.
 *
 * ⚠️ KATEGORİ ŞERİDİ KENDİ KABINDA KAYAR (`overflow-x-auto`). 375px'te dört
 *    kök kategori + etiketler taşıyor. `design-system.md` kuralı: geniş içerik
 *    kendi kabında kayar, SAYFA GÖVDESİ ASLA yatay kaymaz. Bu çubukta bir kez
 *    ölçülmüş bir arıza var — dört metin bağlantısı `document.scrollWidth`i
 *    410'a çıkarmıştı ve mobil filtre çekmecesinin sağını kırpmıştı.
 */

/** Kök kategoriler — pazaryerinin ilk ayrımı (Kadın · Erkek · Çocuk · Unisex). */
const AZAMI_KOK_KATEGORI = 6;

/**
 * ⚠️ OTURUM OKUNUYOR AMA ROL AYRICALIĞI İÇİN DEĞİL, YALNIZCA "giriş yapmış mı"
 *    sorusu için. Rol kapıları sunucuda (`requireRole`); burada rolü kullanmak
 *    çubuğu bir yetki katmanı sanmaya davet ederdi. Panel bağlantıları rolü
 *    OKUYOR ama gizlemek bir GÜVENLİK önlemi değil, gürültü azaltmadır —
 *    bağlantı gizlense bile rota kendi kapısını taşır.
 */
async function oturumDurumu(): Promise<{ girisli: boolean; rol: string | null }> {
  const sid = await readSid();
  if (!sid) return { girisli: false, rol: null };
  const oturum = await loadSession(sid);
  return { girisli: oturum !== null, rol: oturum?.role ?? null };
}

export async function UstCubuk(): Promise<React.ReactElement> {
  const t = await getTranslations('gezinme');

  /**
   * ⚠️ İKİSİ PARALEL. Kategori ağacı önbellekli bir `fetch`, oturum bir Redis
   *    okuması; sırayla beklenirse çubuk her sayfada iki turluk gecikme ekler.
   *
   * ⚠️ KATEGORİ AĞACI DÜŞERSE ÇUBUK ÇİZİLİR, ŞERİT ÇİZİLMEZ. API kapalıyken
   *    gezinmenin tamamen kaybolması, ürün listesine ulaşmayı da imkânsız
   *    kılardı — oysa o sayfa kendi hatasını gösterebilir.
   */
  const [agac, oturum] = await Promise.all([
    kategoriAgaci().catch(() => [] as CategoryNodeWire[]),
    oturumDurumu(),
  ]);

  const kokler = agac.slice(0, AZAMI_KOK_KATEGORI);

  return (
    <header className="border-b border-kenar">
      {/*
        ÜST ŞERİT — hesap ve arz tarafı.
        ⚠️ `text-xs` ve soluk: burası ikincil gezinme. Ana çubukla aynı ağırlıkta
           olsaydı iki satır birbiriyle yarışır, göz nereye bakacağını bilemezdi.
      */}
      <div className="border-b border-kenar bg-yuzey-vurgulu">
        <div className="mx-auto flex h-9 w-full max-w-7xl items-center justify-between gap-4 px-4 text-xs">
          {/* ⚠️ `/calculator` — `/seller/apply` DEĞİL. Başvuru ekranı YAZILMADI
              (uç var, ekran yok); olmayan sayfaya bağlantı 404 demektir. */}
          <Link href="/calculator" className="text-metin-soluk hover:text-metin">
            {t('hesaplayici')}
          </Link>

          <div className="flex items-center gap-4">
            {oturum.rol === 'SELLER_USER' ? (
              <Link href="/seller" className="text-metin-soluk hover:text-metin">
                {t('saticiPaneli')}
              </Link>
            ) : null}
            {oturum.rol === 'ADMIN' ? (
              <Link href="/admin" className="text-metin-soluk hover:text-metin">
                {t('yonetimPaneli')}
              </Link>
            ) : null}

            {/* ⚠️ GİRİŞLİ KULLANICIYA "Giriş yap" GÖSTERİLMEZ. Çubuk bir dönem
                yalnızca "Hesabım" ikonu taşıyordu; giriş yapmamış ziyaretçi için
                o ikon hiçbir şey söylemiyordu — nereye gittiğini bilmeden
                tıklıyordu. */}
            {oturum.girisli ? (
              <Link href="/account" className="text-metin-soluk hover:text-metin">
                {t('hesabim')}
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-metin-soluk hover:text-metin">
                  {t('giris')}
                </Link>
                <Link href="/register" className="font-medium hover:underline">
                  {t('kayit')}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ANA ÇUBUK */}
      <nav className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">
          Virtual Textile
        </Link>

        {/* ⚠️ ARAMA `lg:` ÜSTÜNDE ÇUBUKTA, ALTINDA DEĞİL. 1024px altında çubuk
            zaten logo + beş hedefle dolu; arama kutusunu oraya sıkıştırmak
            ikisini de kullanılamaz yapardı. Mobilde arama ana sayfadaki
            kahraman bölümünde ve ürün listesinde duruyor. */}
        <div className="hidden flex-1 lg:block">
          <AramaKutusu className="max-w-md" />
        </div>

        <div className="ml-auto flex items-center gap-4 text-sm sm:gap-6">
          <GezinmeBaglantisi
            href="/products"
            etiket={t('urunler')}
            ikon={<Shirt className="size-4 shrink-0 text-ikon" />}
          />
          <GezinmeBaglantisi
            href="/collection"
            etiket={t('koleksiyonlar')}
            ikon={<Layers className="size-4 shrink-0 text-ikon" />}
          />
          <GezinmeBaglantisi
            href="/stylist"
            etiket={t('stilDanismani')}
            ikon={<Sparkles className="size-4 shrink-0 text-ikon" />}
          />
          <GezinmeBaglantisi
            href="/cart"
            etiket={t('sepet')}
            ikon={<ShoppingBag className="size-4 shrink-0 text-ikon" />}
          />
          <GezinmeBaglantisi
            href="/account"
            etiket={t('hesabim')}
            ikon={<User className="size-4 shrink-0 text-ikon" />}
          />
        </div>
      </nav>

      {/*
        KATEGORİ ŞERİDİ — pazaryerinin ilk ayrımı.
        ⚠️ BOŞSA ÇİZİLMEZ: kategori ucu düştüğünde boş bir çizgi bırakmak,
           çubuğun altında sebepsiz bir kenarlık üretirdi.
      */}
      {kokler.length > 0 ? (
        <div className="border-t border-kenar">
          <div className="mx-auto w-full max-w-7xl px-4">
            <ul
              className="-mx-4 flex gap-6 overflow-x-auto px-4 py-2.5 text-sm"
              // Klavyeyle kaydırılabilmesi için odaklanabilir olmalı.
              tabIndex={0}
              aria-label={t('kategoriler')}
            >
              {kokler.map((kategori) => (
                <li key={kategori.slug} className="shrink-0">
                  <Link
                    href={`/category/${kategori.slug}`}
                    className="text-metin-soluk transition-colors hover:text-metin"
                  >
                    {kategori.name}
                  </Link>
                </li>
              ))}
              <li className="shrink-0">
                <Link href="/category" className="text-metin-soluk hover:text-metin">
                  {t('kategoriler')}
                </Link>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </header>
  );
}
