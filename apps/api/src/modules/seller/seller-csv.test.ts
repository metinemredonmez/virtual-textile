import { describe, expect, it } from 'vitest';
import { AppError } from '@vt/contracts';
import { MAX_CSV_ROWS, parseBulkUpload, parseCsv, type BulkRowError } from './seller-csv.js';

const HEADER =
  'productRef,title,description,categorySlug,brandName,gender,sku,color,colorHex,size,priceMinor,listPriceMinor,barcode,stock';

const line = (over: Partial<Record<string, string>> = {}): string => {
  const base: Record<string, string> = {
    productRef: 'P-1',
    title: 'Oversize Pamuklu Gömlek',
    description: 'Rahat kesim',
    categorySlug: 'kadin-gomlek',
    brandName: 'Vertex',
    gender: 'WOMAN',
    sku: 'VTX-001-S',
    color: 'Siyah',
    colorHex: '#111111',
    size: 'S',
    priceMinor: '14990',
    listPriceMinor: '19990',
    barcode: '8690000000001',
    stock: '12',
    ...over,
  };
  // Alanlar tırnaklanır: aksi hâlde "149,90" gibi bir değer satırı kaydırır ve
  // test, ölçmek istediği doğrulama hatası yerine sütun kaymasını ölçerdi.
  return [
    base.productRef,
    base.title,
    base.description,
    base.categorySlug,
    base.brandName,
    base.gender,
    base.sku,
    base.color,
    base.colorHex,
    base.size,
    base.priceMinor,
    base.listPriceMinor,
    base.barcode,
    base.stock,
  ]
    .map((value) => `"${(value ?? '').replace(/"/g, '""')}"`)
    .join(',');
};

const errorsOf = (run: () => unknown): BulkRowError[] => {
  try {
    run();
    expect.unreachable('BULK_UPLOAD_INVALID bekleniyordu');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('BULK_UPLOAD_INVALID');
    const details = (error as AppError).details as { errors: BulkRowError[] };
    return details.errors;
  }
};

describe('parseCsv', () => {
  it('tırnaklı alandaki virgül satırı kaydırmaz', () => {
    const rows = parseCsv('a,b\n"kırmızı, bordo",2');
    expect(rows[1]).toEqual(['kırmızı, bordo', '2']);
  });

  it('kaçırılmış tırnağı ("") tek tırnağa çevirir', () => {
    expect(parseCsv('a\n"15"" ekran"')[1]).toEqual(['15" ekran']);
  });

  it('alan içindeki satır sonunu korur', () => {
    expect(parseCsv('a,b\n"iki\nsatır",x')[1]).toEqual(['iki\nsatır', 'x']);
  });

  it('CRLF ve BOM ile başa çıkar', () => {
    const rows = parseCsv('﻿a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('dosya sonundaki boş satırı satır saymaz', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toHaveLength(2);
  });
});

describe('parseBulkUpload — geçerli dosya', () => {
  it('satırları ürün bazında gruplar', () => {
    const csv = [
      HEADER,
      line({ sku: 'VTX-001-S', size: 'S' }),
      line({ sku: 'VTX-001-M', size: 'M', stock: '4' }),
      line({ productRef: 'P-2', title: 'Keten Pantolon', sku: 'VTX-002-M', size: 'M' }),
    ].join('\n');

    const result = parseBulkUpload(csv);

    expect(result.rowCount).toBe(3);
    expect(result.products).toHaveLength(2);
    expect(result.products[0]?.variants).toHaveLength(2);
    expect(result.products[0]?.variants[1]?.stock).toBe(4);
    expect(result.skus).toEqual(['VTX-001-S', 'VTX-001-M', 'VTX-002-M']);
  });

  it('para alanları bigint kuruş olarak taşınır', () => {
    const result = parseBulkUpload([HEADER, line()].join('\n'));
    const variant = result.products[0]!.variants[0]!;

    expect(variant.priceMinor).toBe(14_990n);
    expect(variant.listPriceMinor).toBe(19_990n);
    // Float'a çevrilmediğinin kanıtı: tip bigint.
    expect(typeof variant.priceMinor).toBe('bigint');
  });

  it('isteğe bağlı alanlar boş bırakılabilir', () => {
    const csv = [HEADER, line({ listPriceMinor: '', barcode: '', description: '' })].join('\n');
    const variant = parseBulkUpload(csv).products[0]!.variants[0]!;

    expect(variant.listPriceMinor).toBeNull();
    expect(variant.barcode).toBeNull();
  });

  it('sütun sırası değişebilir — başlıktan eşlenir', () => {
    const csv = [
      'sku,priceMinor,stock,productRef,title,categorySlug,brandName,gender,color,colorHex,size',
      'VTX-9,9990,3,P-9,Basic Tişört,kadin-tisort,Vertex,WOMAN,Bej,#EEDDCC,L',
    ].join('\n');

    const result = parseBulkUpload(csv);
    expect(result.products[0]?.variants[0]?.priceMinor).toBe(9_990n);
  });
});

describe('parseBulkUpload — kısmi başarı olmaz', () => {
  it('tek hatalı satır tüm dosyayı reddeder', () => {
    const csv = [
      HEADER,
      line({ sku: 'A-1', size: 'S' }),
      line({ sku: 'A-2', size: 'M', priceMinor: '149,90' }),
      line({ sku: 'A-3', size: 'L' }),
    ].join('\n');

    const errors = errorsOf(() => parseBulkUpload(csv));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 3, column: 'priceMinor' });
  });

  it('hatalar satır numarasıyla ve toplu döner', () => {
    const csv = [
      HEADER,
      line({ sku: 'A-1', size: 'S', gender: 'KADIN' }),
      line({ sku: 'A-2', size: 'M', colorHex: 'siyah' }),
      line({ sku: 'A-3', size: 'L', stock: '-4' }),
    ].join('\n');

    const errors = errorsOf(() => parseBulkUpload(csv));

    expect(errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(errors.map((e) => e.column)).toEqual(['gender', 'colorHex', 'stock']);
  });

  it('hata sayısı kullanıcı mesajına yansır', () => {
    const csv = [
      HEADER,
      line({ sku: 'AAA-1', priceMinor: 'x' }),
      line({ sku: 'AAA-2', priceMinor: 'y' }),
    ].join('\n');

    try {
      parseBulkUpload(csv);
      expect.unreachable('hata bekleniyordu');
    } catch (error) {
      expect((error as AppError).userMessage).toContain('2 satırda');
    }
  });
});

