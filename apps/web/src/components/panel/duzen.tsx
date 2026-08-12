import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ApiErrorBody } from '@vt/contracts';
import { cn } from '@/lib/utils';
import { baglanti } from '@/lib/sorgu';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';

/**
 * PANEL İSKELETİ — SATICI VE YÖNETİM, TEK KALIP.
 *
 * ⚠️ BU DOSYA BEŞ AYRI UYGULAMANIN YERİNE GEÇTİ ve gerekçesi ölçülmüş bir
 *    ayrışma: dört ajan paralel ekran yazdı, dördü de kendi sayfa başlığını,
 *    boş durumunu, sayfalamasını ve sekme çubuğunu yazdı. Sonuç ekranda
 *    görünüyordu — sekmelerin ÜÇ farklı görünümü vardı (dolgulu hap, alt
 *    çizgili sekme, ve düz bağlantı listesi), sayfalamanın İKİ farklı metni.
 *    Aynı panelde ekran değiştiren kullanıcı, her seferinde başka bir uygulama
 *    kullandığını sanır.
 *
 * ⚠️ BURASI RENKSİZDİR. `design-system.md`in "renk taşımaz" sütunundaki dört
 *    şeyin dördü de bu dosyada: sayfa başlığı, bölüm başlığı, sekme, kart
 *    kenarlığı. Renk yalnızca `<Badge durum>` ile ve yalnızca DURUM için çıkar.
 *
 * ⚠️ Koyu/açık tema bu dosyada DALLANMAZ. Yönetim kabuğu `.tema-koyu` sınıfını
 *    kendi kökünde açıyor ve buradaki `bg-zemin`/`text-metin` gibi anlamsal
 *    tokenlar iki temada da doğru değeri alıyor. Bileşene tema sorulsaydı iki
 *    panel iki ayrı kod yolundan çizilir ve biri düzeltildiğinde diğeri eski
 *    kalırdı.
 */

// ═══════════════════════════ SAYFA BAŞLIĞI ══════════════════════════════════

/**
 * ⚠️ BAŞLIK RENKSİZ, İKONSUZ, ROZETSİZ. Sol menüde ikonlar zaten `text-ikon`
 *    ile bir ton soluk; sayfa başlığına ikinci bir ikon koymak hiyerarşiyi
 *    ikiye böler. Başlığa rozet koymak ise tablonun içindeki GERÇEK durum
 *    rozetleriyle yarışır.
 *
 * `aciklama` bir süs değil: bu ekranlardaki kararların çoğu geri alınamaz
 * (satıcı reddi, ürün reddi, payout onayı) ve neyin ne anlama geldiği başlığın
 * altında yazmazsa hiçbir yerde yazmıyor demektir.
 */
export function SayfaBasligi({
  baslik,
  baslikSinifi,
  ustBaglanti,
  aciklama,
  eylem,
}: {
  /**
   * ⚠️ Tipi `string` DEĞİL `ReactNode`: detay ekranlarının başlığı bir sipariş
   *    numarası ve yanında durum rozeti taşıyor. `string` olduğu için o beş
   *    ekran bileşeni kullanamamış, kendi `<h1>`ini yazmış ve `SayfaBasligi`nin
   *    taşıdığı `border-b` ayracını da kaybetmişti.
   */
  baslik: React.ReactNode;
  /** Başlık bir numara ise `rakam` (tabular-nums). */
  baslikSinifi?: string;
  /** Detay ekranlarının "← Siparişler" dönüş bağlantısı. */
  ustBaglanti?: React.ReactNode;
  aciklama?: React.ReactNode;
  eylem?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-kenar pb-4">
      <div className="min-w-0">
        {ustBaglanti ? <div className="mb-3">{ustBaglanti}</div> : null}
        <h1 className={cn('text-xl font-semibold tracking-tight text-metin', baslikSinifi)}>
          {baslik}
        </h1>
        {aciklama ? (
          <div className="mt-2 max-w-prose text-sm text-metin-soluk">{aciklama}</div>
        ) : null}
      </div>
      {eylem ? <div className="shrink-0">{eylem}</div> : null}
    </header>
  );
}

// ═══════════════════════════ ÖZET ŞERİDİ ════════════════════════════════════

