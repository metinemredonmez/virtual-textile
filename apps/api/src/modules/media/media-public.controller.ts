import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { KNOWN_KEY_PREFIXES, visibilityForKey } from '@vt/adapters';
import { Public } from '../auth/auth.guard.js';
import { MEDIA_STORAGE } from './media.ports.js';
import type { MediaStoragePort } from './media.ports.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GENEL MEDYA SERVİSİ — nesneyi R2'nin S3 API'sinden okuyup KENDİMİZ veririz.
 *
 *  ⚠️ VARLIK SEBEBİ ÖLÇÜLMÜŞ BİR ARIZA, TASARIM TERCİHİ DEĞİL.
 *
 *  Görseller `https://pub-<hash>.r2.dev/<anahtar>` üzerinden servis ediliyordu.
 *  O ad Cloudflare'in GELİŞTİRME adresidir ve hız sınırlıdır. Ölçüm
 *  (2026-08-13, aynı makineden, aynı anahtara):
 *
 *      DNS       → 104.18.54.45 / 104.18.50.34 (+2 AAAA)   ✓ çözülüyor
 *      TCP :443  → bağlantı kuruluyor                       ✓
 *      HTTPS GET → 8 istekte 8 zaman aşımı (curl rc=28)     ✗
 *      cloudflare.com aynı anda 200                         → ağ sorunu DEĞİL
 *      R2'nin S3 ucu aynı anda 400 (imzasız GET beklenen)   → kova AYAKTA
 *
 *  Yani TCP kuruluyor, TLS EL SIKIŞMASI DÜŞÜRÜLÜYOR. Bu bir 429 değil,
 *  gövdesiz bir sessizlik; istemci tarafında "kırık görsel"den başka bir iz
 *  bırakmıyor. Ana sayfada 49 görsel var ve neredeyse hepsi böyle düşüyordu —
 *  kullanıcının gördüğü "resim yok" tam olarak buydu.
 *
 *  ⚠️ NGINX ÖNBELLEĞİ BUNU TEK BAŞINA ÇÖZMEZ. `infra/nginx/vt.conf` → `/medya/`
 *     bloğu r2.dev'i vekilliyor ve önbelleğe alıyor; ama önbelleğin ISINMASI
 *     için ilk isteğin BAŞARILI olması gerekiyor. 8/8 düştüğünde önbellek hiç
 *     dolmaz. Önbellek doğru ve kalıyor — ama üstünde güvenilir bir kaynak
 *     olmak zorunda ve bu uç o kaynak.
 *
 *  ⚠️ NEDEN S3 UCU ÇALIŞIYOR: `<hesap>.r2.cloudflarestorage.com` r2.dev'in
 *     tabi olduğu geliştirme sınırına tabi DEĞİL; seed 278 görseli oraya
 *     sorunsuz yükledi. Yani nesneler yerinde, yalnızca genel okuma adresi
 *     kullanılamaz durumda.
 *
 *  ⚠️ ALTERNATİFLER ELENDİ:
 *     · Kovaya özel alan adı bağlamak → DOĞRU nihai çözüm ama bugün alan adımız
 *       YOK (sunucuya IP ile giriliyor). Alan adı alındığında bu uç kaldırılıp
 *       `NEXT_PUBLIC_MEDIA_URL` oraya çevrilebilir; kod bunu engellemiyor.
 *     · Görselleri depoya commit etmek → 298 dosya ~35 MB; `.git` bugün 8 MB.
 *     · İmzalı URL üretmek → her görüntülemede imza demek; hem yavaş hem de
 *       önbelleklenemez (imza süreli, adres her seferinde değişir).
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Controller('media')
export class MediaPublicController {
  constructor(@Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort) {}

