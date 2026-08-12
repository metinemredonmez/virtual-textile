'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GARDIROP_KATEGORISI } from '../_lib/etiketler';
import type {
  WardrobeCategoryWire,
  WardrobeItemWire,
  WardrobeUploadTicketWire,
} from '@vt/contracts';

/**
 * GARDIROP — parça ekleme ve silme.
 *
 * ⚠️ EKLEME ÜÇ ADIMDIR ve ortadaki adım VEKİLDEN GEÇMEZ:
 *      1. `POST /api/wardrobe`            → imzalı yükleme adresi (202)
 *      2. `PUT <imzalı adres>`            → dosya DOĞRUDAN özel kovaya
 *      3. `POST /api/wardrobe/:id/confirm`→ kayıt kalıcılaşır (201)
 *    Dosya vekilden geçirilseydi her yükleme tam dosya olarak Next sunucusunun
 *    belleğine inerdi; sunucu tarafı da anahtarı istemciden ALMIYOR, `user.sub`
 *    ile kendisi üretiyor (aksi hâlde başkasının fotoğrafına bağlanılabilirdi).
 *
 * ⚠️ 2. adım BAŞARISIZ OLURSA 3. adım ÇAĞRILMAZ. Çağrılsaydı gardıropta
 *    fotoğrafı olmayan bir kayıt kalırdı ve kullanıcı bunu ancak boş bir kutu
 *    görünce anlardı.
 *
 * ⚠️ İmzalı adrese giden istekte ÇEREZ GİTMEZ (`credentials: 'omit'`).
 *    Varsayılan davranış zaten bu ama açıkça yazılıyor: `vt_sid` üçüncü taraf
 *    bir depoya hiçbir koşulda gönderilmemeli.
 */

/** `wardrobe.schema.ts` → `wardrobePhotoContentTypeSchema`. SVG YOK: script taşır. */
const IZINLI_TURLER = ['image/jpeg', 'image/png', 'image/webp'];

/** `wardrobeCreateSchema` → `sizeBytes.max(10 * 1024 * 1024)`. */
const AZAMI_BAYT = 10 * 1024 * 1024;

