'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PHOTO_RETENTION } from '@vt/config/constants';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { tarihSaat } from '@/lib/tarih';
import type { AccountDeletionWire } from '@vt/contracts';

/**
 * HESAP SİLME TALEBİ.
 *
 * ⚠️ SABİT `@vt/config/constants`TAN GELİYOR, elle yazılmıyor. Geri alma
 *    penceresi bir gün 30'dan 14'e çekilirse ekran kendiliğinden düzelir;
 *    elle yazılsaydı kullanıcıya var olmayan bir hak vaat edilmiş olurdu.
 *    ⚠️ İçe aktarma `@vt/config/constants` alt yolundan — kökten alınırsa
 *       `env.ts` istemci paketine girer ve sır ADLARI `.next/static`e düşer
 *       (ölçüldü; `verify:bundle` bunu kırıyor).
 *
 * ⚠️ NE SİLİNİYOR / NE ANONİMLEŞTİRİLİYOR AÇIKÇA YAZILIYOR. Sipariş, fatura ve
 *    muhasebe kayıtları SİLİNMİYOR — bunlar şirketin yasal kayıtları (VUK/TTK
 *    saklama süresi) ve silinirlerse defter tutmaz. Yapılan şey, kişiyi işaret
 *    eden alanların takma kimlikle değiştirilmesi. Bunu söylememek, tutulamayacak
 *    bir söz vermektir: kullanıcı "her şey silindi" sanır, sipariş kaydı durur.
 *
 * ⚠️ SEBEP SERBEST METİN DEĞİL, SABİT LİSTE. Serbest metin kutusuna kullanıcılar
 *    kimlik numarası ve şifre yazar; o metin denetim kaydında süresiz durur.
 */
const SEBEPLER = [
  { deger: '', etiket: 'Belirtmek istemiyorum' },
  { deger: 'NO_LONGER_USING', etiket: 'Artık kullanmıyorum' },
  { deger: 'PRIVACY_CONCERN', etiket: 'Gizlilik endişem var' },
  { deger: 'TOO_MANY_EMAILS', etiket: 'Çok fazla e-posta geliyor' },
  { deger: 'FOUND_ALTERNATIVE', etiket: 'Başka bir platform kullanıyorum' },
  { deger: 'OTHER', etiket: 'Diğer' },
] as const;