  /**
   * ⚠️ `*anahtar` — çok parçalı yol. Anahtarlar `products/<id>/<id>/original`
   *    biçiminde, yani eğik çizgi İÇERİR; tek parçalı bir `:anahtar` yalnızca
   *    ilk parçayı yakalar ve her istek 404 dönerdi.
   *
   * ⚠️ ÖNBELLEK BAŞLIĞI `immutable`: anahtar nesnenin kimliğidir, içerik
   *    değişirse anahtar da değişir (`storageKeys` şeması). Bu yüzden tarayıcı
   *    ve nginx için nesne SONSUZA KADAR geçerli sayılabilir.
   */
  @Get('*anahtar')
  @Public()
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async serve(@Param('anahtar') parcalar: string | string[], @Res() res: Response): Promise<void> {
    const anahtar = Array.isArray(parcalar) ? parcalar.join('/') : parcalar;

    /**
     * ⚠️ YOL KAÇIŞI KAPATILIR — AMA BU KONTROL BUGÜN İLK SAVUNMA DEĞİL.
     *    Ölçüldü: `GET /v1/media/products/../secret` buraya HİÇ GELMİYOR,
     *    Express yolu yönlendirmeden ÖNCE normalize ediyor ve istek `products/`
     *    beyaz listesine takılıp 404 dönüyor. Yani bu satır bugün ölü.
     *
     *    Yine de duruyor ve sebebi şu: ölü olması ÇATININ davranışına bağlı.
     *    Yönlendirici değişirse (Fastify adaptörü, farklı bir sürüm) normalize
     *    etmeyebilir; o gün bu kontrol tek savunma olur. Bir güvenlik kapısını
     *    "zaten üstte biri bakıyor" diye silmek, üstteki değiştiğinde sessizce
     *    açılan bir kapı bırakır.
     *
     *    Baştaki `/` de eleniyor: `//products/…` farklı bir anahtar olurdu ve
     *    önbellekte ikinci bir kopya açardı.
     */
    if (!anahtar || anahtar.includes('..') || anahtar.startsWith('/')) {
      throw new BadRequestException('Geçersiz medya anahtarı');
    }

    /**
     * ⚠️ İKİ AYRI KAPI VE İKİSİ DE GEREKLİ.
     *
     * 1) `visibilityForKey` PRIVATE derse reddet. Bu uç kimlik doğrulamıyor;
     *    kullanıcı fotoğrafı, try-on sonucu, satıcı belgesi ve KVKK dışa
     *    aktarımı buradan ASLA geçemez.
     *
     * 2) Ön ek BİLİNEN listede olmalı. Birincisi tek başına yetmez, çünkü
     *    `visibilityForKey` BİLİNMEYEN her öneki 'public' SAYAR (kendi
     *    docblock'unda yazılı). Yani yarın private bir alan açılıp o listeye
     *    yazılmayı unutursa, birinci kapı onu sessizce açardı. İkinci kapı
     *    beyaz liste olduğu için varsayılanı KAPALI yapar.
     */
    if (visibilityForKey(anahtar) !== 'public') {
      throw new NotFoundException('Medya bulunamadı');
    }
    if (!KNOWN_KEY_PREFIXES.some((onek) => anahtar.startsWith(onek))) {
      throw new NotFoundException('Medya bulunamadı');
    }

    let govde: Buffer;
    try {
      govde = await this.storage.get(anahtar, 'public');
    } catch {
      /**
       * ⚠️ HATA SEBEBİ İSTEMCİYE SIZDIRILMAZ. S3 hatası "NoSuchKey" ile
       *    "AccessDenied"i ayırt eder; ikisini farklı yanıta çevirmek kova
       *    içeriğini dışarıdan yoklamaya izin verirdi.
       */
      throw new NotFoundException('Medya bulunamadı');
    }

    /**
     * ⚠️ İÇERİK TÜRÜ ANAHTARDAN TÜRETİLİYOR, İSTEMCİDEN ALINMIYOR ve S3
     *    metadata'sına da güvenilmiyor. Ürettiğimiz her nesne webp; `original`
     *    uzantısız ama o da webp (bkz. `seed/gorsel.ts`, `media-product.service`).
     */
    res.setHeader('Content-Type', anahtar.endsWith('.jpg') ? 'image/jpeg' : 'image/webp');
    res.setHeader('Content-Length', String(govde.byteLength));
    res.end(govde);
  }
}
