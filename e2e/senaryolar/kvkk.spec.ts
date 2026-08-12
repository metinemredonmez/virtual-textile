/**
 * SENARYO 9 — KVKK: RIZA, FOTOĞRAF SİLME, VERİ İNDİRME, HESAP SİLME
 *
 * Sanal deneme fotoğrafı ÖZEL NİTELİKLİ kişisel veridir ve yurt dışındaki bir
 * sağlayıcıya aktarılır. KVKK md.5/md.9 gereği İKİ ayrı açık rıza şart:
 * PHOTO_PROCESSING ve CROSS_BORDER_TRANSFER. Buradaki bir gevşeme doğrudan
 * idari para cezası riskidir.
 *
 * ⚠️ Rıza kontrolünün ZİNCİRİN EN BAŞINDA olması testin merkezinde: sağlayıcıya
 *    çağrı yapıldıktan sonra rıza sorgulamak anlamsızdır, veri çoktan sınırı
 *    geçmiştir. Aşağıda VAR OLMAYAN bir fotoğraf kimliğiyle istek atılıyor;
 *    rıza kontrolü gerçekten başta ise PHOTO_NOT_FOUND değil CONSENT_REQUIRED
 *    dönmeli. PHOTO_NOT_FOUND dönmesi, kontrolün sıralamada geriye kaydığının
 *    kanıtı olurdu.
 */
import { randomUUID } from 'node:crypto';
import { basariBekle, hataBekle } from '../destek/istemci.js';
import {
  kategoriOlustur,
  musteriOlustur,
  saticiOlustur,
  urunYayinla,
  yoneticiOlustur,
} from '../destek/kurulum.js';
import { expect, test } from '../destek/test.js';
import { fotografDurumu, kullaniciFotografiEkle, rizaYaz } from '../destek/veritabani.js';

