import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReturnStatusWire } from '@vt/contracts';
import { list } from '@/lib/api/core';
import { hesapFetch } from '@/lib/api/server-authed';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Fiyat } from '@/components/fiyat/fiyat';
import { tarih } from '@/lib/tarih';
import { BosSonuc, DurumSekmeleri, ImlecSayfalama, SayfaBasligi } from '@/components/panel/duzen';
import { IADE_DURUMU, IADE_SEBEBI, SUZGEC_SIRASI } from './_lib/etiketler';
import type { SellerReturnWire } from '@vt/contracts';

export const metadata: Metadata = { title: 'İadeler' };

export const dynamic = 'force-dynamic';

const YOL = '/seller/returns';
const SAYFA_BOYU = 9;

function durumOku(ham: string | undefined): ReturnStatusWire | null {
  if (!ham) return null;
  return SUZGEC_SIRASI.find((durum) => durum === ham) ?? null;
}

/**
 * SATICI İADE LİSTESİ.
 *
 * Uç: `GET /v1/seller/returns`.
 *
 * ⚠️ KAPSAM KALEM ÜZERİNDEN KURULUYOR: iade TALEBİ siparişe aittir, sipariş çok
 *    satıcılı olabilir. Sunucu yalnızca satıcının kendi kalemlerini içeren
 *    talepleri döndürüyor ve talebin İÇİNDEKİ kalemleri de satıcıya göre
 *    süzüyor. Yani buradaki tutarlar "iadenin tamamı" değil, satıcıyı ilgilendiren
 *    kısmıdır — `refundAmountMinor` hariç, o talebin tamamına ait.
 */
export default async function SaticiIadelerPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string; imlec?: string }>;
}) {
  const params = await searchParams;
  const durum = durumOku(params.durum);
  const imlec = params.imlec ?? null;

  let sonuc;
  try {
    sonuc = await hesapFetch<unknown, '/seller/returns'>('/seller/returns', YOL, {
      query: { limit: SAYFA_BOYU, status: durum ?? undefined, cursor: imlec ?? undefined },
    });
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const { items, nextCursor } = list<SellerReturnWire>(sonuc);

  const sonrakiYol = (imlecDegeri: string): string => {
    const arama = new URLSearchParams();
    if (durum) arama.set('durum', durum);
    arama.set('imlec', imlecDegeri);
    return `${YOL}?${arama.toString()}`;
  };

  return (
    <section className="flex flex-col gap-6">
      <SayfaBasligi
        baslik="İadeler"
        aciklama="Karar verilmeyen talepler müşteriyi bekletir; kararınız denetim kaydına yazılır."
      />

      <DurumSekmeleri
        etiket="İade süzgeci"
        yol={YOL}
        anahtar="durum"
        secili={durum}
        sekmeler={[
          { etiket: 'Tümü', deger: null },
          ...SUZGEC_SIRASI.map((deger) => ({ etiket: IADE_DURUMU[deger].metin, deger })),
        ]}
      />

      {items.length === 0 ? (
        /* ⚠️ İKİ AYRI BOŞLUK SEBEBİ, İKİ AYRI CÜMLE: hiç talep yok mu, yoksa
           süzgeç mi eşleşmedi? Tek cümle yazılsaydı süzgecini unutmuş satıcı
           "hiç iade gelmemiş" sanardı. */
        <BosSonuc
          baslik={durum ? 'Bu süzgece uyan iade talebi yok.' : 'Henüz iade talebi gelmedi.'}
          aciklama="İade talebi geldiğinde burada görünür ve kararınız beklenir."
          eylem={
            durum ? (
              <Button variant="ikincil" size="sm" asChild>
                <Link href={YOL}>Süzgeci temizle</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH scope="col">İade no</TH>
              <TH scope="col">Sipariş</TH>
              <TH scope="col">Durum</TH>
              <TH scope="col">Sebep</TH>
              <TH scope="col">Talep tarihi</TH>
              <TH scope="col" sayisal>
                Kalem
              </TH>
              <TH scope="col" sayisal>
                İade tutarı
              </TH>
            </TR>
          </THead>
          <TBody>
            {items.map((iade) => {
              const durumEtiketi = IADE_DURUMU[iade.status];
              return (
                <TR key={iade.id}>
                  <TD>
                    <Link
                      href={`/seller/returns/${iade.id}`}
                      className="rakam font-medium text-metin hover:underline"
                    >
                      {iade.returnNumber}
                    </Link>
                  </TD>
                  <TD className="rakam text-metin-soluk">{iade.orderNumber}</TD>
                  <TD>
                    <Badge durum={durumEtiketi.rozet}>{durumEtiketi.metin}</Badge>
                  </TD>
                  <TD className="text-metin-soluk">{IADE_SEBEBI[iade.reason]}</TD>
                  <TD className="rakam text-metin-soluk">{tarih(iade.createdAt)}</TD>
                  <TD sayisal>{iade.items.length}</TD>
                  <TD sayisal>
                    <Fiyat value={iade.refundAmountMinor} className="text-sm" />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <ImlecSayfalama
        ilkSayfaHref={durum ? `${YOL}?durum=${durum}` : YOL}
        sonrakiHref={nextCursor ? sonrakiYol(nextCursor) : null}
        ilkSayfada={imlec === null}
      />
    </section>
  );
}
