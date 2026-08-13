import type { StylistEventWire } from '@vt/contracts';

/**
 * SSE ÇÖZÜCÜ — `text/event-stream` parçalarından olay üretir.
 *
 * ⚠️ `EventSource` KULLANILAMAZ ve bu bir tercih değil: tarayıcı API'si yalnız
 *    `GET` atar, gövde ve `Idempotency-Key` taşımaz. Danışman mesajı bir
 *    `POST`; akış `fetch` + `ReadableStream` ile okunuyor, yani çerçeveleri
 *    ayrıştırmak İSTEMCİNİN işi.
 *
 * ⚠️ AĞ PARÇASI ≠ SSE ÇERÇEVESİ. `ReadableStream` isteğe bağlı yerlerden
 *    böler: tek bir `read()` yarım bir `data:` satırı verebilir, ya da üç
 *    çerçeveyi birden. Bu yüzden tampon SINIFTA tutuluyor ve yalnızca TAM
 *    çerçeveler (`\n\n` ile biten) çözülüyor. Parçayı olduğu gibi
 *    `JSON.parse`a vermek, uzun bir yanıtın ortasında sessizce kopan bir
 *    sohbet üretirdi — ve kopma yalnız uzun yanıtlarda görüneceği için testte
 *    hiç çıkmazdı.
 *
 * ⚠️ `\r\n` DE KABUL EDİLİYOR: SSE belirtimi üç satır sonu biçimine de izin
 *    veriyor ve arada bir ters vekil varsa satır sonu değişebilir.
 *
 * ⚠️ TANINMAYAN OLAY SESSİZCE ATILIR, patlamaz. Sunucu yeni bir olay tipi
 *    yayınladığında ekranın çökmesi, eski istemcileri kullanılamaz yapardı.
 *    Bunun bedeli `wire/stylist.ts` başlığında yazılı: iki kopya union
 *    olduğu sürece yeni tip istemcide sessizce yok sayılır.
 */
export class AkisCozucu {
  private tampon = '';

  /** Ağdan gelen ham metin parçasını yutar, çözülen TAM olayları döndürür. */
  yut(parca: string): StylistEventWire[] {
    this.tampon += parca.replace(/\r\n/g, '\n');
    const olaylar: StylistEventWire[] = [];

    let sinir = this.tampon.indexOf('\n\n');
    while (sinir !== -1) {
      const cerceve = this.tampon.slice(0, sinir);
      this.tampon = this.tampon.slice(sinir + 2);

      const olay = cerceveyiCoz(cerceve);
      if (olay) olaylar.push(olay);

      sinir = this.tampon.indexOf('\n\n');
    }

    return olaylar;
  }
}

/** Bilinen olay adları — `wire/stylist.ts` union'ının `type` alanları. */
const OLAY_ADLARI = ['start', 'delta', 'tool', 'action', 'done', 'error'] as const;

function olayAdiMi(deger: string): deger is StylistEventWire['type'] {
  return (OLAY_ADLARI as readonly string[]).includes(deger);
}

function cerceveyiCoz(cerceve: string): StylistEventWire | null {
  let ad: string | null = null;
  const veriSatirlari: string[] = [];

  for (const satir of cerceve.split('\n')) {
    // ⚠️ `:` ile başlayan satır SSE yorumudur (canlı tutma darbesi); atlanmazsa
    //    `JSON.parse` patlar.
    if (satir.startsWith(':')) continue;
    if (satir.startsWith('event:')) ad = satir.slice('event:'.length).trim();
    // ⚠️ Çok satırlı `data:` alanları BİRLEŞTİRİLİR (belirtim `\n` ile
    //    birleştirmeyi söylüyor). Yalnız ilkini almak, içinde satır sonu olan
    //    bir yanıtı yarıda keserdi.
    else if (satir.startsWith('data:')) veriSatirlari.push(satir.slice('data:'.length).trimStart());
  }

  if (ad === null || !olayAdiMi(ad) || veriSatirlari.length === 0) return null;

  try {
    const data: unknown = JSON.parse(veriSatirlari.join('\n'));
    return { type: ad, data } as StylistEventWire;
  } catch {
    return null;
  }
}

/**
 * ARAÇ ADI → KULLANICININ OKUYACAĞI CÜMLE.
 *
 * ⚠️ `Record` tam DEĞİL, `?? varsayılan` var: araç listesi sunucuda
 *    (`stylist.tools.ts`) ve orada yeni bir araç eklendiğinde istemci
 *    derlenmiyor bile — tel üstünden gelen ad düz bir `string`. Eksik ad
 *    "Bilgi getiriliyor…" olur; İNGİLİZCE ARAÇ ADI EKRANA BASILMAZ.
 */
const ARAC_METINLERI: Record<string, string> = {
  search_products: 'Ürünler aranıyor',
  get_product_details: 'Ürün ayrıntıları getiriliyor',
  get_user_profile: 'Beden ve tercihleriniz okunuyor',
  check_outfit_compatibility: 'Kombin uyumu değerlendiriliyor',
  apply_to_tryon: 'Sanal deneme hazırlanıyor',
  add_outfit_to_cart: 'Kombin sepete ekleniyor',
};

export function aracMetni(ad: string): string {
  return ARAC_METINLERI[ad] ?? 'Bilgi getiriliyor';
}
