/**
 * CSV TOPLU ÜRÜN YÜKLEME — saf çekirdek (ayrıştırma + doğrulama).
 *
 * ⚠️ KISMİ BAŞARI YOKTUR. Dosyadaki tek bir satır bile hatalıysa hiçbir satır
 *    yazılmaz. Sebep: satıcı 500 satırlık dosyayı yükleyip "412 tanesi geçti"
 *    yanıtı alırsa hangi 88'ini düzeltip yeniden yükleyeceğini bilemez;
 *    yeniden yüklerse geçenler mükerrer olur. Ya hep ya hiç, tek doğru davranış.
 *
 * Hatalar SATIR NUMARASIYLA toplanır ve tek seferde döndürülür — satıcı
 * dosyayı bir kez açıp hepsini düzeltebilsin. Tek tek "ilk hatada dur"
 * yaklaşımı 88 hatalı satır için 88 yükleme turu demektir.
 *
 * CSV ayrıştırıcı elle yazıldı: yeni bir npm bağımlılığı kurmak bu ajanın
 * yetkisi dışında ve ihtiyaç duyulan yüzey (tırnak, kaçış, CRLF, BOM) dar.
 */
import { z } from 'zod';
import { appError } from '@vt/contracts';

/** Tek bir hücrenin hatası — satıcıya bu üçlü gösterilir. */
export interface BulkRowError {
  /** 1 tabanlı DOSYA satır numarası. Başlık 1'dir, ilk veri satırı 2'dir. */
  readonly row: number;
  readonly column: string | null;
  readonly message: string;
}

/** Yüklemede kabul edilen sütunlar. Sıra önemsizdir, başlıktan eşlenir. */
export const CSV_COLUMNS = [
  'productRef',
  'title',
  'description',
  'categorySlug',
  'brandName',
  'gender',
  'sku',
  'color',
  'colorHex',
  'size',
  'priceMinor',
  'listPriceMinor',
  'barcode',
  'stock',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

const REQUIRED_COLUMNS: readonly CsvColumn[] = [
  'productRef',
  'title',
  'categorySlug',
  'brandName',
  'gender',
  'sku',
  'color',
  'colorHex',
  'size',
  'priceMinor',
  'stock',
];

/** Tek dosyada işlenebilecek azami satır — bellek ve kilit süresi sınırı. */
export const MAX_CSV_ROWS = 2_000;
/** Ham dosya boyutu sınırı (bayt). */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

// ── Ayrıştırma ────────────────────────────────────────────────────────────

/**
 * RFC 4180 alt kümesi: çift tırnaklı alanlar, "" ile kaçırılmış tırnak,
 * alan içinde satır sonu, CRLF/LF karışımı, BOM.
 *
 * Basit `split(',')` KULLANILMAZ: ürün açıklamasında bir virgül tüm satırı
 * kaydırır ve fiyat sütununa açıklama metni düşer — sessiz fiyat hatası.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    // Tamamen boş satırlar atlanır (dosya sonundaki yeni satır dâhil).
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (char === ',') {
      endField();
      continue;
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      endRow();
      continue;
    }
    if (char === '\n') {
      endRow();
      continue;
    }

    field += char;
    fieldStarted = true;
  }

  // Son satır yeni satırla bitmemişse
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

// ── Satır şeması ──────────────────────────────────────────────────────────

/** Tutarlar dosyada KURUŞ tam sayısı olarak gelir; ondalık kabul edilmez. */
const csvMinorSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}$/, 'Tutar kuruş cinsinden tam sayı olmalı (örn. 14990 = 149,90 ₺).')
  .transform((value) => BigInt(value));

const csvRowSchema = z.object({
  productRef: z.string().trim().min(1, 'Ürün kodu zorunlu.').max(64),
  title: z.string().trim().min(3, 'Başlık en az 3 karakter olmalı.').max(200),
  description: z.string().trim().max(5_000).default(''),
  categorySlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Geçersiz kategori kodu.'),
  brandName: z.string().trim().min(1, 'Marka zorunlu.').max(120),
  gender: z.enum(['WOMAN', 'MAN', 'UNISEX', 'KIDS'], {
    errorMap: () => ({ message: 'Cinsiyet WOMAN, MAN, UNISEX veya KIDS olmalı.' }),
  }),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(3, 'SKU en az 3 karakter olmalı.')
    .max(64)
    .regex(/^[A-Z0-9._-]+$/, 'SKU yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir.'),
  color: z.string().trim().min(1, 'Renk zorunlu.').max(60),
  colorHex: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^#[0-9A-F]{6}$/, 'Renk kodu #RRGGBB biçiminde olmalı.'),
  size: z.string().trim().min(1, 'Beden zorunlu.').max(20),
  priceMinor: csvMinorSchema,
  listPriceMinor: csvMinorSchema.optional(),
  barcode: z.string().trim().max(64).optional(),
  stock: z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, 'Stok negatif olmayan tam sayı olmalı.')
    .transform((value) => Number(value)),
});

