import { Injectable } from '@nestjs/common';
import { deflateRawSync } from 'node:zlib';
import type { Logger } from 'pino';
import { Prisma, serializeBigInts, type PrismaClient, type Role } from '@vt/db';
import type { StorageProvider } from '@vt/adapters';
import type { KvkkNotifier } from './account-deletion.job.js';

/**
 * ═════════════ VERİ İNDİRME (KVKK md.11) — ARŞİVİ HAZIRLAYAN İŞ ═════════════
 *
 * ⚠️ BU İŞ YOKKEN TALEP BİR KUYUYA DÜŞÜYORDU. API ucu talebi `OutboxEvent`
 *    olarak kaydediyor ve kullanıcıya 202 dönüyordu; arşivi hazırlayan hiç
 *    kimse yoktu. Kullanıcı arayüzde "hazırlanıyor" yazısını 48 saat boyunca
 *    görüyor, sonra bağlantı "süresi doldu"ya dönüyordu. Hiç cevap vermemekten
 *    daha kötüsü: cevap veriyormuş gibi yapmak.
 *
 * ⚠️ ARŞİV BAŞKASININ VERİSİNİ İÇEREMEZ. Sipariş kalemi satıcı kimliği,
 *    komisyon oranı ve satıcı hakedişi taşır; bunlar KULLANICININ verisi değil,
 *    satıcının ticari sırrıdır. Kendi verisini isteyen bir kullanıcıya
 *    platformun komisyon marjını göndermek, bir hakkı yerine getirirken
 *    başkasınınkini ihlal etmektir. Bu yüzden dışa yazılan alanlar BEYAZ LİSTE
 *    ile seçilir (`toExportOrder`), "şu alanları çıkar" biçiminde değil: yeni
 *    bir sütun eklendiğinde varsayılan davranış SIZDIRMAK değil, dışarıda
 *    bırakmak olmalıdır.
 *
 * ⚠️ BAĞLANTI SÜRELİDİR (48 saat). Arşiv kullanıcının tüm kişisel verisini tek
 *    dosyada taşır; süresiz bir bağlantı, e-postası aylar sonra ele geçen biri
 *    için hazır paket olurdu.
 *
 * ⚠️ KUYRUK TÜKETİCİSİ DEĞİL, OUTBOX OKUYUCUSUDUR.
 *    `QUEUE.DOMAIN_EVENT` üzerinde ikinci bir BullMQ `Worker` açmak YASAK:
 *    BullMQ bir işi yalnızca BİR tüketiciye verir, ikinci tüketici olaylarla
 *    bildirim köprüsü arasında rastgele paylaşım yapar ve bildirimlerin yarısı
 *    sessizce kaybolurdu (bkz. notification.processor.ts başındaki uyarı).
 *    Bu iş bu yüzden `OutboxEvent` tablosunu doğrudan okur.
 */

/**
 * ⚠️ API'deki `DATA_EXPORT_LINK_HOURS` ile AYNI OLMAK ZORUNDA.
 *    Bugün iki ayrı yerde duruyor çünkü sabit `apps/api` modülünün içinde ve
 *    worker oradan import edemez. Ayrışırlarsa kullanıcıya "48 saat" denir,
 *    bağlantı 24 saatte ölür.
 *    NEEDS-CONFIG: `@vt/config` içindeki `PHOTO_RETENTION` yanına taşınmalı.
 */
export const DATA_EXPORT_LINK_HOURS = 48;

/**
 * Tüketilen olay tipleri.
 *
 * ⚠️ İki değer var çünkü modül raporu olayı `data-export.requested` olarak
 *    adlandırıyor, `MeService` ise `user.data_export_requested` yayımlıyor.
 *    Tek isme güvenip yanlışını seçseydik iş hiçbir talebi görmez ve HİÇBİR
 *    HATA da vermezdi — tam da bu görevin düzeltmeye çalıştığı sessiz arıza.
 */
export const DATA_EXPORT_EVENT_TYPES = [
  'user.data_export_requested',
  'data-export.requested',
] as const;

/** Denetim izi hem kayıt hem de TEKRAR ETMEME kilidi olarak kullanılır. */
export const DATA_EXPORT_AUDIT = {
  prepared: 'user.data_export.prepared',
  skipped: 'user.data_export.skipped',
} as const;

