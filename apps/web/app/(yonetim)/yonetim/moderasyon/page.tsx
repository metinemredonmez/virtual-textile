import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { tarihSaat } from '@/lib/tarih';
import {
  DurumSekmeleri,
  ImlecSayfalama,
  SayfaBasligi,
  type DurumSekmesi,
} from '@/components/panel/duzen';
import { listeOku } from '@/lib/api/okuma';
import { baglanti, tekil, type AramaParametreleri } from '@/lib/sorgu';
import { tryOnSkoru, urunDurumu } from '../_lib/durum';
import type { AdminModerationWire, ProductStatusWire } from '@vt/contracts';
import { UrunKarari } from './karar';

/**
 * ÜRÜN MODERASYON KUYRUĞU.
 *
 * ⚠️ TABLO DEĞİL, SATIR KARTLARI. Her satır kendi karar formunu taşıyor
 *    (gerekçe alanı + iki düğme) ve bunu bir `<td>` içine sıkıştırmak,
 *    "bütçe aşılıyorsa sıkıştırma değil yeni bir düzen gerekir" kuralının
 *    tipik ihlali olurdu. Finansal tablo kalıbı (Stripe) burada geçerli değil:
 *    bu ekranda okunacak sayı değil, verilecek karar var.
 */
export const metadata: Metadata = {
  title: 'Ürün moderasyonu',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const YOL = '/yonetim/moderasyon';
const SAYFA_BOYUTU = 20;

/**
 * ⚠️ "Tümü" SEKMESİ YOK ve olamaz: `moderationQuerySchema` `status` alanına
 *    `.default('PENDING_REVIEW')` veriyor, yani parametre gönderilmediğinde uç
 *    "hepsi" değil "incelemedekiler" döndürüyor. Boş bir sekme "tümü" diye
 *    etiketlenseydi ekran, olmayan bir görünümün adını taşırdı.
 */
const SEKMELER: readonly DurumSekmesi[] = [
  { etiket: 'İncelemede', deger: 'PENDING_REVIEW' },
  { etiket: 'Yayında', deger: 'PUBLISHED' },
  { etiket: 'Reddedilen', deger: 'REJECTED' },
  { etiket: 'Taslak', deger: 'DRAFT' },
  { etiket: 'Arşiv', deger: 'ARCHIVED' },
];

function durumuCoz(ham: string | null): ProductStatusWire {
  const gecerli: readonly string[] = [
    'DRAFT',
    'PENDING_REVIEW',
    'PUBLISHED',
    'REJECTED',
    'ARCHIVED',
  ];
  return ham !== null && gecerli.includes(ham) ? (ham as ProductStatusWire) : 'PENDING_REVIEW';
}

export default async function ModerasyonPage({
  searchParams,
}: {
  searchParams: Promise<AramaParametreleri>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const durum = durumuCoz(tekil(params.durum));
  const imlec = tekil(params.imlec);
  const sorgu = { durum, imlec };

  const okuma = await listeOku<AdminModerationWire, '/admin/products/moderation'>(
    '/admin/products/moderation',
    baglanti(YOL, sorgu),
    { query: { status: durum, cursor: imlec ?? undefined, limit: SAYFA_BOYUTU } },
  );

  return (
    <section className="max-w-4xl">
      <SayfaBasligi
        baslik="Ürün moderasyonu"
        aciklama="Yayına alma yalnızca yöneticide; satıcı en fazla “incelemeye gönder” diyebilir. Red gerekçesi satıcının ürün ekranında görünen tek açıklamadır."
      />

      <div className="flex flex-col gap-4">
        <DurumSekmeleri yol={YOL} anahtar="durum" sekmeler={SEKMELER} secili={durum} />

        {!okuma.tamam ? (
          <SunucuHatasi govde={okuma.hata} />
        ) : okuma.veri.items.length === 0 ? (
          <p className="py-8 text-sm text-metin-soluk">
            {durum === 'PENDING_REVIEW'
              ? 'İnceleme kuyruğu boş. Satıcılar ürünlerini incelemeye gönderdikçe burada görünür.'
              : 'Bu durumda ürün yok.'}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {okuma.veri.items.map((urun) => (
                <UrunSatiri key={urun.id} urun={urun} />
              ))}
            </ul>

            <ImlecSayfalama
              ilkSayfaHref={baglanti(YOL, { ...sorgu, imlec: null })}
              sonrakiHref={
                okuma.veri.nextCursor === null
                  ? null
                  : baglanti(YOL, { ...sorgu, imlec: okuma.veri.nextCursor })
              }
              ilkSayfada={imlec === null}
            />
          </>
        )}
      </div>
    </section>
  );
}

function UrunSatiri({ urun }: { urun: AdminModerationWire }): React.ReactElement {
  const durum = urunDurumu(urun.status);
  const skor = tryOnSkoru(urun.tryOnScore);

  return (
    <li className="rounded-lg border border-kenar bg-zemin p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/*
            ⚠️ ÜRÜN ADI BAĞLANTI DEĞİL. Vitrin rotası `/urun/[slug]` YALNIZCA
               yayındaki ürünü gösteriyor; kuyruktaki ürünlerin çoğu
               PENDING_REVIEW ve bağlantı 404 verirdi. "Olmayan sayfaya bağlantı
               konmaz" kuralının bu ekrandaki karşılığı: slug metin olarak durur.
          */}
          <p className="font-medium">{urun.title}</p>
          <p className="text-xs text-metin-soluk">
            {urun.brandName} · {urun.sellerName} · {urun.categoryName}
          </p>
          <p className="rakam mt-1 text-xs text-metin-soluk">/{urun.slug}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge durum={durum.rozet}>{durum.metin}</Badge>
          {/*
            ⚠️ SKOR ROZETİ YALNIZCA ÖLÇÜLMÜŞSE ÇIKAR. `tryOnScore === null`
               "0 puan" değil "hiç hesaplanmadı" (görsel yüklenmemiş) demek;
               ikisini aynı göstermek, yöneticinin fotoğrafı kötü olan ürünle
               fotoğrafı olmayan ürünü karıştırması demekti.
          */}
          {skor ? (
            <Badge durum={skor.rozet}>Deneme uygunluğu {skor.metin}</Badge>
          ) : (
            <span className="text-xs text-metin-soluk">Deneme uygunluğu ölçülmedi</span>
          )}
        </div>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-metin-soluk">
        <div className="flex gap-1">
          <dt>Görsel:</dt>
          <dd className="rakam">{urun.imageCount}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Varyant:</dt>
          <dd className="rakam">{urun.variantCount}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Yapay zekâ etiketleri:</dt>
          <dd>{urun.aiTagsApproved ? 'satıcı onayladı' : 'satıcı onaylamadı'}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Oluşturma:</dt>
          <dd>{tarihSaat(urun.createdAt)}</dd>
        </div>
      </dl>

      {urun.statusReason ? (
        <p className="mt-3 rounded-md border border-kenar bg-yuzey p-2 text-sm">
          <span className="text-metin-soluk">Son karar gerekçesi: </span>
          {urun.statusReason}
        </p>
      ) : null}

      <div className="mt-4">
        <UrunKarari
          productId={urun.id}
          status={urun.status}
          aiTagsApproved={urun.aiTagsApproved}
          imageCount={urun.imageCount}
        />
      </div>
    </li>
  );
}