export interface OzetRakami {
  etiket: string;
  /** `<Fiyat>`, biçimlenmiş yüzde ya da sayaç — hangisi olduğunu çağıran bilir. */
  deger: React.ReactNode;
  /**
   * Rakamın altındaki bağlam.
   *
   * ⚠️ Tipi `string` DEĞİL `ReactNode`: satıcı panosunun bakiye kartı üç ayrı
   *    koşullu cümle taşıyor ("bekleyen talep var", "bakiye eksidedir"), uyarı
   *    ekranı ise rozet. `string` olduğu için o dört ekran şeridi kullanamamış
   *    ve kendi kartını yazmıştı — kısıt bir kuralı korumuyordu, yalnızca
   *    kopyayı zorunlu kılıyordu.
   */
  alt?: React.ReactNode;
  /**
   * Kartın götürdüğü kuyruk. Verilirse KARTIN TAMAMI tıklanabilir olur.
   *
   * ⚠️ Bağlantı `<dl>`nin doğrudan çocuğu OLAMAZ (geçersiz HTML) ve `<a>`
   *    içine `<dt>/<dd>` konamaz. Bu yüzden tıklama alanı `after:absolute
   *    after:inset-0` ile genişletiliyor: odak halkası görünür bağlantı
   *    metninde kalır, tıklama alanı kartın tamamı olur.
   */
  href?: string;
  /**
   * Etiketin kendisi bir DURUM ise rozet olarak çizilir (uyarı şiddeti).
   * ⚠️ Renk yalnızca durum taşır; sayaç kartında bu alan BOŞ bırakılır.
   */
  etiketRozeti?: BadgeProps['durum'];
}

/**
 * Okuması düşmüş kart.
 *
 * ⚠️ ŞERİT ÇÖKMEZ, HÜCRE ÇÖKER. Pano dört ayrı uçtan besleniyor; biri 500
 *    verdiğinde şeridin tamamını hata kutusuna çevirmek çalışan üç rakamı da
 *    yöneticiden almak olurdu. Hata gövdesi `SunucuHatasi`ya gidiyor, yani
 *    sunucunun Türkçe mesajı ve `retry-policy` davranışı korunuyor — mesajı
 *    burada yeniden yazmak ikinci bir metin kaynağı üretirdi.
 */
export interface OzetHatasi {
  etiket: string;
  hata: ApiErrorBody;
}

export type OzetOgesi = OzetRakami | OzetHatasi;

function hataMi(oge: OzetOgesi): oge is OzetHatasi {
  return 'hata' in oge;
}

/**
 * ⚠️ EN FAZLA DÖRT RAKAM VE BU TİPLE DAYATILIYOR. `design-system.md` finans
 *    tabloları için "tablo üstünde 3-4 özet rakam, fazlası değil" diyor; bu bir
 *    üslup tercihi değil: on bir rakamlık bir şeritte hiçbiri okunmaz, yani
 *    şerit olmamasıyla aynı şeydir. Yorumla söylenen kural bir gün beşinci
 *    kartla delinir, tiple söylenen delinmez.
 */
type UcVeyaDort =
  | readonly [OzetOgesi, OzetOgesi, OzetOgesi]
  | readonly [OzetOgesi, OzetOgesi, OzetOgesi, OzetOgesi];

/**
 * ⚠️ BU BİLEŞENİN YANINDA DÖRT YEREL KOPYA YAŞIYORDU (satıcı panosu, satıcı
 *    finans, yönetim panosu, yönetim uyarıları) ve fark kozmetik değildi:
 *    etiket üç ayrı boyutta (xs · sm · uppercase-xs), rakam iki ayrı boyutta
 *    (lg · 3xl), kabuk üç ayrı biçimde (birleşik ızgara · ayrık kart ·
 *    `<Card>`) çiziliyordu. Aynı kabukta ekran değiştiren kullanıcı her
 *    seferinde başka bir uygulama kullandığını sanıyordu — sekmelerde
 *    kapatılan arızanın (bu dosyanın başlığı) özet şeridinde açık kalmış hâli.
 */
export function OzetSeridi({ rakamlar }: { rakamlar: UcVeyaDort }): React.ReactElement {
  return (
    <dl className="grid gap-px overflow-hidden rounded-lg border border-kenar bg-kenar sm:grid-cols-2 lg:grid-cols-4">
      {rakamlar.map((oge) =>
        hataMi(oge) ? (
          <div key={oge.etiket} className="bg-zemin p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-metin-soluk">
              {oge.etiket}
            </dt>
            <dd className="mt-2">
              <SunucuHatasi govde={oge.hata} />
            </dd>
          </div>
        ) : (
          <div key={oge.etiket} className="relative bg-zemin p-4 has-[a:hover]:bg-yuzey">
            <dt className="text-xs font-medium uppercase tracking-wide text-metin-soluk">
              {oge.etiketRozeti ? <Badge durum={oge.etiketRozeti}>{oge.etiket}</Badge> : oge.etiket}
            </dt>
            {/*
              ⚠️ `rakam` sınıfı BURADA DEĞİL: para `<Fiyat>` ile geliyor ve o sınıfı
                 kendi taşıyor. Buraya da basılsaydı iç içe iki `tabular-nums`
                 olurdu — zararsız ama "para nereden geliyor" sorusunun cevabını
                 bulanıklaştırır. Para OLMAYAN değerler (yüzde, sayaç) sınıfı
                 çağıranda alır.
            */}
            <dd className="mt-1 text-lg font-semibold text-metin">{oge.deger}</dd>
            {oge.alt ? <div className="mt-0.5 text-xs text-metin-soluk">{oge.alt}</div> : null}
            {oge.href ? (
              <p className="mt-3 inline-flex items-center gap-1 text-xs text-metin-soluk">
                <Link
                  href={oge.href}
                  className="hover:text-metin after:absolute after:inset-0"
                  prefetch={false}
                >
                  Bölüme git
                </Link>
                <ArrowRight className="size-3.5 text-ikon" strokeWidth={1.5} />
              </p>
            ) : null}
          </div>
        ),
      )}
    </dl>
  );
}

