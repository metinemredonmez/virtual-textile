'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { mediaUrl } from '@/lib/media';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import type { DenemeAsamasi } from './use-deneme';
import type { Parca } from './parca';

/**
 * ═══════════ TRY-ON GÖRSEL ALANI — KARUSEL DEĞİŞİNCE YENİLENEN TEK YER ═══════
 *
 * ⚠️ BU BİLEŞEN EKRANIN GERİ KALANINDAN AYRI TUTULUYOR ve `memo` ile sarılı.
 *    Parça değiştirmek ekranı baştan kurmaz; başlık, düğmeler, güven satırları
 *    ve karusel yerinde kalır, yalnızca burası değişir. Bu, arka taraftaki önek
 *    tabanlı önbelleğin (multiTryOnCacheKey) arayüz karşılığıdır: sunucu ilk n-1
 *    katmanı yeniden üretmiyorsa arayüz de o katmanları yeniden çizmemeli.
 *    Karusel bir `<Link>` OLSAYDI bu kazanç görünmez olurdu: yeni URL Sunucu
 *    Bileşenini baştan çalıştırır, ekran komple yenilenirdi.
 *
 * ⚠️ FİLİGRAN CSS İLE ÇİZİLMEZ. Yasal uyarı worker tarafında PİKSELE gömülüyor
 *    (`tryon.processor.ts` → `watermarker.embed`). Üstüne bir katman koymak,
 *    ekran görüntüsü alındığında kaybolan sahte bir güvence olurdu.
 */

export interface DenemeGorseliProps {
  asama: DenemeAsamasi;
  ilerleme: number;
  tahminSaniye: number;
  zamanAsimi: boolean;
  /** Henüz deneme yapılmadığında gösterilecek parçalar. */
  parcalar: readonly Parca[];
  onTekrarDene: () => void;
  onYeniFotograf: () => void;
  onDurumuKontrolEt: () => void;
}

function Cerceve({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    // ⚠️ Kenarlık YOK, gölge YOK: ekranın çoğunu görsel kaplamalı ve etraf susmalı.
    <div className="relative flex aspect-urun w-full items-center justify-center overflow-hidden rounded-lg bg-urun-zemin">
      {children}
    </div>
  );
}

function ParcaOnizleme({ parcalar }: { parcalar: readonly Parca[] }): React.ReactElement {
  return (
    <div className="grid h-full w-full grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
      {parcalar.map((parca) => {
        const gorsel = mediaUrl(parca.gorselAnahtari);
        return (
          <div key={parca.variantId} className="relative h-full w-full">
            {/* ⚠️ Ham `next/image` DEĞİL — kovada olmayan nesne `/_next/image`den
                500 dönüyor ve deneme ekranının BOŞ DURUMUNDA kırık resim ikonu
                çıkıyordu (ölçüldü, tarayıcı). Gerekçe
                `components/urun/urun-gorseli.tsx` başlığında. */}
            <UrunGorseli
              src={gorsel}
              alt={parca.baslik}
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover opacity-60"
              oncelikli
            />
          </div>
        );
      })}
    </div>
  );
}

