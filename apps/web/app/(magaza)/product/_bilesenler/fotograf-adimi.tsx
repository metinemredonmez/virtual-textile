'use client';

import * as React from 'react';
import { ImageUp } from 'lucide-react';
import { MEDIA, PHOTO_RETENTION } from '@vt/config/constants';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * FOTOĞRAF ADIMI — yalnızca seçim ve ÖN ELEME.
 *
 * Ağ işi burada YAPILMAZ (bkz. `use-deneme.ts`): imzalı bilet → doğrudan PUT →
 * onay zinciri rıza hatalarıyla iç içe geçiyor ve tek bir yerde durmalı. Bu
 * bileşen dosyayı seçtirir, bariz hataları ağ isteğinden ÖNCE eler ve teslim eder.
 *
 * ⚠️ SAKLAMA AMACI BU EKRANDA SEÇİLMEZ; her fotoğraf `ONE_TIME` yüklenir.
 *    "Profilimde sakla" ayrı bir rıza istiyor (`PHOTO_STORAGE`) ve bu ekranda
 *    ele alınmayan ÜÇÜNCÜ bir rıza modalı doğururdu. Kutucuğu koyup hatayı
 *    ele almamak, basınca hata veren bir düğme yapmak olurdu. Kayıtlı fotoğraf
 *    "Hesabım"a aittir.
 */

const KABUL_EDILEN = MEDIA.allowedMimeTypes.join(',');

interface OnElemeSonucu {
  gecerli: boolean;
  mesaj: string | null;
}

/**
 * ⚠️ ÖLÇÜ TARAYICIDA OKUNUR. Sunucu çözünürlüğü ancak ONAY adımında, yani
 *    dosya R2'ye tamamen yüklendikten SONRA görüyor. 9 MB'lık bir fotoğrafı
 *    yükleyip "çok küçük" demek kullanıcının internetini boşa harcar.
 */
async function onEle(dosya: File): Promise<OnElemeSonucu> {
  const izinliTipler: readonly string[] = MEDIA.allowedMimeTypes;
  if (!izinliTipler.includes(dosya.type)) {
    return { gecerli: false, mesaj: 'Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.' };
  }

  if (dosya.size > MEDIA.maxUploadBytes) {
    const mb = Math.floor(MEDIA.maxUploadBytes / (1024 * 1024));
    return { gecerli: false, mesaj: `Dosya boyutu en fazla ${mb} MB olabilir.` };
  }

  const adres = URL.createObjectURL(dosya);
  try {
    const bitmap = await createImageBitmap(dosya);
    const dar = bitmap.width < MEDIA.minUserPhotoWidth;
    const kisa = bitmap.height < MEDIA.minUserPhotoHeight;
    bitmap.close();

    if (dar || kisa) {
      return {
        gecerli: false,
        mesaj: `Fotoğraf en az ${MEDIA.minUserPhotoWidth}×${MEDIA.minUserPhotoHeight} piksel olmalı.`,
      };
    }
    return { gecerli: true, mesaj: null };
  } catch {
    // Çözülemeyen dosya: sunucu zaten reddedecek, mesajı oradan alalım.
    return { gecerli: true, mesaj: null };
  } finally {
    URL.revokeObjectURL(adres);
  }
}

export interface FotografAdimiProps {
  acik: boolean;
  onKapat: () => void;
  /** Dosya teslim edilir; yükleme/onay zincirini çağıran taraf yürütür. */
  onGonder: (dosya: File) => void;
  yukleniyor: boolean;
  hata: unknown;
}

