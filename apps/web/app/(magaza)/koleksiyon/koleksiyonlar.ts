import type { TryOnCategoryName } from '@vt/config/constants';

/**
 * İNİŞ SAYFALARININ TEK VERİ KAYNAĞI.
 *
 * ⚠️ Dört iniş sayfası AYRI ÖZELLİK DEĞİLDİR — aynı katalog boru hattına atılan
 *    dört ayrı ARAMA TERİMİdir. Bu yüzden dört sayfa dosyası değil, tek
 *    parametrik sayfa + bu tablo var. Dört kopya yazılsaydı beşincisi (ör.
 *    "trençkot") eklendiğinde dördü de ayrı ayrı güncellenmek zorunda kalır ve
 *    biri unutulurdu.
 *
 * ⚠️ `kategoriAdaylari` SIRALIDIR ve "olması muhtemel" slug'lar içerir; hangisi
 *    gerçekten VARSA o kullanılır (bkz. [koleksiyon]/page.tsx → kategoriSlugCoz).
 *    Buraya yalnızca koleksiyonun kendisini ifade eden slug yazılır. "Denim"
 *    başlığı altında `kadin-alt-giyim` göstermek bütün pantolonları denim diye
 *    sunmak olurdu — filtre yokluğu, yanlış filtreden iyidir.
 */
export interface Koleksiyon {
  slug: string;
  /** `<title>` — kök düzendeki "%s · Virtual Textile" şablonuyla birleşir. */
  baslik: string;
  /** `<meta name="description">` — 150-160 karakter hedefi. */
  aciklama: string;
  h1: string;
  girisMetni: string;
  /** Katalog aramasına giden terim. */
  aramaTerimi: string;
  kategoriAdaylari: readonly string[];
  /**
   * ⚠️ Denemenin AÇIK olup olmadığı buradan değil, `isTryOnSupported()` kapısından
   *    okunur. Bu alan yalnızca hangi kapıya sorulacağını söyler; sağlayıcı o
   *    kategoriyi bırakırsa sayfa kendiliğinden vaat vermeyi bırakır.
   */
  tryOnKategorisi: TryOnCategoryName;
  /** Bu koleksiyonda denemenin NEDEN fark yarattığı — üç somut madde. */
  denemeGerekcesi: readonly string[];
  sss: readonly { soru: string; cevap: string }[];
}

