import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { tarih, tarihSaat } from '@/lib/tarih';
import { SayfaBasligi } from '@/components/panel/duzen';
import { tekilOku } from '@/lib/api/okuma';
import { belgeDurumu, saticiDurumu } from '../../_lib/durum';
import type { AdminSellerWire } from '@vt/contracts';
import { SaticiKarari } from './karar';

/**
 * SATICI DETAYI — kararın verildiği ekran.
 *
 * ⚠️ `notFound()` ÇAĞRILMIYOR ve bu bir ihmal değil. `AGENTS.md` §8: bir
 *    Suspense sınırının ARDINDAKİ `notFound()` HTTP 200 döner, yani kural
 *    "notFound çağıran rotanın üstünde `loading.tsx` olmaz". Buradaki
 *    `loading.tsx` grup kökünde (`(yonetim)/loading.tsx`) ve BAŞKA AJANLARIN
 *    ekranları da onun altında; silmek onların iskeletini götürürdü. Bu yüzden
 *    olmayan satıcıda sunucunun kendi 404 zarfı gösteriliyor:
 *    "Bu mağaza bulunamadı." — kullanıcı doğru bilgiyi alıyor, HTTP kodu 200
 *    kalıyor. Bedeli kabul edilebilir çünkü panel `vt_sid` kapısının arkasında
 *    ve `robots: noindex`; §8'in koruduğu şey (arama motorunun uydurma adresi
 *    indekslemesi) burada zaten imkânsız.
 */
