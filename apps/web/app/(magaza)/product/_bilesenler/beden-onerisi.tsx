'use client';

import * as React from 'react';
import { Ruler } from 'lucide-react';
import { useLocale } from 'next-intl';
import {
  bodyProfileSchema,
  type BodyProfileInput,
  type Locale,
  type SizeChartWire,
} from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldMessage } from '@/components/hata/alan-hatalari';
import { OlcuTablosu } from './olcu-tablosu';
import { useBedenOnerisi } from './use-beden-onerisi';

/**
 * BEDEN ÖNERİSİ KUTUSU.
 *
 * ⚠️ GÜVEN EŞİĞİN ALTINDAYSA ÖNERİ DEĞİL ÖLÇÜ TABLOSU gösterilir. Karar
 *    sunucunun (`showRecommendation`); burada yalnızca uygulanır. Zayıf bir
 *    öneriyi "düşük güvenli" etiketiyle göstermek de yanlış olurdu: kullanıcı
 *    etiketi değil bedeni okur.
 *
 * ⚠️ Tablo, ürün detayından gelen `sizeChart` ile SUNUCUDA çizilir; öneri ucu
 *    çağrılmasa bile kullanıcı kendi kararını verebilir. Tabloyu öneri
 *    yanıtına bağlamak, misafire hiçbir şey göstermemek olurdu.
 */

const ALANLAR = [
  { ad: 'heightCm', etiket: 'Boy (cm)' },
  { ad: 'weightKg', etiket: 'Kilo (kg)' },
  { ad: 'chestCm', etiket: 'Göğüs (cm)' },
  { ad: 'waistCm', etiket: 'Bel (cm)' },
  { ad: 'hipCm', etiket: 'Kalça (cm)' },
] as const satisfies readonly { ad: keyof BodyProfileInput; etiket: string }[];

export interface BedenOnerisiProps {
  variantId: string | null;
  /** Ürün detayından gelir; öneri ucu hiç çağrılmasa da tablo çizilir. */
  sizeChart: SizeChartWire | null;
  /** Girişli kullanıcıda kayıtlı vücut profili var; açılışta sorulur. */
  girisYapildi: boolean;
}

export function BedenOnerisi({
  variantId,
  sizeChart,
  girisYapildi,
}: BedenOnerisiProps): React.ReactElement | null {
  const locale = useLocale() as Locale;
  const { oneri, yukleniyor, hata, iste } = useBedenOnerisi(variantId, girisYapildi);
  const [formAcik, setFormAcik] = React.useState(false);
  const [degerler, setDegerler] = React.useState<Record<string, string>>({});
  const [alanHatalari, setAlanHatalari] = React.useState<Record<string, string>>({});

  const tablo = oneri?.sizeChart ?? sizeChart;
  const siralama = oneri?.orderedSizes ?? (tablo ? Object.keys(tablo) : []);

  if (!tablo && !oneri) return null;

  function gonder(event: React.FormEvent): void {
    event.preventDefault();

    const ham: Record<string, number | undefined> = {};
    for (const alan of ALANLAR) {
      const metin = degerler[alan.ad]?.trim();
      // Boş alan GÖNDERİLMEZ: `undefined` "bilmiyorum" demek, 0 değil.
      if (metin) ham[alan.ad] = Number(metin);
    }

    /*
     * ⚠️ Doğrulama `@vt/contracts` şemasıyla yapılır, elle yazılmış min/max ile
     *    değil. Sunucu aynı şemayı kullanıyor; ikinci bir kopya, sınır bir gün
     *    değiştiğinde istemcinin sunucudan farklı davranması demek olurdu.
     */
    const sonuc = bodyProfileSchema.safeParse(ham);
    if (!sonuc.success) {
      const harita: Record<string, string> = {};
      for (const issue of sonuc.error.issues) {
        const yol = issue.path.join('.');
        // Zod'un İngilizce varsayılanları ortak eşlemeden GÖSTERİLEN DİLE çevrilir.
        harita[yol] = fieldMessage({ path: yol, message: issue.message, rule: issue.code }, locale);
      }
      setAlanHatalari(harita);
      return;
    }

    setAlanHatalari({});
    iste(sonuc.data);
  }

  return (
    <div className="rounded-md border border-kenar p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-metin">
          <Ruler className="size-4 text-ikon" />
          Beden önerisi
        </h3>
        <Button variant="bag" size="sm" onClick={() => setFormAcik((acik) => !acik)}>
          {formAcik ? 'Kapat' : 'Ölçülerimi gir'}
        </Button>
      </div>

      {yukleniyor ? <p className="mt-3 text-sm text-metin-soluk">Hesaplanıyor…</p> : null}

      {oneri?.showRecommendation ? (
        <p className="mt-3 text-sm text-metin">
          Önerilen beden: <span className="rakam font-semibold">{oneri.recommendedSize}</span>
          {oneri.alternativeSize ? (
            <span className="text-metin-soluk"> · alternatif {oneri.alternativeSize}</span>
          ) : null}
        </p>
      ) : null}

      {/* ⚠️ Gerekçeler SUNUCUDAN gelir ve olduğu gibi gösterilir; burada
          yeniden yazılmaz — aynı olgu iki farklı cümleyle anlatılmasın. */}
      {oneri && oneri.reasons.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-metin-soluk">
          {oneri.reasons.map((gerekce) => (
            <li key={gerekce.code}>{gerekce.message}</li>
          ))}
        </ul>
      ) : null}

      {formAcik ? (
        <form className="mt-4 grid grid-cols-2 gap-3" onSubmit={gonder}>
          {ALANLAR.map((alan) => (
            <div key={alan.ad} className="flex flex-col gap-1">
              <Label htmlFor={`olcu-${alan.ad}`} className="text-xs">
                {alan.etiket}
              </Label>
              <Input
                id={`olcu-${alan.ad}`}
                inputMode="numeric"
                className="rakam"
                value={degerler[alan.ad] ?? ''}
                onChange={(event) =>
                  setDegerler((onceki) => ({ ...onceki, [alan.ad]: event.target.value }))
                }
              />
              {alanHatalari[alan.ad] ? (
                <span className="text-xs text-tehlike">{alanHatalari[alan.ad]}</span>
              ) : null}
            </div>
          ))}

          <div className="col-span-2">
            <Button type="submit" variant="ikincil" size="sm" disabled={yukleniyor}>
              Bedenimi öner
            </Button>
            {/* ⚠️ Ölçüler SAKLANMAZ: sunucu yalnızca bu hesapta kullanır. */}
            <p className="mt-2 text-xs text-metin-soluk">
              Girdiğiniz ölçüler kaydedilmez, yalnızca bu hesaplamada kullanılır.
            </p>
          </div>
        </form>
      ) : null}

      {hata ? <HataGosterimi error={hata} className="mt-3" /> : null}

      {tablo ? (
        <div className="mt-4">
          <OlcuTablosu
            tablo={tablo}
            siralamaBedenleri={siralama}
            vurgulananBeden={oneri?.showRecommendation ? oneri.recommendedSize : null}
          />
          {oneri ? <p className="mt-2 text-xs text-metin-soluk">{oneri.disclaimer}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
