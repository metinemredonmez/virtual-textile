'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthenticateResult } from '@/lib/session/authenticate';
import { guvenliDonusYolu } from '@/lib/donus-yolu';

/**
 * GİRİŞ FORMU.
 *
 * ⚠️ `POST /api/auth/login` çağrılır — `/v1/auth/login` DEĞİL. Aradaki fark
 *    her şeydir: vekilin bu yolu Redis'e oturum yazar, `vt_sid` üretir ve
 *    misafir sepetini birleştirir. Doğrudan API'ye gidilseydi jeton
 *    tarayıcıya düşer ve `localStorage` yasağı anlamsızlaşırdı.
 *
 * ⚠️ `identifier` TEK ALAN: e-posta mı telefon mu olduğunu sunucu ayırt ediyor
 *    (`auth.service.ts` → `OR: [{email},{phone}]`). İki ayrı sekme yapmak,
 *    kullanıcıya sunucunun umursamadığı bir seçim dayatırdı.
 *
 * ⚠️ `AuthenticateResult` `import type` İLE geliyor ve öyle KALMALI. O modül
 *    (`lib/session/authenticate.ts`) `import 'server-only'` taşıyor; değer
 *    olarak içeri alınırsa bu İstemci Bileşeni derlenmez. Tip importu
 *    tamamen silindiği için bugün sorun yok — ama biri oradan bir fonksiyon
 *    almaya kalkarsa hata "server-only" diye görünür, sebebi burasıdır.
 */
export function GirisFormu({ next }: { next: string | null }): React.ReactElement {
  const router = useRouter();
  const [hata, setHata] = React.useState<unknown>(null);
  const [alanHatalari, setAlanHatalari] = React.useState<Record<string, string>>({});
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [tasinamayan, setTasinamayan] = React.useState<AuthenticateResult['skipped'] | null>(null);

  const hedef = guvenliDonusYolu(next);

  async function gonder(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setGonderiliyor(true);
    setHata(null);
    setAlanHatalari({});

    try {
      const { data } = await apiFetch<AuthenticateResult, '/auth/login'>('/auth/login', {
        method: 'POST',
        json: {
          identifier: String(form.get('identifier') ?? '').trim(),
          password: String(form.get('password') ?? ''),
        },
      });

      /**
       * ⚠️ Taşınamayan sepet kalemi varsa YÖNLENDİRME YAPILMAZ. Yönlendirseydik
       *    tek bilgi kaynağı olan bu yanıt kaybolur ve kullanıcı ürününün
       *    kaybolduğunu ancak ödeme ekranında fark ederdi
       *    (`cart.ts` → `CartMergeResultWire.skipped` başlığındaki gerekçe).
       */
      if (data.skipped.length > 0) {
        setTasinamayan(data.skipped);
        setGonderiliyor(false);
        return;
      }

      // ⚠️ `refresh()` ŞART: düzen ve hesap sayfaları Sunucu Bileşeni ve
      //    yönlendirmeden önce ÇEREZSİZ hâlleri önbellekte duruyor. Yalnız
      //    `replace` çağıran bir akış kullanıcıyı "giriş yapmamış" görünen bir
      //    ekrana götürür.
      router.replace(hedef);
      router.refresh();
    } catch (error) {
      if (isApiFailure(error)) setAlanHatalari(fieldErrorMap(error.fields));
      setHata(error);
      setGonderiliyor(false);
    }
  }

  if (tasinamayan) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div role="status" className="rounded-md border border-kenar bg-yuzey p-4 text-sm">
          <p className="font-medium text-metin">Giriş yapıldı.</p>
          <p className="mt-2 text-metin-soluk">
            Misafirken sepetinize eklediğiniz {tasinamayan.length} ürün hesabınızdaki sepete
            taşınamadı. Sebebi genellikle stok tükenmesi veya ürünün yayından kalkmış olmasıdır.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/sepet">Sepete git</Link>
          </Button>
          <Button variant="ikincil" asChild>
            <Link href={hedef}>Devam et</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={gonder} className="mt-6 flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="identifier">E-posta veya telefon</Label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          required
          aria-invalid={alanHatalari.identifier ? true : undefined}
          aria-describedby={alanHatalari.identifier ? 'identifier-hata' : undefined}
        />
        {alanHatalari.identifier ? (
          <p id="identifier-hata" className="text-xs text-tehlike">
            {alanHatalari.identifier}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Şifre</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={alanHatalari.password ? true : undefined}
          aria-describedby={alanHatalari.password ? 'password-hata' : undefined}
        />
        {alanHatalari.password ? (
          <p id="password-hata" className="text-xs text-tehlike">
            {alanHatalari.password}
          </p>
        ) : null}
      </div>

      {/* ⚠️ Hata metni SUNUCUDAN gelir, burada yeniden yazılmaz. "Kullanıcı yok"
          ile "şifre yanlış" AYNI mesajı döndürüyor (numaralandırma koruması);
          ikisini ayırmaya çalışan bir arayüz o korumayı deler. */}
      {hata ? <HataGosterimi error={hata} /> : null}

      <Button type="submit" disabled={gonderiliyor}>
        {gonderiliyor ? 'Giriş yapılıyor…' : 'Giriş yap'}
      </Button>

      <p className="text-sm text-metin-soluk">
        Hesabınız yok mu?{' '}
        <Link
          href={next ? `/kayit?next=${encodeURIComponent(next)}` : '/kayit'}
          className="text-vurgu underline-offset-4 hover:underline"
        >
          Kayıt olun
        </Link>
      </p>
    </form>
  );
}
