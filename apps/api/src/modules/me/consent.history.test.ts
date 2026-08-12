import { describe, expect, it } from 'vitest';
import {
  ALL_CONSENT_TYPES,
  buildConsentStates,
  changesEffectiveConsent,
  currentConsent,
  revocationExpiresAt,
  revocationPurgesPhotos,
  type ConsentHistoryRecord,
} from './consent.history.js';

/**
 * ⚠️ BU DOSYA BİR KVKK GÜVENCESİNİ KORUR.
 *
 * Sınanan şey "liste doğru sıralanıyor mu" değil, RIZANIN APPEND-ONLY
 * OLDUĞUdur: geri çekme eski satırı silmez, geçerli durum HER ZAMAN en son
 * satırdır ve "ne zaman verildi / ne zaman geri çekildi" sorusu her an
 * cevaplanabilir olmalıdır.
 *
 * Buradaki bir gevşeme, rızasını geri çekmiş kullanıcının fotoğrafının
 * işlenmeye devam etmesi demektir.
 */

const at = (iso: string): Date => new Date(iso);

function record(
  type: ConsentHistoryRecord['type'],
  granted: boolean,
  iso: string,
  documentVersion = 'kvkk-2026-01',
): ConsentHistoryRecord {
  return { type, granted, createdAt: at(iso), documentVersion };
}

describe('buildConsentStates — rıza geçmişi', () => {
  it('hiç kaydı olmayan tür de listelenir ve rıza YOK sayılır', () => {
    const states = buildConsentStates([]);

    expect(states).toHaveLength(ALL_CONSENT_TYPES.length);
    for (const state of states) {
      expect(state.granted, `${state.type} için kayıtsız durum rıza sayıldı`).toBe(false);
      expect(state.since).toBeNull();
      expect(state.history).toEqual([]);
    }
  });

  it('geri çekme ESKİ SATIRI SİLMEZ — iki tarih de gösterilebilir', () => {
    // Gerçek akış: rıza verildi, sonra geri çekildi. İki satır da durur.
    const records = [
      record('PHOTO_PROCESSING', true, '2026-03-03T10:00:00Z'),
      record('PHOTO_PROCESSING', false, '2026-04-14T09:00:00Z'),
    ];

    const [state] = buildConsentStates(records, ['PHOTO_PROCESSING']);

    expect(state.granted, 'Geçerli durum en son satır olmalı').toBe(false);
    expect(state.since).toEqual(at('2026-04-14T09:00:00Z'));

    // ⚠️ ASIL MESELE: "ne zaman verildi" bilgisi geri çekmeden SONRA da duruyor.
    //    Satır güncellenseydi bu tarih kaybolur ve aradaki 42 günlük işlemenin
    //    hukuka uygunluğu ispatlanamazdı.
    expect(state.lastGrantedAt, '⚠️ Rızanın VERİLDİĞİ an kayboldu').toEqual(
      at('2026-03-03T10:00:00Z'),
    );
    expect(state.lastRevokedAt).toEqual(at('2026-04-14T09:00:00Z'));
    expect(state.history).toHaveLength(2);
  });

  it('geçmiş yeniden eskiye sıralanır ve metin sürümünü taşır', () => {
    const records = [
      record('MARKETING', true, '2026-01-01T00:00:00Z', 'kvkk-2025-06'),
      record('MARKETING', false, '2026-02-01T00:00:00Z', 'kvkk-2025-06'),
      record('MARKETING', true, '2026-03-01T00:00:00Z', 'kvkk-2026-01'),
    ];

    const [state] = buildConsentStates(records, ['MARKETING']);

    expect(state.history.map((event) => event.at.toISOString())).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    // Hangi metnin onaylandığı satır bazında saklanır: metin değişince eski
    // rızaların kapsamı yalnızca bu alandan ispatlanabilir.
    expect(state.history[0]?.documentVersion).toBe('kvkk-2026-01');
    expect(state.history[2]?.documentVersion).toBe('kvkk-2025-06');
    expect(state.documentVersion).toBe('kvkk-2026-01');
  });

  it('yeniden verilen rıza geçerlidir ama GERİ ÇEKME TARİHİ kaybolmaz', () => {
    const records = [
      record('CROSS_BORDER_TRANSFER', true, '2026-01-01T00:00:00Z'),
      record('CROSS_BORDER_TRANSFER', false, '2026-02-01T00:00:00Z'),
      record('CROSS_BORDER_TRANSFER', true, '2026-03-01T00:00:00Z'),
    ];

    const [state] = buildConsentStates(records, ['CROSS_BORDER_TRANSFER']);

    expect(state.granted).toBe(true);
    expect(state.lastRevokedAt, 'Arada geri çekildiği bilgisi silinmemeli').toEqual(
      at('2026-02-01T00:00:00Z'),
    );
    expect(state.history).toHaveLength(3);
  });

  it('⚠️ granted=true satırının VARLIĞI tek başına rıza kanıtlamaz', () => {
    // Bu, "granted: true kaydı var mı" diye sorgulayan bir uygulamanın
    // düşeceği tuzak: kayıt duruyor ama rıza geri çekilmiş.
    const records = [
      record('PHOTO_PROCESSING', true, '2026-01-01T00:00:00Z'),
      record('PHOTO_PROCESSING', false, '2026-01-02T00:00:00Z'),
    ];

    expect(
      records.some((entry) => entry.granted),
      'Kurgu doğru: true satırı duruyor',
    ).toBe(true);
    expect(
      currentConsent(records, 'PHOTO_PROCESSING'),
      '⚠️ Geri çekilmiş rıza geçerli sayıldı',
    ).toBe(false);
  });

  it('AYNI MİLİSANİYEDE rıza + geri çekme varsa GERİ ÇEKME kazanır (fail-closed)', () => {
    // Belirsizlikte kullanıcı aleyhine değil, VERİ İŞLEME aleyhine karar verilir.
    const records = [
      record('PHOTO_PROCESSING', true, '2026-05-05T12:00:00Z'),
      record('PHOTO_PROCESSING', false, '2026-05-05T12:00:00Z'),
    ];

    const [state] = buildConsentStates(records, ['PHOTO_PROCESSING']);

    expect(state.granted).toBe(false);
    expect(state.history[0]?.granted, 'Eşitlikte geri çekme başa yazılmalı').toBe(false);
  });

  it('türler birbirine karışmaz', () => {
    const records = [
      record('PHOTO_PROCESSING', true, '2026-01-01T00:00:00Z'),
      record('CROSS_BORDER_TRANSFER', false, '2026-01-01T00:00:00Z'),
    ];

    const states = buildConsentStates(records, ['PHOTO_PROCESSING', 'CROSS_BORDER_TRANSFER']);

    expect(states[0]?.granted).toBe(true);
    expect(states[1]?.granted).toBe(false);
    expect(states[0]?.history).toHaveLength(1);
  });
});

