import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { SayfaBasligi } from '@/components/panel/duzen';
import { GorselYukleme } from '../../_bilesenler/gorsel-yukleme';
import { oneriler, skorRozeti, sorunlariCoz } from '@/components/tryon/tryon-oneriler';
import { urunGetir } from '../../../_lib/veri';

export const metadata: Metadata = { title: 'Görseller · Satıcı paneli' };
export const dynamic = 'force-dynamic';

const ACI_ETIKETLERI: Record<string, string> = {
  FRONT: 'Ön',
  BACK: 'Arka',
  SIDE: 'Yan',
  MODEL: 'Model üzerinde',
  DETAIL: 'Detay',
  FLATLAY: 'Düz çekim',
};

/**
 * ÜRÜN GÖRSELLERİ.
 *
 * ⚠️ MEVCUT GÖRSEL DÜZENLENEMİYOR — SİLME, SIRALAMA VE BİRİNCİL DEĞİŞTİRME
 *    UCU YOK. Medya denetleyicisinde satıcı için yalnız İKİ uç var
 *    (`media.controller.ts`): bilet ve onay. `sortOrder` ile `isPrimary`
 *    SADECE onay anında yazılabiliyor. Bu yüzden aşağıdaki liste salt okunur
 *    ve ekran bunu açıkça söylüyor: sürüklenebilir görünen ama hiçbir şey
 *    yapmayan bir liste, "basınca 404 veren düğme"nin sessiz hâli olurdu.
 *
 * ⚠️ GÖRSELLERİN KENDİSİ ÇİZİLMİYOR, ANAHTARLARI YAZILIYOR. Sebep ölçülmüş:
 *    seed'in işaret ettiği R2 nesneleri kovaya hiç yüklenmemiş; `next/image`
 *    üstteki 404'ü 500'e çeviriyor (AGENTS.md §11). Yeni yüklenen görselin
 *    adresi onay yanıtında geliyor ama listede tek gerçek alan `storageKey`.
 *    Yüklenemeyen 6 gri kutu çizmek yerine, satıcının hangi açıları eklediğini
 *    gösteren bir liste daha çok bilgi taşıyor.
 */
export default async function SaticiUrunGorselleriPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const sonuc = await urunGetir(id, `/seller/products/${id}/images`);

  if (!sonuc.tamam) {
    return (
      <section>
        <Geri id={id} />
        <SunucuHatasi govde={sonuc.hata} className="mt-4 max-w-xl" />
      </section>
    );
  }

  const urun = sonuc.veri;
  const eksikler = oneriler(sorunlariCoz(urun.tryOnIssues));

  return (
    <section className="flex flex-col gap-8">
      {/*
        ⚠️ BAŞLIK `SayfaBasligi`DAN — elle `<h1>` yazan beş panel sayfasından
           biriydi ve ayracı (`border-b border-kenar pb-4`) taşımıyordu.
      */}
      <SayfaBasligi
        ustBaglanti={<Geri id={id} />}
        baslik={
          <span className="flex flex-wrap items-center gap-3">
            {urun.title} · Görseller
            {urun.tryOnScore === null ? (
              <Badge>Henüz ölçülmedi</Badge>
            ) : (
              <Badge durum={skorRozeti(urun.tryOnScore)}>
                <span className="rakam">{urun.tryOnScore}</span>/100
              </Badge>
            )}
          </span>
        }
        aciklama={
          eksikler.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {eksikler.map((oneri) => (
                <li key={oneri.kod} className="flex gap-2">
                  <span className="rakam shrink-0 text-metin-soluk">+{oneri.kazanc}</span>
                  <span className="text-metin">{oneri.eylem}</span>
                </li>
              ))}
            </ul>
          ) : null
        }
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold">Yüklenmiş görseller</h2>
        {urun.images.length === 0 ? (
          <p className="max-w-prose rounded-md border border-kenar bg-yuzey p-4 text-sm text-metin-soluk">
            Bu ürüne henüz görsel eklenmedi. Sanal deneme kıyafeti farklı açılardan anlamak zorunda:
            en az bir ön, bir arka ve bir yan görsel yükleyin. Görsel eklenmeden ürün yayına
            alınamaz.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {urun.images.map((gorsel) => (
                <li
                  key={gorsel.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-kenar p-3 text-sm"
                >
                  <span className="font-medium text-metin">
                    {ACI_ETIKETLERI[gorsel.angle] ?? gorsel.angle}
                  </span>
                  {gorsel.isPrimary ? (
                    <span className="flex items-center gap-1 text-metin-soluk">
                      {/* ⚠️ İkon RENKSİZ: birincil olmak bir durum değil, bir seçim. */}
                      <Star className="size-4 text-ikon" strokeWidth={1.5} />
                      Birincil
                    </span>
                  ) : null}
                  <span className="ml-auto truncate text-xs text-metin-soluk">
                    {gorsel.storageKey}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 max-w-prose text-xs text-metin-soluk">
              Yüklenmiş bir görselin sırası, birincilliği veya silinmesi bu ekrandan
              değiştirilemiyor; sıra ve birincil seçimi yalnızca yükleme sırasında belirleniyor.
            </p>
          </>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Yeni görsel yükle</h2>
        <GorselYukleme productId={urun.id} />
      </div>
    </section>
  );
}

function Geri({ id }: { id: string }): React.ReactElement {
  return (
    <Link
      href={`/seller/products/${id}`}
      className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
    >
      <ChevronLeft className="size-4 text-ikon" strokeWidth={1.5} />
      Ürün
    </Link>
  );
}