// ══════════════════════════════ SEKMELER ════════════════════════════════════

export interface PanelSekmesi {
  etiket: string;
  yol: string;
  secili: boolean;
}

/**
 * KUYRUK / SÜZGEÇ SEKMELERİ.
 *
 * ⚠️ SEKMELER RENKSİZ ve seçili olan YALNIZCA hafif bir arka planla ayrılır —
 *    alt çizgi, çerçeve veya vurgu rengi yok. Sekmeleri durum renkleriyle
 *    boyamak (bekleyen = turuncu, onaylı = yeşil) cazip ama tablodaki rozetlerin
 *    anlamını çalar: aynı renk ekranda iki farklı şey söylerdi.
 *
 * ⚠️ `yol` ÜRETİMİ ÇAĞIRANDA. Beş ekranın beşinin sorgu şekli farklı (biri
 *    `durum`, biri `scope`, biri `gecikmis` bayrağı taşıyor); tipi buraya
 *    bağlamak, bileşeni yalnızca bir ekranın kullanabileceği hale getirir ve
 *    ikinci kopya tam olarak böyle doğar.
 *
 * ⚠️ Sekme değişince İMLEÇ DÜŞER — bunu da çağıran yapar. Bir kuyruğun imleci
 *    diğerinde geçersizdir; taşınsaydı sunucu `VALIDATION_FAILED` döndürür ve
 *    yönetici sekme değiştirdiğinde boş ekran görürdü.
 */
export function Sekmeler({
  etiket,
  sekmeler,
  className,
}: {
  /** `aria-label` — ekran okuyucuya hangi süzgeç olduğunu söyler. */
  etiket: string;
  sekmeler: readonly PanelSekmesi[];
  className?: string;
}): React.ReactElement {
  return (
    <nav
      aria-label={etiket}
      className={cn('flex flex-wrap gap-1 border-b border-kenar pb-3', className)}
    >
      {sekmeler.map((sekme) => (
        <Link
          key={sekme.etiket}
          href={sekme.yol}
          aria-current={sekme.secili ? 'page' : undefined}
          className={cn(
            'rounded-sm px-2.5 py-1 text-sm',
            sekme.secili
              ? 'bg-yuzey-vurgulu text-metin'
              : 'text-metin-soluk hover:bg-yuzey hover:text-metin',
          )}
        >
          {sekme.etiket}
        </Link>
      ))}
    </nav>
  );
}

export interface DurumSekmesi {
  etiket: string;
  /** `null` → "tümü", sorgudan çıkarılır. */
  deger: string | null;
}

/**
 * TEK SORGU PARAMETRESİYLE sürülen sekmeler için ince sarmalayıcı.
 *
 * ⚠️ SARMALAYICI OLMASININ TEK SEBEBİ İMLEÇ. Sekme değişince imleç DÜŞMEK
 *    ZORUNDA: bir kuyruğun imleci diğerinde geçersizdir ve taşınırsa sunucu
 *    `VALIDATION_FAILED` döndürür, yönetici sekme değiştirdiğinde boş ekran
 *    görür. `imlec: null` satırı burada yazılı olduğu için çağıranda
 *    UNUTULAMAZ — beş ayrı çağrı yerine yazılsaydı biri unuturdu.
 *
 * ⚠️ Sorgusu bundan karmaşık olan ekran (iki parametreli süzgeç, bayrak) doğrudan
 *    `<Sekmeler>` kullanır ve `yol`u kendi üretir. Bu sarmalayıcıyı esnetmek,
 *    onu yeniden herkesin bir kopyasını yazdığı hâle getirirdi.
 */
