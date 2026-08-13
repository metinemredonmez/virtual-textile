import Link from 'next/link';

/**
 * BÖLÜM BAŞLIĞI — ana sayfadaki her bölümün üst satırı.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ VARLIK SEBEBİ: ANA SAYFADA HİYERARŞİ YOKTU.
 *
 *  Ölçüldü — bölüm başlıklarının TAMAMI `text-sm font-semibold` idi, yani
 *  gövde metniyle AYNI BOYUTTA. "Nasıl çalışır", "Neler yapabilirsiniz",
 *  "Öne çıkanlar" hepsi 14px; altlarındaki açıklama da 14px. Göz sayfada
 *  nereye bakacağını bilemiyordu ve sayfa tel kafes gibi duruyordu.
 *
 *  ⚠️ BU "SADELİK" DEĞİLDİ, HİYERARŞİSİZLİKTİ — ve ikisi karıştırılmıştı.
 *     `design-system.md` süsü eler: gradyan yok, gölge yok, renkli rozet yok.
 *     Ama TİPOGRAFİK HİYERARŞİ süs değil, okuma sırasının kendisidir. Bir
 *     başlığı gövdeyle aynı boyutta bırakmak sadeleştirmez, sadece hangisinin
 *     başlık olduğunu gizler.
 *
 *  ⚠️ TEK YERDEN: başlık bir bileşen olduğu için ölçek TEK BİR DOSYADA
 *     değişiyor. Daha önce her bölüm kendi `<h2 className="text-sm …">`ünü
 *     yazıyordu; biri değişince diğerleri geride kalırdı ve zaten öyle oldu —
 *     `Ray` `mb-2`, `Ozellikler` `mb-2`, `NasilCalisir` `mb-6` kullanıyordu.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ `text-xl` — `text-3xl` DEĞİL. H1 (afiş başlığı) `text-3xl`; bölüm başlığı
 *    onunla yarışmamalı. Ölçek: 30px (h1) → 20px (h2) → 15px (h3) → 14px (gövde).
 *    Dört basamak, hepsi ayırt edilebilir, hiçbiri bağırmıyor.
 */
export function BolumBasligi({
  baslik,
  aciklama,
  tumuAdres,
  tumuEtiket,
  seviye = 'h2',
}: {
  baslik: string;
  aciklama?: string;
  tumuAdres?: string;
  tumuEtiket?: string;
  /** ⚠️ Bir sayfada tek `h1` olur; afiş onu kullanıyor. Varsayılan `h2`. */
  seviye?: 'h2' | 'h3';
}) {
  const Etiket = seviye;

  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <Etiket className="text-xl font-semibold tracking-tight">{baslik}</Etiket>

        {tumuAdres && tumuEtiket ? (
          /* ⚠️ `shrink-0`: uzun bir başlık bu bağlantıyı ezmemeli — Türkçede
             bölüm adları İngilizceden uzun ve `justify-between` esnek öğeyi
             sıkıştırıyor. */
          <Link
            href={tumuAdres}
            className="shrink-0 text-sm text-metin-soluk transition-colors hover:text-metin"
          >
            {tumuEtiket}
          </Link>
        ) : null}
      </div>

      {aciklama ? <p className="max-w-2xl text-sm text-metin-soluk">{aciklama}</p> : null}
    </div>
  );
}
