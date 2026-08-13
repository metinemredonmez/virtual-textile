'use client';

import * as React from 'react';
import type { ConsentType } from '@vt/contracts';
import { PHOTO_RETENTION } from '@vt/config/constants';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * ═══════════════════ RIZA — İKİ AYRI KOD, İKİ AYRI MODAL ════════════════════
 *
 * ⚠️ TEK MODALDA TOPLANMAZ. KVKK'da fotoğrafın İŞLENMESİ (md.6) ile YURT DIŞINA
 *    AKTARILMASI (md.9) ayrı açık rızalardır; sunucu da ayrı kodlarla reddediyor
 *    (`CONSENT_REQUIRED` / `CONSENT_CROSS_BORDER_REQUIRED`). Tek kutucukta
 *    toplayan bir arayüz, kullanıcı onayladıktan sonra ikinci kodu almaya devam
 *    eder ve kullanıcıyı sonsuz döngüde bırakır.
 *
 * ⚠️ RIZA "ÜZERİMDE DENE"YE BASILDIKTAN SONRA istenir, ekrana girerken değil.
 *    Bağlam netken verilen onay anlamlıdır; sayfa açılışında sorulan onay
 *    kapatılacak bir engeldir (design-system.md → Fotoğraf yükleme akışı).
 *
 * ⚠️ Onay YAZILDIKTAN SONRA orijinal istek AYNI Idempotency-Key ile tekrarlanır.
 *    Yeni anahtar üretmek, sunucuda çoktan başlamış bir üretimin İKİNCİSİNİ
 *    açardı; kararı çağıran taraf değil, anahtar haritası verir (bkz. use-deneme).
 */

interface RizaGovdesi {
  baslik: string;
  aciklama: string;
  maddeler: readonly string[];
  onayMetni: string;
}

const FOTOGRAF_ISLEME: RizaGovdesi = {
  baslik: 'Fotoğrafınızın işlenmesine izin verin',
  aciklama:
    'Sanal deneme görselini üretebilmemiz için fotoğrafınızı işlememiz gerekiyor. ' +
    'Bu izin olmadan deneme başlatılamaz.',
  maddeler: [
    'Fotoğrafınız yalnızca sizin başlattığınız deneme için kullanılır.',
    `Tek seferlik yüklenen fotoğraf ${PHOTO_RETENTION.oneTimeHours} saat sonra silinir.`,
    'İzni hesabınızdan istediğiniz an geri çekebilirsiniz; geri çekildiğinde fotoğraflarınız silinmek üzere işaretlenir.',
  ],
  onayMetni: 'Fotoğrafımın işlenmesine izin veriyorum',
};

const YURT_DISI_AKTARIM: RizaGovdesi = {
  baslik: 'Yurt dışına aktarıma izin verin',
  aciklama:
    'Görseli üreten yapay zekâ sağlayıcısı yurt dışında bulunuyor. Deneme için ' +
    'fotoğrafınız bu sağlayıcıya aktarılır.',
  maddeler: [
    'Aktarım yalnızca deneme görselini üretmek için yapılır.',
    'Sağlayıcıya verilen adres tek kullanımlıktır ve kısa sürede geçersiz olur.',
    'Bu izin, fotoğrafın işlenmesi izninden ayrıdır ve ayrıca geri çekilebilir.',
  ],
  onayMetni: 'Fotoğrafımın yurt dışındaki sağlayıcıya aktarılmasına izin veriyorum',
};

interface RizaModaliProps {
  acik: boolean;
  /** ⚠️ Kapatma onay DEĞİLDİR: çağıran taraf bekleyen isteği iptal etmeli. */
  onKapat: () => void;
  /** Rıza yazıldıktan SONRA çağrılır; orijinal istek burada tekrarlanır. */
  onOnaylandi: () => void;
}

function RizaModali({
  acik,
  onKapat,
  onOnaylandi,
  tur,
  govde,
}: RizaModaliProps & { tur: ConsentType; govde: RizaGovdesi }): React.ReactElement {
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);

  async function onayla(): Promise<void> {
    setGonderiliyor(true);
    setHata(null);
    try {
      // ⚠️ Uç APPEND-ONLY ve bilinçli olarak idempotent DEĞİL: her çağrı ayrı
      //    bir irade beyanıdır, kendi zamanı ve metin sürümüyle kaydedilir.
      await apiFetch<unknown, '/me/consents'>('/me/consents', {
        method: 'POST',
        json: { type: tur, granted: true },
      });
      onOnaylandi();
    } catch (error) {
      setHata(error);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <Dialog open={acik} onOpenChange={(sonraki) => (sonraki ? null : onKapat())}>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">{govde.baslik}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-metin-soluk">
          {govde.aciklama}
        </DialogDescription>

        <ul className="mt-4 flex flex-col gap-2 text-sm text-metin">
          {govde.maddeler.map((madde) => (
            <li key={madde} className="flex gap-2">
              <span aria-hidden className="text-ikon">
                —
              </span>
              <span>{madde}</span>
            </li>
          ))}
        </ul>

        {hata ? <HataGosterimi error={hata} className="mt-4" /> : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="sessiz" onClick={onKapat} disabled={gonderiliyor}>
            Vazgeç
          </Button>
          <Button onClick={() => void onayla()} disabled={gonderiliyor}>
            {govde.onayMetni}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FotografIslemeRizasi(props: RizaModaliProps): React.ReactElement {
  return <RizaModali {...props} tur="PHOTO_PROCESSING" govde={FOTOGRAF_ISLEME} />;
}

export function YurtDisiAktarimRizasi(props: RizaModaliProps): React.ReactElement {
  return <RizaModali {...props} tur="CROSS_BORDER_TRANSFER" govde={YURT_DISI_AKTARIM} />;
}
