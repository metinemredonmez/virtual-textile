'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { isApiFailure, type AdminSiteImageWire, type Locale } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { mediaUrl } from '@/lib/media';
import { tarihSaat } from '@/lib/tarih';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KararKutusu, type Karar } from '@/components/panel/karar-kutusu';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldMessage } from '@/components/hata/alan-hatalari';
import { SLOT_HEDEFI } from './_lib/tipler';
import { Kartlar } from './kartlar';

/**
 * TEK SATIR — ÖNİZLEME, METİNLER, YAYIN DURUMU, SİLME.
 *
 * ⚠️ SATIR İÇİ YÖNETİM, DETAY SAYFASI YOK. `/site-gorselleri/[id]` açmak ikinci
 *    bir rota, ikinci bir menü satırı ve ikinci bir test yüzeyi demekti;
 *    yönetilen alan dört metin kutusu kadar.
 *
 * ⚠️ "YAYINDA" RENK TAŞIR ÇÜNKÜ BİR DURUMDUR — sıra numarası, ölçüler ve
 *    yükleme tarihi taşımaz. `design-system.md`: renk yalnızca DURUM taşır.
 *
 * ⚠️ SLOT DEĞİŞTİRİLEMEZ ve buna dair bir kutu YOKTUR: `siteImageUpdateSchema`
 *    yalnız `isActive/sortOrder/title/subtitle/linkHref` alıyor. 16/7 üretilmiş
 *    türevleri kategori kapağına taşımak görseli yanlış oranda gösterirdi.
 *    Düzenlenemeyen bir alanı düzenlenebilir göstermek, yöneticiye
 *    yapamayacağı bir işi vaat etmektir.
 */
