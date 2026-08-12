/**
 * HESAPLAYICININ VARSAYIMLARI — SAYFADA AÇIKÇA GÖSTERİLİR.
 *
 * ⚠️ BU SAYILAR BİZİM ÖLÇÜMÜMÜZ DEĞİLDİR. Platformda henüz gerçek satıcı
 *    trafiği yok; dolayısıyla "sanal deneme cironuzu şu kadar artırır" diyecek
 *    tek bir ölçülmüş veri noktamız bile bulunmuyor. Aşağıdaki aralıklar sanal
 *    deneme sağlayıcılarının kendi yayımladıkları vaka çalışmalarında dolaşan
 *    büyüklüklerdir; bağımsız olarak doğrulanmamıştır ve satıcının kendi
 *    sektörüne, fotoğraf kalitesine, trafik kaynağına göre BÜYÜK ölçüde değişir.
 *
 * ⚠️ Bu yüzden hesaplayıcı TEK bir sayı değil ARALIK üretir ve üç varsayımın
 *    tamamı kullanıcı tarafından değiştirilebilir. Tek bir kesin sayı gösteren
 *    hesaplayıcı, ilk gerçek müşteride tutmadığında yalnızca kendini değil
 *    ürünün tamamını şüpheli hâle getirir.
 *
 * İlk gerçek satıcı verisi geldiğinde bu dosya ölçümle değişir ve sayfadaki
 * "kaynak" metni de onunla birlikte güncellenir.
 */

export interface Varsayim {
  /** Ürün sayfasını gören ziyaretçilerin sanal denemeyi kullanma oranı. */
  denemeKullanimBps: number;
  /** Deneme yapan ziyaretçide dönüşümün GÖRELİ artışı. */
  donusumArtisiBps: number;
  /** Denenerek alınan üründe iade oranının GÖRELİ düşüşü. */
  iadeDususuBps: number;
}

export type VarsayimAnahtari = keyof Varsayim;

export interface VarsayimTanimi {
  anahtar: VarsayimAnahtari;
  etiket: string;
  aciklama: string;
  dusukBps: number;
  yuksekBps: number;
  /** Girdi doğrulaması için üst sınır — göreli artış %100'ü aşabilir. */
  enFazlaBps: number;
}

export const VARSAYIM_TANIMLARI: readonly VarsayimTanimi[] = [
  {
    anahtar: 'denemeKullanimBps',
    etiket: 'Denemeyi kullanan ziyaretçi oranı',
    aciklama:
      'Ürün sayfasını gören ziyaretçilerin kaçı fotoğraf yükleyip deneme yapar. Fotoğraf istemek bir sürtünmedir; bu oran hesabın en belirsiz girdisidir.',
    dusukBps: 800,
    yuksekBps: 2000,
    enFazlaBps: 10_000,
  },
  {
    anahtar: 'donusumArtisiBps',
    etiket: 'Deneme yapanlarda dönüşüm artışı',
    aciklama:
      'Deneme yapan ziyaretçinin satın alma olasılığındaki GÖRELİ artış. Dikkat: bu artışın bir kısmı zaten satın alacak kişilerden gelir, yani tamamı yeni ciro değildir.',
    dusukBps: 2000,
    yuksekBps: 4000,
    enFazlaBps: 30_000,
  },
  {
    anahtar: 'iadeDususuBps',
    etiket: 'İade oranındaki düşüş',
    aciklama:
      'Denenerek alınan siparişlerde iade oranının GÖRELİ düşüşü. Yalnızca deneme yapılan siparişlere uygulanır; kataloğun tamamına değil.',
    dusukBps: 1000,
    yuksekBps: 2500,
    enFazlaBps: 10_000,
  },
];

function varsayimUret(sec: (t: VarsayimTanimi) => number): Varsayim {
  const oku = (anahtar: VarsayimAnahtari): number =>
    sec(VARSAYIM_TANIMLARI.find((t) => t.anahtar === anahtar)!);

  return {
    denemeKullanimBps: oku('denemeKullanimBps'),
    donusumArtisiBps: oku('donusumArtisiBps'),
    iadeDususuBps: oku('iadeDususuBps'),
  };
}

export const VARSAYIM_DUSUK: Varsayim = varsayimUret((t) => t.dusukBps);
export const VARSAYIM_YUKSEK: Varsayim = varsayimUret((t) => t.yuksekBps);
