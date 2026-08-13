'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useLocale } from 'next-intl';
import { isApiFailure, type Locale } from '@vt/contracts';
import { ALL_TRYON_CATEGORIES, isTryOnSupported } from '@vt/config/constants';
import type { TryOnCategoryName } from '@vt/config/constants';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldMessage } from '@/components/hata/alan-hatalari';
import { cn } from '@/lib/utils';
import type { AdminCategoryWire } from '@vt/contracts';
import { TRYON_KATEGORI_ETIKETI } from '@/components/tryon/kategori-etiketleri';

/**
 * KATEGORİ AĞACI VE DÜZENLEYİCİ.
 *
 * ⚠️ AĞAÇ SUNUCUDAN AĞAÇ OLARAK GELMEZ: uç düz bir liste döndürüyor
 *    (`AdminCategoryRecord[]`, `parentId` ile) ve sayfalama YOK — tamamı tek
 *    yanıtta. Ağacı burada kurmak, sunucuya özyinelemeli bir sorgu yazdırmaktan
 *    ucuz; ama liste büyüdüğünde (bugün 300+ kayıt var, çoğu E2E artığı) bu
 *    kararın yeniden bakılması gerekir.
 *
 * ⚠️ SIRALAMA `sortOrder` SONRA AD. Yalnız `sortOrder` kullanılsaydı aynı
 *    sıraya sahip onlarca kategori her yenilemede farklı dizilir ve yönetici
 *    "ağaç kendiliğinden değişiyor" derdi — sunucu sırası garanti değil.
 */

interface Dugum extends AdminCategoryWire {
  cocuklar: Dugum[];
  derinlik: number;
}

function agaciKur(kategoriler: readonly AdminCategoryWire[]): Dugum[] {
  const dugumler = new Map<string, Dugum>(
    kategoriler.map((kategori) => [kategori.id, { ...kategori, cocuklar: [], derinlik: 0 }]),
  );

  const kokler: Dugum[] = [];
  for (const dugum of dugumler.values()) {
    // ⚠️ `parentId` DOLU AMA ÜST KAYIT LİSTEDE YOK olabilir mi: bugün hayır
    //    (uç ağacın tamamını döndürüyor), ama olursa düğüm KAYBOLMAMALI —
    //    sessizce yok olan bir kategori, ürünlerinin niye görünmediği
    //    sorusunun cevapsız kalması demek. Bu yüzden köke çekiliyor.
    const ust = dugum.parentId === null ? null : (dugumler.get(dugum.parentId) ?? null);
    if (ust === null) kokler.push(dugum);
    else ust.cocuklar.push(dugum);
  }

  const sirala = (liste: Dugum[], derinlik: number): void => {
    liste.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'));
    for (const dugum of liste) {
      dugum.derinlik = derinlik;
      sirala(dugum.cocuklar, derinlik + 1);
    }
  };
  sirala(kokler, 0);

  return kokler;
}

function duzlestir(dugumler: readonly Dugum[]): Dugum[] {
  return dugumler.flatMap((dugum) => [dugum, ...duzlestir(dugum.cocuklar)]);
}

/** Bir düğümün tüm altları — üst kategori seçicisinde gizlenecekler. */
function altAgacKimlikleri(dugum: Dugum): Set<string> {
  const kimlikler = new Set<string>([dugum.id]);
  for (const cocuk of duzlestir(dugum.cocuklar)) kimlikler.add(cocuk.id);
  return kimlikler;
}

