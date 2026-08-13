import { describe, expect, it } from 'vitest';
import { tabanHesapla, tahminHesapla, type HesapGirdisi } from './hesap';
import type { Varsayim } from './varsayimlar';

/**
 * HESAPLAYICI ARİTMETİĞİ — hiçbir yerde kayan nokta olmadığının kanıtı.
 *
 * ⚠️ Bu dosyanın kırılma biçimi de SESSİZDİR: sonuç ekranda makul görünen ama
 *    yanlış bir sayıdır. Satıcıya gösterilen ciro tahmini olduğu için "makul
 *    görünen yanlış" en kötü durumdur.
 */
const girdi: HesapGirdisi = {
  aylikZiyaretci: 100_000,
  donusumBps: 200, // %2
  sepetOrtalamasiMinor: 129_000n, // 1.290,00 ₺
  iadeOraniBps: 2500, // %25
};

const varsayim: Varsayim = {
  denemeKullanimBps: 1000, // %10
  donusumArtisiBps: 3000, // %30
  iadeDususuBps: 2000, // %20
};

describe('tabanHesapla', () => {
  it('sipariş = ziyaretçi × dönüşüm, TAM SAYI aritmetiğiyle', () => {
    const taban = tabanHesapla(girdi);
    expect(taban.siparis).toBe(2000n);
    expect(taban.ciroMinor).toBe(258_000_000n);
    expect(taban.iadeMinor).toBe(64_500_000n);
  });

  it('adet hesabı AŞAĞI yuvarlar — hesaplayıcının yönü yukarı kaymamalı', () => {
    // 999 × %2 = 19,98 sipariş → 19, 20 DEĞİL.
    expect(tabanHesapla({ ...girdi, aylikZiyaretci: 999 }).siparis).toBe(19n);
  });

  it('2^53 üstü ciroyu kayıpsız taşır', () => {
    const buyuk = tabanHesapla({
      ...girdi,
      aylikZiyaretci: 100_000_000,
      sepetOrtalamasiMinor: 129_000n,
    });
    expect(buyuk.siparis).toBe(2_000_000n);
    expect(buyuk.ciroMinor).toBe(258_000_000_000n);
  });

  it('sıfır ziyaretçide her şey sıfır — bölme hatası yok', () => {
    const bos = tabanHesapla({ ...girdi, aylikZiyaretci: 0 });
    expect(bos).toEqual({ siparis: 0n, ciroMinor: 0n, iadeMinor: 0n });
  });
});

describe('tahminHesapla', () => {
  it('artış YALNIZCA deneme yapan ziyaretçilerin siparişine uygulanır', () => {
    const tahmin = tahminHesapla(girdi, varsayim);

    // 100.000 × %10 = 10.000 ziyaretçi denemeyi kullanır.
    expect(tahmin.denemeYapanZiyaretci).toBe(10_000n);
    // 10.000 × %2 = 200 taban sipariş; artış %30 → 60 ek sipariş.
    // ⚠️ TÜM siparişlere uygulansaydı 2000 × %30 = 600 çıkardı; hesabı
    //    şişiren en yaygın hata budur ve bu satır ona karşı bir kilittir.
    expect(tahmin.ekSiparis).toBe(60n);
    expect(tahmin.ekCiroMinor).toBe(7_740_000n);
  });

  it('iade düşüşü yalnızca DENENEREK alınan siparişlerin cirosuna uygulanır', () => {
    const tahmin = tahminHesapla(girdi, varsayim);
    // (200 + 60) × 129000 = 33.540.000 kuruş; %25 iade = 8.385.000; %20'si önlenir.
    expect(tahmin.onlenenIadeMinor).toBe(1_677_000n);
  });

  it('toplam etki iki kalemin toplamıdır, üçüncü bir sayı üretilmez', () => {
    const tahmin = tahminHesapla(girdi, varsayim);
    expect(tahmin.toplamEtkiMinor).toBe(tahmin.ekCiroMinor + tahmin.onlenenIadeMinor);
  });

  it('sıfır varsayımda hiçbir kazanç vaat etmez', () => {
    const tahmin = tahminHesapla(girdi, {
      denemeKullanimBps: 0,
      donusumArtisiBps: 0,
      iadeDususuBps: 0,
    });
    expect(tahmin.ekSiparis).toBe(0n);
    expect(tahmin.toplamEtkiMinor).toBe(0n);
  });
});
