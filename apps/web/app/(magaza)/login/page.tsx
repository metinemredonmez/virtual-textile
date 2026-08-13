import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session/guard';
import { GirisFormu } from './giris-formu';
import { guvenliDonusYolu } from '@/lib/donus-yolu';

export const metadata: Metadata = { title: 'Giriş' };

/**
 * ⚠️ `force-dynamic`: sayfa `cookies()` okuyan `currentUser()`ı çağırıyor ve
 *    zaten dinamik. Açıkça yazmak, bir gün "neden statik değil" diye arayan
 *    kişinin saatini kurtarır.
 */
export const dynamic = 'force-dynamic';

/**
 * OTURUMUN NEDEN KAPANDIĞI.
 *
 * ⚠️ Metinler burada yazılıyor çünkü bunlar bir API HATASI DEĞİL: kullanıcı
 *    başarılı bir işlemin (şifre değiştirme, hesap silme talebi) sonucunda
 *    buraya geliyor. `ERROR_CATALOG`ta karşılıkları yok; olsaydı hata gibi
 *    görünürlerdi.
 *
 * ⚠️ Tek istisna `guvenlik`: metin `AUTH_REFRESH_REUSED` katalog mesajının
 *    AYNISI. Vekil (`proxy.ts` → `oturumDusuruldu`) aynı cümleyi zarfla da
 *    döndürüyor; iki farklı cümle olsaydı aynı olay iki ekranda iki şekilde
 *    anlatılırdı.
 */
const SEBEP_METNI: Record<string, string> = {
  guvenlik: 'Güvenlik nedeniyle tüm oturumlarınız kapatıldı. Lütfen tekrar giriş yapın.',
  'sifre-degisti':
    'Şifreniz değiştirildi ve tüm cihazlardaki oturumlarınız kapatıldı. Yeni şifrenizle giriş yapın.',
  'hesap-silme':
    'Hesap silme talebiniz alındı ve oturumlarınız kapatıldı. 30 gün içinde giriş yaparsanız talep otomatik olarak iptal edilir.',
};

export default async function GirisPage({
  searchParams,
}: {
  searchParams: Promise<{ sebep?: string; next?: string }>;
}) {
  const { sebep, next } = await searchParams;
  const hedef = guvenliDonusYolu(next);

  /**
   * ⚠️ Giriş yapmış kullanıcı burada bırakılmaz. Bırakılsaydı, hesap silme
   *    talebinden vazgeçmek için giriş yapan kullanıcı (bkz. `me.service.ts` →
   *    `cancelAccountDeletion`) formu ikinci kez doldurur ve `login` hız
   *    limitini (5/15dk) kendi kendine yerdi.
   */
  const kullanici = await currentUser();
  if (kullanici) redirect(hedef);

  const uyari = sebep ? SEBEP_METNI[sebep] : undefined;

  return (
    <section className="mx-auto max-w-sm py-16">
      <h1 className="text-xl font-semibold tracking-tight">Giriş yap</h1>

      {uyari ? (
        // Renk DURUM taşıyor: oturum beklenmedik şekilde kapandı.
        <p className="mt-3 rounded-md bg-uyari-zemin p-3 text-sm text-uyari">{uyari}</p>
      ) : null}

      <GirisFormu next={next ?? null} />
    </section>
  );
}