const KOLEKSIYONLAR = {
  denim: {
    slug: 'denim',
    baslik: 'Denim — Üzerinizde Deneyin',
    aciklama:
      'Jean, denim ceket ve denim etek modellerini satın almadan önce kendi fotoğrafınızda görün. Beden uyumu ayrı bir skorla değerlendirilir.',
    h1: 'Denim',
    girisMetni:
      'Denimde beden numarası markadan markaya kayar; aynı 28 beden bir markada bol, diğerinde dar oturur. Ürünü kendi fotoğrafınızda görmek, kalıbın gövdenizde nasıl durduğunu sipariş vermeden önce gösterir.',
    aramaTerimi: 'denim',
    kategoriAdaylari: ['denim', 'kadin-denim'],
    tryOnKategorisi: 'LOWER_BODY',
    denemeGerekcesi: [
      'Yüksek bel, orta bel ve düşük bel aynı bedende bambaşka oturur — fark ancak üzerinizde görünür.',
      'Paça genişliği (mom, straight, wide leg) mankende beğenilip kendinizde beğenilmeyen ilk detaydır.',
      'Denim en çok iade edilen kategorilerden biridir; iade, çoğu zaman renk değil KALIP kaynaklıdır.',
    ],
    sss: [
      {
        soru: 'Denim ürünlerin tamamı denenebiliyor mu?',
        cevap:
          'Kategorisi alt giyim olarak işaretlenmiş ve satıcısı yeterli görsel yüklemiş ürünlerde deneme açıktır. Ürün kartında "Üzerimde dene" işareti görünüyorsa o ürün denenebilir.',
      },
      {
        soru: 'Deneme görseli gerçek ürünü birebir gösteriyor mu?',
        cevap:
          'Hayır. Görsel yapay zekâ ile üretilir; kumaşın dökümü ve gerçek kalıp farklılık gösterebilir. Bu yüzden her görselin üzerinde uyarı bulunur ve beden uyumu ayrı bir sayı olarak verilir.',
      },
      {
        soru: 'Fotoğrafım saklanıyor mu?',
        cevap:
          'Seçim sizin. "Yalnızca bu işlem için kullan" derseniz fotoğraf 24 saat içinde silinir; profilinizde saklamayı seçerseniz her kullanımda süresi yenilenir ve dilediğiniz an silebilirsiniz.',
      },
    ],
  },

  gelinlik: {
    slug: 'gelinlik',
    baslik: 'Gelinlik — Üzerinizde Deneyin',
    aciklama:
      'Gelinlik ve nikâh elbisesi modellerini kendi fotoğrafınızda görün. Prova randevusuna gitmeden önce hangi siluetin size yakıştığını daraltın.',
    h1: 'Gelinlik',
    girisMetni:
      'Gelinlik seçimi çoğu zaman onlarca prova randevusuna yayılır. Sanal deneme provanın yerini almaz; hangi siluetlerle randevuya gideceğinizi daraltarak o günleri kısaltır.',
    aramaTerimi: 'gelinlik',
    kategoriAdaylari: ['gelinlik', 'abiye-gelinlik'],
    tryOnKategorisi: 'DRESS',
    denemeGerekcesi: [
      'Siluet (A kesim, balık, prenses) bedenden çok boy ve omuz çizgisiyle ilişkilidir; mankende görülen etki sizde aynı olmayabilir.',
      'Renk tonu — kırık beyaz, fildişi, şampanya — ten renginizle birlikte görülünce anlam kazanır.',
      'Randevuya gitmeden eleme yapmak, gerçek provada denenen elbise sayısını azaltır.',
    ],
    sss: [
      {
        soru: 'Sanal deneme provanın yerine geçer mi?',
        cevap:
          'Geçmez ve geçtiğini söylemiyoruz. Gelinlikte korse oturumu, boy ayarı ve kumaş ağırlığı yalnızca gerçek provada anlaşılır. Sanal deneme eleme aşaması içindir.',
      },
      {
        soru: 'Uzun kuyruklu modeller nasıl görünüyor?',
        cevap:
          'Kuyruk ve tül gibi gövdeden taşan detaylar, gövdeye oturan bölgelere göre daha az güvenilir üretilir. Görselin altındaki güven skoru bu farkı sayısal olarak gösterir.',
      },
      {
        soru: 'Beden uyumu skoru neye göre hesaplanıyor?',
        cevap:
          'Profilinizdeki ölçüler ile ürünün beden tablosu karşılaştırılır. Ölçü girmediyseniz skor gösterilmez, yalnızca satıcının beden tablosu gösterilir — tahmin üretilmez.',
      },
    ],
  },

  'spor-giyim': {
    slug: 'spor-giyim',
    baslik: 'Spor Giyim — Üzerinizde Deneyin',
    aciklama:
      'Eşofman, sweatshirt ve tayt modellerini kendi fotoğrafınızda görün. Oversize mi tam beden mi olduğunu satın almadan önce anlayın.',
    h1: 'Spor Giyim',
    girisMetni:
      'Spor giyimde aynı ürün "oversize" ve "regular" olarak iki ayrı kalıpta satılır. Ürün fotoğrafındaki manken hangisini giyiyor, çoğu zaman anlaşılmaz — kendi fotoğrafınızda anlaşılır.',
    aramaTerimi: 'spor',
    kategoriAdaylari: ['spor-giyim', 'kadin-spor-giyim'],
    tryOnKategorisi: 'UPPER_BODY',
    denemeGerekcesi: [
      'Oversize kalıp, boyunuza göre "rahat" ile "üzerinize büyük" arasında gidip gelir.',
      'Kapüşon ve reglan kol gibi detaylar omuz genişliğine göre farklı oturur.',
      'Takım alırken üst ve altın birlikte nasıl durduğunu kombin denemesiyle tek seferde görebilirsiniz.',
    ],
    sss: [
      {
        soru: 'Üst ve altı birlikte deneyebilir miyim?',
        cevap:
          'Evet. Kombin denemesi birden fazla parçayı tek görselde birleştirir. Bir parçayı değiştirdiğinizde tüm kombin baştan üretilmez, yalnızca değişen bölge yeniden üretilir.',
      },
      {
        soru: 'Ayakkabı da denenebiliyor mu?',
        cevap:
          'Hayır. Ayakkabı, takı ve çanta bugün denenemiyor; bunun sebebi tercih değil, kullandığımız modellerin bu kategorilerde eğitilmemiş olması. Bu ürünler mağazada satılmaya devam ediyor.',
      },
      {
        soru: 'Deneme ücretli mi?',
        cevap:
          'Hayır. Deneme alıcı için ücretsizdir; maliyeti platform karşılar. Günlük bir kullanım sınırı vardır ve sınıra yaklaştığınızda ekranda gösterilir.',
      },
    ],
  },

  elbise: {
    slug: 'elbise',
    baslik: 'Elbise — Üzerinizde Deneyin',
    aciklama:
      'Günlük, ofis ve davet elbiselerini satın almadan önce kendi fotoğrafınızda görün. Boy, siluet ve renk uyumunu birlikte değerlendirin.',
    h1: 'Elbise',
    girisMetni:
      'Elbise tek parçadır: üstü olan altını da belirler. Bu yüzden "üzerimde nasıl durur" sorusu elbisede diğer kategorilerden daha belirleyicidir ve iade oranı da bu soruyu takip eder.',
    aramaTerimi: 'elbise',
    kategoriAdaylari: ['elbise', 'kadin-elbise'],
    tryOnKategorisi: 'DRESS',
    denemeGerekcesi: [
      'Etek boyu mankenin boyuna göre çekilmiştir; sizde diz üstü mü diz altı mı kalacağı ancak üzerinizde görünür.',
      'Yaka formu ile omuz çizgisi birlikte çalışır; ikisi ayrı ayrı beğenilip birlikte beğenilmeyebilir.',
      'Desen ölçeği — küçük çiçek, büyük blok — bedene göre bambaşka bir etki bırakır.',
    ],
    sss: [
      {
        soru: 'Nasıl bir fotoğraf yüklemeliyim?',
        cevap:
          'Tek kişinin bulunduğu, önden çekilmiş, gövdesi görünen ve arka planı sade bir fotoğraf en iyi sonucu verir. Fotoğraf kalitesi eşiğin altındaysa yüklemeden önce uyarılırsınız.',
      },
      {
        soru: 'Sonuç ne kadar sürede geliyor?',
        cevap:
          'Deneme arka planda çalışır; genellikle yarım dakika içinde tamamlanır. Ekranı kapatmanız gerekmez, işlem bitince sonuç yerinde belirir.',
      },
      {
        soru: 'Sonuç beğenmediğim gibi çıktıysa?',
        cevap:
          'Aynı fotoğrafla tekrar deneyebilirsiniz. Fotoğrafın kendisi uygun değilse (yüz görünmüyor, birden fazla kişi var) tekrar denemek yerine başka bir fotoğraf istenir — aynı hataya ikinci kez düşmemeniz için.',
      },
    ],
  },
} as const satisfies Record<string, Koleksiyon>;

export type KoleksiyonSlug = keyof typeof KOLEKSIYONLAR;

export const KOLEKSIYON_SLUGLARI = Object.keys(KOLEKSIYONLAR) as KoleksiyonSlug[];

export const KOLEKSIYON_LISTESI: readonly Koleksiyon[] = Object.values(KOLEKSIYONLAR);

/** Bilinmeyen slug `undefined` döner — çağıran taraf `notFound()` çağırır. */
export function koleksiyonBul(slug: string): Koleksiyon | undefined {
  return (KOLEKSIYONLAR as Record<string, Koleksiyon>)[slug];
}