export type CsvRow = z.infer<typeof csvRowSchema>;

/** Doğrulanmış satır + geldiği dosya satırı — hata mesajları için taşınır. */
export interface ParsedCsvRow {
  readonly line: number;
  readonly data: CsvRow;
}

/** Satırların ürün bazında gruplanmış hâli — yazma katmanının girdisi. */
export interface BulkProductDraft {
  readonly productRef: string;
  readonly title: string;
  readonly description: string;
  readonly categorySlug: string;
  readonly brandName: string;
  readonly gender: CsvRow['gender'];
  readonly variants: readonly BulkVariantDraft[];
}

export interface BulkVariantDraft {
  readonly line: number;
  readonly sku: string;
  readonly color: string;
  readonly colorHex: string;
  readonly size: string;
  readonly priceMinor: bigint;
  readonly listPriceMinor: bigint | null;
  readonly barcode: string | null;
  readonly stock: number;
}

export interface BulkParseResult {
  readonly products: readonly BulkProductDraft[];
  readonly rowCount: number;
  /** Dosyadaki tüm SKU'lar — çağıran bunları veritabanıyla çakıştırır. */
  readonly skus: readonly string[];
}

// ── Doğrulama ─────────────────────────────────────────────────────────────

/**
 * Dosyayı ayrıştırır, doğrular ve ürün bazında gruplar.
 * Tek bir hata bulunursa BULK_UPLOAD_INVALID fırlatır ve HİÇBİR şey döndürmez.
 */
export function parseBulkUpload(content: string): BulkParseResult {
  const errors: BulkRowError[] = [];
  const rows = parseCsv(content);

  if (rows.length === 0) {
    throw bulkUploadError([{ row: 1, column: null, message: 'Dosya boş.' }]);
  }

  const header = rows[0]!.map((cell) => cell.trim());
  const dataRows = rows.slice(1);

  if (dataRows.length === 0) {
    throw bulkUploadError([
      { row: 1, column: null, message: 'Dosyada başlık satırından başka satır yok.' },
    ]);
  }
  if (dataRows.length > MAX_CSV_ROWS) {
    throw bulkUploadError([
      {
        row: 1,
        column: null,
        message: `Tek dosyada en fazla ${MAX_CSV_ROWS} satır yüklenebilir (${dataRows.length} satır gönderildi).`,
      },
    ]);
  }

  // ── Başlık doğrulaması ──
  const indexOf = new Map<string, number>();
  header.forEach((name, position) => {
    if (!indexOf.has(name)) indexOf.set(name, position);
  });

  for (const column of REQUIRED_COLUMNS) {
    if (!indexOf.has(column)) {
      errors.push({ row: 1, column, message: `Zorunlu "${column}" sütunu eksik.` });
    }
  }
  const unknown = header.filter((name) => !(CSV_COLUMNS as readonly string[]).includes(name));
  if (unknown.length > 0) {
    errors.push({
      row: 1,
      column: null,
      message: `Tanınmayan sütun: ${unknown.join(', ')}. Beklenen sütunlar: ${CSV_COLUMNS.join(', ')}.`,
    });
  }
  // Başlık bozuksa satırları doğrulamanın anlamı yok: yüzlerce türev hata üretir.
  if (errors.length > 0) throw bulkUploadError(errors);

  // ── Satır doğrulaması ──
  const parsed: ParsedCsvRow[] = [];
  const skuFirstSeenAt = new Map<string, number>();
  const variantKeyFirstSeenAt = new Map<string, number>();

  dataRows.forEach((cells, position) => {
    const line = position + 2; // başlık 1. satır

    const raw: Record<string, string> = {};
    for (const column of CSV_COLUMNS) {
      const at = indexOf.get(column);
      if (at === undefined) continue;
      const value = cells[at];
      // Boş isteğe bağlı alanlar şemaya hiç girmesin ki `.optional()` çalışsın.
      if (value === undefined || value.trim() === '') continue;
      raw[column] = value;
    }

    const result = csvRowSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          row: line,
          column: (issue.path[0] as string | undefined) ?? null,
          message:
            issue.code === 'invalid_type' && issue.received === 'undefined'
              ? 'Bu alan zorunlu.'
              : issue.message,
        });
      }
      return;
    }

    const data = result.data;

    if (data.listPriceMinor !== undefined && data.listPriceMinor < data.priceMinor) {
      // Üstü çizili fiyat satış fiyatından düşükse vitrinde "zam" görünür;
      // sahte indirim denetiminde de sorun çıkarır.
      errors.push({
        row: line,
        column: 'listPriceMinor',
        message: 'Üstü çizili fiyat, satış fiyatından düşük olamaz.',
      });
    }

    const previousSku = skuFirstSeenAt.get(data.sku);
    if (previousSku !== undefined) {
      errors.push({
        row: line,
        column: 'sku',
        message: `"${data.sku}" bu dosyada ${previousSku}. satırda da var. SKU benzersiz olmalı.`,
      });
    } else {
      skuFirstSeenAt.set(data.sku, line);
    }

    // Aynı üründe aynı renk+beden iki kez olamaz (Variant @@unique).
    const variantKey = `${data.productRef} ${data.color.toLowerCase()} ${data.size.toLowerCase()}`;
    const previousVariant = variantKeyFirstSeenAt.get(variantKey);
    if (previousVariant !== undefined) {
      errors.push({
        row: line,
        column: 'size',
        message: `"${data.productRef}" ürününde ${data.color}/${data.size} kombinasyonu ${previousVariant}. satırda da var.`,
      });
    } else {
      variantKeyFirstSeenAt.set(variantKey, line);
    }

    parsed.push({ line, data });
  });

  if (errors.length > 0) throw bulkUploadError(errors);

  // ── Ürün bazında gruplama + tutarlılık ──
  const products = groupByProduct(parsed, errors);
  if (errors.length > 0) throw bulkUploadError(errors);

  return {
    products,
    rowCount: parsed.length,
    skus: parsed.map((row) => row.data.sku),
  };
}

