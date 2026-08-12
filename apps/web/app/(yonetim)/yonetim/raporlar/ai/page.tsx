import type { Metadata } from 'next';
import { hesapFetch } from '@/lib/api/server-authed';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { isoGun, tarih } from '@/lib/tarih';
import { BosSonuc, OzetSeridi, SayfaBasligi } from '@/components/panel/duzen';
import { AI_OZELLIGI } from '../../_finans/etiketler';
import { mikroUsd, sayi, yuzdeOran } from '@/lib/sayi-bicim';
import { RaporSekmeleri } from '../sekmeler';
import { AI_FILTERABLE_FEATURES, type AiUsageWire, type AiFeatureWire } from '@vt/contracts';

export const metadata: Metadata = { title: 'AI kullanımı ve maliyeti' };
export const dynamic = 'force-dynamic';

/** Etiket tablosunun anahtarları = `AiFeature` enum'ının tamamı (yedi değer). */
const TUM_OZELLIKLER = Object.keys(AI_OZELLIGI) as AiFeatureWire[];

/**
 * AI MALİYET PANELİ.
 *
 * ⚠️ `costMicroUsd` KURUŞ DEĞİL, MİKRO-USD. `<Fiyat>` ile basılsaydı
 *    `1.234.567` mikro-USD ekrana `12.345,67 ₺` diye çıkardı. Tip sistemi bunu
 *    engelliyor (`MikroUsdString` bilerek `MinorString` değil) ve biçimleme
 *    `bicim.ts` → `mikroUsd()` üzerinden yapılıyor. Bu sayfada TEK BİR `<Fiyat>`
 *    yok ve olmamalı: bu ekranda ₺ cinsinden hiçbir tutar gösterilmiyor.
 *
 * ⚠️ EKSİK ÖZELLİK "VERİ GELMEDİ" DEĞİLDİR. `byFeature` yalnızca o aralıkta
 *    ÇAĞRI ALMIŞ özellikleri döndürüyor. Sabit yedi kartlık bir ızgara
 *    çizilseydi çağrı almamış özellikler boş/sıfır görünür ve panel bozukmuş
 *    gibi okunurdu. Bunun yerine tablo yalnızca gelen satırları basıyor,
 *    altındaki cümle hangi özelliklerin hiç çağrı almadığını AYRICA söylüyor.
 *    `VIDEO_TRYON` böyle bir satır DEĞİLDİR: veritabanı enum'ında hiç yok, yani
 *    "veri gelmemiş bir özellik" değil, var olmayan bir özellik.
 *
 * ⚠️ İKİ ORTALAMA YAN YANA DURUYOR ve bu bilerek:
 *      `avgCostPerCallMicroUsd`      → önbellek isabetleri DÂHİL, birim ekonomisi
 *      `avgCostPerGeneratedMicroUsd` → yalnızca üretilenler, sağlayıcı fiyatı
 *    Tek rakam gösterilseydi önbellek iyileştirmesinin etkisi hiç görünmezdi.
 */
