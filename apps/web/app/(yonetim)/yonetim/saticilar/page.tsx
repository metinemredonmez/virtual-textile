import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { tarih } from '@/lib/tarih';
import {
  DurumSekmeleri,
  ImlecSayfalama,
  SayfaBasligi,
  type DurumSekmesi,
} from '@/components/panel/duzen';
import { listeOku } from '@/lib/api/okuma';
import { baglanti, tekil, type AramaParametreleri } from '@/lib/sorgu';
import { saticiDurumu } from '../_lib/durum';
import type { AdminSellerWire, SellerStatusWire } from '@vt/contracts';

/**
 * SATICI LİSTESİ — başvuru kuyruğu ve mağaza yönetimi tek ekranda.
 *
 * ⚠️ AYRI BİR "BAŞVURULAR" EKRANI YOK ve olmamalı: şemada `SellerApplication`
 *    diye bir tablo yok, başvuru `status = PENDING` olan Seller kaydının
 *    KENDİSİ (`admin.ports.ts:44`). İki ekran yazmak, aynı satırın iki farklı
 *    yerde iki farklı görünümü olması demekti.
 */
export const metadata: Metadata = {
  title: 'Satıcılar',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const YOL = '/yonetim/saticilar';
const SAYFA_BOYUTU = 20;

const SEKMELER: readonly DurumSekmesi[] = [
  { etiket: 'Tümü', deger: null },
  { etiket: 'Bekleyen', deger: 'PENDING' },
  { etiket: 'Onaylı', deger: 'APPROVED' },
  { etiket: 'Askıda', deger: 'SUSPENDED' },
  { etiket: 'Reddedilen', deger: 'REJECTED' },
];

/**
 * ⚠️ Sekme değeri API'ye GİTMEDEN ÖNCE doğrulanıyor. Adres çubuğuna elle
 *    `?durum=YOK` yazan biri aksi hâlde 400 alır ve tablo yerine hata görürdü;
 *    bilinmeyen değer sessizce "tümü"ne düşer.
 */
function durumuCoz(ham: string | null): SellerStatusWire | null {
  const gecerli: readonly string[] = ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'];
  return ham !== null && gecerli.includes(ham) ? (ham as SellerStatusWire) : null;
}

export default async function SaticilarPage({
  searchParams,
}: {
  searchParams: Promise<AramaParametreleri>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const durum = durumuCoz(tekil(params.durum));
  const ham = tekil(params.q);
  // ⚠️ `sellerListQuerySchema` aramada en az 2 karakter istiyor; tek harflik
  //    girdi 400 döndürürdü. Kısa metin aranmaz, sessizce yok sayılır.
  const q = ham !== null && ham.length >= 2 ? ham : null;
  const imlec = tekil(params.imlec);

  const sorgu = { durum, q, imlec };
  const okuma = await listeOku<AdminSellerWire, '/admin/sellers'>(
    '/admin/sellers',
    baglanti(YOL, sorgu),
    {
      query: {
        status: durum ?? undefined,
        q: q ?? undefined,
        cursor: imlec ?? undefined,
        limit: SAYFA_BOYUTU,
      },
    },
  );

  return (
    <section>
      <SayfaBasligi
        baslik="Satıcılar"
        aciklama="Başvuru ayrı bir kayıt değil, “Bekleyen” durumundaki mağazanın kendisidir. Karar vermek için satıra girin."
      />

      <div className="flex flex-col gap-4">
        <DurumSekmeleri
          yol={YOL}
          anahtar="durum"
          sekmeler={SEKMELER}
          secili={durum}
          digerSorgu={{ q }}
        />

        {/*
          ⚠️ FORM `method="get"` VE JAVASCRIPT YOK. Arama kutusunu bir İstemci
             Bileşenine çevirmek bu ekrana hiçbir şey katmazdı: sonuç zaten
             sunucuda üretiliyor ve sonucun adresi paylaşılabilir olmalı.
        */}
        <form action={YOL} method="get" className="flex flex-wrap gap-2">
          {durum !== null ? <input type="hidden" name="durum" value={durum} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            minLength={2}
            maxLength={100}
            placeholder="Unvan, mağaza adı veya e-posta"
            aria-label="Satıcı ara"
            className="h-9 w-full max-w-sm rounded-md border border-kenar bg-zemin px-3 text-sm placeholder:text-metin-soluk"
          />
          <button
            type="submit"
            className="h-9 rounded-md border border-kenar px-3 text-sm hover:bg-yuzey-vurgulu"
          >
            Ara
          </button>
        </form>

        {!okuma.tamam ? (
          <SunucuHatasi govde={okuma.hata} />
        ) : okuma.veri.items.length === 0 ? (
          /*
            ⚠️ BOŞ DURUM NE YAPILACAĞINI SÖYLER (`design-system.md`). "Kayıt
               yok" demek, yöneticinin filtreyi mi yoksa gerçekten kuyruğu mu
               boş olduğunu anlamamasına yol açar.
          */
          <p className="py-8 text-sm text-metin-soluk">
            {durum === null && q === null
              ? 'Kayıtlı satıcı yok. Satıcılar başvuru formundan kendileri kayıt olur; buradan mağaza açılamaz.'
              : 'Bu filtreyle eşleşen satıcı yok. Durum sekmesini değiştirin ya da aramayı temizleyin.'}
          </p>
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH scope="col">Mağaza</TH>
                  <TH scope="col">Ticari unvan</TH>
                  <TH scope="col">İletişim</TH>
                  <TH scope="col">Durum</TH>
                  <TH scope="col" sayisal>
                    Ürün
                  </TH>
                  <TH scope="col">Başvuru</TH>
                </TR>
              </THead>
              <TBody>
                {okuma.veri.items.map((satici) => {
                  const gorunum = saticiDurumu(satici.status);
                  return (
                    <TR key={satici.id}>
                      <TD>
                        <Link
                          href={`${YOL}/${satici.id}`}
                          className="font-medium text-metin hover:underline"
                        >
                          {satici.displayName}
                        </Link>
                        {/* ⚠️ Vitrin adresi METİN olarak duruyor: `/magaza/[slug]`
                            rotası bu depoda YOK (AGENTS.md §10). */}
                        {satici.storeSlug ? (
                          <span className="block text-xs text-metin-soluk">
                            /{satici.storeSlug}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-metin-soluk">{satici.legalName}</TD>
                      <TD className="text-metin-soluk">{satici.contactEmail}</TD>
                      <TD>
                        <Badge durum={gorunum.rozet}>{gorunum.metin}</Badge>
                      </TD>
                      <TD sayisal>{satici.productCount}</TD>
                      <TD className="whitespace-nowrap text-metin-soluk">
                        {tarih(satici.createdAt)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>

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