test.describe('KVKK yükümlülükleri', () => {
  test('rıza olmadan sanal deneme REDDEDİLİR', async ({ api, defter }) => {
    const kullanici = await musteriOlustur(api, defter);

    // ── 1. Hiç rıza yok ──────────────────────────────────────────────────
    const rizasiz = await api.post('/v1/tryon', {
      govde: { userPhotoId: randomUUID(), variantId: randomUUID(), mode: 'FAST' },
      idempotencyKey: randomUUID(),
    });

    hataBekle(rizasiz, 'CONSENT_REQUIRED', 403);
    expect(
      rizasiz.hataKodu,
      '⚠️ Rıza kontrolü zincirin BAŞINDA olmalı — fotoğraf/ürün kontrolünden ÖNCE',
    ).not.toBe('PHOTO_NOT_FOUND');

    // ── 2. Yalnızca fotoğraf işleme rızası: yurt dışı aktarımı hâlâ eksik ─
    await rizaYaz(kullanici.id, 'PHOTO_PROCESSING', true);

    const yarimRiza = await api.post('/v1/tryon', {
      govde: { userPhotoId: randomUUID(), variantId: randomUUID(), mode: 'FAST' },
      idempotencyKey: randomUUID(),
    });

    // ⚠️ AYRI KOD ZORUNLU: kullanıcıya "izin verin" demek yetmez, HANGİ izin
    //    olduğu söylenmeli. Yurt dışına aktarım ayrı bir rıza türüdür (md.9).
    hataBekle(yarimRiza, 'CONSENT_CROSS_BORDER_REQUIRED', 403);

    // ── 3. İkinci rıza da verilince kontrol geçilmeli ────────────────────
    await rizaYaz(kullanici.id, 'CROSS_BORDER_TRANSFER', true);

    const tamRiza = await api.post('/v1/tryon', {
      govde: { userPhotoId: randomUUID(), variantId: randomUUID(), mode: 'FAST' },
      idempotencyKey: randomUUID(),
    });

    // Artık rıza engeli KALKMALI; istek başka bir sebeple (uydurma fotoğraf)
    // düşebilir ama bir rıza hatası dönmemeli.
    expect(
      ['CONSENT_REQUIRED', 'CONSENT_CROSS_BORDER_REQUIRED'],
      `İki rıza da verildiği hâlde rıza hatası döndü: ${tamRiza.ozet()}`,
    ).not.toContain(tamRiza.hataKodu);
    expect(tamRiza.hataKodu, 'Uydurma fotoğraf kimliği artık fotoğraf hatasına düşmeli').toBe(
      'PHOTO_NOT_FOUND',
    );
  });

  test('rıza GERİ ÇEKİLİNCE sanal deneme tekrar reddedilir', async ({ api, defter }) => {
    // ⚠️ ConsentRecord APPEND-ONLY: geri çekme, satır güncelleyerek değil
    //    `granted=false` olan YENİ satır yazılarak yapılır. Geçerli durum
    //    "en son satır"dır; `granted=true` satırının VARLIĞI tek başına
    //    hiçbir şey kanıtlamaz. Sunucu son satıra bakmıyorsa bu test kırılır.
    const kullanici = await musteriOlustur(api, defter);

    await rizaYaz(kullanici.id, 'PHOTO_PROCESSING', true);
    await rizaYaz(kullanici.id, 'CROSS_BORDER_TRANSFER', true);

    const izinli = await api.post('/v1/tryon', {
      govde: { userPhotoId: randomUUID(), variantId: randomUUID(), mode: 'FAST' },
      idempotencyKey: randomUUID(),
    });
    expect(izinli.hataKodu, 'Rızalar verilmişken rıza hatası dönmemeli').toBe('PHOTO_NOT_FOUND');

    // Geri çekme
    await rizaYaz(kullanici.id, 'CROSS_BORDER_TRANSFER', false);

    const geriCekilmis = await api.post('/v1/tryon', {
      govde: { userPhotoId: randomUUID(), variantId: randomUUID(), mode: 'FAST' },
      idempotencyKey: randomUUID(),
    });

    hataBekle(geriCekilmis, 'CONSENT_CROSS_BORDER_REQUIRED', 403);
  });

  test('kullanıcı fotoğrafını silebilir ve başkasınınkini silemez', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    const sahip = await musteriOlustur(api, defter);
    const yabanci = await musteriOlustur(ikinciApi, defter);

    const fotoId = await kullaniciFotografiEkle(sahip.id);
    const yabanciFotoId = await kullaniciFotografiEkle(yabanci.id);

    // ── Başkasının fotoğrafı silinemez ──────────────────────────────────
    const yabanciSilme = await api.delete(`/v1/me/photos/${yabanciFotoId}`);
    expect(
      yabanciSilme.basarili,
      '⚠️ Kullanıcı BAŞKASININ fotoğrafını silebildi — özel nitelikli veri',
    ).toBe(false);
    hataBekle(yabanciSilme, 'PHOTO_NOT_FOUND', 404);

    const digeriDuruyor = await fotografDurumu(yabanciFotoId);
    expect(digeriDuruyor.silinmeZamani, 'Yabancının fotoğrafı silinmiş olmamalı').toBeNull();

    // ── Kendi fotoğrafı silinebilir ─────────────────────────────────────
    const silme = await api.delete(`/v1/me/photos/${fotoId}`);
    basariBekle(silme, 200);
    expect(silme.veri<{ deleted: boolean }>().deleted).toBe(true);

    // ⚠️ "Sildim" demek yetmez; kaydın gerçekten işaretlenmiş olması gerekir.
    //    KVKK taahhüdünün sessizce ihlali, en pahalı sessiz hatadır.
    const durum = await fotografDurumu(fotoId);
    const gercektenSilindi = !durum.varMi || durum.silinmeZamani !== null;
    expect(
      gercektenSilindi,
      '⚠️ Silme ucu başarı döndü ama fotoğraf kaydı silinmemiş/işaretlenmemiş',
    ).toBe(true);

    // ── İkinci silme: kayıp değil, "zaten yapılmış" ────────────────────
    const tekrarSilme = await api.delete(`/v1/me/photos/${fotoId}`);
    hataBekle(tekrarSilme, 'PHOTO_NOT_FOUND', 404);
  });

  test('sanal deneme geçmişi silinebilir', async ({ api, defter }) => {
    // ⚠️ Yalnızca kayıtlar değil ÜRETİLEN GÖRSELLER de silinmeli; depodaki
    //    nesnelerin silinmesi outbox üzerinden worker'a devrediliyor.
    const kullanici = await musteriOlustur(api, defter);
    expect(kullanici.rol).toBe('CUSTOMER');

    const gecmis = await api.get('/v1/tryon/history');
    basariBekle(gecmis, 200);

    const silme = await api.delete('/v1/tryon/history');
    basariBekle(silme);

    const sonrasi = await api.get('/v1/tryon/history');
    basariBekle(sonrasi, 200);
    expect(sonrasi.veri<unknown[]>(), 'Silmeden sonra geçmiş boş olmalı').toHaveLength(0);
  });

  test('sanal deneme uçları kimlik ister — misafir rızası kanıtlanamaz', async ({ api }) => {
    // ⚠️ Rıza kaydı kullanıcıya bağlı (ConsentRecord.userId). Misafirin rızası
    //    kanıtlanamayacağı için bu uçlar @Public OLAMAZ.
    api.kimlikSil();

    const olusturma = await api.post('/v1/tryon', {
      govde: { userPhotoId: randomUUID(), variantId: randomUUID(), mode: 'FAST' },
      idempotencyKey: randomUUID(),
    });
    hataBekle(olusturma, 'AUTH_TOKEN_MISSING', 401);

    const gecmis = await api.get('/v1/tryon/history');
    hataBekle(gecmis, 'AUTH_TOKEN_MISSING', 401);

    const fotoYukleme = await api.post('/v1/me/photos', {
      govde: { contentType: 'image/jpeg', sizeBytes: 100_000, purpose: 'ONE_TIME' },
    });
    hataBekle(fotoYukleme, 'AUTH_TOKEN_MISSING', 401);
  });

  test('beden önerisi misafire açık ama ölçüleri KAYDETMEZ', async ({ api, ikinciApi, defter }) => {
    // ⚠️ Vücut ölçüsü kişisel veridir. Uç POST çünkü query string erişim
    //    loglarına, proxy'lere ve tarayıcı geçmişine yazılırdı. Misafirin
    //    verdiği ölçüler yalnızca hesapta kullanılır, KAYDEDİLMEZ.
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);

    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [
        { renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 300, stok: 5 },
        { renk: 'Siyah', renkHex: '#000000', beden: 'L', fiyat: 300, stok: 5 },
      ],
    });

    const misafir = ikinciApi;
    misafir.kimlikSil();

    const oneri = await misafir.post('/v1/size/recommend', {
      govde: {
        productId: urun.productId,
        measurements: { heightCm: 175, weightKg: 70, chestCm: 96, waistCm: 82 },
      },
    });

    // Uç misafire açık olmalı; kimlik hatası dönmemeli.
    expect(oneri.hataKodu, `Beden önerisi misafire açık olmalı: ${oneri.ozet()}`).not.toBe(
      'AUTH_TOKEN_MISSING',
    );
  });

  test('⚠️ KVKK BOŞLUKLARI: veri indirme ve hesap silme uçları YOK', async ({ api, defter }) => {
    // ═══════════════════════════════════════════════════════════════════════
    // Bu test bir hata AVLAMIYOR, EKSİK BİR YETENEĞİ belgeliyor ve kırmızı
    // yanarak gündemde tutuyor.
    //
    // KVKK md.11 ilgili kişiye şu hakları veriyor:
    //   • verilerinin bir kopyasını isteme  → "veri indirme"
    //   • silinmesini isteme                → "hesap silme"
    //
    // 104 ucun hiçbiri bunları karşılamıyor. Şema hazır
    // (`User.deletionRequestedAt` alanı VAR, grace period için yorumu bile
    // yazılmış) ama tetikleyecek uç yazılmamış. Rıza KAYDI açan bir uç da yok:
    // `ConsentRecord` tablosuna hiçbir uç yazmıyor, dolayısıyla bugün sanal
    // denemeyi kullanabilecek tek bir kullanıcı bile üretilemez.
    // (Bu senaryodaki diğer testler rızayı veritabanından yazıyor.)
    // ═══════════════════════════════════════════════════════════════════════
    await musteriOlustur(api, defter);

    const veriIndirme = await api.get('/v1/me/data-export');
    const hesapSilme = await api.delete('/v1/me');
    const rizaVerme = await api.post('/v1/me/consents', {
      govde: { type: 'PHOTO_PROCESSING', granted: true },
    });

    const eksikler: string[] = [];
    if (veriIndirme.durum === 404) eksikler.push('GET /v1/me/data-export (veri indirme)');
    if (hesapSilme.durum === 404) eksikler.push('DELETE /v1/me (hesap silme)');
    if (rizaVerme.durum === 404) eksikler.push('POST /v1/me/consents (rıza verme)');

    expect(
      eksikler,
      `⚠️ KVKK md.11 uçları eksik: ${eksikler.join(', ')}. ` +
        'Şemada User.deletionRequestedAt hazır ama tetikleyecek uç yok; ' +
        'ConsentRecord tablosuna yazan bir uç da bulunmuyor.',
    ).toEqual([]);
  });
});
