/**
 * GÖRSEL ADRESİ.
 *
 * API `imageKey`/`storageKey` gönderiyor, tam adres DEĞİL: kova adresi
 * değiştiğinde veritabanındaki yüz binlerce satırın güncellenmesi gerekmesin
 * diye. Kökü frontend ekler.
 *
 * ⚠️ Ürün görselleri GENEL kovadan servis ediliyor, imza gerekmiyor
 *    (`SIGNED_URL_TTL_SECONDS` yorumu). Kullanıcı fotoğrafı ve try-on sonucu
 *    BÖYLE DEĞİL: onlar imzalı URL ile gelir, ömürleri 300/900 saniyedir ve bu
 *    fonksiyondan GEÇMEZ — API'nin verdiği `resultUrl` doğrudan kullanılır.
 */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_URL ?? '').replace(/\/+$/, '');

export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith('http://') || key.startsWith('https://')) return key;
  if (!MEDIA_BASE) return null;
  return `${MEDIA_BASE}/${key.replace(/^\/+/, '')}`;
}