export function HesapSilme(): React.ReactElement {
  const router = useRouter();
  const [acik, setAcik] = React.useState(false);
  const [sebep, setSebep] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [sonuc, setSonuc] = React.useState<AccountDeletionWire | null>(null);

  async function talepEt(): Promise<void> {
    setGonderiliyor(true);
    setHata(null);
    try {
      const { data } = await apiFetch<AccountDeletionWire, '/me'>('/me', {
        method: 'DELETE',
        // ⚠️ Sebep verilmediyse alan HİÇ gönderilmez. Boş string göndermek
        //    enum doğrulamasını düşürür ve isteğe bağlı bir alan yüzünden bir
        //    KVKK hakkı kullanılamaz hâle gelir.
        ...(sebep ? { json: { reason: sebep } } : {}),
      });
      setSonuc(data);
      setAcik(false);
    } catch (error) {
      setHata(error);
    } finally {
      setGonderiliyor(false);
    }
  }

  async function cik(): Promise<void> {
    try {
      await apiFetch<{ loggedOut: true }, '/auth/logout'>('/auth/logout', { method: 'POST' });
    } catch {
      // ⚠️ Talep anında SUNUCU zaten tüm oturumları düşürdü; bu çağrının 401
      //    alması BEKLENEN durumdur. Yerel `vt_sid` handler tarafında her
      //    hâlükârda siliniyor, o yüzden hata yutuluyor.
    }
    router.replace('/giris?sebep=hesap-silme');
    router.refresh();
  }

  if (sonuc) {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="rounded-md bg-uyari-zemin p-4 text-sm text-uyari">
          <p className="font-medium">
            {sonuc.alreadyRequested
              ? 'Zaten açık bir silme talebiniz vardı.'
              : 'Hesap silme talebiniz alındı.'}
          </p>
          <p className="mt-2">
            Verileriniz {tarihSaat(sonuc.purgeAt)} tarihinde silinecek/anonimleştirilecek. Vazgeçmek
            için <span className="rakam">{sonuc.daysRemaining}</span> gününüz var:{' '}
            <strong className="font-medium">bu süre içinde giriş yapmanız yeterli</strong>, talep
            kendiliğinden iptal olur.
          </p>
        </div>

        <p className="text-sm text-metin-soluk">
          Güvenlik gereği tüm cihazlardaki oturumlarınız kapatıldı
          {sonuc.sessionsRevoked > 0 ? (
            <>
              {' '}
              (<span className="rakam">{sonuc.sessionsRevoked}</span> oturum)
            </>
          ) : null}
          .
        </p>

        <div>
          <Button onClick={() => void cik()}>Anladım, çıkış yap</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-metin-soluk">
        <p>
          Hesap silme talebi anında silmez:{' '}
          <strong className="font-medium text-metin">
            <span className="rakam">{PHOTO_RETENTION.accountDeletionGraceDays}</span> günlük geri
            alma penceresi
          </strong>{' '}
          başlar. Bu süre içinde giriş yaparsanız talep otomatik olarak iptal edilir. Talep anında
          tüm oturumlarınız kapatılır.
        </p>

        <p className="mt-3 font-medium text-metin">Süre dolduğunda ne olur?</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="font-medium text-metin">Silinir:</strong> profil bilgileriniz,
            adresleriniz, yüklediğiniz fotoğraflar, sanal deneme sonuçlarınız, gardırobunuz ve
            sepetiniz.
          </li>
          <li>
            <strong className="font-medium text-metin">Anonimleştirilir, silinmez:</strong> sipariş,
            fatura ve muhasebe kayıtları. Bunlar yasal saklama yükümlülüğüne tabidir; kaldırılırsa
            satıcı hakedişleri ve geçmiş dönem raporları açıklanamaz hâle gelir. Kayıtlarda sizi
            işaret eden alanların yerine geri döndürülemez bir takma kimlik yazılır; tutarlar ve
            tarihler yerinde kalır.
          </li>
          <li>
            <strong className="font-medium text-metin">Kalır:</strong> rıza kayıtlarınızın denetim
            izi. Hangi rızanın ne zaman verilip geri çekildiğini ispat etmek yine yasal bir
            yükümlülüktür.
          </li>
        </ul>
      </div>

      {hata ? <HataGosterimi error={hata} /> : null}

      <div>
        <Button variant="tehlike" size="sm" onClick={() => setAcik(true)}>
          Hesabımı silmek istiyorum
        </Button>
      </div>

      <Dialog open={acik} onOpenChange={setAcik}>
        <DialogContent>
          <DialogTitle className="text-base font-semibold">
            Hesabınızı silmek üzeresiniz
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm text-metin-soluk">
            Talep <span className="rakam">{PHOTO_RETENTION.accountDeletionGraceDays}</span> gün
            sonra işlenecek ve tüm oturumlarınız hemen kapatılacak. Bu süre içinde giriş yaparsanız
            talep iptal olur.
          </DialogDescription>

          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor="silme-sebebi">Sebep (isteğe bağlı)</Label>
            <select
              id="silme-sebebi"
              value={sebep}
              onChange={(event) => setSebep(event.target.value)}
              className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
            >
              {SEBEPLER.map((secenek) => (
                <option key={secenek.deger} value={secenek.deger}>
                  {secenek.etiket}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 flex gap-3">
            <Button variant="tehlike" disabled={gonderiliyor} onClick={() => void talepEt()}>
              {gonderiliyor ? 'Talep gönderiliyor…' : 'Silme talebini gönder'}
            </Button>
            <Button variant="sessiz" onClick={() => setAcik(false)}>
              Vazgeç
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
