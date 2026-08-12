import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { AppliedFilterWire, GenderWire, InterpretationOutcomeWire } from '@vt/contracts';
import { Fiyat } from '@/components/fiyat/fiyat';

/**
 * DOĞAL DİL ARAMASININ ŞERİDİ — "seni şöyle anladım".
 *
 * ⚠️ HİÇBİR `outcome` HATA DEĞİLDİR. Kota dolduğunda, sağlayıcı düştüğünde ya
 *    da cümle zaten kısa olduğunda sunucu anahtar kelime aramasına düşüyor ve
 *    SONUÇ DÖNDÜRÜYOR. Buraya kırmızı bir hata kutusu koymak, çalışan bir
 *    aramayı bozuk göstermek olurdu. Bu yüzden bilgi tek satır ve akromatik.
 *
 * ⚠️ `occasion`/`season` FİLTRELENMEDİ, yalnızca anlaşıldı. Kullanıcıya
 *    "iş görüşmesi" yazıp sonuçları buna göre daraltmış gibi görünmek, sunucunun
 *    yapmadığı bir işi vaat etmek olurdu; bu yüzden ayrı ve "dikkate alınmadı"
 *    diye yazılıyor.
 */
export interface YorumSeridiProps {
  cumle: string;
  outcome: InterpretationOutcomeWire;
  filtre: AppliedFilterWire | null;
  /** Yorumun düz filtreye çevrilmiş hâli — sonraki her gezinme buradan devam eder. */
  filtreHref: string;
}

const CINSIYET_ETIKETLERI: Record<GenderWire, string> = {
  WOMAN: 'Kadın',
  MAN: 'Erkek',
  UNISEX: 'Unisex',
  KIDS: 'Çocuk',
};

export function YorumSeridi({
  cumle,
  outcome,
  filtre,
  filtreHref,
}: YorumSeridiProps): React.ReactElement {
  const yorumlandi = outcome === 'INTERPRETED' && filtre !== null;

  return (
    <div className="rounded-md border border-kenar bg-yuzey p-4">
      <p className="flex items-start gap-2 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-ikon" aria-hidden />
        <span className="text-metin-soluk">
          <span className="text-metin">“{cumle}”</span> için sonuçlar
        </span>
      </p>

      {yorumlandi ? (
        <>
          <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            {filtre.keywords.length > 0 ? (
              <Satir baslik="Aranan">{filtre.keywords.join(', ')}</Satir>
            ) : null}
            {filtre.category ? <Satir baslik="Kategori">{filtre.category}</Satir> : null}
            {filtre.colors.length > 0 ? (
              <Satir baslik="Renk">{filtre.colors.join(', ')}</Satir>
            ) : null}
            {filtre.gender ? (
              <Satir baslik="Kime">{CINSIYET_ETIKETLERI[filtre.gender]}</Satir>
            ) : null}
            {filtre.maxPriceMinor ? (
              <Satir baslik="Bütçe">
                {/* Telden gelen bir para alanı — tek yol `<Fiyat>`. */}
                <Fiyat value={filtre.maxPriceMinor} className="text-sm" /> ve altı
              </Satir>
            ) : null}
          </dl>

          {filtre.occasion || filtre.season ? (
            <p className="mt-2 text-xs text-metin-soluk">
              “{[filtre.occasion, filtre.season].filter(Boolean).join(', ')}” anlaşıldı ama
              katalogda karşılığı olmadığı için sonuçlara uygulanmadı.
            </p>
          ) : null}

          {/*
            ⚠️ Bu bağlantı sadece bir kolaylık değil, MALİYET KAPISI: buradan
               sonraki her filtre/sıralama/sayfa adımı düz `GET /v1/products`
               üzerinden gider ve cümle bir daha yorumlanmaz.
          */}
          <Link href={filtreHref} className="mt-3 inline-block text-sm text-vurgu hover:underline">
            Filtre olarak düzenle
          </Link>
        </>
      ) : (
        <p className="mt-2 text-sm text-metin-soluk">Cümle çözümlenmedi; kelimelerle arandı.</p>
      )}
    </div>
  );
}

function Satir({
  baslik,
  children,
}: {
  baslik: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-metin-soluk">{baslik}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
