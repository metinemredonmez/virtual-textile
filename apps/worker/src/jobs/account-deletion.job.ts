import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import { PHOTO_RETENTION } from '@vt/config';
import { Prisma, serializeBigInts, type PrismaClient, type Role } from '@vt/db';
import type { StorageProvider } from '@vt/adapters';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE,
  QUEUE_OPTIONS,
  queueJobId,
  type NotificationJobData,
} from '../queues.js';

/**
 * ═══════════════ HESAP SİLME — GERİ ALMA PENCERESİ DOLDUĞUNDA ═══════════════
 *
 * ⚠️ BU İŞ YOKKEN SİSTEM YASAL BİR SÖZÜ TUTMUYORDU. Kullanıcı "hesabımı sil"
 *    diyor, `User.deletionRequestedAt` yazılıyor, 30 gün geçiyor ve HİÇBİR ŞEY
 *    olmuyordu. Talep alınmış görünüyor, veri duruyor — dışarıdan bakınca her
 *    şey yolunda. Sessizce yerine getirilmeyen bir taahhüt, hiç verilmemiş bir
 *    taahhütten daha tehlikelidir.
 *
 * ⚠️ SİLME DEĞİL, ANONİMLEŞTİRME. Kullanıcı satırı SİLİNMEZ:
 *    `status = DELETED` olur ve kimlik alanları (ad, e-posta, telefon, şifre
 *    özeti) geri döndürülemez biçimde temizlenir. Satırın kendisi kalır çünkü
 *    sipariş, yorum, kupon kullanımı ve denetim kayıtları ona referans verir;
 *    satır silinseydi ya bu kayıtlar da giderdi (muhasebe bozulur) ya da
 *    veritabanında sahipsiz yabancı anahtarlar kalırdı. Kalan `userId` artık
 *    kimseyi göstermeyen bir TAKMA KİMLİKTİR.
 *
 * ⚠️ SIRA ÖNEMLİ — ÖNCE DEPO, SONRA VERİTABANI.
 *    `PhotoRetentionJob` ile aynı kalıp ve aynı gerekçe: veritabanı kaydı önce
 *    silinirse ve depo silme başarısız olursa, hangi nesnenin silineceğini
 *    bilemeyiz. Fotoğraf sonsuza kadar depoda kalır ve kimse fark etmez.
 *    Depo silme başarısızsa bu kullanıcı için veritabanına HİÇ DOKUNULMAZ;
 *    kayıt açık kalır ve ertesi gün tekrar denenir.
 *
 * ⚠️ SATICI ENGELİ. Mağazası, hakedişi veya ödeme talebi olan bir hesap
 *    silinemez: satıcı hesabı yalnızca kişisel veri değil, ticari bir taraftır.
 *    Silinseydi ödenmemiş hakediş sahipsiz kalır, ürünler ortada kalır ve
 *    faturalar açıklanamaz hâle gelirdi. Engellenen hesap SESSİZCE geçilmez —
 *    denetim izine yazılır ve olay yayımlanır ki admin görsün.
 */

/** Silme talebinden sonra beklenen gün sayısı — API ile AYNI sabit. */
const GRACE_DAYS = PHOTO_RETENTION.accountDeletionGraceDays;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bir turda işlenecek azami hesap.
 *
 * Küçük tutulması bilinçli: her hesap onlarca tablo yazar ve depo çağrısı
 * yapar. Tek turda binlerce hesap işlemek, cron'un bir sonraki turuna taşan
 * uzun bir transaction kuyruğu yaratırdı.
 */
const BATCH_SIZE = 50;

/** S3/R2 toplu silmede tek istekte gönderilen azami anahtar sayısı. */
const DELETE_CHUNK = 500;

/**
 * ⚠️ KİMLİK ALANLARI NULL'A ÇEKİLİR, "silinmis@..." GİBİ BİR DEĞERE DEĞİL.
 *    `User.email` ve `User.phone` UNIQUE'tir; sabit bir yer tutucu yazılsaydı
 *    İKİNCİ hesabın silinmesi benzersizlik ihlaliyle patlardı ve o hesap
 *    sonsuza kadar silinemezdi. Null, Postgres'te unique kısıtı tetiklemez ve
 *    aynı zamanda e-postayı yeni kayıt için serbest bırakır.
 */
const CLEARED = null;

