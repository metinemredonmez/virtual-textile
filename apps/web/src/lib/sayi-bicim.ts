import type { Bps, MikroUsdString } from '@vt/contracts';

/**
 * PARA OLMAYAN SAYILARIN BİÇİMİ — basis point, oran, mikro-USD, sayaç, ISO gün.
 *
 * ⚠️ Bu dosyada TEK BİR PARA TUTARI biçimlenmez ve biçimlenmemeli. Para
 *    `lib/money.ts` → `<Fiyat>` yolundan çıkar, başka yoldan çıkmaz. Buradaki
 *    üç sayı türü — basis point, oran, mikro-USD — para DEĞİLDİR ve `<Fiyat>`e
 *    verilirlerse ekrana `₺` ile, doğru görünen yanlış tutarlar olarak çıkarlar.
 *
 * ⚠️ Çıktı metinleri `rakam` sınıfını KENDİ TAŞIMAZ; çağıran taşır. `<Fiyat>`
 *    sınıfı kendi taşıyor çünkü orada unutulması para hatası; burada unutulması
 *    yalnızca hizasız bir yüzde. Yine de tablo hücrelerinde `<TD sayisal>`
 *    sınıfı zaten basıyor.
 */

/**
 * 1250 → "%12,50".
 *
 * ⚠️ Ondalık AYRACI VİRGÜL ve iki hane SABİT: "%12,5" ile "%12,50" alt alta
 *    dizildiğinde virgüller kaymaz. Komisyon tablosunda oranlar sütun hâlinde
 *    okunuyor; kayan virgül tam da `tabular-nums` kuralının kapatmaya çalıştığı
 *    şey.
 *
 * ⚠️ `bps / 100` KAYAN NOKTAYA GİRER (1250/100 = 12.5) ama bu bir PARA
 *    hesabı değil: bps zaten tam sayı ve tavan 3500. Kuruş kayması üretecek
 *    bir toplam yok. Yine de bölme yerine metin kaydırması yapılıyor ki
 *    "%0,05" gibi küçük değerlerde float artığı hiç doğmasın.
 *
 * ⚠️ DİZGİ DE KABUL EDİLİYOR ve bunun sebebi ölçülmüş bir ayrışma: satıcı
 *    kupon ekranı `discountValue`yu (telde bigint dizgisi) kendi yazdığı bir
 *    çeviriciyle basıyordu ve o çevirici SIFIR ondalığı kırpıyordu — aynı oran
 *    kuponlarda "%10", komisyon tablosunda "%10,00" görünüyordu. İki uygulama
 *    yerine tek uygulama; dizgi `BigInt` üzerinden okunuyor, `Number()` ile
 *    DEĞİL (`discountValue` PERCENTAGE dalında bps, FIXED_AMOUNT dalında
 *    kuruştur — ikincisi asla buraya verilmez).
 */
export function yuzdeBps(bps: Bps | string): string {
  const ham = typeof bps === 'string' ? BigInt(bps) : BigInt(Math.trunc(bps));
  const negatif = ham < 0n;
  const mutlak = negatif ? -ham : ham;
  const tam = mutlak / 100n;
  const kesir = (mutlak % 100n).toString().padStart(2, '0');
  return `%${negatif ? '-' : ''}${tam.toLocaleString('tr-TR')},${kesir}`;
}

/**
 * 0.7143 → "%71,4".
 *
 * ⚠️ Girdi 0–1 arası bir ORANDIR, yüzde değil. `admin-report.service.ts`
 *    `ratio()` yorumunda açıkça yazıyor: "Yüzde DEĞİL — arayüz biçimlendirir".
 *    100 ile çarpmayı unutmak "%0,71" yazdırır ve önbellek isabetini yüz kat
 *    kötü gösterir.
 */
export function yuzdeOran(oran: number): string {
  return `%${(oran * 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;
}

/**
 * "1234567" mikro-USD → "$1,2346".
 *
 * ⚠️ `Number()` KULLANILMIYOR ve bu bir alışkanlık meselesi değil: toplam AI
 *    maliyeti bir bigint olarak geliyor ve 2^53 mikro-USD (≈ 9 milyar dolar)
 *    bugün uzak görünse de, aynı kalıp kuruş tutarına kopyalandığında sessizce
 *    yanlış rakam üretir. Dönüşüm `lib/money.ts`teki gibi metin → BigInt.
 *
 * ⚠️ DÖRT ONDALIK. İki hane ($0,00) çoğu satırı sıfır gösterirdi: tek bir
 *    stil danışmanı çağrısı bugün ölçüldüğü kadarıyla 5.830 mikro-USD, yani
 *    yarım sentin altında. Panelin işi "maliyet nereye gidiyor"u göstermek;
 *    yuvarlayıp sıfırlamak o soruyu cevapsız bırakır.
 */
export function mikroUsd(deger: MikroUsdString): string {
  const ham = BigInt(deger);
  const negatif = ham < 0n;
  const mutlak = negatif ? -ham : ham;

  const tam = mutlak / 1_000_000n;
  // 1e6 → 4 haneye indirgeme: kalanın ilk dört basamağı.
  const kesir = ((mutlak % 1_000_000n) / 100n).toString().padStart(4, '0');

  return `${negatif ? '-' : ''}$${tam.toLocaleString('tr-TR')},${kesir}`;
}

/** Sayaçlar (çağrı, sipariş, kalem) — binlik ayraçlı. Para değil. */
export function sayi(deger: number): string {
  return deger.toLocaleString('tr-TR');
}