/**
 * ⚠️ Talebin işlenip işlenmediği AYRI BİR TABLODA tutulmuyor; `AuditLog`
 *    satırının varlığı kilit görevi görüyor. Şema değişikliği bu görevin
 *    kapsamı dışında ve `OutboxEvent.publishedAt` kullanılamaz: onu dağıtıcı
 *    kuyruğa taşırken yazıyor, arşiv hazırlanmadan çok önce dolu oluyor.
 *    NEEDS-SCHEMA: `DataExportRequest` tablosu açıldığında kilit oraya taşınmalı.
 */
const ENTITY_DATA_EXPORT = 'DataExport';

/** Bir turda hazırlanacak azami arşiv — her biri onlarca MB olabilir. */
const BATCH_SIZE = 5;

/**
 * Arşive konacak azami toplam ham bayt.
 *
 * ⚠️ Sınır olmadan bu iş bir kullanıcının 90 günlük fotoğraf geçmişini belleğe
 *    alır ve worker prosesini OOM ile öldürür — yani tek bir kullanıcının
 *    talebi bildirim ve sipariş işlerini de durdurur.
 */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

/**
 * ⚠️ BU ŞABLON HENÜZ YOK — bkz. account-deletion.job.ts'teki aynı not.
 *    NEEDS-TEMPLATE: 'kvkk-veri-indirme-hazir' (EMAIL), değişkenler: link, hours.
 */
export const DATA_EXPORT_TEMPLATE = 'kvkk-veri-indirme-hazir';

// ══════════════════════════ ZIP YAZICI ═════════════════════════════════════

/**
 * ZIP ÜRETİMİ — DIŞ BAĞIMLILIK YOK.
 *
 * Depoda arşiv kütüphanesi yok ve `package.json`a dokunmak bu görevin kapsamı
 * dışında (NEEDS-DEP). Node'un yerleşik `zlib`i deflate'i zaten sağlıyor;
 * eksik olan yalnızca kapsayıcı biçimi. Tek seferlik ~60 satır, yeni bir
 * bağımlılığın denetim ve güncelleme yükünden ucuz.
 *
 * ⚠️ ZIP64 YOK: 4 GB üstü arşiv veya 65535'ten çok dosya desteklenmez.
 *    `MAX_ARCHIVE_BYTES` bunun çok altında tuttuğu için sorun değil; sınır
 *    büyütülürse burası da büyütülmelidir.
 */
export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 — sabit zaman damgası. */
const DOS_DATE = 33;
const DOS_TIME = 0;

export function createZipArchive(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // 0x0800 = dosya adı UTF-8. Türkçe karakterli klasör adları için şart.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 30); // extra + comment uzunlukları
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // iç öznitelik
    central.writeUInt32LE(0, 38); // dış öznitelik
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDirectory, end]);
}

// ══════════════════════ BELGE ÜRETİMİ (saf) ════════════════════════════════

/**
 * ⚠️ Ham satır tipleri, YASAKLI alanları da içerecek biçimde tanımlıdır.
 *    Bilerek: test bunları doldurup çıktıda BULUNMADIKLARINI doğrulayabilsin.
 *    Tip onları görmeseydi, sızıntı testi de yazılamazdı.
 */
export interface RawOrderItem {
  productTitle: string;
  brandName: string;
  variantLabel: string;
  sku: string;
  quantity: number;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
  /** ⚠️ SATICININ verisi — dışarı YAZILMAZ. */
  commissionRateBps?: number;
  commissionAmountMinor?: bigint;
  sellerNetMinor?: bigint;
  commissionRuleVersionId?: string;
  packageId?: string;
}

export interface RawOrder {
  orderNumber: string;
  status: string;
  createdAt: Date;
  grandTotalMinor: bigint;
  itemsTotalMinor: bigint;
  shippingTotalMinor: bigint;
  discountMinor: bigint;
  currency: string;
  shippingAddress: unknown;
  billingAddress: unknown;
  items: RawOrderItem[];
  /** ⚠️ Satıcı paketleri — sellerId taşır, dışarı YAZILMAZ. */
  packages?: Array<{ sellerId: string; status: string; carrier: string | null }>;
}

