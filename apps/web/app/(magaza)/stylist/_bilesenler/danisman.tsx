'use client';

import * as React from 'react';
import Link from 'next/link';
import { ApiFailure, isErrorCode, type StylistConversationWire } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { AkisCozucu, aracMetni } from '../_lib/akis';

/**
 * STİL DANIŞMANI — SOHBET EKRANI.
 *
 * ⚠️ BU EKRAN BİR DÖNEM HİÇ YOKTU ve akış vekili (`app/api/stylist/…/messages`)
 *    ÖKSÜZ duruyordu: `grep -rn 'stylist' app/ src/` yalnız vekilin kendisini
 *    buluyordu. Yani "yazıldı, derlendi, hiçbir yerden çağrılmadı" hatasının
 *    bu depodaki dördüncü örneğiydi — üstelik SSE tarafı çalışıyor mu diye
 *    bakılamıyordu bile, çünkü bakacak ekran yoktu.
 *
 * ⚠️ AKIŞ `fetch` İLE OKUNUYOR, `EventSource` İLE DEĞİL. Tarayıcı API'si
 *    yalnız `GET` atar; danışman mesajı gövdeli bir `POST`. Çerçeve
 *    ayrıştırma bu yüzden bizde (`_lib/akis.ts`) ve orada test ediliyor.
 *
 * ⚠️ KONUŞMA İLK MESAJDA AÇILIYOR, SAYFA AÇILIŞINDA DEĞİL. Sayfa açılışında
 *    açılsaydı ekrana bakıp vazgeçen her ziyaretçi veritabanında boş bir
 *    konuşma bırakırdı; dahası bir Sunucu Bileşeninden `POST` atmak yenilemede
 *    ikinci bir kayıt üretirdi.
 *
 * ⚠️ `POST /stylist/conversations` IDEMPOTENT (`IdempotentPath`) ve anahtar
 *    `useRef`te tutuluyor. `useState` olsaydı render sırasında yeni anahtar
 *    üretilir ve "tekrar dene" İKİNCİ BİR KONUŞMA açardı — sepet/sipariş
 *    tarafındaki kuralın aynısı.
 *
 * ⚠️ AKIŞ AÇILMADAN ÖNCEKİ KAPILAR NORMAL JSON ZARFI DÖNER (429 kota, 503
 *    bütçe/sağlayıcı). Vekil `content-type`a bakıp bu gövdeyi olduğu gibi
 *    geçiriyor; burada da `text/event-stream` DEĞİLSE zarf olarak okunuyor.
 *    Denetlenmeseydi SSE ayrıştırıcısı o gövdeyi "boş yanıt" sanardı ve
 *    kullanıcı ne mesaj ne hata görürdü.
 */

interface Mesaj {
  id: string;
  rol: 'kullanici' | 'danisman';
  metin: string;
}

/** Sepete eklenen kombin / denemeye devredilen ürün — akıştaki `action` olayı. */
interface Eylem {
  id: string;
  tur: 'sepet' | 'deneme';
  metin: string;
  href: string;
  baglantiEtiketi: string;
}

