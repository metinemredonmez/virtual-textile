import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { listeBaglantisi, type ListeSorgusu, type OkumaSecenekleri } from './liste-sorgusu';

/**
 * SAYFALAMA — İMLEÇLE, SAYFA NUMARASIZ.
 *
 * Sunucu bilinçli olarak imleç kullanıyor (`catalog.service.ts`): derin `OFFSET`
 * yavaştır ve araya yeni ürün girdiğinde kullanıcı aynı ürünü iki kez görür ya
 * da bir ürünü hiç görmez. Sayfa numarası üretmek `OFFSET`i geri getirmek olurdu.
 *
 * ⚠️ "ÖNCEKİ" DÜĞMESİ YOK ve bu bir eksik değil, imleçli sayfalamanın tanımı:
 *    imleç ileri doğru bir anahtardır, geri anahtarı yoktur. Geri gitmenin
 *    doğru aracı tarayıcının geri tuşudur ve her sayfa ayrı bir URL olduğu için
 *    o tuş burada GERÇEKTEN çalışır. Sahte bir "önceki" düğmesi (imleç yığınını
 *    URL'de taşımak) adresi okunmaz yapar ve paylaşılan bağlantıyı bozar.
 *
 * ⚠️ `prefetch={false}`: sonraki sayfa bağlantısı ekranın altındadır ve Next
 *    görünen bağlantıları ön yükler. Liste ucu `scope:'ip'` ve 60/dk limitli;
 *    kaydıran her ziyaretçi için görülmemiş bir sayfayı önden çekmek, kotayı
 *    kimsenin okumadığı yanıtlara harcar.
 */
export interface SayfalamaProps {
  sorgu: ListeSorgusu;
  yol: string;
  nextCursor: string | null;
  /** Bu sayfada kaç ürün var — "hepsi bu" durumunu ayırt etmek için. */
  urunSayisi: number;
  secenekler?: OkumaSecenekleri;
}

export function Sayfalama({
  sorgu,
  yol,
  nextCursor,
  urunSayisi,
  secenekler = {},
}: SayfalamaProps): React.ReactElement | null {
  const ilkSayfada = sorgu.imlec === null;

  if (nextCursor === null && ilkSayfada) return null;

  return (
    <div className="mt-12 flex items-center justify-between border-t border-kenar pt-6">
      {!ilkSayfada ? (
        <Link
          href={listeBaglantisi(yol, sorgu, {}, secenekler)}
          className="text-sm text-metin-soluk hover:text-metin hover:underline"
        >
          İlk sayfaya dön
        </Link>
      ) : (
        <span />
      )}

      {nextCursor !== null && urunSayisi > 0 ? (
        <Link
          href={listeBaglantisi(yol, sorgu, { imlec: nextCursor }, secenekler)}
          prefetch={false}
          className="inline-flex items-center gap-2 text-sm font-medium text-metin hover:underline"
        >
          Sonraki sayfa
          <ArrowRight className="size-4 text-ikon" />
        </Link>
      ) : (
        <span className="text-sm text-metin-soluk">Listenin sonundasınız.</span>
      )}
    </div>
  );
}
