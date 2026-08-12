import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { FINANCE } from '@vt/config/constants';
import { hesapFetch } from '@/lib/api/server-authed';
import { list } from '@/lib/api/core';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { tarih } from '@/lib/tarih';
import { BosSonuc, DurumSekmeleri, OzetSeridi, SayfaBasligi } from '@/components/panel/duzen';
import { KAPSAM_ADI } from '../_finans/etiketler';
import { sayi, yuzdeBps } from '@/lib/sayi-bicim';
import type {
  CommissionScopeWire,
  CommissionRuleWire,
  AdminCategoryWire,
  AdminSellerOptionWire,
} from '@vt/contracts';
import { YeniKuralFormu } from './yeni-kural';

export const metadata: Metadata = { title: 'Komisyon kuralları' };

/**
 * ⚠️ `force-dynamic`: kimlikli okuma zaten `cache: 'no-store'` ile gidiyor ama
 *    rotanın statik sayılma ihtimali kalmamalı. Komisyon oranı bir dakika bile
 *    bayat gösterilmemeli.
 */
export const dynamic = 'force-dynamic';

const KAPSAMLAR: readonly CommissionScopeWire[] = [
  'PLATFORM',
  'CATEGORY',
  'SELLER',
  'SELLER_CATEGORY',
];

/**
 * KOMİSYON KURALLARI.
 *
 * ⚠️ SUNUCUDA KAPSAM FİLTRESİ YOK. `commissionRuleListQuerySchema` yalnızca
 *    `categoryId` ve `sellerId` kabul ediyor, `scope` kabul etmiyor; ayrıca uç
 *    SAYFALAMASIZ — bütün kuralları tek seferde döndürüyor. Bu yüzden `?kapsam=`
 *    filtresi burada, ELDEKİ TAM LİSTE ÜZERİNDE uygulanıyor.
 *    Bu bir "toplamı frontend'de hesaplamak" değil: hiçbir tutar türetilmiyor,
 *    yalnızca sunucudan gelen satırların bir alt kümesi gösteriliyor. Sunucuya
 *    `scope` filtresi ve sayfalama eklenmesi raporda açık kart.
 */