export function Danisman(): React.ReactElement {
  const [mesajlar, setMesajlar] = React.useState<Mesaj[]>([]);
  const [taslak, setTaslak] = React.useState('');
  const [akan, setAkan] = React.useState<string | null>(null);
  const [aracDurumu, setAracDurumu] = React.useState<string | null>(null);
  const [eylemler, setEylemler] = React.useState<Eylem[]>([]);
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);

  const konusmaRef = React.useRef<string | null>(null);
  const acmaAnahtariRef = React.useRef<string | null>(null);
  const sonMesajRef = React.useRef<string>('');

  /** Konuşmayı bir kez açar; açıksa mevcut kimliği döndürür. */
  async function konusmayiAc(): Promise<string> {
    if (konusmaRef.current) return konusmaRef.current;

    acmaAnahtariRef.current ??= newIdempotencyKey();
    const { data } = await apiFetch<StylistConversationWire, '/stylist/conversations'>(
      '/stylist/conversations',
      { method: 'POST', json: {}, idempotencyKey: acmaAnahtariRef.current },
    );
    konusmaRef.current = data.id;
    return data.id;
  }

  async function gonder(metin: string): Promise<void> {
    const icerik = metin.trim();
    if (icerik === '' || gonderiliyor) return;

    sonMesajRef.current = icerik;
    setHata(null);
    setGonderiliyor(true);
    setTaslak('');
    setMesajlar((onceki) => [
      ...onceki,
      { id: `k-${onceki.length}-${Date.now()}`, rol: 'kullanici', metin: icerik },
    ]);
    setAkan('');

    try {
      const konusmaId = await konusmayiAc();

      /*
        ⚠️ `apiFetch` KULLANILMIYOR ve kullanılamaz: o `unwrap()` ile gövdeyi
           JSON olarak okur, yani akışı sonuna kadar bekler — tamponlanan bir
           akış artık akış değildir. Burada ham `fetch` ile vekile gidiliyor;
           jeton yine tarayıcıya çıkmıyor, vekil ekliyor.
      */
      const yanit = await fetch(`/api/stylist/conversations/${konusmaId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ content: icerik }),
        credentials: 'same-origin',
      });

      const tur = yanit.headers.get('content-type') ?? '';
      if (!tur.includes('text/event-stream')) {
        // Kapı hatası: normal zarf. `error.message` ZATEN Türkçe, gösterilir.
        const govde: unknown = await yanit.json().catch(() => null);
        throw zarftanHata(govde, yanit.status);
      }

      await akisiOku(yanit, {
        delta: (parca) => setAkan((onceki) => (onceki ?? '') + parca),
        arac: (ad, durum) => setAracDurumu(durum === 'running' ? `${aracMetni(ad)}…` : null),
        eylem: (olay) => {
          const cevrilen = eyleme(olay);
          if (cevrilen) setEylemler((onceki) => [...onceki, cevrilen]);
        },
        bitti: (messageId) => {
          setAracDurumu(null);
          setAkan((son) => {
            if (son !== null && son.trim() !== '') {
              setMesajlar((onceki) => [...onceki, { id: messageId, rol: 'danisman', metin: son }]);
            }
            return null;
          });
        },
        akisHatasi: (kod, mesaj, tekrarlanabilir) => {
          setAracDurumu(null);
          setAkan(null);
          setHata(
            new ApiFailure({
              /*
                ⚠️ TELDEN GELEN KOD SÜZÜLÜYOR. Akış olayının `code` alanı düz
                   `string`; katalogda olmayan bir kodu olduğu gibi geçirmek
                   `retry-policy.ts`in bilmediği bir dala düşmek demek.
                   Bilinmeyen kod `STYLIST_UNAVAILABLE`a çekiliyor — MESAJ
                   değişmiyor, yalnız DAVRANIŞ tanımlı bir kodun davranışı
                   oluyor (AGENTS.md §4: kod davranış seçer, metin seçmez).
              */
              code: isErrorCode(kod) ? kod : 'STYLIST_UNAVAILABLE',
              message: mesaj,
              httpStatus: 503,
              retryable: tekrarlanabilir,
              requestId: 'akis',
            }),
          );
        },
      });
    } catch (yakalanan) {
      setAkan(null);
      setAracDurumu(null);
      setHata(yakalanan);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {mesajlar.length === 0 && akan === null ? (
          <Baslangic onSec={(soru) => void gonder(soru)} />
        ) : null}

        {mesajlar.map((mesaj) => (
          <MesajBalonu key={mesaj.id} mesaj={mesaj} />
        ))}

        {akan !== null ? (
          <MesajBalonu
            mesaj={{ id: 'akan', rol: 'danisman', metin: akan }}
            /* ⚠️ Akan yanıt `aria-live="polite"`: ekran okuyucu her yeni
                 harfte değil, duraklamada okur. `assertive` olsaydı yazma
                 hızında kesintisiz konuşurdu. */
            canli
          />
        ) : null}

        {aracDurumu ? (
          <p className="text-sm text-metin-soluk" aria-live="polite">
            {aracDurumu}
          </p>
        ) : null}
      </div>

      {eylemler.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {eylemler.map((eylem) => (
            <li
              key={eylem.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-kenar p-3 text-sm"
            >
              <span className="text-metin">{eylem.metin}</span>
              <Link
                href={eylem.href}
                className="ml-auto text-vurgu underline-offset-4 hover:underline"
              >
                {eylem.baglantiEtiketi}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {hata !== null ? (
        <HataGosterimi error={hata} onRetry={() => void gonder(sonMesajRef.current)} />
      ) : null}

      <form
        className="flex flex-col gap-2"
        onSubmit={(olay) => {
          olay.preventDefault();
          void gonder(taslak);
        }}
      >
        <label htmlFor="danisman-mesaji" className="sr-only">
          Danışmana mesajınız
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="danisman-mesaji"
            rows={2}
            /* ⚠️ 2000 sunucudaki `sendMessageSchema` sınırı; burada da yazılı
                 olması, kullanıcının yazdığı uzun mesajın gönderilip 400
                 dönmesini engelliyor. */
            maxLength={2000}
            value={taslak}
            onChange={(olay) => setTaslak(olay.target.value)}
            onKeyDown={(olay) => {
              // Enter gönderir, Shift+Enter satır atlar — sohbet alanının
              // beklenen davranışı.
              if (olay.key === 'Enter' && !olay.shiftKey) {
                olay.preventDefault();
                void gonder(taslak);
              }
            }}
            placeholder="Ne aradığınızı yazın: “ofis için sade bir kombin”"
            className="min-h-20 w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin placeholder:text-metin-soluk"
          />
          <Button type="submit" disabled={gonderiliyor || taslak.trim() === ''}>
            {gonderiliyor ? 'Yanıtlanıyor…' : 'Gönder'}
          </Button>
        </div>
        <p className="text-xs text-metin-soluk">
          Öneriler bir tahmindir; beden ve kalıp ürüne göre değişebilir.
        </p>
      </form>
    </div>
  );
}

/**
 * ⚠️ BALON RENKSİZ. Kullanıcı ile danışmanı ayıran şey renk değil, HİZA ve
 *    etiket: `design-system.md`de renk yalnızca DURUM taşıyor ve "kim yazdı"
 *    bir durum değil. Renkli balon, aynı ekrandaki gerçek uyarıların
 *    (`HataGosterimi`) sinyalini harcardı.
 */
function MesajBalonu({ mesaj, canli }: { mesaj: Mesaj; canli?: boolean }): React.ReactElement {
  const kullanici = mesaj.rol === 'kullanici';
  return (
    <div className={kullanici ? 'flex justify-end' : 'flex justify-start'}>
      <div className="max-w-prose">
        <p className="mb-1 text-xs text-metin-soluk">{kullanici ? 'Siz' : 'Danışman'}</p>
        <p
          {...(canli ? { 'aria-live': 'polite' as const } : {})}
          className="whitespace-pre-wrap rounded-md border border-kenar bg-yuzey p-3 text-sm text-metin"
        >
          {mesaj.metin}
          {canli && mesaj.metin === '' ? 'Yanıt hazırlanıyor…' : null}
        </p>
      </div>
    </div>
  );
}

/**
 * ⚠️ BOŞ EKRAN NE YAZILACAĞINI SÖYLER. "Bir şey sorun" diyen boş bir kutu,
 *    kullanıcıyı danışmanın NE yapabildiğini tahmin etmeye bırakır; üç örnek
 *    hem yeteneği hem sınırı gösteriyor.
 */
function Baslangic({ onSec }: { onSec: (soru: string) => void }): React.ReactElement {
  const ORNEKLER = [
    'Ofis için sade bir kombin öner',
    'Siyah pantolonumun üstüne ne giyebilirim?',
    'Bedenim M, hangi kalıp bana uyar?',
  ];

  return (
    <div className="rounded-lg border border-dashed border-kenar p-6">
      <p className="text-sm font-medium text-metin">Ne aradığınızı anlatın.</p>
      <p className="mt-1 max-w-prose text-sm text-metin-soluk">
        Danışman kataloğu arar, kombin uyumunu değerlendirir ve bedeninizi biliyorsa ona göre öneri
        yapar. Seçtiği ürünleri sepete ekleyebilir ya da sanal denemeye devredebilir.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {ORNEKLER.map((ornek) => (
          <Button key={ornek} variant="ikincil" size="sm" onClick={() => onSec(ornek)}>
            {ornek}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ── Akış tüketimi ───────────────────────────────────────────────────────────

interface AkisTuketicisi {
  delta: (parca: string) => void;
  arac: (ad: string, durum: 'running' | 'ok' | 'error') => void;
  eylem: (olay: { type: string; payload: unknown }) => void;
  bitti: (messageId: string) => void;
  akisHatasi: (kod: string, mesaj: string, tekrarlanabilir: boolean) => void;
}

async function akisiOku(yanit: Response, tuketici: AkisTuketicisi): Promise<void> {
  const govde = yanit.body;
  if (!govde) return;

  const okuyucu = govde.getReader();
  const cozucu = new TextDecoder();
  const akis = new AkisCozucu();

  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;

    // ⚠️ `stream: true` ŞART: UTF-8 çok baytlı karakter (ç, ğ, ş) parça
    //    sınırında bölünebilir ve bayrak olmadan yerine "" konur.
    for (const olay of akis.yut(cozucu.decode(value, { stream: true }))) {
      switch (olay.type) {
        case 'start':
          break;
        case 'delta':
          tuketici.delta(olay.data.text);
          break;
        case 'tool':
          tuketici.arac(olay.data.name, olay.data.status);
          break;
        case 'action':
          tuketici.eylem(olay.data);
          break;
        case 'done':
          tuketici.bitti(olay.data.messageId);
          break;
        case 'error':
          tuketici.akisHatasi(olay.data.code, olay.data.message, olay.data.retryable);
          break;
      }
    }
  }
}

/**
 * `action` OLAYI → EKRANDA GERÇEKTEN ÇALIŞAN BİR SATIR.
 *
 * ⚠️ `tryon.open` DOĞRUDAN DENEME EKRANINA BAĞLANAMIYOR ve sebebi ölçülebilir:
 *    payload `{type:'OPEN_TRYON', variantId, productTitle}` taşıyor
 *    (`stylist.ports.ts` → `TryOnHandoff`), deneme ekranının rotası ise
 *    `/product/[slug]/try-on`. Varyant kimliğinden slug üreten bir uç YOK
 *    (`GET /products/:slug` var, `:id` yok). Uydurma bir adres kurmak "basınca
 *    404 veren düğme" olurdu; bu yüzden bağlantı ürün ADIYLA aramaya gidiyor —
 *    çalışan, dürüst ve tek tık uzakta. Eksik uç raporlandı.
 *
 * ⚠️ TANINMAYAN EYLEM SESSİZCE ATILIR: sunucu yeni bir eylem tipi ürettiğinde
 *    ekranın çökmesi ya da anlamsız bir satır basması, ikisi de yanlış.
 */
function eyleme(olay: { type: string; payload: unknown }): Eylem | null {
  const kimlik = `${olay.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (olay.type === 'cart.updated') {
    return {
      id: kimlik,
      tur: 'sepet',
      metin: 'Önerilen kombin sepetinize eklendi.',
      href: '/cart',
      baglantiEtiketi: 'Sepete git',
    };
  }

  if (olay.type === 'tryon.open') {
    const yuk = olay.payload as { productTitle?: unknown } | null;
    const baslik = typeof yuk?.productTitle === 'string' ? yuk.productTitle : null;
    if (!baslik) return null;
    return {
      id: kimlik,
      tur: 'deneme',
      metin: `${baslik} sanal denemeye hazır.`,
      href: `/products?q=${encodeURIComponent(baslik)}`,
      baglantiEtiketi: 'Ürüne git',
    };
  }

  return null;
}

/**
 * Kapı hatasının zarfını `ApiFailure`a çevirir.
 *
 * ⚠️ Mesaj BURADA YAZILMAZ: `error.message` sunucudan Türkçe geliyor ve
 *    yeniden yazmak ikinci bir metin kaynağı üretir (AGENTS.md §4). Yalnızca
 *    zarfsız bir yanıt geldiğinde genel bir cümleye düşülüyor.
 */
function zarftanHata(govde: unknown, httpStatus: number): ApiFailure {
  if (
    typeof govde === 'object' &&
    govde !== null &&
    'error' in govde &&
    typeof (govde as { error: unknown }).error === 'object'
  ) {
    return new ApiFailure((govde as { error: ConstructorParameters<typeof ApiFailure>[0] }).error);
  }
  return new ApiFailure({
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Stil danışmanına şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.',
    httpStatus,
    retryable: true,
    requestId: 'akis',
  });
}
