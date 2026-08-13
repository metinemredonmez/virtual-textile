import type { PackageStatusWire } from '@vt/contracts';
import { SUZGEC_SIRASI } from './etiketler';

/**
 * LİSTE SORGUSU — ekranın tüm durumu URL'dedir.
 *
 * Kalıp `(magaza)/products/_liste/liste-sorgusu.ts` ile aynı ve bu bir tercih
 * değil: liste bir Sunucu Bileşeni, elde tutulan bir istemci durumu yok.
 * Süzgeç bağlantıyla değişir, tarayıcı geri tuşu çalışır, satıcı "gecikmiş
 * siparişler" görünümünü kendine kaydedebilir.
 *
 * ⚠️ Değerler API'ye GİTMEDEN önce burada süzülür. Bilinmeyen bir `durum`
 *    değeri sorguya konsaydı API 400 döndürür ve ekran, kullanıcının
 *    düzeltemeyeceği bir doğrulama hatası gösterirdi.
 */
export interface SiparisSorgusu {
  durum: PackageStatusWire | null;
  /** Yalnızca SLA süresi geçmiş paketler. */
  gecikmis: boolean;
  siparisNo: string | null;
  imlec: string | null;
}

export interface AramaParametreleri {
  durum?: string;
  gecikmis?: string;
  siparisNo?: string;
  imlec?: string;
}

function durumOku(ham: string | undefined): PackageStatusWire | null {
  if (!ham) return null;
  return SUZGEC_SIRASI.find((durum) => durum === ham) ?? null;
}

export function sorguyuOku(params: AramaParametreleri): SiparisSorgusu {
  return {
    durum: durumOku(params.durum),
    gecikmis: params.gecikmis === '1',
    // `orderNumber` sunucuda TAM EŞLEŞME arıyor (`where: { order: { orderNumber } }`),
    // parçalı arama değil; boşluk kırpılmazsa satıcı kopyaladığı numarayla
    // hiçbir sonuç bulamaz.
    siparisNo: params.siparisNo?.trim() || null,
    imlec: params.imlec ?? null,
  };
}

/** Süzgeç bağlantısı üretir; imleç BİLEREK taşınmaz (yeni süzgeç, yeni sayfa 1). */
export function suzgecYolu(
  sorgu: SiparisSorgusu,
  degisiklik: Partial<Omit<SiparisSorgusu, 'imlec'>>,
): string {
  const sonraki = { ...sorgu, ...degisiklik };
  const arama = new URLSearchParams();
  if (sonraki.durum) arama.set('durum', sonraki.durum);
  if (sonraki.gecikmis) arama.set('gecikmis', '1');
  if (sonraki.siparisNo) arama.set('siparisNo', sonraki.siparisNo);
  const qs = arama.toString();
  return qs ? `/seller/orders?${qs}` : '/seller/orders';
}

/** Sonraki sayfa bağlantısı — süzgeçler KORUNUR, imleç eklenir. */
export function imlecYolu(sorgu: SiparisSorgusu, imlec: string): string {
  const temel = suzgecYolu(sorgu, {});
  const ayrac = temel.includes('?') ? '&' : '?';
  return `${temel}${ayrac}imlec=${encodeURIComponent(imlec)}`;
}

/** Son tarihe bu saatten az kaldıysa satıcı uyarılır. */
export const SLA_UYARI_SAATI = 6;
