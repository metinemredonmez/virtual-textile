import type { Metadata } from 'next';
import { hesapFetch } from '@/lib/api/server-authed';
import { list } from '@/lib/api/core';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { tarihSaat } from '@/lib/tarih';
import {
  BosSonuc,
  DurumSekmeleri,
  ImlecSayfalama,
  OzetSeridi,
  SayfaBasligi,
} from '@/components/panel/duzen';
import { PAYOUT_DURUMU } from '../_finans/etiketler';
import { sayi } from '@/lib/sayi-bicim';
import { baglanti } from '@/lib/sorgu';
import type { PayoutStatusWire, AdminPayoutWire } from '@vt/contracts';
import { PayoutKarari } from './payout-karari';

export const metadata: Metadata = { title: 'Payout talepleri' };
export const dynamic = 'force-dynamic';

const DURUMLAR: readonly PayoutStatusWire[] = [
  'REQUESTED',
  'APPROVED',
  'SENT',
  'FAILED',
  'CANCELLED',
];

/** Varsayılan görünüm 5–9 öğe (`design-system.md`, finans tabloları). */
const SAYFA_BOYU = 9;

/**
 * PAYOUT TALEPLERİ.
 *
 * ⚠️ BU EKRANDA "ÖDENEBİLİR BAKİYE" DİYE BİR RAKAM YOK, VE OLMAMALI.
 *    Ölçüldü: satıcı ile admin İKİ FARKLI bakiye kuralı kullanıyor.
 *      • satıcı  (`seller-finance.service.ts`): toplam − (henüz olgunlaşmamış)
 *      • admin   (`admin.bridges.ts`): `availableAt IS NOT NULL AND <= NOW()`
 *    İkincisi `REFUND`, `COMMISSION_REVERSAL`, `SHIPPING_REVERSAL`, `PAYOUT` ve
 *    `ADJUSTMENT` satırlarının HEPSİNİ dışarıda bırakıyor (`availableAt` null
 *    yazılıyorlar) — yani iadesi yapılmış para admin tarafında hâlâ ödenebilir
 *    görünüyor. Burada bir bakiye rakamı basılsaydı, iki ekran aynı satıcı için
 *    iki farklı tutar gösterirdi ve hangisinin doğru olduğu ekrandan
 *    anlaşılamazdı. Tek güvenilir rakam onay REDDEDİLDİĞİNDE hata zarfının
 *    `details.availableMinor` alanından geliyor; ekran onu gösteriyor.
 *    Backend düzeltmesi raporda açık kart.
 *
 * ⚠️ ÖZET ŞERİDİ SAYAÇ GÖSTERİYOR, TUTAR DEĞİL. "Bekleyen taleplerin toplamı"
 *    diye bir rakam üretmek, sunucudan gelmeyen bir toplamı frontend'de
 *    hesaplamak olurdu (DEĞİŞMEZ KURAL #1) ve üstelik yalnızca BU SAYFADAKİ
 *    satırları toplardı — imleçli listede ikinci sayfa hiç görülmeden.
 */
