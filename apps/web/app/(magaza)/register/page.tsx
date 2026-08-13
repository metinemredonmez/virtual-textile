import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session/guard';
import { guvenliDonusYolu } from '@/lib/donus-yolu';
import { KayitFormu } from './kayit-formu';

export const metadata: Metadata = { title: 'Kayıt ol' };

export const dynamic = 'force-dynamic';

export default async function KayitPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const kullanici = await currentUser();
  if (kullanici) redirect(guvenliDonusYolu(next));

  return (
    <section className="mx-auto max-w-md py-16">
      <h1 className="text-xl font-semibold tracking-tight">Hesap oluştur</h1>
      <p className="mt-2 text-sm text-metin-soluk">
        Hesabınız olduğunda sanal deneme sonuçlarınız, gardırobunuz ve siparişleriniz tek yerde
        durur.
      </p>

      <KayitFormu next={next ?? null} />
    </section>
  );
}
