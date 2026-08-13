import type { ReactNode } from 'react';
import { BolumBasligi } from './bolum-basligi';

/**
 * YATAY RAY — sağa doğru kaydırılan içerik şeridi.
 *
 * ⚠️ KAYDIRMA RAYIN KENDİ KABINDA, SAYFADA DEĞİL. `design-system.md` kuralı:
 *    geniş içerik kendi `overflow-x` kabında kayar, sayfa gövdesi ASLA yatay
 *    kaymaz. Kabı `overflow-x-auto` yapmayı unutmak, mobilde tüm sayfayı
 *    sağa sola oynatır ve bu bir kez olduğunda kullanıcı sayfayı bozuk sayar.
 *
 * ⚠️ `snap-x` + `snap-start`: parmakla kaydırınca kart YARIM KALMAZ. Yarım
 *    kart, kaydırılabildiğini gösteren en iyi işarettir ama duruş noktası
 *    olarak kötüdür — kullanıcı okuyamadığı bir kartla baş başa kalır.
 *    Çözüm: durak noktası kart başında, ama son kart sonrası boşluk
 *    (`scroll-pl`) bırakılarak son kartın da tam görünmesi sağlanır.
 *
 * ⚠️ KAYDIRMA ÇUBUĞU GİZLENMEZ. Gizlemek "burada daha var" sinyalini yok
 *    eder ve masaüstünde fare tekerleği yatay kaydırmaz — kullanıcı içeriğin
 *    devamını hiç görmez. `design-system.md` süsü eler, İŞLEVİ elemez.
 *
 * ⚠️ Ray bir Sunucu Bileşenidir: ok düğmeleri, otomatik geçiş, nokta
 *    göstergesi YOK. Hepsi JavaScript ister ve tarayıcının yerel kaydırması
 *    zaten dokunmatikte, izleme yüzeyinde ve klavyede çalışıyor. Karusel
 *    kütüphanesi eklemek ~15 KB karşılığında hiçbir yeni yetenek getirmezdi.
 */
export function Ray({
  baslik,
  aciklama,
  tumuAdres,
  tumuEtiket = 'Tümü',
  children,
}: {
  baslik: string;
  aciklama?: string;
  tumuAdres?: string;
  tumuEtiket?: string;
  children: ReactNode;
}) {
  return (
    <section>
      {/* ⚠️ Başlık ARTIK PAYLAŞILAN BİLEŞEN. Her bölüm kendi `<h2>`sini
          yazdığı sürece ölçek ayrışıyordu — ölçüldü: `Ray` `mb-2`,
          `Ozellikler` `mb-2`, `NasilCalisir` `mb-6` kullanıyordu ve üçü de
          gövde metniyle aynı `text-sm` idi. */}
      <BolumBasligi
        baslik={baslik}
        {...(aciklama ? { aciklama } : {})}
        {...(tumuAdres ? { tumuAdres, tumuEtiket } : {})}
      />

      {/* ⚠️ `-mx-4 px-4`: ray kabın kenarına DEĞER, yani kaydırınca kartlar
          ekranın kenarından girip çıkar. Kenar boşluğu içeride bırakılsaydı
          son kart görünür bir çizgide biter ve şerit "bitmiş" görünürdü. */}
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 scroll-pl-4"
        // Klavyeyle kaydırılabilmesi için odaklanabilir olmalı; ekran okuyucu
        // için de bir bölge adı gerekiyor.
        tabIndex={0}
        role="group"
        aria-label={baslik}
      >
        {children}
      </div>
    </section>
  );
}

/** Ray içindeki tek kart. Genişlik SABİT: esnek kart, kaydırma durağını bozar. */
export function RayKarti({
  genislik = 'w-[15rem] sm:w-[17rem]',
  children,
}: {
  genislik?: string;
  children: ReactNode;
}) {
  return <div className={`${genislik} shrink-0 snap-start`}>{children}</div>;
}
