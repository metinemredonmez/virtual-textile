import { describe, expect, it } from 'vitest';
import { isoGun, kalanGun, kalanSaat } from './tarih';

/**
 * ⚠️ BU ÜÇ FONKSİYON SESSİZCE YANLIŞ OLABİLİR — hiçbiri hata fırlatmaz, hepsi
 *    makul görünen bir sayı/metin döndürür. Bedeli somut: bir gün kaymış rapor
 *    aralığı, "0 gün kaldı" diyen bir geri alma ekranı, son teslim saatini
 *    yanlış gösteren bir SLA rozeti. Üçü de ekran ÇALIŞIYOR görünürken olur.
 *
 * ⚠️ `kalanSaat` testleri bir dönem satıcı sipariş ekranının `_lib`indeydi;
 *    fonksiyon `lib/tarih.ts`e taşınırken testi de taşındı. Taşınmasaydı ortak
 *    katmanda test edilmeyen bir fonksiyon kalırdı.
 */

describe('kalanSaat', () => {
  const simdi = Date.parse('2026-08-12T12:00:00.000Z');

  it('geçmiş tarihte 0 döner', () => {
    expect(kalanSaat('2026-08-12T11:00:00.000Z', simdi)).toBe(0);
  });

  it('YUKARI yuvarlar', () => {
    // ⚠️ Aşağı yuvarlansaydı 59 dakikası kalan satıcı "0 saat kaldı" görürdü;
    //    `kalanGun` ile aynı gerekçe.
    expect(kalanSaat('2026-08-12T12:01:00.000Z', simdi)).toBe(1);
    expect(kalanSaat('2026-08-12T17:30:00.000Z', simdi)).toBe(6);
    expect(kalanSaat('2026-08-12T18:00:00.000Z', simdi)).toBe(6);
    expect(kalanSaat('2026-08-12T18:01:00.000Z', simdi)).toBe(7);
  });
});

describe('kalanGun', () => {
  const simdi = Date.parse('2026-08-12T12:00:00.000Z');

  it('geçmiş tarihte 0 döner', () => {
    expect(kalanGun('2026-08-11T12:00:00.000Z', simdi)).toBe(0);
  });

  it('YUKARI yuvarlar — sunucunun `remainingGraceDays` hesabıyla aynı yönde', () => {
    expect(kalanGun('2026-08-12T18:00:00.000Z', simdi)).toBe(1);
    expect(kalanGun('2026-08-13T12:00:00.000Z', simdi)).toBe(1);
    expect(kalanGun('2026-08-13T12:01:00.000Z', simdi)).toBe(2);
  });
});

describe('isoGun', () => {
  it('İstanbul dilimine göre keser, UTC değil', () => {
    /*
     * ⚠️ ÖLÇÜLEBİLİR FARKIN KENDİSİ: 12 Ağustos 22:30 UTC, İstanbul'da (UTC+3)
     *    13 Ağustos 01:30'dur. `toISOString().slice(0,10)` burada `2026-08-12`
     *    derdi ve rapor aralığı bir gün geriye kayardı.
     */
    expect(isoGun('2026-08-12T22:30:00.000Z')).toBe('2026-08-13');
    expect(isoGun('2026-08-12T09:58:44.074Z')).toBe('2026-08-12');
  });

  it('`Date` nesnesini de kabul eder', () => {
    expect(isoGun(new Date('2026-01-05T10:00:00.000Z'))).toBe('2026-01-05');
  });

  it('tarih girdisinin beklediği YYYY-MM-DD biçimini üretir', () => {
    // ⚠️ `tr-TR` `05.01.2026` üretirdi ve `<input type="date">` onu boş bırakır.
    expect(isoGun('2026-01-05T10:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
