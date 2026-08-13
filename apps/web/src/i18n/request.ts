import { getRequestConfig } from 'next-intl/server';
import { istekYapilandirmasi } from './yapilandirma';

/**
 * next-intl İSTEK YAPILANDIRMASI — sunucu tarafındaki tek giriş noktası.
 *
 * ⚠️ BU DOSYA BİLEREK ÜÇ SATIR. Karar ve gerekçelerin TAMAMI
 *    `./yapilandirma.ts` içinde ve orada `environment: 'node'` altında test
 *    ediliyor (`yapilandirma.test.ts`). Sebep: `next-intl/server` bir RSC
 *    yapısı ve vitest'in node ortamında yüklenemiyor — koşulsuz hâlde
 *    "`getRequestConfig` is not supported in Client Components", `react-server`
 *    koşulu açıldığında bu kez React'in kendisi fırlatıyor ve tüm `web`
 *    projesinin çözümü bozuluyor.
 *
 * ⚠️ BURAYA MANTIK EKLEMEYİN. Eklenen her satır ölçülemez bölgeye düşer, ve bu
 *    dosya tam olarak öyle bir satır yüzünden yazıldı: ölçüm amacıyla konan
 *    `localeCoz('en')` yerinde unutuldu, `<html lang="en">` çıktı, TÜM arayüz
 *    İngilizce çizildi — `tsc` temiz, `next build` temiz, 1373 test yeşil.
 *    `muzakere.ts`in `proxy.ts`ten ayrılması da aynı gerekçeyle yapıldı.
 *
 * ⚠️ `cookies()` BURADA DA ÇAĞRILMAZ. Çağrılsaydı bu yapılandırmayı kullanan
 *    HER sayfa dinamikleşir (ölçüldü: 53 rotanın 53'ü `ƒ`) ve `legal/[belge]`
 *    404 kapısı sessizce düşerdi. Gerekçe `yapilandirma.ts` → `aktifLocale`.
 */
export default getRequestConfig(async () => istekYapilandirmasi());
