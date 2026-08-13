'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { NATURAL_SEARCH } from '@vt/config/constants';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { SuggestItemWire } from '@vt/contracts';

/**
 * ARAMA KUTUSU — İKİ AYRI UÇ, İKİ AYRI MALİYET.
 *
 *   1. `GET /v1/search/suggest`  — her tuşta (geciktirilmiş). Ucuz: trigram
 *      benzerliği, tek SQL.
 *   2. `POST /v1/search/natural` — YALNIZCA gönderimde ve yalnızca cümle
 *      görünümlü sorgularda. Pahalı: LLM çağrısı.
 *
 * ⚠️ İKİSİNİ AYIRAN ŞEY BU DOSYADIR. Doğal dil aramasını `useEffect` içine
 *    koymak — yani "kullanıcı yazdıkça sonucu tazele" — her tuş vuruşunu bir
 *    model çağrısına çevirir. "keten gömlek" yazan bir kullanıcı 12 çağrı
 *    demektir. Bu yüzden doğal dil çağrısı BURADA YAPILMAZ bile: gönderim
 *    yalnızca adresi değiştirir, çağrıyı Sunucu Bileşeni yapar ve sayfa başına
 *    BİR KEZ yapar.
 *
 * ⚠️ Öneri isteği `/api/*` VEKİLİNDEN geçer. Uç `@Public()` olmasına rağmen
 *    başka yol yok: tarayıcı API kökeniyle hiç konuşmuyor (CORS yok, jeton yok).
 *    Sunucu Bileşeni doğrudan gidebilir, tarayıcı gidemez — ayrım budur.
 */

/** `suggestQuerySchema`: `q` en az 2 karakter. Altında istek 400 döner. */
const EN_AZ_HARF = 2;

/**
 * ⚠️ Geciktirme İSTEĞE BAĞLI DEĞİL. `/v1/search/suggest` `scope:'ip'` ve 60/dk;
 *    geciktirmesiz bir kutuda tek bir arama cümlesi dakikalık kotanın beşte
 *    birini yakar ve ardından TÜM istekler 429 olur.
 */
const GECIKME_MS = 250;

/**
 * CÜMLE EŞİĞİ — pahalı ucu ne zaman denemeye değer.
 *
 * ⚠️ BU İKİ SAYI ARTIK KOPYA DEĞİL. Eskiden burada `4` ve `2` elle yazılıydı
 *    ve sunucudaki `natural-search.intent.ts` aynı kararı kendi kopyasıyla
 *    veriyordu. Sapmanın bedeli sessizdi: eşikler ayrıştığında bazı cümleler
 *    yorumlanmadan düz kelime aramasına düşer — kullanıcı YANLIŞ sonuç almaz,
 *    sadece iyi sonucu alamaz, yani kimse fark etmez. Sabit `@vt/config`e
 *    taşındı; iki taraf aynı sayıyı okuyor.
 *
 * ⚠️ Alt yol `@vt/config/constants`, kök `@vt/config` DEĞİL: kökten alındığında
 *    `env.ts` istemci paketine giriyor ve sır adları `.next/static`e sızıyor
 *    (`verify:bundle` bunu kırar).
 */
const CUMLE_KELIME_ESIGI = NATURAL_SEARCH.minWordsForLlm;
const RAKAMLI_CUMLE_KELIME_ESIGI = NATURAL_SEARCH.minWordsWithNumericHint;

export interface AramaKutusuProps {
  /** Adresteki mevcut arama — sayfa yenilendiğinde kutu boşalmasın. */
  baslangic?: string;
  className?: string;
}

function cumleGorunumlu(terim: string): boolean {
  const kelimeSayisi = terim.split(/\s+/).filter(Boolean).length;
  if (kelimeSayisi >= CUMLE_KELIME_ESIGI) return true;
  // "5000 altı elbise": kelime aramasında SIFIR sonuç verir (terimler VE'lenir
  // ve hiçbir başlıkta "5000" geçmez); rakamlı kısa sorgu tam da pahalı ucun
  // sorunu çözdüğü yerdir.
  return /\d/.test(terim) && kelimeSayisi >= RAKAMLI_CUMLE_KELIME_ESIGI;
}