/** Kombin adımları — ⚠️ `reused` katmana YÜKLEME GÖSTERGESİ ÇİZİLMEZ. */
function Adimlar({ asama }: { asama: Extract<DenemeAsamasi, { tur: 'uretiliyor' }> }) {
  if (asama.adimlar.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-col gap-1 text-xs text-metin-soluk">
      {asama.adimlar.map((adim) => (
        <li key={adim.variantId} className="flex items-center justify-between gap-3">
          <span>{adim.layerIndex + 1}. katman</span>
          <span>
            {adim.reused ? (
              // Önek önbelleğinden geldi: üretilmedi, beklenmiyor, çizilmiyor.
              'hazır'
            ) : (
              <span className="rakam">üretiliyor</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Ilerleme({
  asama,
  ilerleme,
  tahminSaniye,
}: {
  asama: Extract<DenemeAsamasi, { tur: 'uretiliyor' }>;
  ilerleme: number;
  tahminSaniye: number;
}): React.ReactElement {
  // ⚠️ Çubuk %95'te DURUR (bkz. use-tryon-job). Dolu çubuk + bekleyen ekran,
  //    belirsiz çarkın hatasının aynısıdır: kullanıcı bittiğini sanıp kapatır.
  const bitmeUzere = ilerleme >= 95;
  const kalan = Math.max(0, Math.ceil(tahminSaniye * (1 - ilerleme / 100)));

  return (
    <div className="w-full max-w-xs px-6 text-center">
      <div
        role="progressbar"
        aria-valuenow={ilerleme}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Sanal deneme ilerlemesi"
        className="h-1 w-full overflow-hidden rounded-full bg-yuzey-vurgulu"
      >
        <div
          className="h-full bg-metin transition-[width] duration-500"
          style={{ width: `${ilerleme}%` }}
        />
      </div>

      <p className="rakam mt-3 text-sm text-metin">
        {bitmeUzere ? 'Neredeyse bitti…' : `Tahmini ${kalan} saniye`}
      </p>

      <Adimlar asama={asama} />
    </div>
  );
}

function GorseliniCiz({
  asama,
  onDurumuKontrolEt,
}: {
  asama: Extract<DenemeAsamasi, { tur: 'sonuc' }>;
  onDurumuKontrolEt: () => void;
}): React.ReactElement {
  if (!asama.sonuc.gorselUrl) {
    return <p className="p-6 text-center text-sm text-metin-soluk">Görsel hazırlanıyor…</p>;
  }

  return (
    /*
     * ⚠️ `next/image` KULLANILMAZ. Adres İMZALI ve ömrü 900 saniye
     *    (SIGNED_URL_TTL_SECONDS.tryOnResult); optimize edici onu adresine göre
     *    önbelleğe alır ve imza öldükten sonra ölü bir kopyayı servis eder.
     *    Ayrıca `next.config.ts` yalnızca genel `**.r2.dev` kovasına izin
     *    veriyor — kullanıcı görselleri özel kovadan gelir.
     */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asama.sonuc.gorselUrl}
      alt="Sanal deneme sonucu"
      className="h-full w-full object-contain"
      // ⚠️ İmza ölmüş olabilir (sekme uzun süre gizli kaldı). Kırık ikon yerine
      //    yeni imzalı adresi çekiyoruz.
      onError={onDurumuKontrolEt}
    />
  );
}

function Icerik(props: DenemeGorseliProps): React.ReactElement {
  const { asama, ilerleme, tahminSaniye, zamanAsimi, parcalar } = props;

  if (zamanAsimi) {
    return (
      <div className="px-6 text-center">
        <p className="text-sm text-metin">Deneme beklenenden uzun sürdü.</p>
        <Button variant="ikincil" size="sm" className="mt-3" onClick={props.onDurumuKontrolEt}>
          Durumu kontrol et
        </Button>
      </div>
    );
  }

  switch (asama.tur) {
    case 'bos':
      return (
        <>
          <ParcaOnizleme parcalar={parcalar} />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-zemin/80 py-3 text-sm text-metin">
            <Sparkles className="size-4 text-ikon" />
            Bu parçaları kendi fotoğrafınızda görün
          </div>
        </>
      );

    case 'gonderiliyor':
      return <p className="text-sm text-metin-soluk">Deneme sıraya alınıyor…</p>;

    case 'uretiliyor':
      return <Ilerleme asama={asama} ilerleme={ilerleme} tahminSaniye={tahminSaniye} />;

    case 'sonuc':
      return <GorseliniCiz asama={asama} onDurumuKontrolEt={props.onDurumuKontrolEt} />;

    case 'hata':
      return (
        <div className="w-full max-w-sm px-6">
          <HataGosterimi
            error={asama.hata}
            // ⚠️ Kalıcı hatada "Tekrar dene" YOK: üçüncü denemede de fotoğrafta
            //    kişi bulunmayacak. Tek anlamlı çıkış başka bir fotoğraf.
            onRetry={asama.kalici ? undefined : props.onTekrarDene}
          />
          {asama.kalici ? (
            <Button variant="ikincil" size="sm" className="mt-3" onClick={props.onYeniFotograf}>
              Başka fotoğraf yükle
            </Button>
          ) : null}
        </div>
      );
  }
}

/**
 * ⚠️ `memo` bir mikro-optimizasyon değil, YUKARIDAKİ KURALIN uygulanışıdır:
 *    karusel seçimi değiştiğinde bu bileşen yalnızca kendi propları değiştiği
 *    için yeniden çizilir; ekranın kalanı yerinde kalır.
 */
export const DenemeGorseli = React.memo(function DenemeGorseli(
  props: DenemeGorseliProps,
): React.ReactElement {
  return (
    <Cerceve>
      <Icerik {...props} />
    </Cerceve>
  );
});
