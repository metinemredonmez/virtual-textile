import {
  Money,
  VARSAYILAN_LOCALE,
  type Locale,
  type MinorString,
  type MoneyValue,
} from '@vt/contracts';

/**
 * PARA — TEK OKUMA NOKTASI.
 *
 * Telde para `{"totalMinor":"258000"}` şeklinde gelir: `Money` nesnesi yok,
 * `currency` yok, düz string var. Dönüşüm: string → BigInt → biçim.
 *
 * ⚠️ `Number(...)` ile para OKUNMAZ. Kuruş tutarı 2^53'ü aşabildiği için
 *    sessizce yanlış tutar gösterir ve HATA VERMEZ. Bu kuralı üç katman
 *    koruyor ve hiçbiri tek başına yeterli değil:
 *      1. `MinorString` markası — elle yazılmış string para olamaz.
 *         Ama `Number(x)` markayı DELER: `NumberConstructor` imzası `any` alır.
 *      2. eslint `no-restricted-syntax` — `Number(*.Minor)` kalıbını yakalar.
 *         Ama alan yeniden adlandırılırsa deseni kaçırır.
 *      3. Bu dosya — okuma buradan geçer, başka yerde ham alan okunmaz.
 *
 * ⚠️ WIRE TİPİNDE PARA ALANI ADI DEĞİŞTİRİLMEZ. `totalMinor`u frontend'de
 *    `total` diye yeniden adlandırmak, 2. katmanı o alan için SESSİZCE kapatır.
 */

export function readMinor(value: MinorString): MoneyValue {
  // `currency` telde yok; sistemde tek para birimi TRY.
  return Money.money(BigInt(value));
}

/**
 * 129000 → "₺1.290,00" (tr) · "TRY 1,290.00" (en)
 *
 * ⚠️ PARA BİRİMİ DİLE GÖRE DEĞİŞMEZ, yalnız AYRAÇ ve simgenin yeri değişir.
 *    Dil değiştiren kullanıcı aynı fiyatı görmek zorunda; aksi hâlde sepetteki
 *    tutarla ödenen tutar ayrışırdı.
 *
 * ⚠️ Yol yine `MinorString → BigInt → biçim`. Locale eklenmesi bu zincirin
 *    HİÇBİR halkasını `Number`a çevirmez.
 */
export function formatMinor(value: MinorString, locale: Locale = VARSAYILAN_LOCALE): string {
  return Money.formatMoney(readMinor(value), locale);
}

/** İndirim yüzdesi — yalnızca rozet metni için. Tutar hesabında kullanılmaz. */
export function discountPercent(price: MinorString, listPrice: MinorString): number | null {
  const current = readMinor(price).amountMinor;
  const list = readMinor(listPrice).amountMinor;
  if (list <= current || list === 0n) return null;
  return Number(((list - current) * 100n) / list);
}

/**
 * "Bu tutar sıfırdan büyük mü?" — indirim/kargo satırını gösterip göstermeme
 * kararı. Sepet, ödeme özeti ve sipariş detayı üçü de aynı kararı veriyor.
 *
 * ⚠️ `value !== '0'` YAZILMAZ. Sunucu bugün `"0"` gönderiyor ama `"00"`, `"-0"`
 *    ya da bir gün `"0.00"` da aynı tutardır; dize karşılaştırması bunların
 *    hepsinde yanlış cevap verir ve ekranda "İndirim: ₺0,00" satırı belirir.
 *
 * ⚠️ Bu bir TOPLAM HESABI DEĞİLDİR ve olmamalı: yalnızca "göster/gizle"
 *    yüklemi. Gösterilen tutar her zaman sunucudan geldiği gibi basılır.
 */
export function paraPozitif(value: MinorString): boolean {
  return readMinor(value).amountMinor > 0n;
}

/**
 * ⚠️ TOPLAM/İNDİRİM FRONTEND'DE HESAPLANMAZ. `cart-totals.ts` indirimi
 *    `Money.allocate()` ile kuruş kaybı olmadan paylaştırıp `totalMinor`
 *    gönderiyor. Burada yeniden toplamak `applyBps` half-up yuvarlamasını ve
 *    kalan dağıtımını İKİNCİ kez, farklı şekilde yapardı; fark 1 kuruş olsa
 *    bile mutabakatı bozar. Bu yüzden bu dosyada `add`/`sum` sarmalayıcısı
 *    bilinçli olarak YOKTUR.
 */