export default async function AiMaliyetPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; ozellik?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const seciliOzellik = AI_FILTERABLE_FEATURES.find((deger) => deger === params.ozellik);

  let panel: AiUsageWire;
  try {
    const sonuc = await hesapFetch<AiUsageWire, '/admin/ai/usage'>(
      '/admin/ai/usage',
      '/yonetim/raporlar/ai',
      {
        query: {
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          ...(seciliOzellik ? { feature: seciliOzellik } : {}),
        },
      },
    );
    panel = sonuc.data;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const gelenOzellikler = new Set(panel.byFeature.map((satir) => satir.feature));
  const cagrisizOzellikler = TUM_OZELLIKLER.filter((ozellik) => !gelenOzellikler.has(ozellik));

  return (
    <section className="flex flex-col gap-6">
      <SayfaBasligi
        baslik="AI kullanımı ve maliyeti"
        aciklama={
          <>
            {tarih(panel.range.from)} – {tarih(panel.range.to)} · tutarlar mikro-USD cinsinden
            tutulur, dolara çevrilerek gösterilir. Başarısız çağrılar da toplama dâhildir: sağlayıcı
            hata dönse bile çoğu zaman ücret tahakkuk eder.
          </>
        }
      />

      <RaporSekmeleri aktif="ai" />

      <AralikFormu
        from={params.from ?? isoGun(panel.range.from)}
        to={params.to ?? isoGun(panel.range.to)}
        ozellik={seciliOzellik ?? ''}
      />

      <OzetSeridi
        rakamlar={[
          {
            etiket: 'Toplam çağrı',
            deger: <span className="rakam">{sayi(panel.totals.callCount)}</span>,
            alt: `${sayi(panel.totals.failureCount)} başarısız`,
          },
          {
            etiket: 'Toplam maliyet',
            deger: <span className="rakam">{mikroUsd(panel.totals.costMicroUsd)}</span>,
            alt: 'Başarısız çağrılar dâhil',
          },
          {
            etiket: 'Önbellek isabeti',
            // ⚠️ `cacheHitRate` 0–1 arası ORAN. 100 ile çarpmayı unutmak
            //    isabeti yüz kat kötü gösterirdi.
            deger: <span className="rakam">{yuzdeOran(panel.totals.cacheHitRate)}</span>,
            alt: `${sayi(panel.totals.cacheHitCount)} isabet`,
          },
          {
            etiket: 'Çağrı başına',
            deger: <span className="rakam">{mikroUsd(panel.totals.avgCostPerCallMicroUsd)}</span>,
            alt: 'Önbellek isabetleri dâhil',
          },
        ]}
      />

      {/* ── Sanal deneme: iki ortalama yan yana ───────────────────────── */}
      <div className="rounded-lg border border-kenar p-4">
        <h2 className="text-sm font-semibold text-metin">Sanal deneme birim maliyeti</h2>
        <p className="mt-1 text-sm text-metin-soluk">
          İki ortalama AYNI EKRANDA durur: biri kullanıcıya sunulan her deneme başına gerçek
          maliyeti, diğeri sağlayıcının üretim başına fiyatını gösterir. Aralarındaki fark doğrudan
          önbelleğin kazancıdır.
        </p>

        <dl className="mt-3 grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-metin-soluk">Deneme çağrısı</dt>
            <dd className="rakam mt-0.5 text-base font-semibold text-metin">
              {sayi(panel.tryOn.callCount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-metin-soluk">Gerçekten üretilen</dt>
            <dd className="rakam mt-0.5 text-base font-semibold text-metin">
              {sayi(panel.tryOn.generatedCount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-metin-soluk">Çağrı başına (önbellek dâhil)</dt>
            <dd className="rakam mt-0.5 text-base font-semibold text-metin">
              {mikroUsd(panel.tryOn.avgCostPerCallMicroUsd)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-metin-soluk">Üretim başına (sağlayıcı fiyatı)</dt>
            <dd className="rakam mt-0.5 text-base font-semibold text-metin">
              {mikroUsd(panel.tryOn.avgCostPerGeneratedMicroUsd)}
            </dd>
          </div>
        </dl>
      </div>

      {/* ── Özellik kırılımı ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-metin">Özellik kırılımı</h2>

        {panel.byFeature.length === 0 ? (
          <BosSonuc
            baslik="Bu aralıkta hiç AI çağrısı yok."
            aciklama="Tarih aralığını genişletin ya da özellik filtresini kaldırın."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Özellik</TH>
                <TH sayisal>Çağrı</TH>
                <TH sayisal>Önbellek isabeti</TH>
                <TH sayisal>İsabet oranı</TH>
                <TH sayisal>Maliyet</TH>
                <TH sayisal>Çağrı başına</TH>
              </TR>
            </THead>
            <TBody>
              {panel.byFeature.map((satir) => (
                <TR key={satir.feature}>
                  <TD className="text-metin">{AI_OZELLIGI[satir.feature]}</TD>
                  <TD sayisal>{sayi(satir.callCount)}</TD>
                  <TD sayisal>{sayi(satir.cacheHitCount)}</TD>
                  <TD sayisal>{yuzdeOran(satir.cacheHitRate)}</TD>
                  <TD sayisal>{mikroUsd(satir.costMicroUsd)}</TD>
                  <TD sayisal>{mikroUsd(satir.avgCostPerCallMicroUsd)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {/*
          ⚠️ BU CÜMLE "VERİ GELMEDİ" DEMEZ. Tabloda olmayan bir özellik, o
             aralıkta hiç çağrı almamış demektir — panelin eksiği değil,
             ölçümün sonucu. Sıfır satırlı bir tablo çizmek ikisini
             birbirine karıştırırdı.
        */}
        {cagrisizOzellikler.length > 0 ? (
          <p className="text-xs text-metin-soluk">
            Bu aralıkta hiç çağrı almayan özellikler:{' '}
            {cagrisizOzellikler.map((ozellik) => AI_OZELLIGI[ozellik]).join(', ')}. Satırın yokluğu
            veri eksikliği değildir.
          </p>
        ) : null}
      </div>

      {/* ── En çok harcayan kullanıcılar ─────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-metin">En çok maliyet üreten kullanıcılar</h2>
          <p className="mt-1 text-sm text-metin-soluk">
            Panel yalnızca kullanıcı kimliği ve tutar gösterir; fotoğraf, istem metni veya model
            çıktısı GÖSTERMEZ. Maliyet analizi için kimlik yeterlidir.
          </p>
        </div>

        {panel.topUsers.length === 0 ? (
          <BosSonuc
            baslik="Bu aralıkta kullanıcıya bağlanmış çağrı yok."
            aciklama="Misafir çağrıları kullanıcı kimliği taşımaz."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Kullanıcı</TH>
                <TH sayisal>Çağrı</TH>
                <TH sayisal>Maliyet</TH>
                <TH sayisal>Çağrı başına</TH>
              </TR>
            </THead>
            <TBody>
              {panel.topUsers.map((kullanici, sira) => (
                <TR key={kullanici.userId ?? `misafir-${sira}`}>
                  {/* ⚠️ `userId` NULL OLABİLİR — misafir çağrısı. Boş hücre
                      bırakmak "kimlik okunamadı" gibi görünürdü. */}
                  <TD className="rakam text-metin-soluk">{kullanici.userId ?? 'Misafir'}</TD>
                  <TD sayisal>{sayi(kullanici.callCount)}</TD>
                  <TD sayisal>{mikroUsd(kullanici.costMicroUsd)}</TD>
                  <TD sayisal>{mikroUsd(kullanici.avgCostPerCallMicroUsd)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </section>
  );
}

function AralikFormu({
  from,
  to,
  ozellik,
}: {
  from: string;
  to: string;
  ozellik: string;
}): React.ReactElement {
  return (
    <form
      method="get"
      action="/yonetim/raporlar/ai"
      className="grid gap-3 rounded-lg border border-kenar p-4 sm:grid-cols-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-from">Başlangıç</Label>
        <Input id="ai-from" type="date" name="from" className="rakam" defaultValue={from} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-to">Bitiş</Label>
        <Input id="ai-to" type="date" name="to" className="rakam" defaultValue={to} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-ozellik">Özellik</Label>
        {/*
          ⚠️ LİSTEDE ALTI DEĞER VAR, TABLODA YEDİ OLABİLİR. Sunucunun filtre
             şeması (`aiFeatureSchema`) `SEARCH_NL`i KABUL ETMİYOR; seçeneğe
             konsaydı seçen yönetici sonuç yerine 400 alırdı. Eksik olan
             arayüz değil, şema — raporda açık kart.
        */}
        <select
          id="ai-ozellik"
          name="ozellik"
          defaultValue={ozellik}
          className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
        >
          <option value="">Tümü</option>
          {AI_FILTERABLE_FEATURES.map((deger) => (
            <option key={deger} value={deger}>
              {AI_OZELLIGI[deger]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" size="sm">
          Uygula
        </Button>
      </div>
    </form>
  );
}
