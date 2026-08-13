'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { MEDIA } from '@vt/config/constants';
import {
  isApiFailure,
  type AdminSiteImageWire,
  type Locale,
  type SiteImageSlotWire,
  type UploadTicketWire,
} from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { useImzaliYukleme } from '@/lib/media/use-imzali-yukleme';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldMessage } from '@/components/hata/alan-hatalari';
import { SLOT_HEDEFI } from './_lib/tipler';

/**
 * AFİŞ / KAPAK YÜKLEME — ÜÇ ADIM, ORTADAKİ ADIM VEKİLDEN GEÇMEZ.
 *
 *   1. `POST /admin/site-images`             → imzalı bilet (vekilden)
 *   2. `PUT <uploadUrl>`                     → DOĞRUDAN R2 (ÖZEL kovaya)
 *   3. `POST /admin/site-images/:id/confirm` → satır + türevler (vekilden)
 *
 * ⚠️ SIFIRDAN BİR AKIŞ YAZILMADI: ürün görselinin imzalı yükleme akışı zaten
 *    vardı, adımlar `@/lib/media/use-imzali-yukleme` kancasına çıkarıldı ve bu
 *    ekran onun üstüne ince bir form yazıyor. `GorselYukleme` bileşeninin
 *    KENDİSİ ELLENMEDİ — üç çalışan çağıranı var.
 *
 * ⚠️ HAM DOSYA GENEL KOVAYA İNMEZ, ÖZEL KOVAYA İNER. Nihai afiş nesnesi
 *    `site/…` altında GENELDİR (site afişi sır değildir), ama YÜKLEME hedefi
 *    `staging/site/<id>` yani özeldir: ham dosya EXIF/GPS taşır ve biz
 *    temizleyene kadar CDN'den indirilebilir olmamalı. Sanitize → türev →
 *    genel kova → staging `discard` sırası sunucuda.
 *
 * ⚠️ BU ADIM BUGÜN TARAYICIDA ÇALIŞMIYOR OLABİLİR — GİZLENMİYOR.
 *    `infra/R2-CORS.md` (ölçüm): özel kovada CORS tanımlı değil, ön uçuş
 *    `OPTIONS` → 403, aynı adrese `curl PUT` → 200. Kova ayarı yapılıp
 *    `OPTIONS` 204 dönene kadar hiçbir tarayıcı yüklemesi tamamlanamaz. Hata
 *    metni bunu AÇIKÇA söylüyor (`medyaYukleme.depoEngellendi`), yoksa
 *    yönetici aynı dosyayı beş kez dener.
 *
 * ⚠️ IDEMPOTENCY ANAHTARI KANCADA ve KULLANICI NİYETİ BAŞINA BİR KEZ üretiliyor;
 *    onay adımı satır yaratıyor. Bilet adımında anahtar YOK ve olmamalı — o
 *    çağrı DB'ye yazmıyor (uç da `@Idempotent` taşımıyor).
 */
export interface HedefSecenegi {
  deger: string;
  etiket: string;
}

