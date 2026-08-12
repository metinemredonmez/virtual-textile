import { Sekmeler } from '@/components/panel/duzen';

/**
 * RAPOR SEKMELERİ.
 *
 * ⚠️ GMV ve AI maliyeti AYRI EKRAN, tek ekranda iki blok değil. İkisinin de
 *    kendi tarih aralığı, kendi kırılımı ve kendi özet rakamları var; tek
 *    ekrana sıkıştırmak `design-system.md`in "Bütçe aşılıyorsa yeni bir ekran
 *    gerekiyordur, sıkıştırma değil" kuralına doğrudan aykırı olurdu. Üstelik
 *    ikisinin BİRİMİ farklı: biri kuruş/₺, diğeri mikro-USD. Yan yana duran iki
 *    para birimi, tek bir yanlış okumada bütçe kararını bozar.
 *
 * ⚠️ ÇİZİMİ `<Sekmeler>` YAPIYOR. Bu dosya bir dönem kendi sekme görünümünü
 *    (alt çizgili) yazıyordu; panelde ÜÇ farklı sekme görünümü vardı ve aynı
 *    kabuk içinde ekran değiştiren yönetici her seferinde başka bir uygulama
 *    kullandığını sanıyordu. Görünüm kararı tek yerde: seçili sekme yalnızca
 *    hafif arka planla ayrılır, RENK TAŞIMAZ — "hangi sayfadayım" bir durum
 *    değil.
 */
export function RaporSekmeleri({ aktif }: { aktif: 'gmv' | 'ai' }): React.ReactElement {
  return (
    <Sekmeler
      etiket="Rapor sekmeleri"
      sekmeler={[
        { etiket: 'GMV', yol: '/yonetim/raporlar', secili: aktif === 'gmv' },
        { etiket: 'AI maliyeti', yol: '/yonetim/raporlar/ai', secili: aktif === 'ai' },
      ]}
    />
  );
}
