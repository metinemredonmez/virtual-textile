import { PrismaClient, Prisma } from '../generated/client/index.js';

export * from '../generated/client/index.js';
export { PrismaClient, Prisma };

/**
 * Prisma istemcisi — tek örnek (singleton).
 *
 * Geliştirmede hot-reload her yeniden yüklemede yeni bir istemci yaratır ve
 * bağlantı havuzunu tüketir; globalThis üzerinde saklayarak bunu engelliyoruz.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export interface PrismaFactoryOptions {
  databaseUrl?: string;
  /** Yavaş sorguları loglamak için eşik. */
  slowQueryMs?: number;
  onSlowQuery?: (info: { query: string; durationMs: number }) => void;
}

export function createPrismaClient(options: PrismaFactoryOptions = {}): PrismaClient {
  const client = new PrismaClient({
    ...(options.databaseUrl ? { datasources: { db: { url: options.databaseUrl } } } : {}),
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  const threshold = options.slowQueryMs ?? 500;
  const { onSlowQuery } = options;
  if (onSlowQuery) {
    client.$on('query', (event) => {
      if (event.duration >= threshold) {
        onSlowQuery({ query: event.query, durationMs: event.duration });
      }
    });
  }

  return client;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ── Hata sınıflandırma yardımcıları ───────────────────────────────────────
// apps/api'deki global exception filter bunları AppError'a çevirir.

export const PRISMA_ERROR = {
  /** Benzersizlik kısıtı ihlali → DUPLICATE_RESOURCE (409) */
  UNIQUE_VIOLATION: 'P2002',
  /** Yabancı anahtar ihlali → INVALID_REFERENCE (400) */
  FOREIGN_KEY_VIOLATION: 'P2003',
  /** Kayıt bulunamadı → NOT_FOUND (404) */
  RECORD_NOT_FOUND: 'P2025',
  /** CHECK kısıtı ihlali → VALIDATION_FAILED (400) */
  CONSTRAINT_VIOLATION: 'P2004',
  /** Transaction kilitlenmesi → CONCURRENCY_CONFLICT (409, retryable) */
  TRANSACTION_CONFLICT: 'P2034',
} as const;

export function isPrismaKnownError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

/** P2002'de hangi alanın çakıştığını döndürür — kullanıcıya anlamlı mesaj için. */
export function uniqueViolationTarget(
  error: Prisma.PrismaClientKnownRequestError,
): string[] | undefined {
  const target = error.meta?.['target'];
  if (Array.isArray(target)) return target as string[];
  if (typeof target === 'string') return [target];
  return undefined;
}

// ── BigInt serileştirme ───────────────────────────────────────────────────

/**
 * JSON.stringify bigint'i serileştiremez.
 * Para alanları API sınırında string'e çevrilir — hassasiyet kaybı olmadan.
 *
 * ⚠️ Number'a çevirmeyin: 2^53'ten büyük kuruş tutarları bozulur.
 */
export function serializeBigInts<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val: unknown) => (typeof val === 'bigint' ? val.toString() : val)),
  ) as T;
}

/**
 * Satıcı bakiyesi — ledger'dan HESAPLANIR.
 * ⚠️ Ayrı bir `balance` kolonu tutulmaz; er geç tutarsızlaşır.
 */
export async function getSellerBalanceMinor(
  client: PrismaClient,
  sellerId: string,
  options: { onlyAvailable?: boolean } = {},
): Promise<bigint> {
  const result = await client.ledgerEntry.aggregate({
    where: {
      sellerId,
      ...(options.onlyAvailable ? { availableAt: { lte: new Date() } } : {}),
    },
    _sum: { amountMinor: true },
  });
  return result._sum.amountMinor ?? 0n;
}