export function DurumSekmeleri({
  yol,
  anahtar,
  sekmeler,
  secili,
  digerSorgu = {},
  etiket = 'Durum filtresi',
}: {
  yol: string;
  /** Sorgu parametresinin adı: `durum`, `scope`… */
  anahtar: string;
  sekmeler: readonly DurumSekmesi[];
  secili: string | null;
  /** Sekmeler arası TAŞINACAK diğer parametreler (arama metni gibi). */
  digerSorgu?: Record<string, string | null>;
  etiket?: string;
}): React.ReactElement {
  return (
    <Sekmeler
      etiket={etiket}
      sekmeler={sekmeler.map((sekme) => ({
        etiket: sekme.etiket,
        // ⚠️ İki imleç adı da düşürülüyor: panel uçlarının bir kısmı `cursor`,
        //    bir kısmı `imlec` kullanıyor. Yalnız birini silmek, diğerini
        //    kullanan ekranda sekme değişince boş liste demekti.
        yol: baglanti(yol, { ...digerSorgu, [anahtar]: sekme.deger, imlec: null, cursor: null }),
        secili: sekme.deger === secili,
      }))}
    />
  );
}

// ════════════════════════════ BOŞ SONUÇ ═════════════════════════════════════

/**
 * ⚠️ "Kayıt bulunamadı" YETMEZ. Bu ekranlarda boşluğun İKİ ayrı sebebi var —
 *    hiç kayıt yok, ya da filtre eşleşmedi — ve ikisinin doğru eylemi farklı.
 *    Tek cümlelik bir boş durum, filtresini unutmuş yöneticiye "hiç payout
 *    talebi yok" dedirtir. `aciklama` ne yapılacağını söyler.
 */
export function BosSonuc({
  baslik,
  aciklama,
  eylem,
}: {
  baslik: string;
  aciklama: string;
  eylem?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-dashed border-kenar p-8 text-center">
      <p className="text-sm font-medium text-metin">{baslik}</p>
      <p className="mt-1 text-sm text-metin-soluk">{aciklama}</p>
      {eylem ? <div className="mt-4 flex justify-center">{eylem}</div> : null}
    </div>
  );
}

// ═══════════════════════════ SAYFALAMA ══════════════════════════════════════

/**
 * İMLEÇLİ SAYFALAMA.
 *
 * ⚠️ "ÖNCEKİ" DÜĞMESİ YOK ve bu bir eksik değil, imleçli sayfalamanın tanımı:
 *    imleç ileri doğru bir anahtardır, geri anahtarı yoktur. Sahte bir "önceki"
 *    (imleç yığınını URL'de taşımak) adresi okunmaz yapar ve paylaşılan
 *    bağlantıyı bozar. Geri gitmenin doğru aracı tarayıcının geri tuşudur ve
 *    her sayfa ayrı bir URL olduğu için o tuş GERÇEKTEN çalışır.
 *
 * ⚠️ TOPLAM SAYFA SAYISI GÖSTERİLMEZ. `meta.total` panel uçlarında gelmiyor
 *    (`Page<T> = {items, nextCursor}`). Uydurma bir "1/12" yazmak, olmayan bir
 *    bilgiyi varmış gibi göstermek olurdu.
 *
 * ⚠️ `prefetch={false}`: panel listeleri kimlikli ve `cache: 'no-store'`;
 *    görünen bağlantıyı önden çekmek okunmayacak bir yanıt için ikinci bir
 *    kimlikli tur açar.
 *
 * ⚠️ `sonrakiHref` üretimi çağıranda: "sonraki sayfa var mı" kararı yalnızca
 *    `nextCursor` değil, satır sayısı da olabilir (boş son sayfa). Çağıran
 *    `null` geçerek düğmeyi kapatır.
 */
export function ImlecSayfalama({
  ilkSayfaHref,
  sonrakiHref,
  ilkSayfada,
}: {
  ilkSayfaHref: string;
  /** `null` → sonraki sayfa yok. */
  sonrakiHref: string | null;
  ilkSayfada: boolean;
}): React.ReactElement | null {
  // Tek sayfalık liste: ne ileri ne geri gidilecek bir yer var.
  if (sonrakiHref === null && ilkSayfada) return null;

  return (
    <div className="mt-6 flex items-center justify-between border-t border-kenar pt-4 text-sm">
      {!ilkSayfada ? (
        <Link
          href={ilkSayfaHref}
          className="text-metin-soluk hover:text-metin hover:underline"
          prefetch={false}
        >
          İlk sayfaya dön
        </Link>
      ) : (
        <span />
      )}

      {sonrakiHref !== null ? (
        <Link
          href={sonrakiHref}
          prefetch={false}
          className="inline-flex items-center gap-2 font-medium text-metin hover:underline"
        >
          Sonraki sayfa
          <ArrowRight className="size-4 text-ikon" strokeWidth={1.5} />
        </Link>
      ) : (
        <span className="text-metin-soluk">Listenin sonundasınız.</span>
      )}
    </div>
  );
}