/**
 * Siparişte e-posta ve telefon ZORUNLU alandır (misafir siparişi de bildirim
 * alabilmeli). Null yazılamadığı için yer tutucu konur; benzersizlik kısıtı
 * OLMADIĞI için burada çakışma riski yoktur.
 */
export const ORDER_CONTACT_TOMBSTONE = {
  email: 'silinmis-hesap@kvkk.invalid',
  phone: '00000000000',
} as const;

const ENTITY_USER = 'User';

/** Denetim izine yazılan işlemler (kural 6). */
export const ACCOUNT_DELETION_AUDIT = {
  executed: 'user.deletion.executed',
  blocked: 'user.deletion.blocked',
} as const;

/** Yayımlanan olaylar. */
export const ACCOUNT_DELETION_EVENT = {
  completed: 'user.account_deleted',
  blocked: 'user.deletion_blocked',
} as const;

const OUTBOX_AGGREGATE = 'user';

/**
 * ⚠️ BU ŞABLON HENÜZ YOK.
 *    `TemplateKey` birliği `@vt/adapters/notification/template.ts` içindedir ve
 *    bu görevin dosya kapsamı dışındadır. Şablon eklenene kadar bildirim işi
 *    kuyrukta KALICI HATA ile düşer — sessizce başarılı sayılmaz, görünür olur.
 *    NEEDS-TEMPLATE: 'kvkk-hesap-silindi' (EMAIL), değişken: yok.
 */
export const ACCOUNT_DELETED_TEMPLATE = 'kvkk-hesap-silindi';

// ── Bildirim yüzeyi ────────────────────────────────────────────────────────

export const KVKK_NOTIFIER = 'KVKK_NOTIFIER';

/**
 * KVKK işlerinin bildirim yüzeyi.
 *
 * ⚠️ NEDEN OUTBOX DEĞİL — kural 5'ten bilinçli sapma.
 *    Outbox satırı KALICIDIR. "Hesabınız silindi" e-postasının alıcı adresi
 *    outbox yüküne yazılsaydı, az önce sildiğimiz kişinin e-posta adresi
 *    `infra_outbox_events` tablosunda süresiz yaşamaya devam ederdi — silme
 *    taahhüdünü, taahhüdü yerine getiren işin kendisi ihlal ederdi.
 *    Bu yüzden: kişisel veri İÇERMEYEN olay outbox'a (transaction içinde),
 *    adresi taşıyan bildirim ise commit'ten SONRA doğrudan kuyruğa yazılır.
 *    Kuyruk işi tamamlanınca silinir (removeOnComplete), kalıcı iz bırakmaz.
 *
 * ⚠️ Bunun bedeli: commit başarılı olup bildirim düşerse kullanıcı
 *    bilgilendirilmez. Kabul edilebilir, çünkü işlemin KENDİSİ AuditLog'da
 *    kayıtlıdır; tersi (silinen kişinin adresinin kalıcı tabloda kalması)
 *    kabul edilemez.
 */
export interface KvkkNotifier {
  enqueue(job: NotificationJobData): Promise<void>;
}

/** BullMQ karşılığı — `OutboxDispatcher` ve bildirim köprüsüyle aynı kalıp. */
export class BullMqKvkkNotifier implements KvkkNotifier {
  private readonly queue: Queue<NotificationJobData>;

