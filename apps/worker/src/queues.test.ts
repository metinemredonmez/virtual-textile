import { describe, expect, it } from 'vitest';
import { queueJobId } from './queues.js';
import { notificationMessageId } from './jobs/notification.processor.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BU DOSYA BİR ÜRETİM ARIZASINDAN DOĞDU.
 *
 *  Tekilleştirme anahtarları okunabilir olsun diye `evt:<id>:<şablon>:...`
 *  biçiminde kuruluyor ve doğrudan BullMQ'ya `jobId` olarak veriliyordu.
 *  BullMQ iki nokta içeren iş kimliğini REDDEDER; sonuç, sipariş onayından
 *  KVKK e-postalarına kadar bildirim üretiminin tamamen durmasıydı.
 *
 *  ⚠️ 1113 birim testi bunu GÖRMEDİ, çünkü hepsi kuyruğu taklit ediyordu:
 *     sahte kuyruk her `add` çağrısını kabul eder, gerçek kuyruk etmez.
 *     Arıza yalnızca süreç GERÇEKTEN ayağa kaldırılınca ortaya çıktı.
 *     Buradaki testler o boşluğu kapatır: kuyruğa giden kimliğin BİÇİMİNİ
 *     sınarlar, kuyruğun kendisini değil.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * BullMQ'nun uyguladığı kural, tek satırda: iş kimlikleri Redis'te
 * `bull:<kuyruk>:<jobId>` anahtarına gömülür, bu yüzden ayırıcı karakter
 * kimliğin içinde geçemez.
 *
 * ⚠️ Kural burada KOPYALANMIŞTIR, kütüphaneden içe aktarılmamıştır —
 *    `Job.validateOptions` dışa açık değil ve gerçek `queue.add` çağrısı
 *    Redis bağlantısı ister. Kütüphane bir gün kuralı genişletirse bu testler
 *    yeşil kalırken üretim kırılır; o yüzden BullMQ sürümü yükseltilirken
 *    worker'ın gerçekten açıldığı bir kez elle doğrulanmalıdır.
 */
const BULLMQ_FORBIDDEN_IN_JOB_ID = ':';

describe('queueJobId', () => {
  it('BullMQ’nun reddettiği karakteri çıkarır', () => {
    const raw = notificationMessageId('019ff587-1ef4-7a93', 'siparis-alindi', 'SMS', 'musteri');

    expect(raw).toContain(BULLMQ_FORBIDDEN_IN_JOB_ID); // ham anahtar hâlâ okunabilir
    expect(queueJobId(raw)).not.toContain(BULLMQ_FORBIDDEN_IN_JOB_ID);
  });

  /**
   * ⚠️ ASIL RİSK BU TESTTE. İki farklı mesaj aynı iş kimliğine düşerse BullMQ
   *    ikincisini "zaten var" sayıp SESSİZCE ATAR — yani bir bildirim hiç
   *    gitmez ve hiçbir yerde hata görünmez. Düz `:` → `_` değiştirmesi tam
   *    olarak bunu yapardı; kaçışlı dönüşüm bu yüzden seçildi.
   */
  it('farklı anahtarları farklı iş kimliklerine götürür — çakışma bir bildirimi yutar', () => {
    const pairs: Array<[string, string]> = [
      ['a:b', 'a_b'],
      ['a:b:c', 'a_b:c'],
      ['x__y', 'x_:y'],
      ['evt:1:tpl', 'evt:1_tpl'],
    ];

    for (const [left, right] of pairs) {
      expect(left).not.toBe(right);
      expect(queueJobId(left), `${left} ile ${right} aynı iş kimliğine düştü`).not.toBe(
        queueJobId(right),
      );
    }
  });

  it('aynı anahtar her zaman aynı kimliği verir — tekilleştirme buna dayanır', () => {
    const raw = notificationMessageId('019ff587', 'siparis-kargolandi', 'EMAIL', 'musteri');
    expect(queueJobId(raw)).toBe(queueJobId(raw));
  });

  it('iki nokta içermeyen anahtarı bozmadan geçirir', () => {
    expect(queueJobId('duz-bir-kimlik')).toBe('duz-bir-kimlik');
  });
});

/**
 * ÜRETİCİLERİN TAMAMI — kuyruğa kimlik veren her yer buraya yazılır.
 *
 * ⚠️ Yeni bir bildirim üreticisi eklendiğinde anahtarı da buraya eklenmelidir.
 *    Arıza tam olarak böyle doğdu: KVKK işleri kendi `kvkk:...` anahtarlarını
 *    getirdi, var olan kalıbı kopyaladı ve kimse kalıbın kendisinin kırık
 *    olduğunu fark etmedi.
 */
describe('gerçek tekilleştirme anahtarları kuyruğa güvenle verilebilir', () => {
  const realMessageIds = [
    notificationMessageId('019ff587-1ef4-7a93', 'siparis-alindi', 'SMS', 'musteri'),
    notificationMessageId('019ff587-1ef4-7a93', 'siparis-alindi', 'EMAIL', 'musteri'),
    notificationMessageId('019ff587-1ef4-7a93', 'satici-yeni-siparis', 'SMS', 'satici-0'),
    notificationMessageId('019ff587-1ef4-7a93', 'siparis-kargolandi', 'EMAIL', 'musteri'),
    notificationMessageId('019ff587-1ef4-7a93', 'iade-onaylandi', 'SMS', 'musteri'),
    notificationMessageId('019ff587-1ef4-7a93', 'payout-gonderildi', 'EMAIL', 'satici'),
    notificationMessageId('019ff587-1ef4-7a93', 'satici-onaylandi', 'EMAIL', 'satici'),
    // KVKK işleri — bkz. account-deletion.job.ts / data-export.job.ts
    'kvkk:account-deleted:019ff587-1ef4-7a93',
    'kvkk:data-export:019ff587-1ef4-7a93',
  ];

  it('hiçbiri yasaklı karakter taşımaz', () => {
    for (const messageId of realMessageIds) {
      expect(
        queueJobId(messageId),
        `${messageId} kuyruk kimliğine çevrilince hâlâ yasaklı karakter içeriyor`,
      ).not.toContain(BULLMQ_FORBIDDEN_IN_JOB_ID);
    }
  });

  it('hiçbiri bir diğeriyle çakışmaz', () => {
    const jobIds = realMessageIds.map(queueJobId);
    expect(new Set(jobIds).size, 'iki gerçek anahtar aynı iş kimliğine düşüyor').toBe(
      realMessageIds.length,
    );
  });
});