export interface RawExportData {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    locale: string;
    createdAt: Date;
  };
  addresses: Array<Record<string, unknown>>;
  bodyProfile: Record<string, unknown> | null;
  consents: Array<{ type: string; granted: boolean; documentVersion: string; createdAt: Date }>;
  orders: RawOrder[];
  favorites: Array<{ productId: string; createdAt: Date }>;
  outfits: Array<{ name: string; createdAt: Date }>;
  /**
   * ⚠️ DİJİTAL GARDIROP KVKK KAPSAMINDADIR ve arşivde YOKTU.
   *
   *    Kanıt tartışmaya kapalı: hesap silme işi (account-deletion.job.ts) bu
   *    satırları `deleteMany` ile siliyor ve `photoKey` nesnelerini depodan
   *    kaldırıyor. Aynı veriyi "silinmesi gereken kişisel veri" sayıp
   *    "kopyası verilmesi gereken kişisel veri" saymamak, KVKK md.11'in iki
   *    fıkrasını birbirine ters uygulamaktır.
   *
   *    Kayıt kullanıcının ne satın aldığını VE bedenine dair tercihlerini
   *    gösterir; satıcıya ait ticari bir alan taşımaz, o yüzden beyaz listeye
   *    tümü girer (`sourceOrderItemId` hariç — o bir iç anahtardır).
   */
  wardrobe: Array<{
    source: string;
    category: string;
    color: string;
    label: string | null;
    variantId: string | null;
    createdAt: Date;
  }>;
  tryOnJobs: Array<{ id: string; status: string; mode: string; queuedAt: Date }>;
  photos: Array<{ id: string; purpose: string; createdAt: Date; expiresAt: Date }>;
  stylistMessages: Array<{ role: string; content: string; createdAt: Date }>;
  sessions: Array<{ deviceLabel: string | null; ipAddress: string; createdAt: Date }>;
}

export interface MissingFile {
  name: string;
  reason: 'depo-hatasi' | 'boyut-siniri';
}

/**
 * ⚠️ BEYAZ LİSTE. Yeni bir sütun eklendiğinde varsayılan davranış onu dışarıda
 *    bırakmaktır; `delete item.sellerNetMinor` biçiminde kara liste yazılsaydı
 *    bir sonraki komisyon alanı sessizce arşive düşerdi.
 */
export function toExportOrder(order: RawOrder): Record<string, unknown> {
  return {
    siparisNo: order.orderNumber,
    durum: order.status,
    tarih: order.createdAt.toISOString(),
    paraBirimi: order.currency,
    urunToplamiKurus: order.itemsTotalMinor,
    kargoToplamiKurus: order.shippingTotalMinor,
    indirimKurus: order.discountMinor,
    genelToplamKurus: order.grandTotalMinor,
    teslimatAdresi: order.shippingAddress,
    faturaAdresi: order.billingAddress,
    kalemler: order.items.map((item) => ({
      urun: item.productTitle,
      marka: item.brandName,
      secenek: item.variantLabel,
      stokKodu: item.sku,
      adet: item.quantity,
      birimFiyatKurus: item.unitPriceMinor,
      satirToplamiKurus: item.lineTotalMinor,
      // ⚠️ commissionRateBps / commissionAmountMinor / sellerNetMinor /
      //    commissionRuleVersionId / packageId BİLİNÇLİ OLARAK YOK.
    })),
    // ⚠️ `packages` hiç yazılmıyor: hangi satıcının hangi kalemi gönderdiği
    //    bilgisi kullanıcının kargo takibinde zaten var, arşivde satıcı
    //    kimliğini kalıcılaştırmanın bir faydası yok.
  };
}