export default async function PayoutPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string; cursor?: string }>;
}): Promise<React.ReactElement> {
  const { durum, cursor } = await searchParams;
  const seciliDurum = DURUMLAR.find((deger) => deger === durum) ?? null;

  let talepler: AdminPayoutWire[];
  let nextCursor: string | null;

  try {
    const sonuc = await hesapFetch<unknown, '/admin/payouts'>('/admin/payouts', '/yonetim/payout', {
      query: {
        limit: SAYFA_BOYU,
        ...(seciliDurum ? { status: seciliDurum } : {}),
        ...(cursor ? { cursor } : {}),
      },
    });
    const cozulmus = list<AdminPayoutWire>(sonuc);
    talepler = cozulmus.items;
    nextCursor = cozulmus.nextCursor;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const bekleyen = talepler.filter((talep) => talep.status === 'REQUESTED').length;
  const onayli = talepler.filter((talep) => talep.status === 'APPROVED').length;

  return (
    <section className="flex flex-col gap-6">
      <SayfaBasligi
        baslik="Payout talepleri"
        aciklama={
          <>
            Ödeme, satıcının kayıtlı hesabına yapılır.{' '}
            <strong className="font-medium text-metin">IBAN bu ekranda gösterilmez</strong> — alan
            bazlı şifreli saklanıyor ve yalnızca gönderim anında çözülüyor. Maskeli hâli de
            listelenmiyor: uç onu hiç döndürmüyor.
          </>
        }
      />

      <OzetSeridi
        rakamlar={[
          {
            etiket: 'Bu sayfada',
            deger: <span className="rakam">{sayi(talepler.length)}</span>,
            alt: 'talep satırı',
          },
          {
            etiket: 'Karar bekleyen',
            deger: <span className="rakam">{sayi(bekleyen)}</span>,
            alt: 'bu sayfadaki REQUESTED satırları',
          },
          {
            etiket: 'Onaylı, gönderim bekleyen',
            deger: <span className="rakam">{sayi(onayli)}</span>,
            alt: 'bu sayfadaki APPROVED satırları',
          },
        ]}
      />

      <DurumFiltresi secili={seciliDurum} />

      {talepler.length === 0 ? (
        <BosSonuc
          baslik={seciliDurum === null ? 'Hiç payout talebi yok.' : 'Bu durumda talep bulunamadı.'}
          aciklama={
            seciliDurum === null
              ? 'Satıcılar çekilebilir bakiyeleri asgari tutara ulaştığında talep açar.'
              : 'Filtreyi değiştirerek diğer talepleri görebilirsiniz.'
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Satıcı</TH>
              <TH sayisal>Tutar</TH>
              <TH>Durum</TH>
              <TH>Referans</TH>
              <TH>Talep tarihi</TH>
              <TH className="text-right">Karar</TH>
            </TR>
          </THead>
          <TBody>
            {talepler.map((talep) => {
              const durumBilgisi = PAYOUT_DURUMU[talep.status];
              return (
                <TR key={talep.id} className="align-top">
                  <TD className="py-2 font-medium text-metin">{talep.sellerName}</TD>
                  <TD sayisal className="py-2">
                    <Fiyat value={talep.amountMinor} />
                  </TD>
                  <TD className="py-2">
                    <Badge durum={durumBilgisi.rozet}>{durumBilgisi.metin}</Badge>
                    {/* Red gerekçesi `failureReason` alanında saklanıyor —
                        kararın tek kaydı olduğu için listede görünür. */}
                    {talep.failureReason ? (
                      <p className="mt-1 max-w-xs text-xs text-metin-soluk">
                        {talep.failureReason}
                      </p>
                    ) : null}
                  </TD>
                  <TD className="rakam py-2 text-metin-soluk">{talep.payoutRef}</TD>
                  <TD className="py-2 text-metin-soluk">{tarihSaat(talep.createdAt)}</TD>
                  <TD className="py-2 text-right">
                    {/*
                      ⚠️ DÜĞMELER YALNIZCA `REQUESTED` SATIRINDA. `assertPayoutTransition`
                         başka her durumda `PAYOUT_INVALID_STATE` fırlatıyor; düğmeyi
                         her satıra koymak "basınca hata veren düğme" üretirdi — bu
                         deponun yedi kırık panel bağlantısını kaldırma gerekçesinin
                         aynısı.
                    */}
                    {talep.status === 'REQUESTED' ? (
                      <PayoutKarari
                        payoutId={talep.id}
                        saticiAdi={talep.sellerName}
                        tutarMinor={talep.amountMinor}
                      />
                    ) : talep.status === 'APPROVED' ? (
                      // ⚠️ "Ödendi" YAZILMAZ: onay defterde `PAYOUT` satırı
                      //    oluşturmuyor ve `sentAt` hiçbir kod tarafından
                      //    yazılmıyor. Gönderim işçisi yazılana kadar doğru olan
                      //    tek cümle bu.
                      <span className="text-xs text-metin-soluk">
                        {talep.approvedAt
                          ? `${tarihSaat(talep.approvedAt)} onaylandı`
                          : 'Onaylandı'}
                      </span>
                    ) : (
                      <span className="text-xs text-metin-soluk">—</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <ImlecSayfalama
        ilkSayfaHref={baglanti('/yonetim/payout', { durum: seciliDurum })}
        sonrakiHref={
          nextCursor !== null && talepler.length > 0
            ? baglanti('/yonetim/payout', { durum: seciliDurum, cursor: nextCursor })
            : null
        }
        ilkSayfada={cursor === undefined || cursor === ''}
      />
    </section>
  );
}

function DurumFiltresi({ secili }: { secili: PayoutStatusWire | null }): React.ReactElement {
  return (
    <DurumSekmeleri
      yol="/yonetim/payout"
      anahtar="durum"
      secili={secili}
      sekmeler={[
        { etiket: 'Tümü', deger: null },
        ...DURUMLAR.map((deger) => ({ etiket: PAYOUT_DURUMU[deger].metin, deger })),
      ]}
    />
  );
}