export function AfisYukle({
  slot,
  kategoriSecenekleri,
  koleksiyonSecenekleri,
  kategoriOkunamadi,
}: {
  slot: SiteImageSlotWire;
  kategoriSecenekleri: readonly HedefSecenegi[];
  koleksiyonSecenekleri: readonly HedefSecenegi[];
  /** Kategori listesi okunamadıysa form yine çizilir, hedef seçilemez. */
  kategoriOkunamadi: boolean;
}): React.ReactElement {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations('siteGorselleri');

  const [acik, setAcik] = React.useState(false);
  const [dosya, setDosya] = React.useState<File | null>(null);
  const [hedef, setHedef] = React.useState('');
  const [baslik, setBaslik] = React.useState('');
  const [altBaslik, setAltBaslik] = React.useState('');
  const [bagAdresi, setBagAdresi] = React.useState('');
  const [sira, setSira] = React.useState('0');

  const hedefTuru = SLOT_HEDEFI[slot];
  const secenekler = hedefTuru === 'kategori' ? kategoriSecenekleri : koleksiyonSecenekleri;
  const yuzey = t(`slot.${slot}`);

  const yukleme = useImzaliYukleme<AdminSiteImageWire>({
    bileti: async (secilen) => {
      const bilet = await apiFetch<UploadTicketWire, '/admin/site-images'>('/admin/site-images', {
        method: 'POST',
        json: {
          slot,
          targetKey: hedefTuru === 'yok' ? null : hedef,
          contentType: secilen.type,
          sizeBytes: secilen.size,
        },
      });
      return bilet.data;
    },
    onayla: async (siteImageId, anahtar) => {
      /**
       * ⚠️ `slot` ve `targetKey` ONAYDA TEKRAR GÖNDERİLİYOR ve bu bir kopya
       *    değil, zorunluluk: bilet adımı VERİTABANINA YAZMIYOR (yarım kalan
       *    yükleme veri bırakmasın diye), yani sunucunun hatırladığı bir taslak
       *    yok. Ürün görselinin `angle`ı da aynı sebeple onayda tekrar gidiyor.
       *
       * ⚠️ `isActive` GÖNDERİLMİYOR — şemada YOK. Yeni görsel PASİF doğar;
       *    yayına almak ayrı ve bilinçli bir adım. Onayda açılabilseydi yanlış
       *    kırpılmış bir deneme doğrudan vitrine düşerdi.
       */
      const onay = await apiFetch<AdminSiteImageWire, `/admin/site-images/${string}/confirm`>(
        `/admin/site-images/${siteImageId}/confirm`,
        {
          method: 'POST',
          json: {
            slot,
            targetKey: hedefTuru === 'yok' ? null : hedef,
            title: baslik.trim() === '' ? null : baslik.trim(),
            subtitle: altBaslik.trim() === '' ? null : altBaslik.trim(),
            linkHref: bagAdresi.trim() === '' ? null : bagAdresi.trim(),
            sortOrder: Number.parseInt(sira, 10) || 0,
          },
          idempotencyKey: anahtar,
        },
      );
      return onay.data;
    },
  });

  const hedefEksik = hedefTuru !== 'yok' && hedef === '';
  const alanHatalari = isApiFailure(yukleme.hata) ? yukleme.hata.fields : [];

  async function gonder(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    await yukleme.calistir(dosya);
    // ⚠️ BAŞARIDA TEK ŞEY `router.refresh()`. Yerel state'e satır eklemek ekranı
    //    sunucudan okunan gerçekle ayrıştırırdı: türevler, blurhash ve ölçüler
    //    onay yanıtında SUNUCUDA hesaplanıyor.
    router.refresh();
  }

  if (!acik) {
    return (
      <div>
        <Button size="sm" variant="ikincil" onClick={() => setAcik(true)}>
          {t('yukle.dugme', { yuzey })}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(olay) => void gonder(olay)}
      className="flex flex-col gap-3 rounded-md border border-kenar bg-yuzey p-4"
    >
      <p className="text-sm font-medium text-metin">{t('yukle.formBasligi', { yuzey })}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t('yukle.dosya')}
          <input
            type="file"
            accept={MEDIA.allowedMimeTypes.join(',')}
            onChange={(olay) => setDosya(olay.target.files?.[0] ?? null)}
            className="text-sm text-metin"
          />
          <span className="text-xs text-metin-soluk">
            {t('yukle.dosyaIpucu', {
              mb: String(Math.floor(MEDIA.maxUploadBytes / (1024 * 1024))),
            })}
          </span>
        </label>

        {hedefTuru !== 'yok' ? (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            {hedefTuru === 'kategori' ? t('yukle.kategori') : t('yukle.koleksiyon')}
            <select
              value={hedef}
              onChange={(olay) => setHedef(olay.target.value)}
              required
              className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
            >
              <option value="">{t('yukle.secin')}</option>
              {secenekler.map((secenek) => (
                <option key={secenek.deger} value={secenek.deger}>
                  {secenek.etiket}
                </option>
              ))}
            </select>
            {kategoriOkunamadi ? (
              <span className="text-xs text-tehlike">{t('kategoriOkunamadi')}</span>
            ) : (
              <span className="text-xs text-metin-soluk">
                {hedefTuru === 'kategori' ? t('yukle.kategoriIpucu') : t('yukle.koleksiyonIpucu')}
              </span>
            )}
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          {t('alan.baslik')} <span className="text-metin-soluk">{t('alan.istegeBagli')}</span>
          <input
            value={baslik}
            onChange={(olay) => setBaslik(olay.target.value)}
            maxLength={200}
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('alan.altBaslik')} <span className="text-metin-soluk">{t('alan.istegeBagli')}</span>
          <input
            value={altBaslik}
            onChange={(olay) => setAltBaslik(olay.target.value)}
            maxLength={200}
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('alan.bagAdresi')} <span className="text-metin-soluk">{t('alan.istegeBagli')}</span>
          <input
            value={bagAdresi}
            onChange={(olay) => setBagAdresi(olay.target.value)}
            maxLength={500}
            /*
              ⚠️ DESEN `/.*` DEĞİL: `//evil.com` tek eğik çizgi kontrolünü geçer
                 ama tarayıcı onu PROTOKOL-GÖRELİ MUTLAK adres olarak çözer —
                 yani vitrinin en büyük tıklanabilir alanı dış bir siteye bakar
                 (açık yönlendirme). Sunucu şeması da aynı ileri-olumsuz bakışı
                 kullanıyor (`linkHrefSchema`); buradaki denetim onun yerine
                 geçmez, yalnız 400'ü beklemeden söyler.
            */
            pattern="/(?!/).*"
            placeholder="/collection/denim"
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          />
          <span className="text-xs text-metin-soluk">{t('alan.bagIpucu')}</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('alan.sira')}
          <input
            type="number"
            min={0}
            max={1000}
            value={sira}
            onChange={(olay) => setSira(olay.target.value)}
            className="rakam h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          />
        </label>
      </div>

      <p className="text-xs text-metin-soluk">{t('yukle.pasifUyarisi')}</p>

      {yukleme.yerelHata ? <p className="text-sm text-tehlike">{yukleme.yerelHata}</p> : null}

      {/*
        ⚠️ ALAN HATASI ÖNCE, ZARF MESAJI SONRA. Zarf yalnızca "Gönderilen
           bilgiler geçersiz." diyor; hangi alanın neden reddedildiğini SADECE
           `fields[0].message` söylüyor ("Bağlantı site içi bir yol olmalı…").
      */}
      {alanHatalari.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-metin">
          {alanHatalari.map((alan) => (
            <li key={alan.path}>{fieldMessage(alan, locale)}</li>
          ))}
        </ul>
      ) : null}

      {yukleme.hata !== null ? <HataGosterimi error={yukleme.hata} /> : null}

      {yukleme.sonuc !== null ? (
        <p className="text-sm text-metin">
          {/*
            ⚠️ ÖLÇÜLER `String()` İLE GEÇİLİYOR, SAYI OLARAK DEĞİL. next-intl
               sayı argümanını `Intl.NumberFormat` ile biçimliyor ve Türkçede
               2048 → "2.048" olurdu; piksel ölçüsünde binlik ayracı yanlış
               okunur ("2 nokta 048").
          */}
          {t('yukle.sonuc', {
            en: String(yukleme.sonuc.widthPx),
            boy: String(yukleme.sonuc.heightPx),
          })}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={yukleme.calisiyor || hedefEksik}>
          {yukleme.adim === 'bilet'
            ? t('yukle.adimBilet')
            : yukleme.adim === 'yukleme'
              ? t('yukle.adimYukleme')
              : yukleme.adim === 'onay'
                ? t('yukle.adimOnay')
                : t('yukle.gonder')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="sessiz"
          disabled={yukleme.calisiyor}
          onClick={() => {
            setAcik(false);
            yukleme.temizle();
          }}
        >
          {t('alan.vazgec')}
        </Button>
      </div>
    </form>
  );
}
