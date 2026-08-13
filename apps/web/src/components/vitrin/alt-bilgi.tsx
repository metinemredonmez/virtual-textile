import Link from 'next/link';
import { TemaSecici } from '@/components/tema/tema-secici';
import { KOLEKSIYON_LISTESI } from '../../../app/(magaza)/collection/koleksiyonlar';

/**
 * ALT BİLGİ — sütunlu, sitenin haritası.
 *
 * ⚠️ Bir dönem tek satırdı: "Virtual Textile" + tema anahtarı. Sonuç, ana
 *    sayfadakiyle aynı arızaydı — yazılmış ekranların çoğuna site içinden
 *    ulaşılamıyordu. Alt bilgi bir süs değil, sitenin İKİNCİ gezinmesidir:
 *    üst çubuk 375px'te beş hedefle zaten doluydu ve altıncısı taşırıyordu
 *    (bkz. layout.tsx'teki tema anahtarı gerekçesi), geri kalan her şeyin
 *    gideceği yer burası.
 *
 * ⚠️ HER BAĞLANTI VAR OLAN BİR SAYFAYA GİDER. Referans aldığımız sitelerin
 *    alt bilgisinde "Kariyer", "Basında biz", "Sürdürülebilirlik" gibi
 *    başlıklar var; bizde o sayfalar YOK ve 404'e giden bir bağlantı,
 *    olmayan bir bağlantıdan kötüdür. Sayfa yazıldığında satır eklenir.
 *
 * ⚠️ "Satıcı ol" BİLEREK YOK: `POST /seller/apply` ucu var ama BAŞVURU EKRANI
 *    YAZILMADI (ölçüldü — pazaryerinin arz tarafı girişi kapalı). Ekran
 *    gelince buraya eklenecek; şimdiden koymak kullanıcıyı boş bir yola sokardı.
 */

interface Sutun {
  readonly baslik: string;
  readonly bagliantilar: ReadonlyArray<{ readonly etiket: string; readonly adres: string }>;
}

export function AltBilgi() {
  const sutunlar: readonly Sutun[] = [
    {
      baslik: 'Alışveriş',
      bagliantilar: [
        { etiket: 'Tüm ürünler', adres: '/products' },
        { etiket: 'Kategoriler', adres: '/category' },
        { etiket: 'Koleksiyonlar', adres: '/collection' },
        { etiket: 'Sepetim', adres: '/cart' },
      ],
    },
    {
      baslik: 'Sanal deneme',
      bagliantilar: [
        // Koleksiyonlar sanal denemenin en somut vitrini; ilk ikisi buraya.
        ...KOLEKSIYON_LISTESI.slice(0, 2).map((k) => ({
          etiket: k.h1,
          adres: `/collection/${k.slug}`,
        })),
        { etiket: 'Stil danışmanı', adres: '/stylist' },
        { etiket: 'Satıcılar için hesaplayıcı', adres: '/calculator' },
      ],
    },
    {
      baslik: 'Hesabım',
      bagliantilar: [
        { etiket: 'Giriş yap', adres: '/login' },
        { etiket: 'Hesap oluştur', adres: '/register' },
        { etiket: 'Siparişlerim', adres: '/account/orders' },
        { etiket: 'Gardırobum', adres: '/account/wardrobe' },
      ],
    },
    {
      baslik: 'Gizlilik ve haklar',
      bagliantilar: [
        // ⚠️ Bu iki adres REWRITE ile kısa tutuluyor (`/legal/...` değil) çünkü
        //    kayıt formunda ve yarın e-postalarda sabit yazılı olacaklar.
        { etiket: 'Kullanım koşulları', adres: '/kullanim-kosullari' },
        { etiket: 'Aydınlatma metni', adres: '/aydinlatma-metni' },
        { etiket: 'Verilerim ve rızalarım', adres: '/account/privacy' },
        { etiket: 'Oturum güvenliği', adres: '/account/security' },
      ],
    },
  ];

  return (
    <footer className="mt-20 border-t border-kenar">
      <div className="mx-auto w-full max-w-7xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          {/* Marka bloğu — tek cümlelik ne yaptığımız. */}
          <div className="flex flex-col gap-3 lg:col-span-1">
            <span className="text-sm font-semibold tracking-tight">Virtual Textile</span>
            <p className="text-sm leading-relaxed text-metin-soluk">
              Farklı mağazaların parçalarını kendi fotoğrafınızda deneyin, tek sepette satın alın.
            </p>
          </div>

          {sutunlar.map((sutun) => (
            <nav key={sutun.baslik} aria-label={sutun.baslik} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold tracking-tight">{sutun.baslik}</h2>
              <ul className="flex flex-col gap-2">
                {sutun.bagliantilar.map((bag) => (
                  <li key={bag.adres}>
                    <Link
                      href={bag.adres}
                      className="text-sm text-metin-soluk transition-colors hover:text-metin"
                    >
                      {bag.etiket}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/*
          ⚠️ TEMA ANAHTARI ALT BİLGİDE, GEZİNME ÇUBUĞUNDA DEĞİL. Çubuk 375px'te
             zaten ölçülmüş bir taşma sorunu yaşadı (etiketler `hidden sm:inline`
             tam bu yüzden); altıncı bir hedef aynı arızayı geri getirirdi. Tema
             bir gezinme hedefi de değil — tek seferlik bir tercihtir.
        */}
        <div className="mt-10 flex flex-col gap-4 border-t border-kenar pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-metin-soluk">
            Sanal deneme görselleri yapay zekâ ile üretilir; ürünün gerçek kalıbı farklılık
            gösterebilir.
          </p>
          <TemaSecici />
        </div>
      </div>
    </footer>
  );
}