export function GorselSatiri({
  gorsel,
  hedefEtiketi,
}: {
  gorsel: AdminSiteImageWire;
  /** `targetKey`in okunabilir karşılığı; `null` → hedef bulunamadı. */
  hedefEtiketi: string | null;
}): React.ReactElement {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations('siteGorselleri');
  const tOrtak = useTranslations('ortak');

  const [acik, setAcik] = React.useState(false);
  const [calisiyor, setCalisiyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);

  const [baslik, setBaslik] = React.useState(gorsel.title ?? '');
  const [altBaslik, setAltBaslik] = React.useState(gorsel.subtitle ?? '');
  const [bagAdresi, setBagAdresi] = React.useState(gorsel.linkHref ?? '');
  const [sira, setSira] = React.useState(String(gorsel.sortOrder));

  const adres = mediaUrl(gorsel.storageKey);
  const hedefliMi = SLOT_HEDEFI[gorsel.slot] !== 'yok';

  async function yamala(govde: Record<string, unknown>): Promise<void> {
    setCalisiyor(true);
    setHata(null);
    try {
      await apiFetch<AdminSiteImageWire, `/admin/site-images/${string}`>(
        `/admin/site-images/${gorsel.id}`,
        { method: 'PATCH', json: govde },
      );
      setAcik(false);
      // ⚠️ Yerel state güncellenmiyor, `router.refresh()` çağrılıyor: yayına
      //    alma aynı slottaki DİĞER satırların anlamını da değiştirir (vitrin
      //    ilk aktif afişi okuyor). Tek doğru kaynak sunucu.
      router.refresh();
    } catch (yakalanan) {
      setHata(yakalanan);
    } finally {
      setCalisiyor(false);
    }
  }

  /**
   * ⚠️ SİLME `KararKutusu`NDAN GEÇİYOR ÇÜNKÜ GERİ ALINAMAZ: satır gider, kartlar
   *    cascade ile düşer, nesne kovadan silinir. Tek tıkla silinen bir vitrin
   *    afişi, yanlış satıra basan yöneticinin ana sayfayı boşaltması demekti.
   *    Bu dosya `KararKutusu`ya yalnız `calistir` veriyor, JSX yazmıyor
   *    (`moderation/karar.tsx` emsali).
   *
   * ⚠️ GEREKÇE ALANI YOK (`gerekce: 'yok'`) ÇÜNKÜ UÇTA YOK: `DELETE
   *    /admin/site-images/:id` gövde ALMIYOR. Gerekçe kutusu çizmek,
   *    yöneticinin yazdığı cümlenin hiçbir yere gitmemesi demekti — bu ekranın
   *    her yerinde uyguladığımız kuralın (yapamayacağı bir işi vaat etme)
   *    ihlali. Uç bir gün `reason` kabul ederse burası `istege-bagli` olur.
   *
   * ⚠️ ASIL KORUMA `engel`DE: YAYINDAKİ görsel silinemez. Tek tıkla silme
   *    tehlikesinin tamamı burada — yanlış satıra basan yönetici CANLI vitrini
   *    boşaltırdı. Önce "Yayından kaldır" demek zorunda olması, sitedeki
   *    değişikliği silmeden ÖNCE görmesini de sağlıyor. (Sunucu bu kuralı
   *    bilmiyor; bu bir arayüz koruması ve öyle olduğu yazılı.)
   */
  const silmeKarari: Karar = {
    anahtar: 'sil',
    etiket: t('satir.sil'),
    yikici: true,
    gerekce: 'yok',
    onayEtiketi: t('satir.silOnay'),
    engel: gorsel.isActive ? t('satir.silEngeli') : null,
    calistir: async () => {
      await apiFetch<{ id: string; deleted: true }, `/admin/site-images/${string}`>(
        `/admin/site-images/${gorsel.id}`,
        { method: 'DELETE' },
      );
    },
  };

  const alanHatalari = isApiFailure(hata) ? hata.fields : [];

  return (
    <div className="rounded-md border border-kenar bg-zemin p-3">
      <div className="flex flex-wrap items-start gap-3">
        {/*
          ⚠️ `next/image` DEĞİL, düz `<img>` — iki sebep, ikisi de yeterli:
             (1) burası bir yönetim önizlemesi ve optimize edici her genişlik ×
                 format için ayrı bir upstream çekimi açıyor; `pub-*.r2.dev`
                 ölçülmüş biçimde hız sınırlı (aynı anahtar 5 çekimde 3 kez
                 düştü). Yönetim ekranı bu bütçeyi harcamamalı.
             (2) `NEXT_PUBLIC_MEDIA_URL` bu turda nginx önbelleğine çevriliyor
                 ve `images.remotePatterns` güncellemesi BAŞKA bir ajanın işi —
                 optimize ediciye bağlanan bir önizleme, o satır yazılmadığı
                 gün 400 döner.
          ⚠️ Adres yoksa KIRIK `<img>` DEĞİL, sebebi yazan bir kutu çizilir:
             "görsel mi bozuk, ayar mı eksik" sorusunun cevabı başka yerde yok.
        */}
        {adres !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={adres}
            alt=""
            width={160}
            height={70}
            className="h-[70px] w-[160px] shrink-0 rounded-sm border border-kenar object-cover"
          />
        ) : (
          <div className="flex h-[70px] w-[160px] shrink-0 items-center justify-center rounded-sm border border-dashed border-kenar p-2 text-center text-xs text-metin-soluk">
            {t('satir.medyaAdresiYok')}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-metin">
              {gorsel.title ?? t('satir.basliksiz')}
            </span>
            {gorsel.isActive ? (
              <Badge durum="olumlu">{t('satir.yayinda')}</Badge>
            ) : (
              <Badge durum="notr">{t('satir.pasif')}</Badge>
            )}
          </div>

          {gorsel.subtitle !== null ? (
            <p className="mt-0.5 text-sm text-metin-soluk">{gorsel.subtitle}</p>
          ) : null}

          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-metin-soluk">
            {hedefliMi ? (
              <span>
                {hedefEtiketi !== null ? (
                  t('satir.hedef', { etiket: hedefEtiketi })
                ) : (
                  <span className="text-tehlike">
                    {t('satir.hedef', {
                      etiket: t('satir.hedefYok', { anahtar: gorsel.targetKey ?? '—' }),
                    })}
                  </span>
                )}
              </span>
            ) : null}
            {/*
              ⚠️ ÖLÇÜ SÖZLÜKTEN GEÇMEZ ve bu bir kaçamak değil: "1600×700"ün
                 çevirisi yok. Sözlüğe konsaydı iki dilde BİREBİR aynı olurdu ve
                 `sozluk.test.ts`in "çevrilmemiş kalıntı" iddiası — haklı olarak
                 — kırmızı yanardı. Aynı sebeple `t()` ile de geçirilmiyor:
                 next-intl sayı argümanını `Intl.NumberFormat` ile biçimler ve
                 2048 → "2.048" olurdu; piksel ölçüsünde binlik ayracı yanlış
                 okunur.
            */}
            <span className="rakam">
              {gorsel.widthPx}×{gorsel.heightPx}
            </span>
            <span className="rakam">{t('satir.siraNo', { n: String(gorsel.sortOrder) })}</span>
            {gorsel.linkHref !== null ? (
              <span>{t('satir.bag', { yol: gorsel.linkHref })}</span>
            ) : null}
            <span>{tarihSaat(gorsel.createdAt, locale)}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/*
            ⚠️ YAYIN ANAHTARI TEK TIK, forma girmeden. Yöneticinin en sık yaptığı
               iş bu; dört kutuluk bir formun arkasına konsaydı "hangi afiş
               yayında" sorusu her seferinde form açtırarak sorulurdu.
          */}
          <Button
            size="sm"
            variant="ikincil"
            disabled={calisiyor}
            onClick={() => void yamala({ isActive: !gorsel.isActive })}
          >
            {gorsel.isActive ? t('satir.yayindanKaldir') : t('satir.yayinaAl')}
          </Button>
          <Button size="sm" variant="sessiz" disabled={calisiyor} onClick={() => setAcik(!acik)}>
            {acik ? tOrtak('kapat') : t('satir.duzenle')}
          </Button>
        </div>
      </div>

      {acik ? (
        <form
          className="mt-3 flex flex-col gap-3 border-t border-kenar pt-3"
          onSubmit={(olay) => {
            olay.preventDefault();
            /*
              ⚠️ BOŞ DİZE `null` GÖNDERİLİYOR, ATLANMIYOR. Şema metin alanlarını
                 `.nullable().optional()` yaptı ve fark önemli: "gönderilmedi"
                 alanı KORUR, `null` alanı TEMİZLER. Boş kutuyu atlasaydık
                 yönetici bir başlığı asla silemezdi.
            */
            void yamala({
              title: baslik.trim() === '' ? null : baslik.trim(),
              subtitle: altBaslik.trim() === '' ? null : altBaslik.trim(),
              linkHref: bagAdresi.trim() === '' ? null : bagAdresi.trim(),
              sortOrder: Number.parseInt(sira, 10) || 0,
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              {t('alan.baslik')}
              <input
                value={baslik}
                onChange={(olay) => setBaslik(olay.target.value)}
                maxLength={200}
                className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('alan.altBaslik')}
              <input
                value={altBaslik}
                onChange={(olay) => setAltBaslik(olay.target.value)}
                maxLength={200}
                className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('alan.bagAdresi')}
              <input
                value={bagAdresi}
                onChange={(olay) => setBagAdresi(olay.target.value)}
                maxLength={500}
                // ⚠️ `//evil.com` reddedilir: tarayıcı onu protokol-göreli MUTLAK
                //    adres olarak çözer (açık yönlendirme). Sunucu da aynı deseni
                //    uyguluyor; buradaki denetim yerine geçmez.
                pattern="/(?!/).*"
                placeholder="/collection/denim"
                className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
              />
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

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={calisiyor}>
              {calisiyor ? t('satir.kaydediliyor') : tOrtak('kaydet')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="sessiz"
              disabled={calisiyor}
              onClick={() => setAcik(false)}
            >
              {t('alan.vazgec')}
            </Button>
          </div>
        </form>
      ) : null}

      {/*
        ⚠️ ÜRÜN KARTLARI YALNIZCA VİTRİN AFİŞİNDE. Kategori/koleksiyon kapağının
           üstünde kart yok — o sayfalarda ürün ızgarası zaten hemen altında.
      */}
      {gorsel.slot === 'HERO' ? <Kartlar gorsel={gorsel} /> : null}

      <div className="mt-3 border-t border-kenar pt-3">
        <KararKutusu kararlar={[silmeKarari]} />
      </div>

      {alanHatalari.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-metin">
          {alanHatalari.map((alan) => (
            <li key={alan.path}>{fieldMessage(alan, locale)}</li>
          ))}
        </ul>
      ) : null}

      {hata !== null ? <HataGosterimi className="mt-2" error={hata} /> : null}
    </div>
  );
}