export const metadata: Metadata = {
  title: 'Satıcı detayı',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SaticiDetayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const yol = `/yonetim/saticilar/${id}`;

  const okuma = await tekilOku<AdminSellerWire, `/admin/sellers/${string}`>(
    `/admin/sellers/${id}`,
    yol,
  );

  if (!okuma.tamam) {
    return (
      <section>
        <GeriBaglantisi />
        <SunucuHatasi govde={okuma.hata} className="mt-4 max-w-md" />
      </section>
    );
  }

  const satici = okuma.veri;
  const gorunum = saticiDurumu(satici.status);

  return (
    <section className="max-w-4xl">
      <GeriBaglantisi />

      <SayfaBasligi
        baslik={satici.displayName}
        aciklama={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge durum={gorunum.rozet}>{gorunum.metin}</Badge>
            <span>{satici.legalName}</span>
          </span>
        }
      />

      {/*
        ⚠️ `statusReason` KARARIN TEK AÇIKLAMASI. Red ve askı gerekçesi bu alanda
           tutuluyor, başka hiçbir yerde görünmüyor (denetim izi hariç) ve
           satıcıya giden bildirim de bu metni taşıyor. Gizlenirse yönetici,
           meslektaşının neden askıya aldığını bilmeden askıyı kaldırır.
      */}
      {satici.statusReason ? (
        <p className="mb-6 rounded-md border border-kenar bg-yuzey p-3 text-sm">
          <span className="text-metin-soluk">Son karar gerekçesi: </span>
          {satici.statusReason}
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        <div>
          <h2 className="mb-3 text-sm font-semibold">Başvuru bilgileri</h2>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Alan etiket="Ticari unvan" deger={satici.legalName} />
            <Alan etiket="Vergi dairesi" deger={satici.taxOffice} />
            <Alan etiket="İletişim e-postası" deger={satici.contactEmail} />
            <Alan etiket="İletişim telefonu" deger={satici.contactPhone} />
            <Alan etiket="Vitrin adresi" deger={satici.storeSlug ? `/${satici.storeSlug}` : '—'} />
            <Alan etiket="Ürün sayısı" deger={String(satici.productCount)} sayisal />
            <Alan etiket="Kalite skoru" deger={String(satici.qualityScore)} sayisal />
            <Alan etiket="Tatil modu" deger={satici.vacationMode ? 'Açık' : 'Kapalı'} />
            <Alan etiket="Başvuru tarihi" deger={tarihSaat(satici.createdAt)} />
            <Alan
              etiket="Onay tarihi"
              deger={satici.approvedAt ? tarihSaat(satici.approvedAt) : 'Henüz onaylanmadı'}
            />
          </dl>

          {/*
            ⚠️ VERGİ NUMARASI VE IBAN BU EKRANDA YOK, ÇÜNKÜ UÇTA YOK. İkisi de
               alan bazlı şifreli saklanıyor ve yönetim yanıtına hiç konmuyor.
               "Boş görünüyor" demek yerine yokluğun SEBEBİ yazılıyor; aksi
               hâlde birileri bir gün bu alanları yanıta ekleyerek "eksiği
               tamamladığını" sanır.
          */}
          <p className="mt-3 max-w-prose text-xs text-metin-soluk">
            Vergi numarası ve IBAN yönetim yanıtında yer almaz; ikisi de şifreli saklanır ve
            yalnızca ödeme akışında çözülür.
          </p>

          <p className="mt-1 max-w-prose text-xs text-metin-soluk">
            Ödeme sağlayıcısı alt üye işyeri:{' '}
            {satici.submerchantKeyPresent
              ? 'açık.'
              : 'henüz açılmadı. Onaydan sonra finans işçisi açar; açılana kadar bu mağazaya hakediş aktarılamaz.'}
          </p>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold">Belgeler</h2>

          {satici.documents.length === 0 ? (
            <p className="text-sm text-metin-soluk">Bu başvuruda yüklenmiş belge yok.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH scope="col">Belge</TH>
                  <TH scope="col">Tür</TH>
                  <TH scope="col">İnceleme</TH>
                  <TH scope="col">İnceleme tarihi</TH>
                </TR>
              </THead>
              <TBody>
                {satici.documents.map((belge) => {
                  const durum = belgeDurumu(belge.approved);
                  return (
                    <TR key={belge.id}>
                      {/* ⚠️ DOSYA ADI METİN, BAĞLANTI DEĞİL — gerekçe aşağıda. */}
                      <TD>{belge.fileName}</TD>
                      <TD className="text-metin-soluk">{belge.type}</TD>
                      <TD>
                        <Badge durum={durum.rozet}>{durum.metin}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-metin-soluk">
                        {belge.reviewedAt ? tarih(belge.reviewedAt) : '—'}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}

          {/*
            ⚠️⚠️ BELGE GÖRÜNTÜLEME BUGÜN YAZILAMAZ — bu bir tasarım tercihi değil,
                 ÖLÇÜLMÜŞ bir veri boşluğu. `admin.bridges.ts:213` belgenin
                 `storageKey`ini bilerek dışarı vermiyor ("indirme ayrı,
                 denetlenen bir akıştır") ve o akışın ucu HİÇ YAZILMAMIŞ:
                 `seller-docs/` öneki imzalı URL üretebiliyor
                 (`r2.config.ts:143`, 300 sn TTL) ama onu çağıran bir yönetim
                 ucu yok. Elimizde yalnız `fileName` var.

                 Bu yüzden buraya "Görüntüle" düğmesi KONMADI: basınca hiçbir
                 şey yapamayacak yedinci bir düğme olurdu — kaldırılan yedi 404
                 düğmesiyle aynı sınıf. Yokluk METİNLE söyleniyor ki yönetici
                 belgeyi incelemeden onay vermemesi gerektiğini bilsin.
          */}
          <p className="mt-3 max-w-prose text-xs text-metin-soluk">
            Belgelerin kendisi bu ekrandan açılamaz: yönetim ucu yalnızca dosya adını ve inceleme
            durumunu döndürüyor, imzalı indirme bağlantısı üreten bir uç henüz yok. Belge incelemesi
            bugün panel dışında yapılır.
          </p>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold">Karar</h2>
          <SaticiKarari sellerId={satici.id} status={satici.status} />
        </div>
      </div>
    </section>
  );
}

function GeriBaglantisi(): React.ReactElement {
  return (
    <Link
      href="/yonetim/saticilar"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-metin-soluk hover:text-metin"
    >
      <ArrowLeft className="size-4 text-ikon" strokeWidth={1.5} />
      Satıcılar
    </Link>
  );
}

function Alan({
  etiket,
  deger,
  sayisal,
}: {
  etiket: string;
  deger: string;
  sayisal?: boolean;
}): React.ReactElement {
  return (
    <div>
      <dt className="text-xs text-metin-soluk">{etiket}</dt>
      <dd className={sayisal ? 'rakam text-sm' : 'text-sm'}>{deger}</dd>
    </div>
  );
}