export function KategoriAgaci({
  kategoriler,
}: {
  kategoriler: readonly AdminCategoryWire[];
}): React.ReactElement {
  const [acikId, setAcikId] = React.useState<string | null>(null);
  const [yeniAcik, setYeniAcik] = React.useState(false);

  const kokler = React.useMemo(() => agaciKur(kategoriler), [kategoriler]);
  const duz = React.useMemo(() => duzlestir(kokler), [kokler]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          size="sm"
          variant="ikincil"
          onClick={() => {
            setYeniAcik((onceki) => !onceki);
            setAcikId(null);
          }}
        >
          {yeniAcik ? 'Vazgeç' : 'Yeni kategori'}
        </Button>
      </div>

      {yeniAcik ? <KategoriFormu mod="yeni" duz={duz} onBitti={() => setYeniAcik(false)} /> : null}

      <ul className="flex flex-col">
        {duz.map((dugum) => (
          <li key={dugum.id} className="border-b border-kenar/60">
            <div
              className="flex min-h-9 flex-wrap items-center gap-2 py-1.5"
              style={{ paddingLeft: `${dugum.derinlik * 20}px` }}
            >
              {dugum.derinlik > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 text-ikon" strokeWidth={1.5} />
              ) : null}

              <span className={cn('text-sm', dugum.derinlik === 0 && 'font-medium')}>
                {dugum.name}
              </span>
              <span className="text-xs text-metin-soluk">/{dugum.slug}</span>

              {/*
                ⚠️ PASİF KATEGORİ RENK TAŞIR ÇÜNKÜ BİR DURUMDUR: pasif kategori
                   vitrinde görünmez ve altındaki ürünler bulunamaz. Sıra
                   numarası, ürün sayısı ve ağaç derinliği renk TAŞIMAZ.
              */}
              {!dugum.isActive ? <Badge durum="uyari">Pasif</Badge> : null}

              <span className="ml-auto flex items-center gap-3 pl-3 text-xs text-metin-soluk">
                <span>{denemeEtiketi(dugum.tryOnCategory)}</span>
                <span className="rakam">sıra {dugum.sortOrder}</span>
                <span className="rakam">{dugum.productCount} ürün</span>
                <Button
                  size="sm"
                  variant="sessiz"
                  onClick={() => {
                    setYeniAcik(false);
                    setAcikId((onceki) => (onceki === dugum.id ? null : dugum.id));
                  }}
                >
                  {acikId === dugum.id ? 'Kapat' : 'Düzenle'}
                </Button>
              </span>
            </div>

            {acikId === dugum.id ? (
              <div className="pb-4" style={{ paddingLeft: `${dugum.derinlik * 20}px` }}>
                <KategoriFormu
                  mod="duzenle"
                  dugum={dugum}
                  duz={duz}
                  onBitti={() => setAcikId(null)}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function denemeEtiketi(kategori: TryOnCategoryName | null): string {
  if (kategori === null) return 'deneme yok';
  const ad = TRYON_KATEGORI_ETIKETI[kategori];
  return isTryOnSupported(kategori) ? `deneme: ${ad}` : `deneme: ${ad} (kapalı)`;
}

/**
 * KATEGORİ FORMU — yeni ve düzenleme aynı bileşen.
 *
 * ⚠️ `slug` DÜZENLEME MODUNDA SALT OKUNUR ve bu, arayüz tercihi değil: sunucu
 *    şeması `categoryUpdateSchema` içinde `slug` alanı HİÇ YOK. Alan gönderilse
 *    sessizce yok sayılırdı; düzenlenebilir bir kutu göstermek yöneticiye
 *    yapamayacağı bir işi vaat etmek olurdu. Gerekçe `admin-catalog.service.ts`
 *    yorumunda: slug kalıcı bağlantıdır, değişirse dış bağlantılar ve arama
 *    motoru indeksleri kırılır.
 */
function KategoriFormu({
  mod,
  dugum,
  duz,
  onBitti,
}: {
  mod: 'yeni' | 'duzenle';
  dugum?: Dugum;
  duz: readonly Dugum[];
  onBitti: () => void;
}): React.ReactElement {
  const router = useRouter();
  const locale = useLocale() as Locale;

  const [ad, setAd] = React.useState(dugum?.name ?? '');
  const [slug, setSlug] = React.useState('');
  const [ustId, setUstId] = React.useState(dugum?.parentId ?? '');
  const [deneme, setDeneme] = React.useState<string>(dugum?.tryOnCategory ?? '');
  const [sira, setSira] = React.useState(String(dugum?.sortOrder ?? 0));
  const [aktif, setAktif] = React.useState(dugum?.isActive ?? true);
  const [calisiyor, setCalisiyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);

  const yasakUstler = dugum ? altAgacKimlikleri(dugum) : new Set<string>();
  const secilenDeneme = deneme === '' ? null : (deneme as TryOnCategoryName);
  const denemeKapali = secilenDeneme !== null && !isTryOnSupported(secilenDeneme);

  async function gonder(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    setCalisiyor(true);
    setHata(null);

    try {
      /**
       * ⚠️ `sortOrder` SAYI OLARAK GİDER. Şema `z.number().int()` istiyor;
       *    metin gönderilseydi 400 dönerdi. `Number()` burada PARA DEĞİL bir
       *    sıra numarası üzerinde çalışıyor — para okunmasını yasaklayan kural
       *    (`lib/money.ts`) bu alanı kapsamaz.
       */
      const sayisalSira = Number.parseInt(sira, 10);

      if (mod === 'yeni') {
        await apiFetch<AdminCategoryWire, '/admin/categories'>('/admin/categories', {
          method: 'POST',
          json: {
            parentId: ustId === '' ? null : ustId,
            slug,
            name: ad,
            tryOnCategory: secilenDeneme,
            sortOrder: Number.isNaN(sayisalSira) ? 0 : sayisalSira,
            isActive: aktif,
          },
        });
      } else if (dugum) {
        await apiFetch<AdminCategoryWire, `/admin/categories/${string}`>(
          `/admin/categories/${dugum.id}`,
          {
            method: 'PATCH',
            json: {
              parentId: ustId === '' ? null : ustId,
              name: ad,
              tryOnCategory: secilenDeneme,
              sortOrder: Number.isNaN(sayisalSira) ? 0 : sayisalSira,
              isActive: aktif,
            },
          },
        );
      }

      onBitti();
      router.refresh();
    } catch (yakalanan) {
      setHata(yakalanan);
    } finally {
      setCalisiyor(false);
    }
  }

  const alanHatalari = isApiFailure(hata) ? hata.fields : [];

  return (
    <form
      onSubmit={(olay) => void gonder(olay)}
      className="flex flex-col gap-3 rounded-md border border-kenar bg-yuzey p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Kategori adı
          <input
            value={ad}
            onChange={(olay) => setAd(olay.target.value)}
            minLength={2}
            maxLength={80}
            required
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Bağlantı adresi (slug)
          {mod === 'yeni' ? (
            <input
              value={slug}
              onChange={(olay) => setSlug(olay.target.value)}
              minLength={2}
              maxLength={120}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
              placeholder="kadin-ust-giyim"
              className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
            />
          ) : (
            <span className="flex h-9 items-center rounded-md border border-kenar bg-yuzey-vurgulu px-2 text-sm text-metin-soluk">
              /{dugum?.slug}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Üst kategori
          <select
            value={ustId}
            onChange={(olay) => setUstId(olay.target.value)}
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          >
            <option value="">Kök kategori</option>
            {duz
              // ⚠️ Kendisi ve altları listede YOK: sunucu döngüyü zaten
              //    reddediyor (`assertNotDescendant`), ama reddedilecek bir
              //    seçeneği sunmak yöneticiye 400 aldırmak demek.
              .filter((aday) => !yasakUstler.has(aday.id))
              .map((aday) => (
                <option key={aday.id} value={aday.id}>
                  {'— '.repeat(aday.derinlik)}
                  {aday.name}
                </option>
              ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Sanal deneme kategorisi
          <select
            value={deneme}
            onChange={(olay) => setDeneme(olay.target.value)}
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          >
            <option value="">Yok — bu kategoride deneme düğmesi çıkmaz</option>
            {/*
              ⚠️ LİSTE `ALL_TRYON_CATEGORIES`TEN GELİR, elle yazılmaz. Yalnızca
                 desteklenenleri listelemek de YANLIŞ olurdu: enum değerleri
                 şemada var ve ürün kategorisi olarak bugün kullanılıyor
                 (mağazada ayakkabı satılıyor), yalnızca deneme yeteneği yok.
                 Seçilemez yapmak, ayakkabı kategorisini kurulamaz hale getirirdi.
            */}
            {ALL_TRYON_CATEGORIES.map((aday) => (
              <option key={aday} value={aday}>
                {TRYON_KATEGORI_ETIKETI[aday]}
                {isTryOnSupported(aday) ? '' : ' (deneme kapalı)'}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Sıra numarası
          <input
            type="number"
            min={0}
            max={9999}
            value={sira}
            onChange={(olay) => setSira(olay.target.value)}
            className="rakam h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={aktif}
            onChange={(olay) => setAktif(olay.target.checked)}
          />
          Vitrinde aktif
        </label>
      </div>

      {/*
        ⚠️⚠️ BU UYARI OLMAZSA YÖNETİCİ DENEMENİN AÇILACAĞINI SANIR.
             `TryOnCategory` enum'ında sekiz değer var ama sağlayıcı yalnızca
             dördünü giydirebiliyor (`docs/tryon-kategori-destegi.md`: fal.ai
             üzerindeki modeller GİYSİYE ÖZGÜ; ayakkabı/takı/çanta için model
             YOK). Kategoriye `SHOES` atamak ürünü satılabilir yapar ama deneme
             düğmesini AÇMAZ ve bunu söyleyen başka hiçbir yer yok.

             Metin `isTryOnSupported()` ile ÜRETİLİYOR, elle yazılmıyor: bir gün
             sağlayıcı matrisine ayakkabı eklenirse uyarı KENDİLİĞİNDEN kaybolur.
             Elle yazılsaydı iki gerçek olurdu — matrisin yapabildiği ve
             uyarının iddia ettiği.
      */}
      {denemeKapali && secilenDeneme ? (
        <p className="rounded-md border border-kenar bg-uyari-zemin p-3 text-sm text-uyari">
          Sanal deneme bu kategoride <strong>kapalı</strong> — sağlayıcı{' '}
          {TRYON_KATEGORI_ETIKETI[secilenDeneme].toLocaleLowerCase('tr')} kategorisini
          desteklemiyor. Ürünler bu kategoride satılır, yalnızca “Üzerimde Dene” düğmesi çıkmaz.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={calisiyor}>
          {calisiyor
            ? 'Kaydediliyor…'
            : mod === 'yeni'
              ? 'Kategoriyi oluştur'
              : 'Değişikliği kaydet'}
        </Button>
        <Button type="button" size="sm" variant="sessiz" disabled={calisiyor} onClick={onBitti}>
          Vazgeç
        </Button>
      </div>

      {alanHatalari.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {alanHatalari.map((alan) => (
            <li key={alan.path}>{fieldMessage(alan, locale)}</li>
          ))}
        </ul>
      ) : null}

      {hata !== null ? <HataGosterimi error={hata} /> : null}
    </form>
  );
}
