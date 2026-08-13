import { Money } from '@vt/contracts';
import type { Varsayim } from './varsayimlar';

/**
 * TRY-ON HESAPLAYICISININ TÜM ARİTMETİĞİ.
 *
 * ⚠️ Hiçbir yerde kayan nokta yok: tutarlar `bigint` kuruş, oranlar tam sayı
 *    basis point. Oranla tutar çarpımı `Money.applyBps` ile yapılır —
 *    yuvarlaması (half-up) backend'in komisyon/indirim hesabıyla AYNI olsun
 *    diye. Burada kendi yuvarlamamızı yazsaydık, aynı sayıyı iki farklı yerde
 *    iki farklı sonuçla gösterirdik.
 *
 * ⚠️ ADET hesapları taban bölmeyle (aşağı yuvarlama) yapılır. Bilinçli:
 *    hesaplayıcının yönü YUKARI kaymamalı. Küçük trafikte "ek sipariş: 0"
 *    çıkması bir hata değil, dürüst cevaptır — 7,2 siparişi 8'e yuvarlayan bir
 *    hesaplayıcı satıcıya olmayan bir ciro vaat eder.
 *
 * Bu dosya React bilmez ve DOM'a dokunmaz; tek girdisi sayılar, tek çıktısı
 * sayılar. Böylece istemci bileşeni yalnızca gösterimden sorumlu kalır.
 */

export interface HesapGirdisi {
  /** Ürün sayfası gören aylık ziyaretçi. */
  aylikZiyaretci: number;
  /** Mevcut dönüşüm oranı (bps). */
  donusumBps: number;
  /** Sepet ortalaması, KURUŞ. */
  sepetOrtalamasiMinor: bigint;
  /** Mevcut iade oranı (bps). */
  iadeOraniBps: number;
}

/** Satıcının kendi verisinden çıkan, varsayım İÇERMEYEN taban. */
export interface Taban {
  siparis: bigint;
  ciroMinor: bigint;
  iadeMinor: bigint;
}

/** Varsayımlara dayanan kısım — sayfada ayrı bir blokta gösterilir. */
export interface Tahmin {
  denemeYapanZiyaretci: bigint;
  ekSiparis: bigint;
  ekCiroMinor: bigint;
  onlenenIadeMinor: bigint;
  /** Ek ciro + iadeye gitmeyen ciro. Sayfada ne olduğu yazılı olarak açıklanır. */
  toplamEtkiMinor: bigint;
}

const BPS = 10_000n;

function oranla(tutarMinor: bigint, bps: number): bigint {
  return Money.applyBps(Money.money(tutarMinor), bps).result.amountMinor;
}

export function tabanHesapla(girdi: HesapGirdisi): Taban {
  const ziyaretci = BigInt(girdi.aylikZiyaretci);
  const siparis = (ziyaretci * BigInt(girdi.donusumBps)) / BPS;
  const ciroMinor = girdi.sepetOrtalamasiMinor * siparis;

  return {
    siparis,
    ciroMinor,
    iadeMinor: oranla(ciroMinor, girdi.iadeOraniBps),
  };
}

export function tahminHesapla(girdi: HesapGirdisi, varsayim: Varsayim): Tahmin {
  const ziyaretci = BigInt(girdi.aylikZiyaretci);

  const denemeYapanZiyaretci = (ziyaretci * BigInt(varsayim.denemeKullanimBps)) / BPS;

  /**
   * ⚠️ Artış, TÜM siparişlere değil yalnızca deneme yapan ziyaretçilerin
   *    üreteceği siparişlere uygulanır. Tüm siparişlere uygulamak, denemeye hiç
   *    dokunmamış ziyaretçileri de kazanç hanesine yazmak olurdu; hesabı
   *    şişiren en yaygın hata budur.
   */
  const denemeliTabanSiparis = (denemeYapanZiyaretci * BigInt(girdi.donusumBps)) / BPS;
  const ekSiparis = (denemeliTabanSiparis * BigInt(varsayim.donusumArtisiBps)) / BPS;
  const ekCiroMinor = girdi.sepetOrtalamasiMinor * ekSiparis;

  /**
   * İade düşüşü yalnızca DENENEREK alınan siparişlerin cirosuna uygulanır —
   * artışla gelen ek siparişler dahil, denemeye hiç girmemiş siparişler hariç.
   */
  const denemeliCiroMinor = girdi.sepetOrtalamasiMinor * (denemeliTabanSiparis + ekSiparis);
  const denemeliIadeMinor = oranla(denemeliCiroMinor, girdi.iadeOraniBps);
  const onlenenIadeMinor = oranla(denemeliIadeMinor, varsayim.iadeDususuBps);

  return {
    denemeYapanZiyaretci,
    ekSiparis,
    ekCiroMinor,
    onlenenIadeMinor,
    toplamEtkiMinor: ekCiroMinor + onlenenIadeMinor,
  };
}
