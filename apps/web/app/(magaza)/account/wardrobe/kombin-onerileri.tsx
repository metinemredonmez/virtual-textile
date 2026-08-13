'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GARDIROP_KATEGORISI } from '../_lib/etiketler';
import type { OutfitSuggestionWire, WardrobeItemWire } from '@vt/contracts';

/**
 * KOMBİN ÖNERİLERİ — İSTEK ÜZERİNE.
 *
 * ⚠️ SAYFA AÇILIRKEN ÇEKİLMİYOR ve bu bilinçli bir karar. `GET
 *    /v1/wardrobe/outfit-suggestions` gardırop modülünde durmasına rağmen
 *    STİL DANIŞMANINI çalıştırıyor (`wardrobe.ports.ts` → `WardrobeStylistPort`)
 *    ve orada kota/bütçe kapıları var. Her gardırop görüntülemesinde otomatik
 *    çağırmak, kullanıcının günlük AI hakkını o hiç istemeden yakar ve
 *    `AI_BUDGET_EXCEEDED` ekranını gardırobun kendisine bağlardı.
 *
 * ⚠️ `limit` küçük tutuluyor (sunucu varsayılanı 3, tavanı 10): büyük bir limit
 *    tek istekte aynı hakkı yer.
 */
const LIMIT = 3;

const UYUM_ROZETI = {
  HARMONIOUS: { metin: 'Renkler uyumlu', durum: 'olumlu' },
  ACCEPTABLE: { metin: 'Kabul edilebilir', durum: 'notr' },
  CLASHING: { metin: 'Renkler çakışıyor', durum: 'uyari' },
  UNKNOWN: { metin: 'Uyum belirlenemedi', durum: 'notr' },
} satisfies Record<
  OutfitSuggestionWire['harmony'],
  { metin: string; durum: 'olumlu' | 'notr' | 'uyari' }
>;

export function KombinOnerileri({
  parcalar,
}: {
  parcalar: WardrobeItemWire[];
}): React.ReactElement {
  const [oneriler, setOneriler] = React.useState<OutfitSuggestionWire[] | null>(null);
  const [hata, setHata] = React.useState<unknown>(null);
  const [yukleniyor, setYukleniyor] = React.useState(false);

  const adlar = new Map(
    parcalar.map((parca) => [parca.id, parca.label ?? GARDIROP_KATEGORISI[parca.category]]),
  );

  async function getir(): Promise<void> {
    setYukleniyor(true);
    setHata(null);
    try {
      const { data } = await apiFetch<OutfitSuggestionWire[], '/wardrobe/outfit-suggestions'>(
        '/wardrobe/outfit-suggestions',
        { query: { limit: LIMIT } },
      );
      setOneriler(data);
    } catch (error) {
      setHata(error);
    } finally {
      setYukleniyor(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-metin">Kombin önerileri</h2>
          <p className="text-sm text-metin-soluk">
            Gardırobunuzdaki parçalardan kombin önerilir. Öneri üretmek yapay zekâ hakkınızdan
            düşer, bu yüzden yalnızca siz istediğinizde çalışır.
          </p>
        </div>
        <Button variant="ikincil" size="sm" onClick={() => void getir()} disabled={yukleniyor}>
          <Sparkles className="text-ikon" />
          {yukleniyor ? 'Hazırlanıyor…' : oneriler ? 'Yeniden öner' : 'Kombin öner'}
        </Button>
      </div>

      {hata ? <HataGosterimi error={hata} onRetry={() => void getir()} /> : null}

      {oneriler !== null && oneriler.length === 0 ? (
        <p className="text-sm text-metin-soluk">
          Bu gardıropla kombin üretilemedi. Farklı kategorilerden birkaç parça daha eklediğinizde
          öneriler ortaya çıkar.
        </p>
      ) : null}

      {oneriler && oneriler.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {oneriler.map((oneri, index) => {
            const uyum = UYUM_ROZETI[oneri.harmony];
            return (
              <li key={`${oneri.title}-${index}`} className="rounded-lg border border-kenar p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-metin">{oneri.title}</p>
                  {/* Renk uyumu bir DURUMdur — rozetin renkli olmasının sebebi bu. */}
                  <Badge durum={uyum.durum}>{uyum.metin}</Badge>
                </div>
                <p className="mt-1 text-sm text-metin-soluk">{oneri.rationale}</p>
                <p className="mt-2 text-sm text-metin-soluk">
                  {/* ⚠️ Sunucu yalnızca `itemIds` gönderiyor; adlar eldeki
                      gardırop listesinden eşleniyor. Eşleşmeyen kimlik ham
                      basılmaz — kullanıcıya uuid göstermek bilgi değil gürültü. */}
                  {oneri.itemIds
                    .map((id) => adlar.get(id))
                    .filter(Boolean)
                    .join(' + ')}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