export function GardiropYonetimi({
  parcalar,
}: {
  parcalar: WardrobeItemWire[];
}): React.ReactElement {
  const router = useRouter();
  const [hata, setHata] = React.useState<unknown>(null);
  const [yerelHata, setYerelHata] = React.useState<string | null>(null);
  const [asama, setAsama] = React.useState<'bos' | 'adres' | 'yukleme' | 'onay'>('bos');
  const [silinen, setSilinen] = React.useState<string | null>(null);
  const [formAcik, setFormAcik] = React.useState(false);

  async function ekle(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const veri = new FormData(form);
    const dosya = veri.get('photo');

    setHata(null);
    setYerelHata(null);

    if (!(dosya instanceof File) || dosya.size === 0) {
      setYerelHata('Bir fotoğraf seçin.');
      return;
    }
    // ⚠️ Bu iki kapı SUNUCUDA DA VAR; buradakiler yalnızca kullanıcıyı boşuna
    //    bir yüklemeye sokmamak için. Tek kapı olsalardı yetersiz olurlardı.
    if (!IZINLI_TURLER.includes(dosya.type)) {
      setYerelHata('Yalnızca JPEG, PNG veya WebP fotoğraf yükleyebilirsiniz.');
      return;
    }
    if (dosya.size > AZAMI_BAYT) {
      setYerelHata('Fotoğraf en fazla 10 MB olabilir.');
      return;
    }

    const govde = {
      category: String(veri.get('category') ?? '') as WardrobeCategoryWire,
      color: String(veri.get('color') ?? '').trim(),
      label: String(veri.get('label') ?? '').trim() || null,
      contentType: dosya.type,
      /**
       * ⚠️ `dosya.size` GÖNDERİLİR, yuvarlak bir tavan değil: imzalı adres
       *    `content-length` başlığını İMZALIYOR. Farklı bir sayı bildirilirse
       *    depo yüklemeyi imza uyuşmazlığı diye reddeder ve hata "fotoğraf
       *    yüklenemedi" diye görünür, sebebi görünmez.
       */
      sizeBytes: dosya.size,
    };

    try {
      setAsama('adres');
      const { data: bilet } = await apiFetch<WardrobeUploadTicketWire, '/wardrobe'>('/wardrobe', {
        method: 'POST',
        json: govde,
      });

      setAsama('yukleme');
      const yukleme = await fetch(bilet.uploadUrl, {
        method: 'PUT',
        body: dosya,
        headers: { 'content-type': dosya.type },
        credentials: 'omit',
      });

      if (!yukleme.ok) {
        setYerelHata(
          `Fotoğraf depoya yüklenemedi (HTTP ${yukleme.status}). Bağlantınızı kontrol edip tekrar deneyin.`,
        );
        setAsama('bos');
        return;
      }

      setAsama('onay');
      await apiFetch<WardrobeItemWire, `/wardrobe/${string}/confirm`>(
        `/wardrobe/${bilet.itemId}/confirm`,
        { method: 'POST', json: govde },
      );

      form.reset();
      setFormAcik(false);
      router.refresh();
    } catch (error) {
      setHata(error);
    } finally {
      setAsama('bos');
    }
  }

  async function sil(id: string): Promise<void> {
    setSilinen(id);
    setHata(null);
    try {
      // 204 — gövde yok.
      await apiFetch<undefined, `/wardrobe/${string}`>(`/wardrobe/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (error) {
      setHata(error);
    } finally {
      setSilinen(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-metin-soluk">
          <span className="rakam">{parcalar.length}</span> parça
        </p>
        <Button variant="ikincil" size="sm" onClick={() => setFormAcik((acik) => !acik)}>
          {formAcik ? 'Vazgeç' : 'Parça ekle'}
        </Button>
      </div>

      {formAcik ? (
        <form onSubmit={ekle} className="flex flex-col gap-4 rounded-lg border border-kenar p-4">
          <p className="text-sm text-metin">
            Platformda satmadığımız kendi kıyafetlerinizi de ekleyebilirsiniz; kombin önerileri
            gerçek dolabınıza bakar.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Kategori</Label>
              <select
                id="category"
                name="category"
                required
                defaultValue="UPPER_BODY"
                className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
              >
                {(Object.keys(GARDIROP_KATEGORISI) as WardrobeCategoryWire[]).map((anahtar) => (
                  <option key={anahtar} value={anahtar}>
                    {GARDIROP_KATEGORISI[anahtar]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="color">Renk</Label>
              <Input
                id="color"
                name="color"
                required
                minLength={2}
                maxLength={40}
                placeholder="Lacivert"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="label">Ad (isteğe bağlı)</Label>
            <Input id="label" name="label" maxLength={120} placeholder="Kot ceket" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photo">Fotoğraf</Label>
            <input
              id="photo"
              name="photo"
              type="file"
              accept={IZINLI_TURLER.join(',')}
              required
              className="text-sm text-metin file:mr-3 file:rounded-md file:border file:border-kenar file:bg-zemin file:px-3 file:py-1.5 file:text-sm file:text-metin"
            />
            <p className="text-xs text-metin-soluk">
              Fotoğraf özel bir alanda saklanır ve yalnızca size gösterilir; adres kısa ömürlüdür.
            </p>
          </div>

          {yerelHata ? (
            <p role="alert" className="text-sm text-tehlike">
              {yerelHata}
            </p>
          ) : null}
          {hata ? <HataGosterimi error={hata} /> : null}

          <div>
            <Button type="submit" disabled={asama !== 'bos'}>
              {asama === 'adres'
                ? 'Yükleme adresi alınıyor…'
                : asama === 'yukleme'
                  ? 'Fotoğraf yükleniyor…'
                  : asama === 'onay'
                    ? 'Kaydediliyor…'
                    : 'Gardıroba ekle'}
            </Button>
          </div>
        </form>
      ) : null}

      {!formAcik && hata ? <HataGosterimi error={hata} /> : null}

      {parcalar.length === 0 ? (
        <div className="rounded-lg border border-kenar p-8 text-center text-sm text-metin-soluk">
          Gardırobunuz henüz boş. Satın aldığınız ürünler teslim edildiğinde buraya kendiliğinden
          eklenir; kendi kıyafetlerinizi de yukarıdan ekleyebilirsiniz.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
          {parcalar.map((parca) => (
            <ParcaKarti
              key={parca.id}
              parca={parca}
              siliniyor={silinen === parca.id}
              onSil={() => void sil(parca.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ParcaKarti({
  parca,
  siliniyor,
  onSil,
}: {
  parca: WardrobeItemWire;
  siliniyor: boolean;
  onSil: () => void;
}): React.ReactElement {
  return (
    <li className="flex flex-col gap-2">
      <div className="relative aspect-urun w-full overflow-hidden rounded-md bg-yuzey">
        {parca.imageUrl ? (
          /*
           * ⚠️ `next/image` DEĞİL, düz `<img>`. İki ayrı sebep, ikisi de yeterli:
           *   1. İmzalı adresin sunucusu (`*.r2.cloudflarestorage.com`)
           *      `next.config.ts` → `remotePatterns` listesinde YOK; optimizasyon
           *      isteği 400 döner ve görsel hiç çıkmaz.
           *   2. Daha önemlisi: `next/image` optimize ettiği çıktıyı SUNUCU
           *      DİSKİNDE önbelleğe alır. Gardırop fotoğrafı özel niteliklidir ve
           *      imzalı adresin ömrü dakikalarla sınırlıdır; optimize kopya o
           *      ömrü aşarak diskte kalır ve saklama taahhüdünü sessizce deler.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={parca.imageUrl}
            alt={parca.label ?? GARDIROP_KATEGORISI[parca.category]}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-metin">
          {parca.label ?? GARDIROP_KATEGORISI[parca.category]}
        </p>
        <p className="text-sm text-metin-soluk">
          {GARDIROP_KATEGORISI[parca.category]} · {parca.color}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {/* ⚠️ Kaynak rozeti "buraya nasıl geldi" sorusunu ekranda cevaplar;
              satın alınan parça kullanıcı hiçbir şey yapmadan giriyor. */}
          <Badge durum="notr">
            {parca.source === 'PURCHASE' ? 'Satın alındı' : 'Kendi ekledim'}
          </Badge>
          {parca.tryOnable ? <Badge durum="notr">Üzerimde dene</Badge> : null}
        </div>

        <div>
          <Button variant="sessiz" size="sm" onClick={onSil} disabled={siliniyor}>
            <Trash2 className="text-ikon" />
            {siliniyor ? 'Siliniyor…' : 'Sil'}
          </Button>
        </div>
      </div>
    </li>
  );
}