export function FotografAdimi({
  acik,
  onKapat,
  onGonder,
  yukleniyor,
  hata,
}: FotografAdimiProps): React.ReactElement {
  const [dosya, setDosya] = React.useState<File | null>(null);
  const [onizleme, setOnizleme] = React.useState<string | null>(null);
  const [onElemeHatasi, setOnElemeHatasi] = React.useState<string | null>(null);

  /**
   * ⚠️ `createObjectURL` adresi ELLE serbest bırakılır; bırakılmazsa sekme açık
   *    kaldıkça seçilen her fotoğraf bellekte kalır. Adres bir EFFECT'te değil,
   *    seçim anında üretilir: dosya bir kullanıcı olayıyla geliyor ve türev
   *    state'i effect ile senkronlamak gereksiz bir render turu doğururdu.
   */
  const onizlemeRef = React.useRef<string | null>(null);

  const onizlemeyiKur = React.useCallback((secilen: File | null): void => {
    if (onizlemeRef.current) URL.revokeObjectURL(onizlemeRef.current);
    const adres = secilen ? URL.createObjectURL(secilen) : null;
    onizlemeRef.current = adres;
    setOnizleme(adres);
  }, []);

  // Yalnızca sökülme temizliği — state yazmaz.
  React.useEffect(
    () => () => {
      if (onizlemeRef.current) URL.revokeObjectURL(onizlemeRef.current);
    },
    [],
  );

  async function secildi(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const secilen = event.target.files?.[0] ?? null;
    setOnElemeHatasi(null);

    if (!secilen) {
      setDosya(null);
      onizlemeyiKur(null);
      return;
    }

    const sonuc = await onEle(secilen);
    if (!sonuc.gecerli) {
      setOnElemeHatasi(sonuc.mesaj);
      setDosya(null);
      onizlemeyiKur(null);
      return;
    }

    setDosya(secilen);
    onizlemeyiKur(secilen);
  }

  return (
    <Dialog open={acik} onOpenChange={(sonraki) => (sonraki ? null : onKapat())}>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">Fotoğrafınızı yükleyin</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-metin-soluk">
          Tüm vücudunuzun göründüğü, önden çekilmiş ve aydınlık bir fotoğraf en iyi sonucu verir.
          Fotoğraf {PHOTO_RETENTION.oneTimeHours} saat sonra silinir.
        </DialogDescription>

        {/*
          ⚠️ ODAK HALKASI SARMALAYICIDA, GİRDİDE DEĞİL — ve bu bir tercih değil,
             zorunluluk. Gerçek tab durağı `sr-only` girdinin kendisi;
             `:focus-visible` ONA eşleşiyor ve halka da ONUN üzerine çiziliyor,
             ama `sr-only` `clip: inset(50%)` uyguladığı için halka 1×1 piksele
             kırpılıp GÖRÜNMEZ oluyor (ölçüldü: outline "solid 2px", rect 1×1).
             Kullanıcının gördüğü 293×98'lik kutu odaklandığını hiçbir şekilde
             belli etmiyordu — platformun ayrıştırıcısına giden akışın İLK
             adımı klavye kullanıcısı için başlatılamıyordu (WCAG 2.4.7).

             Desen `products/_liste/arama-kutusu.tsx`te gerekçelendirildi ve
             oradan alındı: görünür kabuk halkayı taşır, gizli/çıplak girdi
             taşımaz. `focus-within` değil `has-[:focus-visible]` — halka
             klavye işaretidir, fare tıklamasında yanmaz.
        */}
        <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-kenar bg-yuzey p-6 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-vurgu">
          <ImageUp className="size-5 text-ikon" />
          <span className="text-sm text-metin">
            {dosya ? dosya.name : 'Fotoğraf seçmek için tıklayın'}
          </span>
          <input
            type="file"
            accept={KABUL_EDILEN}
            className="sr-only"
            onChange={(event) => void secildi(event)}
          />
        </label>

        {onizleme ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={onizleme}
            alt="Seçilen fotoğrafın önizlemesi"
            className="mt-4 max-h-64 w-full rounded-md object-contain"
          />
        ) : null}

        {onElemeHatasi ? (
          <p role="alert" className="mt-3 text-sm text-tehlike">
            {onElemeHatasi}
          </p>
        ) : null}

        {/*
          ⚠️ `onRetry` ZORUNLU. Yükleme hatası `UPSTREAM_UNAVAILABLE` olarak
             fırlatılıyor (`use-deneme.ts`) ve o kod `otomatik` dalında; düğme
             olmadan ekranda hiçbir çıkış kalmıyordu. Dosya hâlâ state'te
             olduğu için tekrar dene AYNI dosyayı gönderir, yeniden seçtirmez.
        */}
        {hata ? (
          <HataGosterimi
            error={hata}
            className="mt-4"
            onRetry={dosya ? () => onGonder(dosya) : undefined}
          />
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="sessiz" onClick={onKapat} disabled={yukleniyor}>
            Vazgeç
          </Button>
          <Button onClick={() => dosya && onGonder(dosya)} disabled={!dosya || yukleniyor}>
            {yukleniyor ? 'Yükleniyor…' : 'Devam et'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