export function buildExportDocument(
  raw: RawExportData,
  context: { generatedAt: Date; linkExpiresAt: Date; missingFiles: MissingFile[] },
): Record<string, unknown> {
  return {
    aciklama:
      'KVKK md.11 kapsamında hazırlanan kişisel veri kopyanız. Tutarlar kuruş cinsindendir.',
    olusturulmaZamani: context.generatedAt.toISOString(),
    baglantiSonKullanma: context.linkExpiresAt.toISOString(),
    /** Depodan okunamayan veya boyut sınırına takılan dosyalar açıkça yazılır. */
    eksikDosyalar: context.missingFiles,
    hesap: {
      olusturulma: raw.user.createdAt.toISOString(),
      eposta: raw.user.email,
      telefon: raw.user.phone,
      ad: raw.user.firstName,
      soyad: raw.user.lastName,
      dil: raw.user.locale,
    },
    adresler: raw.addresses,
    vucutProfili: raw.bodyProfile,
    rizaGecmisi: raw.consents.map((consent) => ({
      tur: consent.type,
      verildi: consent.granted,
      metinSurumu: consent.documentVersion,
      tarih: consent.createdAt.toISOString(),
    })),
    siparisler: raw.orders.map(toExportOrder),
    favoriler: raw.favorites.map((favorite) => ({
      urunId: favorite.productId,
      tarih: favorite.createdAt.toISOString(),
    })),
    kombinler: raw.outfits.map((outfit) => ({
      ad: outfit.name,
      tarih: outfit.createdAt.toISOString(),
    })),
    dijitalGardirop: raw.wardrobe.map((item) => ({
      // MANUAL = kullanıcının kendi eklediği parça, PURCHASE = satın alınan.
      kaynak: item.source,
      kategori: item.category,
      renk: item.color,
      etiket: item.label,
      urunVaryantId: item.variantId,
      tarih: item.createdAt.toISOString(),
    })),
    sanalDenemeler: raw.tryOnJobs.map((job) => ({
      id: job.id,
      durum: job.status,
      mod: job.mode,
      tarih: job.queuedAt.toISOString(),
    })),
    fotograflar: raw.photos.map((photo) => ({
      id: photo.id,
      amac: photo.purpose,
      yuklenme: photo.createdAt.toISOString(),
      saklamaSonu: photo.expiresAt.toISOString(),
    })),
    stilDanismaniMesajlari: raw.stylistMessages.map((message) => ({
      taraf: message.role,
      metin: message.content,
      tarih: message.createdAt.toISOString(),
    })),
    oturumlar: raw.sessions.map((session) => ({
      cihaz: session.deviceLabel,
      ip: session.ipAddress,
      tarih: session.createdAt.toISOString(),
    })),
  };
}

// ══════════════════════════════ İŞ ═════════════════════════════════════════

export interface DataExportOutcome {
  scanned: number;
  prepared: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class DataExportJob {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageProvider,
    private readonly notifier: KvkkNotifier,
    private readonly logger: Logger,
  ) {}

  async run(now: Date = new Date()): Promise<DataExportOutcome> {
    const requests = await this.prisma.outboxEvent.findMany({
      where: {
        aggregate: 'user',
        type: { in: [...DATA_EXPORT_EVENT_TYPES] },
        // Bağlantısı çoktan ölmüş bir talep için arşiv hazırlamak, kimsenin
        // indiremeyeceği bir dosyayı depoya yazmaktır.
        createdAt: { gt: new Date(now.getTime() - DATA_EXPORT_LINK_HOURS * 3600 * 1000) },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, aggregateId: true, createdAt: true },
      take: BATCH_SIZE,
    });

    const outcome: DataExportOutcome = {
      scanned: requests.length,
      prepared: 0,
      skipped: 0,
      failed: 0,
    };

    for (const request of requests) {
      try {
        const handled = await this.handle(request, now);
        if (handled === 'prepared') outcome.prepared += 1;
        else outcome.skipped += 1;
      } catch (error) {
        outcome.failed += 1;
        // ⚠️ Kilit YAZILMADI: talep açık kalır ve sonraki turda tekrar denenir.
        //    Hata anında kilit atılsaydı, geçici bir depo arızası kullanıcının
        //    hakkını sessizce iptal ederdi.
        this.logger.error(
          { outboxEventId: request.id, userId: request.aggregateId, err: error },
          'Veri indirme arşivi hazırlanamadı',
        );
      }
    }

    if (outcome.prepared > 0 || outcome.failed > 0) {
      this.logger.info(outcome, 'Veri indirme turu tamamlandı');
    }
    return outcome;
  }