describe('parseBulkUpload — başlık hataları', () => {
  it('eksik zorunlu sütun bildirilir', () => {
    const errors = errorsOf(() => parseBulkUpload('sku,priceMinor\nA-1,100'));

    expect(errors.every((e) => e.row === 1)).toBe(true);
    expect(errors.map((e) => e.column)).toContain('productRef');
    expect(errors.map((e) => e.column)).toContain('stock');
  });

  it('tanınmayan sütun bildirilir', () => {
    const errors = errorsOf(() => parseBulkUpload(`${HEADER},fiyat\n${line()},1`));
    expect(errors.some((e) => e.message.includes('fiyat'))).toBe(true);
  });

  it('başlık bozuksa satır hataları üretilmez — türev gürültü olmasın', () => {
    const errors = errorsOf(() => parseBulkUpload('sku\nA-1\nA-2\nA-3'));
    expect(errors.every((e) => e.row === 1)).toBe(true);
  });

  it('boş dosya reddedilir', () => {
    expect(errorsOf(() => parseBulkUpload(''))[0]?.message).toContain('boş');
  });

  it('yalnızca başlık içeren dosya reddedilir', () => {
    expect(errorsOf(() => parseBulkUpload(HEADER))[0]?.message).toContain('başka satır yok');
  });

  it('satır sınırı aşılırsa reddedilir', () => {
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) =>
      line({ sku: `S-${index}`, size: String(index) }),
    );
    const errors = errorsOf(() => parseBulkUpload([HEADER, ...rows].join('\n')));
    expect(errors[0]?.message).toContain(String(MAX_CSV_ROWS));
  });
});

describe('parseBulkUpload — dosya içi tutarlılık', () => {
  it('mükerrer SKU ilk görüldüğü satırla birlikte bildirilir', () => {
    const csv = [HEADER, line({ sku: 'DUP', size: 'S' }), line({ sku: 'DUP', size: 'M' })].join(
      '\n',
    );

    const errors = errorsOf(() => parseBulkUpload(csv));

    expect(errors[0]).toMatchObject({ row: 3, column: 'sku' });
    expect(errors[0]?.message).toContain('2. satırda');
  });

  it('aynı üründe mükerrer renk/beden reddedilir', () => {
    const csv = [
      HEADER,
      line({ sku: 'A-1', color: 'Siyah', size: 'M' }),
      line({ sku: 'A-2', color: 'Siyah', size: 'M' }),
    ].join('\n');

    const errors = errorsOf(() => parseBulkUpload(csv));
    expect(errors[0]).toMatchObject({ row: 3, column: 'size' });
  });

  it('aynı ürün kodunda farklı başlık sessizce kabul edilmez', () => {
    const csv = [
      HEADER,
      line({ sku: 'A-1', size: 'S' }),
      line({ sku: 'A-2', size: 'M', title: 'Bambaşka Bir Ürün' }),
    ].join('\n');

    const errors = errorsOf(() => parseBulkUpload(csv));

    expect(errors[0]).toMatchObject({ row: 3, column: 'title' });
    expect(errors[0]?.message).toContain('Bambaşka Bir Ürün');
  });

  it('üstü çizili fiyat satış fiyatının altında olamaz', () => {
    const csv = [HEADER, line({ priceMinor: '20000', listPriceMinor: '10000' })].join('\n');

    const errors = errorsOf(() => parseBulkUpload(csv));
    expect(errors[0]).toMatchObject({ row: 2, column: 'listPriceMinor' });
  });

  it('farklı ürün kodları aynı başlığı paylaşabilir', () => {
    const csv = [
      HEADER,
      line({ productRef: 'P-1', sku: 'A-1' }),
      line({ productRef: 'P-2', sku: 'A-2' }),
    ].join('\n');

    expect(parseBulkUpload(csv).products).toHaveLength(2);
  });
});
