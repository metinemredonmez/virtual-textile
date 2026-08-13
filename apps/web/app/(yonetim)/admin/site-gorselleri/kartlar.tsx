'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SITE_IMAGE_MAX_CARDS } from '@vt/config/constants';
import type {
  AdminSiteImageWire,
  ProductListItemWire,
  ProductListPayloadWire,
} from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { list } from '@/lib/api/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * VİTRİN AFİŞİNİN ÜSTÜNDEKİ ÜRÜN KARTLARI — SEÇİM.
 *
 * Ana sayfa bugün “üzerinizde görün” DİYOR ama GÖSTERMİYOR. Afişin üstüne
 * binen 2-3 ürün kartı bunu gösteriyor; her kartta “Üzerimde Dene” ve “Sepete
 * Ekle” AYNI görsel ağırlıkta duruyor. Hangi ürünlerin görüneceği BURADAN
 * seçilir.
 *
 * ⚠️ "VİTRİN LİSTESİNDEN İLK ÜÇ" REDDEDİLDİ ve gerekçesi burada görünür olmalı:
 *    alaka sıralaması her gün başka üç ürün getirir, afiş ise sabit kalır —
 *    kartlardaki ürünlerle afiş görselindeki kıyafet görünür biçimde ayrışırdı.
 *    Bütün fikir kartın GÖRSELDEKİ parça olması; o yüzden seçim yöneticinin.
 *
 * ⚠️ SINIR `SITE_IMAGE_MAX_CARDS`TAN OKUNUR, "3" YAZILMAZ. Sunucu da aynı
 *    sabiti kullanıyor (`admin-site-image.service.ts`); ekrana rakam gömülseydi
 *    sınır değiştiğinde ekran ya erken engeller ya da 400 aldırırdı.
 *    Sınırın kendisi ölçülmüş: 1280px'te afiş 546px, görselsiz kart ~210px,
 *    üç kart yan yana 752px (kap 1248px). Dördüncüsü taşar.
 */