  private async handle(
    request: { id: string; aggregateId: string; createdAt: Date },
    now: Date,
  ): Promise<'prepared' | 'skipped'> {
    // ⚠️ TEKRAR ETMEME. Outbox teslimatı en az bir kezdir ve bu iş her turda
    //    aynı satırı yeniden görür; kilit olmasaydı kullanıcı her beş dakikada
    //    bir "arşiviniz hazır" e-postası alırdı.
    const already = await this.prisma.auditLog.findFirst({
      where: {
        entityType: ENTITY_DATA_EXPORT,
        entityId: request.id,
        action: { in: [DATA_EXPORT_AUDIT.prepared, DATA_EXPORT_AUDIT.skipped] },
      },
      select: { id: true },
    });
    if (already) return 'skipped';

    const user = await this.prisma.user.findUnique({
      where: { id: request.aggregateId },
      select: { id: true, email: true, role: true, status: true },
    });

    // ⚠️ SİLİNMİŞ HESABA ARŞİV ÜRETİLMEZ. Silme işi kimlik alanlarını
    //    temizledikten sonra bekleyen bir indirme talebi işlenseydi, boş ama
    //    yine de kişiyi işaret eden bir dosya üretilir ve gidecek adres de
    //    olmazdı.
    if (!user || user.status === 'DELETED') {
      await this.writeLock(request, user?.role ?? 'CUSTOMER', DATA_EXPORT_AUDIT.skipped, {
        reason: user ? 'hesap-silinmis' : 'kullanici-yok',
        skippedAt: now.toISOString(),
      });
      return 'skipped';
    }

    const linkExpiresAt = new Date(
      request.createdAt.getTime() + DATA_EXPORT_LINK_HOURS * 3600 * 1000,
    );

    const raw = await this.collect(user.id);
    const { entries, missingFiles } = await this.collectFiles(user.id);

    const document = buildExportDocument(raw, {
      generatedAt: now,
      linkExpiresAt,
      missingFiles,
    });

    const archive = createZipArchive([
      {
        name: 'veriler.json',
        // ⚠️ `serializeBigInts`: kuruş alanları bigint'tir ve `JSON.stringify`
        //    bigint'i serileştiremez — dosya hiç üretilemezdi.
        data: Buffer.from(JSON.stringify(serializeBigInts(document), null, 2), 'utf8'),
      },
      ...entries,
    ]);

    /**
     * ⚠️ PRIVATE KOVA. Bu dosya kullanıcının her şeyidir; public kovaya
     *    yazılması tek başına bir veri ihlalidir.
     *    NEEDS-KEYSCHEMA: `@vt/adapters` içindeki `visibilityForKey()` 'exports/'
     *    önekini tanımıyor ve public sayıyor. Bugün sorun değil — kova bu
     *    çağrılarda AÇIKÇA veriliyor — ama önek o listeye eklenmelidir.
     */
    const key = `exports/${user.id}/${request.id}.zip`;
    await this.storage.put({
      key,
      visibility: 'private',
      body: archive,
      contentType: 'application/zip',
      cacheControl: 'private, no-store',
    });

    const url = await this.storage.signedUrl({
      key,
      visibility: 'private',
      expiresInSeconds: Math.max(60, Math.floor((linkExpiresAt.getTime() - now.getTime()) / 1000)),
      operation: 'get',
    });

    // ⚠️ Kilit ve denetim izi, bildirimden ÖNCE. Ters sırada olsaydı ve kilit
    //    yazımı düşseydi, kullanıcı her turda yeni bir e-posta alırdı.
    await this.writeLock(request, user.role, DATA_EXPORT_AUDIT.prepared, {
      // ⚠️ İMZALI URL DENETİM İZİNE YAZILMAZ: imza, dosyanın kendisine erişim
      //    yetkisidir. Denetim kaydını okuyabilen herkes arşivi indirebilirdi.
      storageKey: key,
      fileCount: entries.length + 1,
      archiveBytes: archive.length,
      missingFileCount: missingFiles.length,
      linkExpiresAt: linkExpiresAt.toISOString(),
    });

    await this.notify(user.id, user.email, url, linkExpiresAt, request.id);

    this.logger.info(
      {
        userId: user.id,
        outboxEventId: request.id,
        fileCount: entries.length + 1,
        bytes: archive.length,
      },
      'Veri indirme arşivi hazırlandı',
    );

    return 'prepared';
  }

  // ── Veri toplama ────────────────────────────────────────────────────────

