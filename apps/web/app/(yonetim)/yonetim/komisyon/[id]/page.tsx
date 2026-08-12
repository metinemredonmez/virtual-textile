import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Lock } from 'lucide-react';
import { FINANCE } from '@vt/config/constants';
import { hesapFetch } from '@/lib/api/server-authed';
import { list } from '@/lib/api/core';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { tarihSaat } from '@/lib/tarih';
import { SayfaBasligi } from '@/components/panel/duzen';
import { KAPSAM_ADI } from '../../_finans/etiketler';
import { sayi, yuzdeBps } from '@/lib/sayi-bicim';
import type { CommissionRuleWire, CommissionVersionsWire } from '@vt/contracts';
import { YeniVersiyonFormu } from './yeni-versiyon';

export const metadata: Metadata = { title: 'Komisyon kuralı' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/**
 * KOMİSYON KURALI DETAYI — yürürlükteki oran + versiyon geçmişi.
 *
 * ⚠️ EKRANIN ASIL İŞİ BİR YANLIŞ ANLAMAYI ÖNLEMEK. Yönetici oranı düşürür,
 *    sonra eski bir siparişe bakar, orada eski oranı görür ve "değişiklik
 *    uygulanmamış" sanır. `OrderItem` komisyon oranını KENDİ ANINDA snapshot
 *    alıyor (`commissionRateBps`, `commissionAmountMinor`, `sellerNetMinor`) ve
 *    bu bilinçli: geçmiş bir siparişin hakedişi sonradan değişirse satıcıya
 *    ödenen tutarla defter ayrışır.
 *    `appliedOrderItemCount` sütunu bunun KANITIDIR — cümle değil, sayı.
 *
 * ⚠️ `notFound()` ÇAĞRILMIYOR, bilerek. `(yonetim)/loading.tsx` grup kökünde
 *    duruyor ve alt rotaları da kapsıyor; AGENTS.md §8 ölçümü net: bir Suspense
 *    sınırının ardındaki `notFound()` HTTP 200 döner. İki seçenekten biri
 *    gerekiyordu — ya başka ajanın dosyasını (grup `loading.tsx`) silmek ya da
 *    404 iddiasından vazgeçmek. İkincisi seçildi: sunucunun Türkçe mesajı
 *    ("Komisyon kuralı bulunamadı.") koyu kabuğun içinde gösteriliyor. Panel
 *    kimliğin arkasında ve indekslenmiyor, yani kaybedilen tek şey durum kodu.
 */
export default async function KomisyonKuraliPage({
  params,
}: {
  params: Params;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const yol = `/yonetim/komisyon/${id}`;

  let kural: CommissionVersionsWire;
  let yururluktekiVersiyonId: string | null = null;

  try {
    /**
     * ⚠️ İKİNCİ İSTEK SÜS DEĞİL. Versiyon ucu "hangi versiyon BUGÜN
     *    yürürlükte" sorusunu cevaplamıyor, yalnızca listeyi veriyor. O kararı
     *    burada yeniden hesaplamak (`validFrom <= now < validTo`) sunucudaki
     *    kuralın ikinci bir kopyasını yaratırdı ve devir gününde iki taraf
     *    farklı versiyonu işaretleyebilirdi. Karar sunucudan okunuyor:
     *    liste ucu `currentVersion`ı kendisi hesaplıyor.
     */
    const [versiyonSonucu, kuralListesi] = await Promise.all([
      hesapFetch<CommissionVersionsWire, `/admin/commission-rules/${string}/versions`>(
        `/admin/commission-rules/${encodeURIComponent(id)}/versions`,
        yol,
      ),
      hesapFetch<unknown, '/admin/commission-rules'>('/admin/commission-rules', yol),
    ]);

    kural = versiyonSonucu.data;
    yururluktekiVersiyonId =
      list<CommissionRuleWire>(kuralListesi).items.find((satir) => satir.id === id)?.currentVersion
        ?.id ?? null;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const yururlukteki =
    kural.versions.find((versiyon) => versiyon.id === yururluktekiVersiyonId) ?? null;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link
          href="/yonetim/komisyon"
          className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
        >
          <ChevronLeft className="size-4 text-ikon" />
          Komisyon kuralları
        </Link>
      </div>

      <SayfaBasligi
        baslik={kural.label}
        aciklama={
          <>
            {KAPSAM_ADI[kural.scope]} · <span className="rakam">{sayi(kural.versions.length)}</span>{' '}
            versiyon
          </>
        }
      />

      {/* ── Yürürlükteki oran ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-kenar p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-metin-soluk">
          Yürürlükteki oran
        </p>
        {yururlukteki ? (
          <>
            <p className="rakam mt-1 text-3xl font-semibold text-metin">
              {yuzdeBps(yururlukteki.rateBps)}
            </p>
            <p className="mt-1 text-sm text-metin-soluk">
              {tarihSaat(yururlukteki.validFrom)} tarihinden itibaren
              {/* Sabit ücret sıfır olsa bile gösteriliyor: "bu kuralda sabit
                  ücret var mı" sorusunun cevabı görünür olmalı. */}
              {' · '}Sabit ücret <Fiyat value={yururlukteki.fixedFeeMinor} className="text-sm" />
            </p>
          </>
        ) : (
          <>
            <p className="rakam mt-1 text-3xl font-semibold text-metin">—</p>
            {/*
              ⚠️ "%0,00" YAZILMAZ. Bugün yürürlükte versiyon olmaması,
                 komisyonun sıfır olduğu anlamına gelmez: bu kural bugün hiç
                 uygulanmaz ve checkout bir üst kapsamdaki kurala düşer.
            */}
            <p className="mt-1 text-sm text-uyari">
              Bu kuralın bugün yürürlükte bir versiyonu yok; tek versiyonu ileri tarihli. Sipariş
              geldiğinde daha geniş kapsamlı kural uygulanır.
            </p>
          </>
        )}
      </div>

      {/* ── Versiyon geçmişi ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-metin">Versiyon geçmişi</h2>
          <p className="mt-1 text-sm text-metin-soluk">
            Yürürlük aralığı <span className="rakam">[başlangıç, bitiş)</span> biçimindedir:
            başlangıç anı dâhil, bitiş anı hariç. Devir anında yalnızca tek bir oran geçerlidir.
          </p>
        </div>

        <Table>
          <THead>
            <TR>
              <TH sayisal>Oran</TH>
              <TH sayisal>Sabit ücret</TH>
              <TH>Başlangıç (dâhil)</TH>
              <TH>Bitiş (hariç)</TH>
              <TH sayisal>Bu oranla kesilen kalem</TH>
            </TR>
          </THead>
          <TBody>
            {kural.versions.map((versiyon) => {
              const yururlukte = versiyon.id === yururluktekiVersiyonId;
              const kilitli = versiyon.appliedOrderItemCount > 0;

              return (
                <TR key={versiyon.id} className={yururlukte ? 'bg-yuzey' : undefined}>
                  <TD sayisal className={yururlukte ? 'font-semibold text-metin' : undefined}>
                    {yuzdeBps(versiyon.rateBps)}
                  </TD>
                  <TD sayisal>
                    <Fiyat value={versiyon.fixedFeeMinor} />
                  </TD>
                  <TD className="text-metin-soluk">{tarihSaat(versiyon.validFrom)}</TD>
                  <TD className="text-metin-soluk">
                    {versiyon.validTo === null
                      ? yururlukte
                        ? 'Yürürlükte'
                        : 'Başlamadı'
                      : tarihSaat(versiyon.validTo)}
                  </TD>
                  {/*
                    ⚠️ SIFIRDAN BÜYÜKSE KİLİT İKONU. Bu satır, "geçmiş neden
                       değişmiyor" sorusunu sorulmadan cevaplıyor: bu oranla
                       zaten N kalemin komisyonu kesilmiş ve o kalemler kendi
                       anındaki oranı taşıyor. İkon RENKSİZ (`text-ikon`) —
                       bir durum değil, bir olgu.
                  */}
                  <TD sayisal>
                    <span className="inline-flex items-center gap-1.5">
                      {sayi(versiyon.appliedOrderItemCount)}
                      {kilitli ? (
                        <Lock className="size-3.5 text-ikon" aria-label="Bu versiyon silinemez" />
                      ) : null}
                    </span>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      <YeniVersiyonFormu
        ruleId={kural.id}
        etiket={kural.label}
        maxRateBps={FINANCE.maxCommissionBps}
        mevcutOranBps={yururlukteki?.rateBps ?? null}
      />
    </section>
  );
}
