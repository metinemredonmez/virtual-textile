import type { Metadata } from 'next';
import { list } from '@/lib/api/core';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { hesapFetch } from '@/lib/api/server-authed';
import type { WardrobeItemWire } from '@vt/contracts';
import { GardiropYonetimi } from './gardirop-yonetimi';
import { KombinOnerileri } from './kombin-onerileri';

export const metadata: Metadata = { title: 'Gardırobum' };

export const dynamic = 'force-dynamic';

const YOL = '/hesabim/gardirop';

/**
 * DİJİTAL GARDIROP.
 *
 * ⚠️ "BURAYA NASIL GELDİ" SORUSU EKRANDA CEVAPLANIR. Satın alınan ürün paket
 *    TESLİM EDİLDİĞİNDE gardıroba kendiliğinden düşüyor (`package.delivered`
 *    olayı → `apps/worker/jobs/wardrobe.auto-add.job.ts`). Kullanıcı bunu
 *    yapmadıysa ve ekran da söylemiyorsa, tanımadığı bir listeyi kendi
 *    fotoğraflarıyla dolu görür — bu, güven kaybının en sessiz biçimidir.
 *
 * ⚠️ `imageUrl` `mediaUrl()`DEN GEÇMEZ. Sunucu burada TAM adres gönderiyor:
 *    MANUAL parçada imzalı ve kısa ömürlü, PURCHASE parçada kalıcı public.
 *    Önüne medya kökü eklemek imzayı bozar ve görsel hiç açılmaz.
 */
export default async function GardiropPage() {
  let parcalar: WardrobeItemWire[];
  try {
    const sonuc = await hesapFetch<unknown, '/wardrobe'>('/wardrobe', YOL);
    parcalar = list<WardrobeItemWire>(sonuc).items;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const satinAlinan = parcalar.filter((parca) => parca.source === 'PURCHASE').length;

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Gardırobum</h1>
        <p className="mt-1 text-sm text-metin-soluk">
          Satın aldığınız ürünler{' '}
          <strong className="font-medium text-metin">
            teslim edildiğinde buraya kendiliğinden eklenir
          </strong>
          ; ayrıca kendi kıyafetlerinizi de ekleyebilirsiniz.
          {satinAlinan > 0 ? (
            <>
              {' '}
              Şu an <span className="rakam">{satinAlinan}</span> parça bu şekilde eklendi.
            </>
          ) : null}{' '}
          Bir parçayı silmek, o parçanın fotoğrafını da depodan kaldırır.
        </p>
      </header>

      <GardiropYonetimi parcalar={parcalar} />

      {parcalar.length > 0 ? (
        <div className="border-t border-kenar pt-8">
          <KombinOnerileri parcalar={parcalar} />
        </div>
      ) : null}
    </section>
  );
}