  private async collect(userId: string): Promise<RawExportData> {
    const [
      user,
      addresses,
      bodyProfile,
      consents,
      orders,
      favorites,
      outfits,
      wardrobe,
      tryOnJobs,
      photos,
      stylistMessages,
      sessions,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          locale: true,
          createdAt: true,
        },
      }),
      this.prisma.address.findMany({
        where: { userId },
        // ⚠️ `taxNumberEnc` YOK: şifreli sütunu ham hâliyle yazmak hem
        //    anlamsız hem de şifreleme sınırını arşive taşımak olurdu.
        select: {
          title: true,
          firstName: true,
          lastName: true,
          phone: true,
          city: true,
          district: true,
          neighbourhood: true,
          line1: true,
          postalCode: true,
          createdAt: true,
        },
      }),
      this.prisma.bodyProfile.findUnique({
        where: { userId },
        select: {
          heightCm: true,
          weightKg: true,
          chestCm: true,
          waistCm: true,
          hipCm: true,
          usualSize: true,
          fitPref: true,
        },
      }),
      this.prisma.consentRecord.findMany({
        where: { userId },
        select: { type: true, granted: true, documentVersion: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { userId },
        select: {
          orderNumber: true,
          status: true,
          createdAt: true,
          currency: true,
          itemsTotalMinor: true,
          shippingTotalMinor: true,
          discountMinor: true,
          grandTotalMinor: true,
          shippingAddress: true,
          billingAddress: true,
          items: {
            // ⚠️ Komisyon ve satıcı hakedişi sütunları BURADA DA seçilmiyor:
            //    veritabanından hiç okunmayan alan yanlışlıkla yazılamaz.
            select: {
              productTitle: true,
              brandName: true,
              variantLabel: true,
              sku: true,
              quantity: true,
              unitPriceMinor: true,
              lineTotalMinor: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.favorite.findMany({
        where: { userId },
        select: { productId: true, createdAt: true },
      }),
      this.prisma.outfit.findMany({
        where: { userId },
        select: { name: true, createdAt: true },
      }),
      this.prisma.digitalWardrobeItem.findMany({
        where: { userId },
        /**
         * ⚠️ `photoKey` ve `productImageKey` BURADA seçilmiyor. `photoKey`
         *    kullanıcının kendi fotoğrafıdır ve arşive DOSYA olarak girer
         *    (bkz. `collectFiles`); depo anahtarını ayrıca JSON'a yazmak,
         *    kullanıcıya işine yaramayan bir iç adres vermek olurdu.
         *    `productImageKey` ise satıcının pazarlama görselidir — kullanıcının
         *    verisi değil.
         *
         * ⚠️ `sourceOrderItemId` de yok: iç idempotentlik anahtarı, kişisel veri
         *    değil. Hangi siparişten geldiği zaten `siparisler` bölümünde.
         */
        select: {
          source: true,
          category: true,
          color: true,
          label: true,
          variantId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.tryOnJob.findMany({
        where: { userId },
        select: { id: true, status: true, mode: true, queuedAt: true },
      }),
      this.prisma.userPhoto.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, purpose: true, createdAt: true, expiresAt: true },
      }),
      this.prisma.stylistMessage.findMany({
        where: { conversation: { userId } },
        select: { role: true, content: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.session.findMany({
        where: { userId },
        // ⚠️ `refreshTokenHash` YOK: oturum jetonunun özeti arşive girerse,
        //    arşivi ele geçiren kişi oturum çalma denemesi için malzeme bulur.
        select: { deviceLabel: true, ipAddress: true, createdAt: true },
      }),
    ]);

    return {
      user,
      addresses: addresses.map((address) => ({ ...address, createdAt: address.createdAt })),
      bodyProfile,
      consents: consents.map((consent) => ({ ...consent, type: String(consent.type) })),
      orders: orders.map((order) => ({ ...order, status: String(order.status) })),
      favorites,
      outfits,
      wardrobe: wardrobe.map((item) => ({
        ...item,
        source: String(item.source),
        category: String(item.category),
      })),
      tryOnJobs: tryOnJobs.map((job) => ({
        ...job,
        status: String(job.status),
        mode: String(job.mode),
      })),
      photos: photos.map((photo) => ({ ...photo, purpose: String(photo.purpose) })),
      stylistMessages,
      sessions,
    };
  }

  /**
   * Fotoğrafları ve sanal deneme çıktılarını depodan çeker.
   *
   * ⚠️ TEK BİR DOSYANIN OKUNAMAMASI ARŞİVİ DÜŞÜRMEZ. Saklama süresi dolup
   *    silinmiş ama kaydı henüz temizlenmemiş bir nesne her zaman olabilir;
   *    yüzlerce dosyalık bir arşivi tek eksik nesne yüzünden hiç üretmemek,
   *    kullanıcıya hiçbir şey vermemek demektir. Eksikler manifestoda AÇIKÇA
   *    listelenir — sessizce eksik teslim edilmez.
   */
  private async collectFiles(
    userId: string,
  ): Promise<{ entries: ZipEntry[]; missingFiles: MissingFile[] }> {
    const photos = await this.prisma.userPhoto.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, storageKey: true },
    });
    const tryOns = await this.prisma.tryOnJob.findMany({
      where: { userId, resultKey: { not: null } },
      select: { id: true, resultKey: true },
    });
    /**
     * ⚠️ Gardıroptaki KULLANICI fotoğrafları (MANUAL kayıtların `photoKey`
     *    alanı, private kova). Hesap silme işi bu nesneleri depodan siliyor —
     *    yani kişisel veri sayıyor; arşiv de onları vermek zorunda.
     *
     *    `productImageKey` BİLİNÇLİ OLARAK ALINMAZ: o satıcının public ürün
     *    görselidir, kullanıcının verisi değil. Arşive konsaydı kullanıcıya
     *    kendi verisi diye satıcının pazarlama materyali gönderilirdi.
     */
    const wardrobePhotos = await this.prisma.digitalWardrobeItem.findMany({
      where: { userId, photoKey: { not: null } },
      select: { id: true, photoKey: true },
    });

    const wanted: Array<{ name: string; key: string }> = [
      ...photos.map((photo) => ({ name: `fotograflar/${photo.id}`, key: photo.storageKey })),
      ...tryOns
        .filter((job): job is { id: string; resultKey: string } => job.resultKey !== null)
        .map((job) => ({ name: `sanal-deneme/${job.id}.webp`, key: job.resultKey })),
      ...wardrobePhotos
        .filter((item): item is { id: string; photoKey: string } => item.photoKey !== null)
        .map((item) => ({ name: `gardirop/${item.id}`, key: item.photoKey })),
    ];

    const entries: ZipEntry[] = [];
    const missingFiles: MissingFile[] = [];
    let total = 0;

    for (const item of wanted) {
      if (total >= MAX_ARCHIVE_BYTES) {
        missingFiles.push({ name: item.name, reason: 'boyut-siniri' });
        continue;
      }
      try {
        const data = await this.storage.get(item.key, 'private');
        total += data.length;
        entries.push({ name: item.name, data });
      } catch (error) {
        missingFiles.push({ name: item.name, reason: 'depo-hatasi' });
        this.logger.warn(
          { userId, name: item.name, err: error },
          'Arşive eklenecek dosya depodan okunamadı',
        );
      }
    }

    return { entries, missingFiles };
  }

  // ── Kayıt ve bildirim ───────────────────────────────────────────────────

  private async writeLock(
    request: { id: string; aggregateId: string },
    role: Role,
    action: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        // Aktör talebi açan kullanıcıdır; `Role` birliğinde SYSTEM yok ve
        // uydurma bir rol denetim izini yanıltıcı kılardı.
        actorId: request.aggregateId,
        actorRole: role,
        action,
        entityType: ENTITY_DATA_EXPORT,
        entityId: request.id,
        before: Prisma.DbNull,
        after: serializeBigInts(after) as Prisma.InputJsonValue,
        reason: null,
        ipAddress: 'worker/data-export',
      },
    });
  }

  private async notify(
    userId: string,
    email: string | null,
    url: string,
    linkExpiresAt: Date,
    requestId: string,
  ): Promise<void> {
    if (!email) {
      // ⚠️ Arşiv HAZIR ama gidecek adres yok. SMS ile gönderilmiyor: imzalı
      //    bağlantı uzundur, çok segmente bölünür ve SMS'i gören herkes
      //    kullanıcının tüm verisini indirebilir.
      this.logger.warn(
        { userId, requestId },
        '⚠️ Veri indirme arşivi hazır ama kullanıcının e-posta adresi yok',
      );
      return;
    }

    await this.notifier.enqueue({
      channel: 'EMAIL',
      to: email,
      template: DATA_EXPORT_TEMPLATE,
      variables: {
        link: url,
        hours: String(DATA_EXPORT_LINK_HOURS),
        expiresAt: linkExpiresAt.toISOString(),
      },
      // Deterministik: aynı talep iki kez işlense de tek e-posta gider.
      messageId: `kvkk:data-export:${requestId}`,
    });
  }
}