export function AramaKutusu({ baslangic, className }: AramaKutusuProps): React.ReactElement {
  const router = useRouter();
  const [deger, setDeger] = React.useState(baslangic ?? '');
  const [oneriler, setOneriler] = React.useState<SuggestItemWire[]>([]);
  const [acik, setAcik] = React.useState(false);
  const [vurgulu, setVurgulu] = React.useState(-1);
  const ucusRef = React.useRef<AbortController | null>(null);

  /**
   * ⚠️ EŞİĞİN ALTINDA LİSTE ETKİDE DEĞİL, OLAY İŞLEYİCİDE temizlenir
   *    (`yaziyaGore`). Etkinin gövdesinde `setState` çağırmak zincirleme render
   *    üretir ve `react-hooks/set-state-in-effect` bunu hata sayıyor. Etkinin
   *    tek işi dış dünyayla konuşmaktır: bir isteği zamanlar, sökülürken iptal
   *    eder. Durum güncellemesi ya kullanıcının eyleminden ya da yanıtın
   *    kendisinden doğar.
   */
  React.useEffect(() => {
    const terim = deger.trim();
    if (terim.length < EN_AZ_HARF) return;

    const zamanlayici = setTimeout(() => {
      /**
       * ⚠️ ÖNCEKİ İSTEK İPTAL EDİLİR. Edilmezse yanıtlar geldikleri sırayla
       *    yazılır ve yavaş kalan ESKİ yanıt yeni öneriyi ezer: kullanıcı
       *    "keten" yazmışken "ket" önerilerini görür. Hata değil, yarış.
       */
      ucusRef.current?.abort();
      const kontrol = new AbortController();
      ucusRef.current = kontrol;

      void apiFetch<SuggestItemWire[], '/search/suggest'>('/search/suggest', {
        query: { q: terim },
        signal: kontrol.signal,
      })
        .then((sonuc) => {
          setOneriler(sonuc.data);
          setVurgulu(-1);
          setAcik(true);
        })
        .catch(() => {
          /**
           * ⚠️ ÖNERİ HATASI KULLANICIYA GÖSTERİLMEZ. Kutu yazarken 429 ya da
           *    ağ kesintisi alırsa doğru davranış listeyi boşaltmaktır; hata
           *    kutusu açmak, çalışan aramayı bozuk gösterir. Asıl arama
           *    gönderimle yapılıyor ve o yol bu uca hiç bağlı değil.
           */
          setOneriler([]);
        });
    }, GECIKME_MS);

    return () => {
      clearTimeout(zamanlayici);
    };
  }, [deger]);

  React.useEffect(() => {
    const kontrol = ucusRef;
    return () => {
      kontrol.current?.abort();
    };
  }, []);

  function yaziyaGore(yeni: string): void {
    setDeger(yeni);
    if (yeni.trim().length < EN_AZ_HARF) {
      setOneriler([]);
      setVurgulu(-1);
      setAcik(false);
    }
  }

  function gonder(terim: string, cumleDene: boolean): void {
    const temiz = terim.trim();
    setAcik(false);
    if (temiz === '') {
      router.push('/products');
      return;
    }

    /**
     * ⚠️ İKİ FARKLI PARAMETRE, İKİ FARKLI MALİYET:
     *      ?q=…   → düz kelime araması, LLM yok
     *      ?ara=… → cümle yorumlanır (sayfa başına BİR kez), sonra düz filtre
     *    Öneriden seçilen metin her zaman `q` ile gider: o zaten katalogdan
     *    gelen bir ürün/marka adıdır, çevrilecek bir niyet değil.
     */
    const anahtar = cumleDene && cumleGorunumlu(temiz) ? 'ara' : 'q';
    router.push(`/products?${anahtar}=${encodeURIComponent(temiz)}`);
  }

  function tuslar(olay: React.KeyboardEvent<HTMLInputElement>): void {
    if (!acik || oneriler.length === 0) return;

    if (olay.key === 'ArrowDown') {
      olay.preventDefault();
      setVurgulu((onceki) => (onceki + 1) % oneriler.length);
    } else if (olay.key === 'ArrowUp') {
      olay.preventDefault();
      setVurgulu((onceki) => (onceki <= 0 ? oneriler.length - 1 : onceki - 1));
    } else if (olay.key === 'Escape') {
      setAcik(false);
    } else if (olay.key === 'Enter' && vurgulu >= 0) {
      // Vurgulu öneri varken form gönderimi DEVRALINIR; aksi hâlde kullanıcı
      // seçtiğini sanır, kutudaki yarım metin aranır.
      olay.preventDefault();
      const secilen = oneriler[vurgulu];
      if (secilen) {
        setDeger(secilen.text);
        gonder(secilen.text, false);
      }
    }
  }

  return (
    <div className={cn('relative', className)}>
      {/*
        ⚠️ `action`/`method` gerçek: JavaScript çalışmazsa gönderim düz bir GET
           olur ve kullanıcı yine kelime aramasına ulaşır. Doğal dil o durumda
           devre dışı kalır — pahalı yol zaten isteğe bağlı olandır.
      */}
      <form
        method="get"
        action="/products"
        role="search"
        onSubmit={(olay) => {
          olay.preventDefault();
          gonder(deger, true);
        }}
      >
        {/*
          ⚠️ ODAK HALKASI SARMALAYICIDA — `focus-within` deponun bu deseni
             kullandığı BİRİNCİ yer, gerekçesi burada yazılı ki ikinci bir
             kutuda aynı hata tekrarlanmasın.

             Girdideki `outline-none` TEK BAŞINA bırakılmıştı ve
             `globals.css`in kendi kuralını deliyordu ("Odak halkası klavye
             gezinmesi için ZORUNLU … `outline: none` yazılmaz"). ÖLÇÜLDÜ:
             gerçek Tab ile odaklanınca `:focus-visible` EŞLEŞİYOR ama
             `outlineStyle: none`, `boxShadow: none` — hiçbir görsel işaret
             yok; bir sonraki durak olan "Filtrele" düğmesinde net 2px halka
             var. WCAG 2.4.7 ihlali, üstelik ana sayfa + /products + /category +
             /collection ekranlarının HEPSİNDE duran kutuda.

             Halka neden girdiye değil kabuğa: girdi 1px kenarlıklı kutunun
             İÇİNDE oturuyor; 2px halka orada kenarlığa yapışıp ezik görünür.
             Kabuk halkayı taşıyınca `outline-none` girdide KALABİLİR — ve
             ancak o zaman kalabilir.

             ⚠️ `focus-within` DEĞİL, `has-[:focus-visible]`. `focus-within`
                `:focus`e bakar ve halkayı FAREYLE tıklayanda da yakar;
                `globals.css`teki kural `:focus-visible`, yani halka klavye
                işaretidir. İki farklı odak tanımı taşımak, kuralı bir sonraki
                bileşende yeniden tartışmak demektir.
        */}
        <div className="flex items-center gap-2 rounded-md border border-kenar bg-zemin px-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-vurgu">
          <Search className="size-4 shrink-0 text-ikon" aria-hidden />
          <input
            type="search"
            name="q"
            value={deger}
            onChange={(olay) => {
              yaziyaGore(olay.target.value);
            }}
            onKeyDown={tuslar}
            onFocus={() => {
              if (oneriler.length > 0) setAcik(true);
            }}
            onBlur={() => {
              // Öneriye tıklama `blur`dan sonra gelir; kapatmayı bir tik geciktir.
              setTimeout(() => {
                setAcik(false);
              }, 120);
            }}
            placeholder="Ürün, marka ara ya da ne aradığınızı yazın"
            aria-label="Arama"
            role="combobox"
            aria-expanded={acik && oneriler.length > 0}
            aria-controls="arama-onerileri"
            aria-autocomplete="list"
            {...(vurgulu >= 0 ? { 'aria-activedescendant': `arama-oneri-${vurgulu}` } : {})}
            className="h-10 w-full bg-transparent text-sm text-metin outline-none placeholder:text-metin-soluk"
          />
        </div>
      </form>

      {acik && oneriler.length > 0 ? (
        <ul
          id="arama-onerileri"
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-kenar bg-zemin py-1 shadow-sm"
        >
          {oneriler.map((oneri, sira) => (
            <li key={`${oneri.type}:${oneri.text}`}>
              <button
                type="button"
                id={`arama-oneri-${sira}`}
                role="option"
                aria-selected={sira === vurgulu}
                onMouseDown={() => {
                  // `onMouseDown`: `onClick` `blur`dan sonra gelir ve liste o
                  // ana kadar kapanmış olur.
                  setDeger(oneri.text);
                  gonder(oneri.text, false);
                }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                  sira === vurgulu ? 'bg-yuzey-vurgulu' : 'hover:bg-yuzey',
                )}
              >
                <span className="truncate">{oneri.text}</span>
                {oneri.type === 'brand' ? (
                  <span className="ml-2 shrink-0 text-xs text-metin-soluk">Mağaza</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
