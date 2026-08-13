/**
 * ORTAM KAPISI — seed'in çalışmasına izin verilen tek yer geliştirme/CI'dır.
 *
 * ⚠️ NEDEN ÜRETİMDE ASLA: bu seed `finance_ledger_entries`e SALE/COMMISSION
 *    satırları yazıyor ve ledger APPEND-ONLY. Üretimde bir kez koşarsa sahte
 *    finansal kayıtlar GERİ ALINAMAZ; satıcı bakiyesi `SUM(amount_minor)` ile
 *    hesaplandığı için gerçek hakedişler de bozulur. Ayrıca sahte satıcının
 *    `ibanEnc` değeri `demo:not-encrypted`; payout akışı onu çözmeye
 *    çalıştığında patlar.
 *
 * ⚠️ "DEMO MODU BAYRAĞI" DA EKLENMEZ. Bayrak "üretimde demo veri ne zaman
 *    doğru olur?" sorusunu açık bırakır ve o soru bir gün "sadece bir kez,
 *    canlıyı göstermek için" diye cevaplanır.
 *
 * ⚠️ ÖNCEKİ KORUMADAKİ DELİK: eski seed yalnızca `process.env.NODE_ENV`e
 *    bakıyordu. `pnpm db:seed` env'i `dotenv -e ../../.env` ile yüklüyor;
 *    sunucuda yetkili env dosyası `/etc/virtual-textile/api.env` ve kök `.env`
 *    orada olmayabilir — o durumda `NODE_ENV` TANIMSIZ kalır ve tek şartlı
 *    nöbetçi geçer. Bu yüzden şartlar ÇOKLANDI ve hepsi birden sağlanmalı.
 */

export interface OrtamRaporu {
  readonly nodeEnv: string;
  readonly veritabaniHost: string;
  readonly appUrl: string | null;
}

function hostCoz(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const YEREL_HOSTLAR = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Üç bağımsız şart. Üçü de "burası bir geliştirici makinesi / CI konteyneri"
 * demeli; biri bile aksini söylerse seed hiç başlamaz.
 */
export function ortamKapisi(): OrtamRaporu {
  const nodeEnv = process.env['NODE_ENV'] ?? '(tanımsız)';
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  const appUrl = process.env['APP_URL'] ?? null;

  if (nodeEnv === 'production') {
    throw new Error('Seed üretim ortamında çalıştırılamaz (NODE_ENV=production).');
  }

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL tanımlı değil. Seed env dosyasını kendisi yüklemez: `pnpm db:seed` kullanın.',
    );
  }

  const veritabaniHost = hostCoz(databaseUrl);
  if (!YEREL_HOSTLAR.has(veritabaniHost)) {
    throw new Error(
      `Seed yalnızca yerel veritabanında çalışır. DATABASE_URL host'u: "${veritabaniHost}". ` +
        "Uzak bir veritabanına demo veri yazmak ledger'ı geri alınamaz biçimde kirletir.",
    );
  }

  // APP_URL yoksa (CI seed adımında yok) bu şart atlanır; varsa yerel olmalı.
  if (appUrl !== null && appUrl !== '' && !YEREL_HOSTLAR.has(hostCoz(appUrl))) {
    throw new Error(
      `Seed yalnızca yerel kurulumda çalışır. APP_URL: "${appUrl}" yerel bir adres değil.`,
    );
  }

  return { nodeEnv, veritabaniHost, appUrl };
}