/**
 * Aynı `productRef` satırları tek ürüne katlanır.
 *
 * Ürün düzeyindeki alanlar (başlık, kategori, marka, cinsiyet) satırlar arası
 * AYNI olmak zorundadır. Farklıysa "ilk satır kazanır" gibi sessiz bir kural
 * uygulanmaz: satıcı hangi başlığın yayımlandığını göremez, sonra da yanlış
 * ürünü fark etmez.
 */
function groupByProduct(rows: readonly ParsedCsvRow[], errors: BulkRowError[]): BulkProductDraft[] {
  interface Accumulator {
    first: ParsedCsvRow;
    variants: BulkVariantDraft[];
  }
  const byRef = new Map<string, Accumulator>();

  for (const row of rows) {
    const { data, line } = row;
    let entry = byRef.get(data.productRef);

    if (entry === undefined) {
      entry = { first: row, variants: [] };
      byRef.set(data.productRef, entry);
    } else {
      const head = entry.first.data;
      const mismatched: Array<[CsvColumn, string, string]> = [];
      if (head.title !== data.title) mismatched.push(['title', head.title, data.title]);
      if (head.categorySlug !== data.categorySlug)
        mismatched.push(['categorySlug', head.categorySlug, data.categorySlug]);
      if (head.brandName !== data.brandName)
        mismatched.push(['brandName', head.brandName, data.brandName]);
      if (head.gender !== data.gender) mismatched.push(['gender', head.gender, data.gender]);

      for (const [column, expected, received] of mismatched) {
        errors.push({
          row: line,
          column,
          message: `"${data.productRef}" ürününün ${column} değeri ${entry.first.line}. satırda "${expected}" iken burada "${received}". Aynı ürün kodundaki satırlarda bu alan aynı olmalı.`,
        });
      }
    }

    entry.variants.push({
      line,
      sku: data.sku,
      color: data.color,
      colorHex: data.colorHex,
      size: data.size,
      priceMinor: data.priceMinor,
      listPriceMinor: data.listPriceMinor ?? null,
      barcode: data.barcode ?? null,
      stock: data.stock,
    });
  }

  return [...byRef.values()].map(({ first, variants }) => ({
    productRef: first.data.productRef,
    title: first.data.title,
    description: first.data.description,
    categorySlug: first.data.categorySlug,
    brandName: first.data.brandName,
    gender: first.data.gender,
    variants,
  }));
}

/**
 * Hataları tek yanıtta toplar.
 *
 * Satır numarasına göre sıralanır: satıcı dosyayı yukarıdan aşağıya
 * düzeltebilsin. Yanıt boyutu sınırlanır — 2000 satırlık bozuk bir dosya
 * 6000 hata üretebilir ve yanıt işe yaramaz hâle gelir.
 */
export function bulkUploadError(errors: readonly BulkRowError[]): ReturnType<typeof appError> {
  const sorted = [...errors].sort(
    (a, b) => a.row - b.row || (a.column ?? '').localeCompare(b.column ?? ''),
  );
  const MAX_REPORTED = 200;

  return appError('BULK_UPLOAD_INVALID', {
    params: { count: sorted.length },
    details: {
      errorCount: sorted.length,
      truncated: sorted.length > MAX_REPORTED,
      errors: sorted.slice(0, MAX_REPORTED),
    },
    internalMessage: `Toplu yüklemede ${sorted.length} hata`,
  });
}
