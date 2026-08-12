'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PasswordChangedWire } from '@vt/contracts';

/**
 * ŞİFRE DEĞİŞTİRME.
 *
 * ⚠️ BAŞARILI OLDUĞUNDA KULLANICI ÇIKIŞ YAPMIŞ OLUR. `auth.controller.ts` bu
 *    uçta TÜM oturumları düşürüp `vt_rt` çerezini siliyor — bu istemcininki de
 *    dahil. Elimizdeki `vt_sid` artık ÖLÜ bir jeton çiftini işaret ediyor.
 *    Sayfada kalınsaydı kullanıcı bir sonraki tıklamasında sebepsiz bir 401
 *    ekranıyla karşılaşırdı; bunun yerine yerel oturum AÇIKÇA kapatılıp
 *    `/giris`e sebebiyle birlikte gidiliyor.
 *
 * ⚠️ Çıkış çağrısının başarısız olması akışı DURDURMAZ: o handler her durumda
 *    yerel oturumu siliyor ve zaten hedef, kullanıcıyı giriş ekranına almak.
 */
export function SifreFormu(): React.ReactElement {
  const router = useRouter();
  const [hata, setHata] = React.useState<unknown>(null);
  const [alanHatalari, setAlanHatalari] = React.useState<Record<string, string>>({});
  const [gonderiliyor, setGonderiliyor] = React.useState(false);

  async function gonder(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setGonderiliyor(true);
    setHata(null);
    setAlanHatalari({});

    try {
      await apiFetch<PasswordChangedWire, '/auth/password/change'>('/auth/password/change', {
        method: 'POST',
        json: {
          currentPassword: String(form.get('currentPassword') ?? ''),
          newPassword: String(form.get('newPassword') ?? ''),
        },
      });

      try {
        await apiFetch<{ loggedOut: true }, '/auth/logout'>('/auth/logout', { method: 'POST' });
      } catch {
        // Yut: yerel oturum handler tarafında her hâlükârda silindi.
      }

      router.replace('/giris?sebep=sifre-degisti');
      router.refresh();
    } catch (error) {
      if (isApiFailure(error)) setAlanHatalari(fieldErrorMap(error.fields));
      setHata(error);
      setGonderiliyor(false);
    }
  }

  return (
    <form onSubmit={gonder} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">Mevcut şifreniz</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={alanHatalari.currentPassword ? true : undefined}
        />
        {alanHatalari.currentPassword ? (
          <p className="text-xs text-tehlike">{alanHatalari.currentPassword}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newPassword">Yeni şifre</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={alanHatalari.newPassword ? true : undefined}
        />
        {alanHatalari.newPassword ? (
          <p className="text-xs text-tehlike">{alanHatalari.newPassword}</p>
        ) : (
          <p className="text-xs text-metin-soluk">
            En az 10 karakter, en az bir harf ve bir rakam.
          </p>
        )}
      </div>

      <p className="text-xs text-metin-soluk">
        Şifreniz değiştiğinde tüm cihazlardaki oturumlarınız kapanır ve bu cihazda da yeniden giriş
        yapmanız gerekir.
      </p>

      {hata ? <HataGosterimi error={hata} /> : null}

      <div>
        <Button type="submit" disabled={gonderiliyor}>
          {gonderiliyor ? 'Değiştiriliyor…' : 'Şifreyi değiştir'}
        </Button>
      </div>
    </form>
  );
}
