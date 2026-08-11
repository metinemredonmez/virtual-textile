/**
 * BELGE NUMARASI ÜRETİMİ — VT-YYMMDD-NNNN
 *
 * Numara müşteriyle konuşma dilidir: telefonda okunur, kargo etiketine
 * yazılır, dekonta düşer. Bu yüzden kısa, okunabilir ve gün bazında artan
 * olmalı — rastgele bir UUID bu işi görmez.
 *
 * ⚠️ ÇAKIŞMA: numara "bugünün sipariş sayısı + 1" ile üretiliyor. İki istek
 *    aynı anda okursa ikisi de aynı numarayı bulur. Üç katmanlı savunma var:
 *    1) Aynı GÜN için advisory lock — numara tahsisini sıralar, farklı
 *       günlerin siparişleri birbirini beklemez.
 *    2) MAX(...) okuması, COUNT(...) değil — eski kayıt silinse bile numara
 *       geri sarmaz.
 *    3) orderNumber üzerindeki UNIQUE indeks — kilit alınmadan (ör. yanlışlıkla
 *       transaction dışında) çağrılırsa bile çift numara veritabanına giremez;
 *       çağıran taraf P2002'de yeniden dener.
 */
import type { Prisma } from '@vt/db';

export const ORDER_NUMBER_PREFIX = 'VT';
/** İade numarası siparişten ayırt edilebilsin: VT-R-260811-0001 */
export const RETURN_NUMBER_PREFIX = 'VT-R';

/**
 * Advisory lock ad alanları. pg_advisory_xact_lock(int, int) iki parçalı
 * anahtar alır; ilk parça "bu kilit ne için", ikinci parça "hangi kayıt".
 * Sabitler elle seçilmiştir — hash çakışması riski yok.
 */
export const LOCK_NAMESPACE = {
  orderNumber: 8801,
  returnNumber: 8802,
  order: 8803,
} as const;

/**
 * Gün anahtarı TÜRKİYE saatine göre hesaplanır, UTC'ye göre değil.
 * Gece 02:00'de verilen bir sipariş müşteri için "dün" değil "bugün"dür;
 * UTC kullanılsaydı yaz saatinde numara günü kullanıcının gününden kayardı.
 */
const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
});

export function formatDayKey(now: Date): string {
  const parts = DAY_FORMATTER.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('year')}${pick('month')}${pick('day')}`;
}

/** Sıra numarası 4 haneye tamamlanır; 9999'u aşarsa doğal olarak genişler. */
export function formatDocumentNumber(prefix: string, dayKey: string, sequence: number): string {
  return `${prefix}-${dayKey}-${String(sequence).padStart(4, '0')}`;
}

/** "VT-260811-0042" → 42. Biçim tutmuyorsa null. */
export function parseSequence(documentNumber: string | null | undefined): number | null {
  if (!documentNumber) return null;
  const match = /-(\d+)$/.exec(documentNumber);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) ? value : null;
}

interface SequenceSpec {
  readonly prefix: string;
  readonly lockNamespace: number;
  readonly readLast: (tx: Prisma.TransactionClient, pattern: string) => Promise<string | null>;
}

async function allocate(
  tx: Prisma.TransactionClient,
  spec: SequenceSpec,
  now: Date,
): Promise<string> {
  const dayKey = formatDayKey(now);

  // Kilit transaction sonunda kendiliğinden düşer — açıkta kalan kilit olmaz.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${spec.lockNamespace}::int, ${Number(dayKey)}::int)`;

  const last = await spec.readLast(tx, `${spec.prefix}-${dayKey}-%`);
  return formatDocumentNumber(spec.prefix, dayKey, (parseSequence(last) ?? 0) + 1);
}

/**
 * ⚠️ Sıralama LENGTH önce: 10000 > 9999 sayısal olarak doğru ama metin
 * sıralamasında '10000' < '9999'. Günlük sipariş 9999'u aştığında numara
 * geri sarmasın diye önce uzunluğa bakılıyor.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  return allocate(
    tx,
    {
      prefix: ORDER_NUMBER_PREFIX,
      lockNamespace: LOCK_NAMESPACE.orderNumber,
      readLast: async (client, pattern) => {
        const rows = await client.$queryRaw<Array<{ last: string }>>`
          SELECT "orderNumber" AS last
            FROM order_orders
           WHERE "orderNumber" LIKE ${pattern}
           ORDER BY LENGTH("orderNumber") DESC, "orderNumber" DESC
           LIMIT 1`;
        return rows[0]?.last ?? null;
      },
    },
    now,
  );
}

export async function nextReturnNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  return allocate(
    tx,
    {
      prefix: RETURN_NUMBER_PREFIX,
      lockNamespace: LOCK_NAMESPACE.returnNumber,
      readLast: async (client, pattern) => {
        const rows = await client.$queryRaw<Array<{ last: string }>>`
          SELECT "returnNumber" AS last
            FROM return_requests
           WHERE "returnNumber" LIKE ${pattern}
           ORDER BY LENGTH("returnNumber") DESC, "returnNumber" DESC
           LIMIT 1`;
        return rows[0]?.last ?? null;
      },
    },
    now,
  );
}

/**
 * Sipariş kaydını bu transaction boyunca kilitler.
 *
 * ⚠️ YARIŞ DURUMU: müşteri "iptal et"e iki kez basarsa veya iptal ile iade
 * talebi aynı anda gelirse, ikisi de aynı paket durumlarını okuyup ikisi de
 * geçerli bulur. Satır kilidi (SELECT FOR UPDATE) yetmez — iade akışı Order
 * satırını hiç güncellemeyebilir. Bu yüzden mantıksal anahtar kilitleniyor.
 */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE.order}::int, hashtext(${orderId}))`;
}