export function Kartlar({ gorsel }: { gorsel: AdminSiteImageWire }): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('siteGorselleri.kartlar');

  const [acik, setAcik] = React.useState(false);
  const [calisiyor, setCalisiyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);

  const doluMu = gorsel.cards.length >= SITE_IMAGE_MAX_CARDS;

  async function kartEkle(productId: string): Promise<void> {
    setCalisiyor(true);
    setHata(null);
    try {
      await apiFetch<AdminSiteImageWire, `/admin/site-images/${string}/cards`>(
        `/admin/site-images/${gorsel.id}/cards`,
        { method: 'POST', json: { productId, sortOrder: gorsel.cards.length } },
      );
      setAcik(false);
      // Yanıt afişin tamamını döndürüyor ama yerel state'e yazılmıyor: kart
      // listesi sunucuda `status = PUBLISHED` ile ayrıca süzülüyor.
      router.refresh();
    } catch (yakalanan) {
      setHata(yakalanan);
    } finally {
      setCalisiyor(false);
    }
  }

  async function kartSil(productId: string): Promise<void> {
    setCalisiyor(true);
    setHata(null);
    try {
      await apiFetch<AdminSiteImageWire, `/admin/site-images/${string}/cards/${string}`>(
        `/admin/site-images/${gorsel.id}/cards/${productId}`,
        { method: 'DELETE' },
      );
      router.refresh();
    } catch (yakalanan) {
      setHata(yakalanan);
    } finally {
      setCalisiyor(false);
    }
  }

  return (
    <div className="mt-3 border-t border-kenar pt-3">
      <p className="text-sm font-medium text-metin">
        {t('baslik')}{' '}
        {/*
          ⚠️ "2/3" SÖZLÜKTEN GEÇMEZ: çevirisi yok, iki dilde birebir aynı olurdu
             ve `sozluk.test.ts`in "çevrilmemiş kalıntı" iddiası kırmızı yanardı.
        */}
        <span className="rakam font-normal text-metin-soluk">
          {gorsel.cards.length}/{SITE_IMAGE_MAX_CARDS}
        </span>
      </p>

      {gorsel.cards.length === 0 ? (
        /*
          ⚠️ BOŞ DURUM NE OLDUĞUNU SÖYLER: kart seçmemek bir hata değil, afiş
             tek başına da çalışır. Ama o zaman "üzerinizde görün" cümlesi yine
             yalnızca SÖYLENİR, gösterilmez — cümle tam olarak bunu yazıyor.
        */
        <p className="mt-1 text-sm text-metin-soluk">{t('bos')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {gorsel.cards.map((kart) => (
            <li key={kart.productId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-metin">{kart.title}</span>
              <span className="text-xs text-metin-soluk">{kart.brandName}</span>

              {/*
                ⚠️ `tryOnable` BURADA KAPININ TAMAMI: sunucu hem ürünün bayrağını
                   hem `isTryOnSupported(kategori)`yi uygulayarak hesaplıyor
                   (`wire/site.ts` başlığı). Bu yüzden ekran ikinci bir kapı
                   kurmuyor — kurulsaydı iki gerçek olurdu.
                ⚠️ Kart YİNE ÇİZİLİR, yalnız "Sepete Ekle" ile. Devre dışı ya da
                   gri bir "Üzerimde Dene" ÇİZİLMEZ (`urun-eylemleri.tsx` kuralı).
              */}
              {!kart.tryOnable ? <Badge durum="uyari">{t('denemeKapali')}</Badge> : null}

              {/*
                ⚠️ VARYANTI KALMAMIŞ ÜRÜN "Sepete Ekle"Yİ DE KAYBEDER
                   (`defaultVariantId: null`). İkisi birden düşerse kart hiçbir
                   şey yapmayan bir kutuya döner; yönetici bunu BURADA görmeli.
              */}
              {kart.defaultVariantId === null ? (
                <Badge durum="tehlike">{t('varyantYok')}</Badge>
              ) : null}

              <Button
                size="sm"
                variant="sessiz"
                className="ml-auto"
                disabled={calisiyor}
                onClick={() => void kartSil(kart.productId)}
              >
                {t('kaldir')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!acik ? (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ikincil"
            disabled={doluMu || calisiyor}
            onClick={() => setAcik(true)}
          >
            {t('urunEkle')}
          </Button>
          {doluMu ? <span className="ml-2 text-xs text-metin-soluk">{t('dolu')}</span> : null}
        </div>
      ) : (
        <UrunSecici
          seciliIdler={gorsel.cards.map((kart) => kart.productId)}
          calisiyor={calisiyor}
          onSec={(urun) => void kartEkle(urun.id)}
          onKapat={() => setAcik(false)}
        />
      )}

      {hata !== null ? <HataGosterimi className="mt-2" error={hata} /> : null}
    </div>
  );
}

/**
 * ÜRÜN ARAMA — katalog aramasının kendisi kullanılıyor.
 *
 * ⚠️ AYRI BİR YÖNETİM ARAMA UCU AÇILMADI: `GET /products` zaten yalnızca
 *    YAYINDAKİ ürünleri döndürüyor ve kart ancak yayındaki bir üründen
 *    kurulabilir. Yeni bir uç, aynı filtrenin ikinci bir uygulaması olurdu.
 *
 * ⚠️ LİSTE UCUNUN `tryOnable`I KAPININ YARISI. `ProductListItemWire.tryOnable`
 *    yalnız "kategorinin bir try-on karşılığı var mı" der ve AYAKKABI için de
 *    `true` döner; sağlayıcı yeteneği ikinci yarı ve o veri bu uçta YOK
 *    (`wire/site.ts`de ölçülmüş). Bu yüzden buradaki rozet KISMİDİR ve öyle
 *    olduğu yazılıyor — kesin durum, kart eklendikten sonra satırda görünür
 *    (`SiteImageCardWire.tryOnable` kapının tamamı). Liste sözleşmesini
 *    genişletmek bu turun işi değil.
 */
function UrunSecici({
  seciliIdler,
  calisiyor,
  onSec,
  onKapat,
}: {
  seciliIdler: readonly string[];
  calisiyor: boolean;
  onSec: (urun: ProductListItemWire) => void;
  onKapat: () => void;
}): React.ReactElement {
  const t = useTranslations('siteGorselleri.kartlar');
  const tOrtak = useTranslations('ortak');
  const [metin, setMetin] = React.useState('');
  const [araniyor, setAraniyor] = React.useState(false);
  const [sonuclar, setSonuclar] = React.useState<ProductListItemWire[] | null>(null);
  const [hata, setHata] = React.useState<unknown>(null);

  async function ara(): Promise<void> {
    setAraniyor(true);
    setHata(null);
    try {
      const yanit = await apiFetch<ProductListPayloadWire, '/products'>('/products', {
        query: { q: metin.trim() === '' ? undefined : metin.trim(), limit: 8 },
      });
      setSonuclar(list<ProductListItemWire>(yanit).items);
    } catch (yakalanan) {
      setHata(yakalanan);
    } finally {
      setAraniyor(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-kenar bg-yuzey p-3">
      {/*
        ⚠️ `<form>` KULLANILMIYOR ve sebebi yapısal: bu bileşen satırın DÜZENLEME
           FORMUNUN içinde çizilebiliyor ve iç içe `<form>` geçersiz HTML'dir
           (tarayıcı içtekini sessizce atar, sonra "Ara" düğmesi dıştaki formu
           gönderir — yani afişin metinlerini kaydeder). Arama düz bir düğme;
           Enter tuşu `onKeyDown` ile ayrıca bağlandı ki klavye kaybolmasın.
      */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('urunAra')}
          <input
            value={metin}
            onChange={(olay) => setMetin(olay.target.value)}
            onKeyDown={(olay) => {
              if (olay.key === 'Enter') {
                olay.preventDefault();
                void ara();
              }
            }}
            maxLength={80}
            autoFocus
            placeholder={t('ornek')}
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          />
        </label>
        <Button
          type="button"
          size="sm"
          variant="ikincil"
          disabled={araniyor}
          onClick={() => void ara()}
        >
          {araniyor ? t('araniyor') : tOrtak('ara')}
        </Button>
        <Button type="button" size="sm" variant="sessiz" onClick={onKapat}>
          {tOrtak('iptal')}
        </Button>
      </div>

      {hata !== null ? <HataGosterimi className="mt-2" error={hata} /> : null}

      {sonuclar !== null ? (
        sonuclar.length === 0 ? (
          <p className="mt-2 text-sm text-metin-soluk">{t('sonucYok')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {sonuclar.map((urun) => {
              const zatenVar = seciliIdler.includes(urun.id);
              return (
                <li key={urun.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-metin">{urun.title}</span>
                  <span className="text-xs text-metin-soluk">{urun.brandName}</span>
                  {!urun.tryOnable ? <Badge durum="uyari">{t('denemeKapaliKisa')}</Badge> : null}
                  <Button
                    size="sm"
                    variant="ikincil"
                    className="ml-auto"
                    disabled={calisiyor || zatenVar}
                    onClick={() => onSec(urun)}
                  >
                    {zatenVar ? t('ekli') : t('ekle')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      <p className="mt-2 text-xs text-metin-soluk">{t('kismiUyari')}</p>
    </div>
  );
}