describe('changesEffectiveConsent', () => {
  it('aynı beyanın tekrarı DURUM DEĞİŞİKLİĞİ sayılmaz', () => {
    const records = [record('MARKETING', true, '2026-01-01T00:00:00Z')];
    expect(changesEffectiveConsent(records, 'MARKETING', true)).toBe(false);
    expect(changesEffectiveConsent(records, 'MARKETING', false)).toBe(true);
  });

  it('hiç kaydı olmayan türde ilk rıza DEĞİŞİKLİKTİR, ilk ret değildir', () => {
    expect(changesEffectiveConsent([], 'PHOTO_STORAGE', true)).toBe(true);
    expect(changesEffectiveConsent([], 'PHOTO_STORAGE', false)).toBe(false);
  });
});

describe('revocationPurgesPhotos', () => {
  it('fotoğraf taşıyan rızalar geri çekilince silme tetiklenir', () => {
    expect(revocationPurgesPhotos('PHOTO_PROCESSING', false)).toBe(true);
    // ⚠️ Yurt dışı aktarımı ayrı bir rızadır ve tek başına yeterlidir:
    //    aktarım izni kalkmışken fotoğrafı elde tutmak, ilk fırsatta yeniden
    //    sınır dışına çıkabilecek bir veriyi saklamak demektir.
    expect(revocationPurgesPhotos('CROSS_BORDER_TRANSFER', false)).toBe(true);
  });

  it('rıza VERİLİRKEN silme tetiklenmez', () => {
    expect(revocationPurgesPhotos('PHOTO_PROCESSING', true)).toBe(false);
  });

  it('fotoğrafla ilgisi olmayan rızalar fotoğrafı silmez', () => {
    expect(revocationPurgesPhotos('MARKETING', false)).toBe(false);
    expect(revocationPurgesPhotos('MODEL_TRAINING', false)).toBe(false);
  });
});

describe('revocationExpiresAt', () => {
  it('saklama süresi GEÇMİŞE çekilir — temizlik işi kaydı bu turda toplar', () => {
    const now = at('2026-07-01T12:00:00Z');
    const expires = revocationExpiresAt(now);

    // PhotoRetentionJob sorgusu: expiresAt <= now
    expect(expires.getTime()).toBeLessThan(now.getTime());
    // Saat kayması payı: tam `now` yazılsaydı saati birkaç ms geride olan bir
    // worker turu kaydı "henüz dolmadı" sayıp atlayabilirdi.
    expect(now.getTime() - expires.getTime()).toBe(1000);
  });
});
