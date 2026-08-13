'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { isApiFailure, type Locale } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthenticateResult } from '@/lib/session/authenticate';
import { guvenliDonusYolu } from '@/lib/donus-yolu';

/**
 * KAYIT FORMU.
 *
 * ⚠️ `acceptedTerms` gövdeye YALNIZCA `true` olarak gidebilir: şema
 *    `z.literal(true)` (`schemas/auth.ts`). `false` göndermek kaydı
 *    reddettirir — yani onay kutusu bir süs değil, sunucunun kapısıdır.
 *    Burada `required` ile tarayıcı da engelliyor; ikisi birden var çünkü
 *    yalnız tarayıcıya güvenen bir akış, JavaScript kapalıyken ya da elle
 *    atılan bir istekte rızasız kayıt üretmeye ÇALIŞIR ve sunucudan
 *    anlamsız bir hata alır.
 *
 * ⚠️ `marketingConsent` VARSAYILAN OLARAK KAPALI ve öyle kalmalı. Önceden
 *    işaretli bir kutu KVKK md.3 anlamında "özgür iradeyle açıklanan" rıza
 *    değildir; kaydın kendisi de bu yüzden geçersiz sayılır.
 *
 * ⚠️ E-posta ve telefonun İKİSİ birden zorunlu değil, biri yeterli. Sunucu
 *    `refine` hatasını `path: ['email']` ile döndürüyor; alan hatası bu yüzden
 *    e-posta kutusunun altında görünür.
 */
export function KayitFormu({ next }: { next: string | null }): React.ReactElement {
  const router = useRouter();
  const locale = useLocale() as Locale;
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

    const eposta = String(form.get('email') ?? '').trim();
    const telefon = String(form.get('phone') ?? '').trim();

    try {
      const { data } = await apiFetch<AuthenticateResult, '/auth/register'>('/auth/register', {
        method: 'POST',
        json: {
          // ⚠️ Boş string GÖNDERİLMEZ, alan hiç gönderilmez: `emailSchema` boş
          //    stringi "geçersiz e-posta" diye reddeder ve telefonla kayıt olan
          //    kullanıcı doldurmadığı bir alandan hata alır.
          ...(eposta ? { email: eposta } : {}),
          ...(telefon ? { phone: telefon } : {}),
          password: String(form.get('password') ?? ''),
          firstName: String(form.get('firstName') ?? '').trim(),
          lastName: String(form.get('lastName') ?? '').trim(),
          acceptedTerms: form.get('acceptedTerms') === 'on',
          marketingConsent: form.get('marketingConsent') === 'on',
        },
      });

      if (data.skipped.length > 0) {
        setTasinamayan(data.skipped);
        setGonderiliyor(false);
        return;
      }

      router.replace(hedef);
      router.refresh();
    } catch (error) {
      if (isApiFailure(error)) setAlanHatalari(fieldErrorMap(error.fields, locale));
      setHata(error);
      setGonderiliyor(false);
    }
  }

  if (tasinamayan) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div role="status" className="rounded-md border border-kenar bg-yuzey p-4 text-sm">
          <p className="font-medium text-metin">Hesabınız oluşturuldu.</p>
          <p className="mt-2 text-metin-soluk">
            Misafirken sepetinize eklediğiniz {tasinamayan.length} ürün taşınamadı; sebebi
            genellikle stok tükenmesi veya ürünün yayından kalkmış olmasıdır.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/cart">Sepete git</Link>
          </Button>
          <Button variant="ikincil" asChild>
            <Link href={hedef}>Devam et</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={gonder} className="mt-6 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <AlanKutusu id="firstName" etiket="Ad" hata={alanHatalari.firstName}>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            aria-invalid={alanHatalari.firstName ? true : undefined}
          />
        </AlanKutusu>
        <AlanKutusu id="lastName" etiket="Soyad" hata={alanHatalari.lastName}>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            aria-invalid={alanHatalari.lastName ? true : undefined}
          />
        </AlanKutusu>
      </div>

      <AlanKutusu id="email" etiket="E-posta" hata={alanHatalari.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={alanHatalari.email ? true : undefined}
        />
      </AlanKutusu>

      <AlanKutusu
        id="phone"
        etiket="Telefon"
        ipucu="E-posta veya telefondan en az birini girin. Telefon +90 ile başlar."
        hata={alanHatalari.phone}
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+905XXXXXXXXX"
          aria-invalid={alanHatalari.phone ? true : undefined}
        />
      </AlanKutusu>

      <AlanKutusu
        id="password"
        etiket="Şifre"
        ipucu="En az 10 karakter, en az bir harf ve bir rakam."
        hata={alanHatalari.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={alanHatalari.password ? true : undefined}
        />
      </AlanKutusu>

      <div className="flex flex-col gap-3 rounded-md border border-kenar bg-yuzey p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="acceptedTerms"
            required
            className="mt-0.5 size-4 shrink-0 accent-[var(--metin)]"
          />
          <span className="text-metin">
            <Link
              href="/kullanim-kosullari"
              className="text-vurgu underline-offset-4 hover:underline"
            >
              Kullanım koşullarını
            </Link>{' '}
            ve{' '}
            <Link
              href="/aydinlatma-metni"
              className="text-vurgu underline-offset-4 hover:underline"
            >
              aydınlatma metnini
            </Link>{' '}
            okudum, kabul ediyorum.
          </span>
        </label>
        {alanHatalari.acceptedTerms ? (
          <p className="text-xs text-tehlike">{alanHatalari.acceptedTerms}</p>
        ) : null}

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="marketingConsent"
            className="mt-0.5 size-4 shrink-0 accent-[var(--metin)]"
          />
          <span className="text-metin-soluk">
            Kampanya ve indirim duyurularını almak istiyorum. İsteğe bağlıdır; sipariş ve kargo
            bildirimleri bu seçimden etkilenmez ve her hâlükârda gönderilir.
          </span>
        </label>
      </div>

      {hata ? <HataGosterimi error={hata} /> : null}

      <Button type="submit" disabled={gonderiliyor}>
        {gonderiliyor ? 'Hesap oluşturuluyor…' : 'Hesap oluştur'}
      </Button>

      <p className="text-sm text-metin-soluk">
        Zaten hesabınız var mı?{' '}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="text-vurgu underline-offset-4 hover:underline"
        >
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}

function AlanKutusu({
  id,
  etiket,
  ipucu,
  hata,
  children,
}: {
  id: string;
  etiket: string;
  ipucu?: string;
  hata?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiket}</Label>
      {children}
      {ipucu && !hata ? <p className="text-xs text-metin-soluk">{ipucu}</p> : null}
      {hata ? <p className="text-xs text-tehlike">{hata}</p> : null}
    </div>
  );
}
