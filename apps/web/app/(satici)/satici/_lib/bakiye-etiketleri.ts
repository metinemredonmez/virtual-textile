/**
 * BAKİYE ALANLARININ ADI — SATICI PANELİNDE TEK YER.
 *
 * ⚠️ AYNI SUNUCU ALANI İKİ EKRANDA İKİ FARKLI ADLA ÇIKIYORDU: pano
 *    `bakiye.totalMinor`ı "Bakiye" diye, finans ekranı aynı alanı "Defter
 *    toplamı" diye basıyordu. İkisi de satıcıya sesleniyor, ikisi de aynı
 *    sayıyı gösteriyor — yani bu bir "karşılık" değil, düpedüz kopya.
 *
 * ⚠️ DOĞRU AD "DEFTER TOPLAMI"; "bakiye" yanlış. Gerekçe finans ekranının
 *    başlığında ölçülmüş olarak duruyor: veritabanında `balance` diye bir kolon
 *    YOK ve olmaması bilinçli (`seller-balance.ts`). Her rakam append-only
 *    `finance_ledger_entries` satırlarının o andaki toplamıdır. "Bakiyeniz şu
 *    kadar" cümlesi arkasında saklanan bir sayı varmış izlenimi verir; iade
 *    sonrası rakam değiştiğinde satıcı "bakiyem eksildi, kim düşürdü" diye
 *    sorar. Doğru cümle: deftere satır eklendi.
 */
export const BAKIYE_ETIKETI = {
  toplam: 'Defter toplamı',
  cekilebilir: 'Çekilebilir',
  bekleyen: 'Bekleyen hakediş',
} as const;
