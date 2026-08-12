/**
 * VERİ İNDİRME (KVKK md.11) — SAF ÇEKİRDEK
 *
 * ⚠️ SENKRON ÇALIŞMAZ. Kullanıcının siparişleri, adresleri, sepetleri, rıza
 *    geçmişi ve sanal deneme kayıtları toplanır, arşivlenir ve depoya yazılır;
 *    bu iş saniyeler değil dakikalar sürebilir. HTTP isteği içinde yapılsaydı
 *    bağlantı zaman aşımına uğrar, iş yarıda kalır ve kullanıcı hiçbir zaman
 *    dosyayı alamazdı. Uç yalnızca TALEBİ kaydeder ve 202 döner; hazırlığı
 *    worker yapar, bağlantı kullanıcıya gönderilir.
 *
 * ⚠️ Bağlantı SÜRELİDİR. Arşiv kullanıcının tüm kişisel verisini tek dosyada
 *    taşır: e-postası ele geçen biri, süresiz bir bağlantıyla aylar sonra bile
 *    her şeyi indirebilirdi.
 */

/** İndirme bağlantısının geçerlilik süresi. */
export const DATA_EXPORT_LINK_HOURS = 48;

/**
 * Bekleme süresi AYRI BİR SABİT DEĞİLDİR: yeni talep, öncekinin bağlantısı
 * ölene kadar açılmaz (bkz. `canRequestDataExport`). Hazırlık pahalıdır (tüm
 * tabloların taranması + arşivleme); ikinci bir sayı tanımlansaydı, düğmeye üst
 * üste basan bir kullanıcı iki sabit arasındaki boşlukta worker kuyruğunu tek
 * başına doldurabilirdi.
 */

const HOUR_MS = 60 * 60 * 1000;

export function dataExportLinkExpiresAt(
  requestedAt: Date,
  hours: number = DATA_EXPORT_LINK_HOURS,
): Date {
  return new Date(requestedAt.getTime() + hours * HOUR_MS);
}

export type DataExportStatus = 'NONE' | 'PREPARING' | 'READY' | 'EXPIRED';

export interface DataExportSnapshot {
  status: DataExportStatus;
  requestedAt: Date | null;
  /** Worker arşivi hazırlayıp olayı yayımladığı an. */
  preparedAt: Date | null;
  linkExpiresAt: Date | null;
}

/**
 * Kaydedilmiş talebin kullanıcıya gösterilecek durumu.
 *
 * `publishedAt` outbox kaydının worker tarafından alındığı andır; hazırlığın
 * BİTTİĞİ an değildir ama elimizdeki tek ilerleme sinyalidir (bkz. modül
 * raporundaki `DataExportRequest` tablosu notu).
 */
export function describeDataExport(
  request: { requestedAt: Date; publishedAt: Date | null } | null,
  now: Date,
): DataExportSnapshot {
  if (!request) {
    return { status: 'NONE', requestedAt: null, preparedAt: null, linkExpiresAt: null };
  }

  const linkExpiresAt = dataExportLinkExpiresAt(request.requestedAt);

  if (linkExpiresAt.getTime() <= now.getTime()) {
    return {
      status: 'EXPIRED',
      requestedAt: request.requestedAt,
      preparedAt: request.publishedAt,
      linkExpiresAt,
    };
  }

  return {
    status: request.publishedAt ? 'READY' : 'PREPARING',
    requestedAt: request.requestedAt,
    preparedAt: request.publishedAt,
    linkExpiresAt,
  };
}

/**
 * Yeni talep açılabilir mi?
 *
 * ⚠️ Süresi dolmuş bir talep yeni talebi ENGELLEMEZ: bağlantısı ölmüş bir
 *    arşiv, kullanıcının hakkını kullanmasını sonsuza kadar bloke edemez.
 */
export function canRequestDataExport(
  latest: { requestedAt: Date; publishedAt: Date | null } | null,
  now: Date,
): boolean {
  const status = describeDataExport(latest, now).status;
  return status === 'NONE' || status === 'EXPIRED';
}
