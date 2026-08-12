/**
 * KULLANICI GİRDİSİ → TAM SAYI.
 *
 * ⚠️ `parseFloat`/`Number` KULLANILMAZ. Sepet ortalaması bir para tutarıdır ve
 *    kayan noktaya uğrayan para sessizce yanlış tutar üretir (`lib/money.ts`
 *    başındaki gerekçenin aynısı). Burada dönüşüm metin üzerinde yapılır ve
 *    doğrudan `bigint`e çıkılır: metin → basamak → BigInt.
 *
 * ⚠️ Yüzdeler de tam sayıdır: `%2,15` → 215 **basis point**. Yüzdeyi 0.0215
 *    diye taşımak, ilerideki her çarpımı kayan noktaya sokardı.
 */

const YALNIZ_RAKAM = /^\d+$/;

/**
 * Binlik ayracı mı, ondalık ayracı mı?
 *
 * ⚠️ TÜRKÇE GİRDİDE `.` İKİ ANLAMA GELİR ve ayırt etmemek sessiz hata üretir:
 *    kullanıcı 1290 ₺'yi "1.290" diye de yazar, 1,5'i "1.5" diye de. Noktayı
 *    körü körüne silmek ikincisini 15'e çevirir ve hesap on kat şişer — hata
 *    vermeden. Kural:
 *      • virgül varsa nokta binliktir (1.290,50)
 *      • virgül yoksa ve noktadan sonra TAM 3 basamak varsa binliktir (1.290)
 *      • aksi hâlde nokta ondalık ayracıdır (1.5)
 *    Bu bir sezgiseldir, kesin değildir; bu yüzden ekranda girdinin
 *    yorumlanmış hâli kullanıcıya geri gösterilir.
 */
function ayraclariNormalize(ham: string): string {
  // `\s` Unicode boşlukları (kırılmaz boşluk dâhil) zaten kapsıyor.
  const temiz = ham.replace(/[\s₺]/g, '');
  if (temiz.includes(',')) return temiz.replace(/\./g, '');

  const parcalar = temiz.split('.');
  if (parcalar.length === 2 && parcalar[1]!.length === 3) return parcalar.join('');
  if (parcalar.length > 2) return parcalar.join('');
  return temiz.replace('.', ',');
}

/**
 * Ondalıklı metni, `basamak` kadar ölçeklenmiş tam sayıya çevirir.
 * `"12,5"`, basamak 2 → `1250n`.
 *
 * Fazla ondalık REDDEDİLİR, kırpılmaz: sessizce kırpmak kullanıcının yazdığı
 * sayı ile hesaplanan sayıyı ayrıştırır ve kimse fark etmez.
 */
function olcekliTamsayi(ham: string, basamak: number): bigint | null {
  const metin = ayraclariNormalize(ham);
  if (metin === '') return null;

  const parcalar = metin.split(',');
  if (parcalar.length > 2) return null;

  const tam = parcalar[0] ?? '';
  const kesir = parcalar[1] ?? '';
  if (tam === '' && kesir === '') return null;
  if (tam !== '' && !YALNIZ_RAKAM.test(tam)) return null;
  if (kesir !== '' && !YALNIZ_RAKAM.test(kesir)) return null;
  if (kesir.length > basamak) return null;

  const kesirDolu = kesir.padEnd(basamak, '0');
  const tamKisim = BigInt(tam === '' ? '0' : tam);
  const kesirKisim = kesirDolu === '' ? 0n : BigInt(kesirDolu);

  return tamKisim * 10n ** BigInt(basamak) + kesirKisim;
}

/** "12.500" → 12500. Adet; para değil. */
export function adetCoz(ham: string, enFazla: number): number | null {
  const deger = olcekliTamsayi(ham, 0);
  if (deger === null || deger > BigInt(enFazla)) return null;
  return Number(deger);
}

/**
 * "2,15" → 215 bps.
 *
 * `enFazlaBps` çağıran tarafından verilir: dönüşüm oranı %100'ü aşamaz ama
 * dönüşüm ARTIŞI (göreli) aşabilir — ikisi aynı sınırı paylaşmamalı.
 */
export function yuzdeCoz(ham: string, enFazlaBps: number): number | null {
  const deger = olcekliTamsayi(ham, 2);
  if (deger === null || deger > BigInt(enFazlaBps)) return null;
  return Number(deger);
}

/**
 * "1.290,50" → 129050n kuruş.
 *
 * ⚠️ Dönen değer `MinorString` DEĞİLDİR ve olmamalıdır: `MinorString` markası
 *    "bu para API yanıtından doğdu" güvencesidir. Buradaki tutar kullanıcının
 *    yazdığı bir varsayımdır, telden gelmemiştir. `unsafeMinorString` ile marka
 *    basmak o güvenceyi delerdi; bu yüzden hesaplayıcı `<Fiyat>` bileşenini de
 *    kullanmaz, kendi gösterimini yapar (bkz. hesaplayici.tsx → Tutar).
 */
export function kurusCoz(ham: string, enFazlaKurus: bigint): bigint | null {
  const deger = olcekliTamsayi(ham, 2);
  if (deger === null || deger > enFazlaKurus) return null;
  return deger;
}