export default async function KomisyonPage({
  searchParams,
}: {
  searchParams: Promise<{ kapsam?: string }>;
}): Promise<React.ReactElement> {
  const { kapsam } = await searchParams;
  const seciliKapsam = KAPSAMLAR.find((deger) => deger === kapsam) ?? null;

  let kurallar: CommissionRuleWire[];
  let kategoriler: AdminCategoryWire[] = [];
  let saticilar: AdminSellerOptionWire[] = [];

  try {
    /**
     * ⚠️ ÜÇ İSTEK PARALEL. Sıralı yazılsaydı ekran üç turun toplamı kadar
     *    beklerdi ve ikisi (kategori/satıcı) yalnızca FORMUN seçicilerini
     *    besliyor — tablonun onlara ihtiyacı yok.
     */
    const [kuralSonucu, kategoriSonucu, saticiSonucu] = await Promise.all([
      hesapFetch<unknown, '/admin/commission-rules'>(
        '/admin/commission-rules',
        '/yonetim/komisyon',
      ),
      hesapFetch<unknown, '/admin/categories'>('/admin/categories', '/yonetim/komisyon'),
      hesapFetch<unknown, '/admin/sellers'>('/admin/sellers', '/yonetim/komisyon', {
        query: { status: 'APPROVED', limit: 100 },
      }),
    ]);

    // ⚠️ `data.items` ELLE OKUNMAZ: bu üç uçtan ikisi çıplak dizi, biri nesne
    //    döndürebilir (`envelope.interceptor.ts`). `list()` ikisini de açar.
    kurallar = list<CommissionRuleWire>(kuralSonucu).items;
    kategoriler = list<AdminCategoryWire>(kategoriSonucu).items;
    saticilar = list<AdminSellerOptionWire>(saticiSonucu).items;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const gosterilen =
    seciliKapsam === null ? kurallar : kurallar.filter((k) => k.scope === seciliKapsam);
  const platformKurali = kurallar.find((k) => k.scope === 'PLATFORM') ?? null;
  const oransizSayisi = kurallar.filter((k) => k.currentVersion === null).length;

  return (
    <section className="flex flex-col gap-6">
      <SayfaBasligi
        baslik="Komisyon kuralları"
        aciklama={
          <>
            Bir kural GÜNCELLENMEZ, üzerine yeni bir{' '}
            <strong className="font-medium text-metin">versiyon</strong> yazılır. Yeni versiyon
            yalnızca yürürlük tarihinden sonraki siparişlere uygulanır; mevcut siparişler kendi
            anındaki oranı taşır ve değişmez.
          </>
        }
      />

      <OzetSeridi
        rakamlar={[
          {
            etiket: 'Tanımlı kural',
            deger: <span className="rakam">{sayi(kurallar.length)}</span>,
          },
          {
            etiket: 'Platform varsayılanı',
            deger: (
              <span className="rakam">
                {platformKurali?.currentVersion
                  ? yuzdeBps(platformKurali.currentVersion.rateBps)
                  : '—'}
              </span>
            ),
            alt: platformKurali?.currentVersion
              ? undefined
              : 'Bugün yürürlükte platform kuralı yok',
          },
          {
            etiket: 'Yürürlükte oranı yok',
            deger: <span className="rakam">{sayi(oransizSayisi)}</span>,
            alt: 'Tek versiyonu ileri tarihli kurallar',
          },
          {
            etiket: 'Oran tavanı',
            // ⚠️ Tavan ekrana ELLE yazılmaz; `@vt/config/constants` → FINANCE.
            //    Sunucudaki zod şeması da aynı sabitten okuyor, iki taraf
            //    ayrışamaz.
            deger: <span className="rakam">{yuzdeBps(FINANCE.maxCommissionBps)}</span>,
            alt: 'Üstünde kural tanımlanamaz',
          },
        ]}
      />

      <KapsamFiltresi secili={seciliKapsam} />

      {gosterilen.length === 0 ? (
        <BosSonuc
          baslik={seciliKapsam === null ? 'Hiç komisyon kuralı yok.' : 'Bu kapsamda kural yok.'}
          aciklama={
            seciliKapsam === null
              ? 'Aşağıdaki formdan platform varsayılanını tanımlayarak başlayın.'
              : 'Filtreyi kaldırarak tüm kuralları görebilirsiniz.'
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Kapsam</TH>
              <TH>Etiket</TH>
              <TH sayisal>Yürürlükteki oran</TH>
              <TH sayisal>Sabit ücret</TH>
              <TH>Yürürlük başlangıcı</TH>
              <TH sayisal>Versiyon</TH>
            </TR>
          </THead>
          <TBody>
            {gosterilen.map((kural) => (
              <TR key={kural.id}>
                <TD>
                  <span className="text-metin-soluk">{KAPSAM_ADI[kural.scope]}</span>
                  {kural.categoryName || kural.sellerName ? (
                    <span className="ml-2 text-metin">
                      {[kural.sellerName, kural.categoryName].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </TD>
                <TD>
                  <Link
                    href={`/yonetim/komisyon/${kural.id}`}
                    className="font-medium text-metin hover:underline"
                  >
                    {kural.label}
                  </Link>
                </TD>
                {/*
                  ⚠️ `currentVersion` NULL OLABİLİR ve bu bir hata değil: kuralın
                     tek versiyonu ileri tarihliyse BUGÜN yürürlükte oran yoktur.
                     "%0,00" yazmak, komisyonsuz satış yapılıyormuş gibi okunurdu.
                */}
                <TD sayisal>
                  {kural.currentVersion ? yuzdeBps(kural.currentVersion.rateBps) : '—'}
                </TD>
                <TD sayisal>
                  {kural.currentVersion ? (
                    <Fiyat value={kural.currentVersion.fixedFeeMinor} />
                  ) : (
                    '—'
                  )}
                </TD>
                <TD className="text-metin-soluk">
                  {kural.currentVersion ? tarih(kural.currentVersion.validFrom) : 'Henüz başlamadı'}
                </TD>
                <TD sayisal>
                  <span className="inline-flex items-center gap-1.5">
                    {sayi(kural.versionCount)}
                    {kural.versionCount > 1 ? (
                      // ⚠️ Kilit ikonu DURUM değil, bilgi: renk taşımaz.
                      <Lock
                        className="size-3.5 text-ikon"
                        aria-label="Geçmiş versiyonlar silinemez"
                      />
                    ) : null}
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/*
        ⚠️ Sayfalama bilerek YOK: uç sayfalamıyor (`listRules` hepsini
           döndürüyor). Sahte bir "sonraki sayfa" düğmesi hiç dolmayacak bir
           imleci beklerdi.
      */}
      <YeniKuralFormu
        kategoriler={kategoriler.map((k) => ({ id: k.id, ad: k.name }))}
        saticilar={saticilar.map((s) => ({ id: s.id, ad: s.displayName }))}
        maxRateBps={FINANCE.maxCommissionBps}
      />
    </section>
  );
}

/**
 * ⚠️ KAPSAM FİLTRESİ DURUM DEĞİL, SINIFLANDIRMA — ama sekme çizimi aynı
 *    bileşenden geliyor. Renk taşımaz; seçili sekme yalnızca hafif arka planla
 *    ayrılır.
 *
 * ⚠️ FİLTRE ELDEKİ TAM LİSTE ÜZERİNDE uygulanıyor, sunucuya gitmiyor:
 *    `GET /admin/commission-rules` `scope` parametresi KABUL ETMİYOR ve
 *    sayfalamıyor. Alt küme alınıyor, hiçbir tutar türetilmiyor.
 */
function KapsamFiltresi({ secili }: { secili: CommissionScopeWire | null }): React.ReactElement {
  return (
    <DurumSekmeleri
      etiket="Kapsam filtresi"
      yol="/yonetim/komisyon"
      anahtar="kapsam"
      secili={secili}
      sekmeler={[
        { etiket: 'Tümü', deger: null },
        ...KAPSAMLAR.map((deger) => ({ etiket: KAPSAM_ADI[deger], deger })),
      ]}
    />
  );
}