  constructor(connection: Redis) {
    this.queue = new Queue<NotificationJobData>(QUEUE.NOTIFICATION, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...QUEUE_OPTIONS[QUEUE.NOTIFICATION] },
    });
  }

  async enqueue(job: NotificationJobData): Promise<void> {
    // ⚠️ İş kimliği = messageId'nin kuyruk için güvenli hâli. İş iki kez
    //    çalışırsa (en az bir kez teslimat) BullMQ ikinci eklemeyi sessizce yok
    //    sayar; kullanıcı iki e-posta almaz. Ham `messageId` doğrudan
    //    VERİLEMEZ: `kvkk:...` biçimindeki iki nokta yüzünden BullMQ reddeder
    //    ve KVKK e-postası hiç gönderilmez (bkz. queues.ts → queueJobId).
    await this.queue.add(job.template, job, { jobId: queueJobId(job.messageId) });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

// ── Sonuç tipleri ─────────────────────────────────────────────────────────

export interface AccountDeletionOutcome {
  /** Süresi dolmuş ve incelenen talep sayısı. */
  scanned: number;
  /** Anonimleştirilmesi tamamlanan hesap sayısı. */
  anonymized: number;
  /** ⚠️ Satıcılığı olduğu için silinemeyen hesaplar — admin görmeli. */
  blockedBySeller: number;
  /** Depo silme başarısız olduğu için ERTELENEN hesaplar. */
  storageFailures: number;
}

/** Süresi dolmuş talebi olan kullanıcıdan okunan alanlar. */
interface DueUser {
  id: string;
  email: string | null;
  role: Role;
  deletionRequestedAt: Date | null;
}

/** Silmeyi engelleyen satıcılık — rapora ve denetim izine bu özet yazılır. */
export interface SellerBlock {
  sellerId: string;
  status: string;
  hasStore: boolean;
  ledgerEntryCount: number;
  payoutCount: number;
}

// ── Saf yardımcılar (testten doğrudan çağrılır) ───────────────────────────

/**
 * Bir satıcılık silmeyi engelliyor mu?
 *
 * ⚠️ REDDEDİLMİŞ ve HİÇ İZ BIRAKMAMIŞ başvuru engellemez: reddedilen bir
 *    satıcı başvurusunun ne mağazası ne hakedişi vardır, onu bahane edip
 *    kullanıcının silme hakkını süresiz bloke etmek hakkın inkârı olurdu.
 *    Onun dışında HER durum engeller — askıya alınmış satıcının bile ödenmemiş
 *    hakedişi olabilir.
 */
export function blocksDeletion(seller: {
  status: string;
  hasStore: boolean;
  ledgerEntryCount: number;
  payoutCount: number;
}): boolean {
  if (seller.hasStore) return true;
  if (seller.ledgerEntryCount > 0) return true;
  if (seller.payoutCount > 0) return true;
  return seller.status !== 'REJECTED';
}

/**
 * Sipariş adres anlık görüntüsünden kimliği söker.
 *
 * ⚠️ Sipariş SİLİNMEZ ama adres anlık görüntüsü ad, telefon, açık adres ve
 *    vergi numarası taşır; sipariş kaydı içinde saklandığı için "sipariş
 *    duruyor" denip atlanırsa kişisel veri hiç silinmemiş olur.
 *
 * ⚠️ İl/ilçe KALIR. Tutar ve tarih gibi bunlar da muhasebe/raporlama verisidir
 *    (bölgesel satış, kargo maliyeti) ve tek başlarına kişiyi göstermez.
 */
export function redactAddressSnapshot(snapshot: unknown, redactedAt: Date): Prisma.InputJsonValue {
  const source: Record<string, unknown> =
    typeof snapshot === 'object' && snapshot !== null ? (snapshot as Record<string, unknown>) : {};

  const keep = (key: string): string | null =>
    typeof source[key] === 'string' ? (source[key] as string) : null;

  return {
    city: keep('city'),
    district: keep('district'),
    kvkkRedactedAt: redactedAt.toISOString(),
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

// ── İş ────────────────────────────────────────────────────────────────────

@Injectable()
export class AccountDeletionJob {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageProvider,
    private readonly notifier: KvkkNotifier,
    private readonly logger: Logger,
  ) {}

  async run(now: Date = new Date()): Promise<AccountDeletionOutcome> {
    /**
     * ⚠️ SINIRDA SİLME YAPILIR (`<=`). API tarafındaki geri alma kontrolü
     *    (`evaluateDeletionCancellation`) tam `now === purgeAt` anında iptali
     *    REDDEDER. İki taraf aynı anı aynı yöne yorumlamalı; aksi hâlde ya
     *    hem iptal reddedilir hem silme ertelenir (talep askıda kalır) ya da
     *    ikisi birden çalışır (yarısı silinmiş hesap geri verilir).
     */
    const cutoff = new Date(now.getTime() - GRACE_DAYS * DAY_MS);

    const due = await this.prisma.user.findMany({
      where: {
        deletionRequestedAt: { lte: cutoff },
        // Zaten anonimleştirilmiş hesap tekrar taranmaz. `deletionRequestedAt`
        // KASITLI olarak temizlenmiyor: "ne zaman talep edildi" sorusunun
        // cevabı kalmalı, döngü koruması durum alanından geliyor.
        status: { not: 'DELETED' },
      },
      select: {
        id: true,
        email: true,
        role: true,
        deletionRequestedAt: true,
      },
      orderBy: { deletionRequestedAt: 'asc' },
      take: BATCH_SIZE,
    });

    const outcome: AccountDeletionOutcome = {
      scanned: due.length,
      anonymized: 0,
      blockedBySeller: 0,
      storageFailures: 0,
    };

    for (const user of due) {
      try {
        const blocks = await this.sellerBlocks(user.id);
        if (blocks.length > 0) {
          outcome.blockedBySeller += 1;
          await this.reportBlocked(user, blocks, now);
          continue;
        }

        const purged = await this.purge(user, now);
        if (purged) {
          outcome.anonymized += 1;
        } else {
          outcome.storageFailures += 1;
        }
      } catch (error) {
        // Bir hesabın patlaması turu durdurmaz; diğerlerinin hakkı da var.
        outcome.storageFailures += 1;
        this.logger.error({ userId: user.id, err: error }, 'Hesap anonimleştirilemedi');
      }
    }

    this.logger.info(outcome, 'Hesap silme turu tamamlandı');
    return outcome;
  }

  // ── Satıcı engeli ───────────────────────────────────────────────────────

  private async sellerBlocks(userId: string): Promise<SellerBlock[]> {
    const memberships = await this.prisma.sellerUser.findMany({
      where: { userId },
      select: {
        sellerId: true,
        seller: {
          select: {
            status: true,
            store: { select: { id: true } },
            _count: { select: { ledgerEntries: true, payouts: true } },
          },
        },
      },
    });

    return memberships
      .map((membership) => ({
        sellerId: membership.sellerId,
        status: String(membership.seller.status),
        hasStore: membership.seller.store !== null,
        ledgerEntryCount: membership.seller._count.ledgerEntries,
        payoutCount: membership.seller._count.payouts,
      }))
      .filter((seller) => blocksDeletion(seller));
  }

  /**
   * Engellenen hesabı görünür kılar.
   *
   * ⚠️ Talep başına BİR KEZ yazılır. Bu iş her gün çalışır; her turda denetim
   *    izine satır atsaydı, çözülmeyen tek bir engel yılda 365 satır üretir ve
   *    gerçek olayları gürültüye boğardı.
   */
  private async reportBlocked(user: DueUser, blocks: SellerBlock[], now: Date): Promise<void> {
    const already = await this.prisma.auditLog.findFirst({
      where: {
        entityType: ENTITY_USER,
        entityId: user.id,
        action: ACCOUNT_DELETION_AUDIT.blocked,
        createdAt: { gte: user.deletionRequestedAt ?? new Date(0) },
      },
      select: { id: true },
    });

    this.logger.warn(
      { userId: user.id, sellers: blocks.map((block) => block.sellerId) },
      '⚠️ Hesap silme ENGELLENDİ — aktif satıcılık var',
    );

    if (already) return;

    await this.prisma.$transaction(async (tx) => {
      await this.writeAudit(tx, user, {
        action: ACCOUNT_DELETION_AUDIT.blocked,
        entityId: user.id,
        after: { blockedAt: now.toISOString(), sellers: blocks },
        reason: 'Aktif satıcılık: mağaza ve/veya hakediş kaydı var',
      });

      await this.emitOutbox(tx, user.id, ACCOUNT_DELETION_EVENT.blocked, {
        userId: user.id,
        blockedAt: now.toISOString(),
        sellerIds: blocks.map((block) => block.sellerId),
      });
    });
  }

  // ── Asıl silme ──────────────────────────────────────────────────────────

  /**
   * @returns depo silme başarılıysa ve veritabanı yazıldıysa `true`;
   *          depo silme düştüyse `false` (kayıtlara DOKUNULMAZ).
   */
  private async purge(user: DueUser, now: Date): Promise<boolean> {
    // 1) Silinecek nesnelerin anahtarları — veritabanına dokunmadan ÖNCE.
    const photos = await this.prisma.userPhoto.findMany({
      where: { userId: user.id },
      select: { storageKey: true },
    });
    const tryOns = await this.prisma.tryOnJob.findMany({
      where: { userId: user.id, resultKey: { not: null } },
      select: { resultKey: true },
    });
    const orders = await this.prisma.order.findMany({
      where: { userId: user.id },
      select: { id: true, shippingAddress: true, billingAddress: true },
    });
    const returns = await this.prisma.returnRequest.findMany({
      where: { orderId: { in: orders.map((order) => order.id) } },
      select: { id: true, photoKeys: true },
    });

    /**
     * ⚠️ GARDIROP FOTOĞRAFLARI — `photoKey` yalnızca MANUAL kayıtlarda dolu.
     *
     *    `productImageKey` KASITLI OLARAK TOPLANMAZ: o, satıcının public
     *    kovadaki ürün görselidir ve başka kullanıcıların da gördüğü tek bir
     *    nesnedir. Silinseydi, hesabını kapatan bir kullanıcı yüzünden o ürünün
     *    görseli TÜM katalogdan kaybolurdu.
     */
    const wardrobe = await this.prisma.digitalWardrobeItem.findMany({
      where: { userId: user.id, photoKey: { not: null } },
      select: { photoKey: true },
    });

    const keys = [
      ...photos.map((photo) => photo.storageKey),
      ...tryOns.map((job) => job.resultKey).filter((key): key is string => key !== null),
      ...returns.flatMap((request) => request.photoKeys),
      ...wardrobe.map((item) => item.photoKey).filter((key): key is string => key !== null),
    ];

    // 2) ⚠️ ÖNCE DEPO. Başarısızsa veritabanına HİÇ dokunulmaz; kayıt açık
    //    kalır ve yarın tekrar denenir. Tersi sırada, silinmiş bir satırın
    //    hangi nesneyi işaret ettiğini bir daha asla öğrenemezdik.
    try {
      for (const batch of chunk(keys, DELETE_CHUNK)) {
        await this.storage.deleteMany(batch, 'private');
      }
    } catch (error) {
      this.logger.error(
        { userId: user.id, keyCount: keys.length, err: error },
        '⚠️ Depo silme başarısız — hesap anonimleştirilmedi, sonraki turda denenecek',
      );
      return false;
    }

    // 3) Depodan gerçekten silindikten SONRA veritabanı — tek transaction.
    await this.prisma.$transaction(async (tx) => {
      // ⚠️ İADELER SİPARİŞTEN ÖNCE. Aşağıda `Order.userId` koparılıyor; iade
      //    kayıtlarını sipariş üzerinden filtreleseydik bu satırdan sonra
      //    hiçbirini bulamazdık. Bu yüzden kimlikler önceden toplandı.
      if (returns.length > 0) {
        await tx.returnRequest.updateMany({
          where: { id: { in: returns.map((request) => request.id) } },
          // Kanıt fotoğrafları depodan silindi; serbest metin not kullanıcının
          // kendi cümleleridir ve kimlik içerebilir. Tutar, karar ve tarihler
          // yerinde kalır — iade muhasebesi bozulmaz.
          data: { photoKeys: [], note: null },
        });
      }

      // ── ANONİMLEŞTİRİLENLER (silinmez) ──────────────────────────────────
      for (const order of orders) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            userId: null,
            email: ORDER_CONTACT_TOMBSTONE.email,
            phone: ORDER_CONTACT_TOMBSTONE.phone,
            shippingAddress: redactAddressSnapshot(order.shippingAddress, now),
            billingAddress: redactAddressSnapshot(order.billingAddress, now),
          },
        });
      }

      // ⚠️ `OrderItem` ve `OrderPackage` için AYRI İŞLEM YOK ve bu bir eksik
      //    DEĞİLDİR: ikisi de yalnızca ürün/komisyon anlık görüntüsü taşır,
      //    kullanıcıya ait tek alanları siparişe olan bağlantılarıdır ve o
      //    bağlantı yukarıda koparıldı. Buraya bir `deleteMany` eklenirse
      //    satıcı hakedişinin dayanağı yok olur.

      // ⚠️ `LedgerEntry`, `CommissionRule*`, `PayoutRequest`, `PaymentIntent`:
      //    DOKUNULMAZ. Bunlar kişinin değil ŞİRKETİN yasal kayıtlarıdır
      //    (VUK/TTK: 10 yıl). Kişiyle bağları sipariş üzerinden kurulur ve o
      //    bağ zaten koparıldı.

      // Maliyet metriği korunur, kişi bağı koparılır.
      await tx.aiUsageLog.updateMany({ where: { userId: user.id }, data: { userId: null } });

      // ── SİLİNENLER ──────────────────────────────────────────────────────
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.socialAccount.deleteMany({ where: { userId: user.id } });
      await tx.address.deleteMany({ where: { userId: user.id } });
      await tx.bodyProfile.deleteMany({ where: { userId: user.id } });
      await tx.favorite.deleteMany({ where: { userId: user.id } });
      // Kombinler ve sepet — `CartItem` FK ile birlikte gider.
      await tx.outfit.deleteMany({ where: { userId: user.id } });
      await tx.cart.deleteMany({ where: { userId: user.id } });

      /**
       * ⚠️⚠️ DİJİTAL GARDIROP AÇIKÇA SİLİNİR — FK CASCADE'E GÜVENİLEMEZ.
       *
       *    `user_wardrobe_items.userId` üzerinde ON DELETE CASCADE tanımlı ama
       *    BU İŞ KULLANICI SATIRINI SİLMİYOR: aşağıda `status = 'DELETED'` ile
       *    güncelliyor (kimlik alanları null'lanıyor, satır duruyor). Yani
       *    cascade HİÇ TETİKLENMEZ. Bu satır olmasaydı kullanıcının dolabındaki
       *    her parça —kategorisi, rengi, satın aldığı ürünün adı— silinmiş
       *    hesabın altında süresiz yaşamaya devam ederdi.
       *
       *    Fotoğrafların depodaki karşılıkları yukarıda, transaction'dan ÖNCE
       *    silindi (bkz. `wardrobe` sorgusu); buraya gelinmişse depo silme
       *    zaten başarılı olmuştur.
       */
      await tx.digitalWardrobeItem.deleteMany({ where: { userId: user.id } });
      await tx.stylistConversation.deleteMany({ where: { userId: user.id } });
      // Yanıt gövdesi sipariş/adres kopyası içerebilir; ömrü kısa olsa da
      // silme talebinden sonra beklemesi için sebep yok.
      await tx.idempotencyKey.deleteMany({ where: { userId: user.id } });

      // ⚠️ FOTOĞRAF SATIRLARI TAMAMEN SİLİNİR, `deletedAt` İŞARETİYLE DEĞİL.
      //    `UserPhoto.storageKey` kullanıcı kimliğini içerir ve `contentHash`
      //    aynı fotoğrafı yeniden tanımaya yarar — ikisi de kişiyi işaret eder.
      //    ⚠️ YAN ETKİ: `TryOnJob.userPhotoId` FK'si CASCADE'dir, deneme
      //       kayıtları da birlikte gider. Bilinçli: maliyet ve önbellek
      //       metriği `AiUsageLog` içinde (kişi bağı koparılmış olarak) durur,
      //       deneme satırının kendisi kişisel veridir.
      await tx.userPhoto.deleteMany({ where: { userId: user.id } });

      // ── KORUNANLAR ──────────────────────────────────────────────────────
      // ⚠️ `ConsentRecord` SİLİNMEZ. Rızanın verildiği ve geri çekildiği anlar,
      //    silme talebinin kendisi dahil, denetlenebilir kalmalıdır. Kaydı
      //    silmek "rıza hiç alınmadı" iddiasına cevap verecek tek delili yok
      //    etmek olurdu. Satırlar artık kimliksiz bir kullanıcıya bağlıdır.
      // ⚠️ `AuditLog` DOKUNULMAZ — "kim ne yaptı" kaydı silinebilseydi denetim
      //    izi olmazdı.

      // ── KİMLİK ALANLARI ─────────────────────────────────────────────────
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: 'DELETED',
          email: CLEARED,
          phone: CLEARED,
          passwordHash: CLEARED,
          firstName: CLEARED,
          lastName: CLEARED,
          emailVerifiedAt: CLEARED,
          phoneVerifiedAt: CLEARED,
          twoFactorEnabled: false,
        },
      });

      await this.writeAudit(tx, user, {
        action: ACCOUNT_DELETION_AUDIT.executed,
        entityId: user.id,
        before: { status: 'ACTIVE', hadEmail: user.email !== null },
        after: {
          status: 'DELETED',
          anonymizedOrders: orders.length,
          scrubbedReturns: returns.length,
          deletedPhotos: photos.length,
          deletedStorageObjects: keys.length,
          executedAt: now.toISOString(),
        },
        reason: 'Geri alma penceresi doldu',
      });

      // ⚠️ YÜKTE KİŞİSEL VERİ YOK. Outbox satırı kalıcıdır; e-posta veya ad
      //    yazılsaydı, silinen kişinin verisi silme olayının kendi kaydında
      //    yaşamaya devam ederdi.
      await this.emitOutbox(tx, user.id, ACCOUNT_DELETION_EVENT.completed, {
        userId: user.id,
        deletedAt: now.toISOString(),
        anonymizedOrders: orders.length,
      });
    });

    // 4) ⚠️ BİLDİRİM COMMIT'TEN SONRA ve BELLEKTEKİ adresle. Transaction geri
    //    alınsaydı "hesabınız silindi" e-postası yalan olurdu; adres kalıcı bir
    //    satıra yazılsaydı silme eksik kalırdı.
    await this.notifyDeleted(user.id, user.email);

    this.logger.info(
      { userId: user.id, orders: orders.length, storageObjects: keys.length },
      'Hesap anonimleştirildi',
    );

    return true;
  }

  private async notifyDeleted(userId: string, email: string | null): Promise<void> {
    if (!email) {
      // Telefonla açılmış hesapta e-posta olmayabilir. SMS gönderilmiyor:
      // silme onayı için SMS segmenti harcamak, kullanıcının zaten talep
      // ettiği bir sonucu duyurmak için pahalı bir kanal.
      this.logger.info({ userId }, 'Silme bildirimi gönderilmedi — e-posta adresi yok');
      return;
    }

    try {
      await this.notifier.enqueue({
        channel: 'EMAIL',
        to: email,
        template: ACCOUNT_DELETED_TEMPLATE,
        variables: {},
        // Deterministik: iş iki kez çalışsa da tek e-posta gider.
        messageId: `kvkk:account-deleted:${userId}`,
      });
    } catch (error) {
      // Silme TAMAMLANDI; bildirim gitmese de geri alınmaz. Denetim izi olayın
      // gerçekleştiğini zaten kanıtlar.
      this.logger.error({ userId, err: error }, 'Hesap silme bildirimi kuyruğa alınamadı');
    }
  }

  // ── Ortak yazıcılar ─────────────────────────────────────────────────────

  /**
   * DENETİM İZİ (kural 6).
   *
   * ⚠️ AKTÖR KULLANICININ KENDİSİDİR, sistem değil. `Role` birliğinde SYSTEM
   *    yoktur ve uydurma bir rol yazmak denetim izini yanıltıcı kılardı. İşlemi
   *    tetikleyen irade kullanıcınındır; işi yalnızca zamanı gelince yürüttük.
   *    `reason` alanı bunu açıkça yazar.
   *
   * ⚠️ `before`/`after` alanına ham kayıt KONMAZ — e-posta, telefon veya
   *    fotoğraf anahtarı denetim iznine kopyalanırsa, silinen veri "kim ne
   *    yaptı" günlüğünde süresiz yaşar.
   */
  private async writeAudit(
    tx: Prisma.TransactionClient,
    user: DueUser,
    entry: {
      action: string;
      entityId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        action: entry.action,
        entityType: ENTITY_USER,
        entityId: entry.entityId,
        // ⚠️ `DbNull`, `JsonNull` DEĞİL: "önceki durum yoktu" bir YOKLUKtur,
        //    JSON `null` DEĞERİ değil.
        before: entry.before
          ? (serializeBigInts(entry.before) as Prisma.InputJsonValue)
          : Prisma.DbNull,
        after: entry.after
          ? (serializeBigInts(entry.after) as Prisma.InputJsonValue)
          : Prisma.DbNull,
        reason: entry.reason ?? null,
        // İsteği bir kullanıcı değil zamanlayıcı yaptı; IP uydurmak yerine
        // kaynağı açıkça yazıyoruz.
        ipAddress: 'worker/account-deletion',
      },
    });
  }

  /** TRANSACTIONAL OUTBOX (kural 5) — değişiklikle aynı transaction'da. */
  private async emitOutbox(
    tx: Prisma.TransactionClient,
    userId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregate: OUTBOX_AGGREGATE,
        aggregateId: userId,
        type,
        payload: serializeBigInts(payload) as Prisma.InputJsonValue,
      },
    });
  }
}
