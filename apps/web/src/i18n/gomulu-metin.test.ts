import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { borcOzeti, gomuluMetinler } from './gomulu-metin';

const WEB_KOKU = join(__dirname, '..', '..');

const BULUNAN = gomuluMetinler([join(WEB_KOKU, 'app'), join(WEB_KOKU, 'src')], WEB_KOKU.length + 1);
const OZET = borcOzeti(BULUNAN);

/**
 * ÇEVİRİ BORCU CIRCIRI (ratchet).
 *
 * ⚠️ TAVAN BİR HEDEF DEĞİL, BİR ÜST SINIR. `docs/i18n.md` §8.A metinlerin
 *    büyük kısmını BİLEREK erteliyor; bu test o ertelemeyi bitirmeye
 *    çalışmıyor, GÖRÜNÜR tutuyor. Tek iddiası: borç ARTMADI.
 *
 * ⚠️ TAVAN YALNIZCA DÜŞÜRÜLÜR. Sayı bu değerin üstüne çıktıysa doğru hamle
 *    burayı büyütmek DEĞİL, eklenen metni sözlüğe koymaktır. Tavanı büyütmek
 *    bir kararı sessizce geri almaktır ve bu depoda ertelemenin görünmez olduğu
 *    an kalıcılaştığı yazılı.
 *
 * ⚠️ TAVAN 513'TEN 687'YE ÇIKTI VE BU BİR GERİ ALIM DEĞİL, SAYACIN DELİĞİNİN
 *    KAPATILMASI. Eski sayaç yalnız `.tsx` okuyordu; ölçüldü ki `.ts` etiket
 *    tablolarında 174 metin daha var (`collection/koleksiyonlar.ts` 47,
 *    `seller/finance/_lib/etiketler.ts` 25, `admin/_finans/etiketler.ts` 20 …)
 *    ve hepsi kullanıcının GÖRDÜĞÜ metin. Aynı ağaçta `.tsx` sayısı 513'te
 *    KALDI — yani yükselen şey borç değil, GÖRÜLEN borç. Tavan bundan sonra
 *    yine yalnızca düşer.
 *
 * ⚠️ İDDİA ARTIK TOPLAM ÜZERİNDEN, ve sebebi bir OYUN AÇIĞIYDI: bir JSX
 *    metnini `.ts` içinde bir sabite taşımak tek satır çeviri yapmadan eski
 *    sayacı düşürüyordu. Toplam sayıldığında taşıma sayıyı DEĞİŞTİRMEZ.
 *
 * ⚠️ SAYININ MUTLAK DOĞRULUĞU İDDİA EDİLMİYOR — sayaç kaba (gerekçe
 *    `gomulu-metin.ts` başlığında) ve Türkçeye özgü harf taşımayan metinleri
 *    (`Ara`, `Kaydet`) hiç görmüyor, yani GERÇEK BORÇ BUNDAN BÜYÜK. Taşınan
 *    değer monotonluk.
 */
const TAVAN = 687;

describe('JSX’e gömülü Türkçe metin — çeviri borcu', () => {
  /**
   * ⚠️ ALT SINIR: tarama boşalırsa "sıfır borç" çıkar ve circir MÜKEMMEL
   *    görünür. Bu, `i18n-kapsam.mjs`in başında anlatılan arızanın birebir
   *    aynısı: bir eksikliği ödül olarak okuyan ölçüm, ölçüm değildir.
   */
  it('tarama gerçekten çalışıyor', () => {
    expect(BULUNAN.length).toBeGreaterThan(100);
    expect(new Set(BULUNAN.map((b) => b.dosya)).size).toBeGreaterThan(20);

    /**
     * ⚠️ HER İKİ UZANTI DA GERÇEKTEN TARANIYOR MU. Biri sessizce düşerse
     *    toplam düşer ve circir bunu İYİLEŞME sanar — tam olarak
     *    `i18n-kapsam.mjs`in başında anlatılan "eksikliği ödül olarak okuyan
     *    ölçüm" arızası.
     */
    expect(OZET.tsx, '.tsx taraması boşalmış').toBeGreaterThan(100);
    expect(OZET.ts, '.ts taraması boşalmış').toBeGreaterThan(50);
  });

  it('çeviri borcu artmadı', () => {
    const enYogun = [
      ...BULUNAN.reduce(
        (m, b) => m.set(b.dosya, (m.get(b.dosya) ?? 0) + 1),
        new Map<string, number>(),
      ),
    ]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([d, n]) => `${d} (${n})`)
      .join(' · ');

    expect(
      OZET.toplam,
      `çeviri borcu ${OZET.toplam} (tsx ${OZET.tsx} · ts ${OZET.ts}), tavan ${TAVAN}. ` +
        `Tavanı BÜYÜTME — metni sözlüğe taşı; .tsx'ten .ts'e taşımak sayıyı DÜŞÜRMEZ. ` +
        `En yoğun: ${enYogun}`,
    ).toBeLessThanOrEqual(TAVAN);
  });

  /**
   * ⚠️ SÖZLÜĞE TAŞINMIŞ EKRANLAR GERİ KAYMASIN. `dil-degistirici.tsx` ve
   *    `tema-secici.tsx` tamamen sözlükten besleniyor; birine elle Türkçe
   *    metin yazılması, çevrilmiş bir yüzeyin sessizce delinmesi olurdu.
   */
  it('sözlükten beslenen bileşenlerde gömülü metin yok', () => {
    const temizler = [
      'src/components/i18n/dil-degistirici.tsx',
      'src/components/tema/tema-secici.tsx',
    ];
    for (const dosya of temizler) {
      const ihlal = BULUNAN.filter((b) => b.dosya === dosya);
      expect(
        ihlal.map((i) => i.metin),
        `${dosya} gömülü metin taşıyor`,
      ).toEqual([]);
    }
  });
});
