import 'server-only';
import type { CategoryNodeWire } from '@vt/contracts';
// ⚠️ İKİNCİ KOPYA YAZILMADI: kategori ağacını çeken tek yer bu dosya
//    (`src/lib/kategori.ts`) ve önbellek süresiyle
//    birlikte oradaki gerekçesi de geçerli (46 KB, günde birkaç kez değişir).
//    İki ekran kullandığına göre `src/lib/` altına TAŞINMALI (rapor).
import { kategoriAgaci } from '@/lib/kategori';

export interface KategoriSecenegi {
  id: string;
  /** "Kadın › Üst Giyim › Gömlek" — seçicide tek satırda okunabilsin diye. */
  etiket: string;
}

/**
 * Ürün formunun kategori seçicisi için DÜZ liste.
 *
 * ⚠️ AĞACIN TAMAMI DÜZLEŞTİRİLİYOR, yalnız yapraklar değil: `categoryId`
 *    doğrulaması `idSchema`dır, uç ara düğümü de kabul eder. Yaprakla
 *    sınırlamak, bugün alt kategorisi olmayan bir dalı seçilemez yapardı.
 *
 * ⚠️ ÖLÇÜLDÜ (bkz. `kategori/_veri/kategoriler.ts`): kök sayısı 288 ve
 *    287'si E2E koşularından kalan artık ("E2E Üst Giyim"). Yani bu seçici
 *    geliştirme veritabanında yüzlerce satır gösterir. Frontend'den
 *    kapatılamaz — filtrelemek gerçek bir kategoriyi de gizleyebilirdi;
 *    doğru düzeltme E2E artıklarının temizlenmesi (rapor).
 */
export async function kategoriSecenekleri(): Promise<KategoriSecenegi[]> {
  const agac = await kategoriAgaci();
  const secenekler: KategoriSecenegi[] = [];

  const gez = (dugumler: CategoryNodeWire[], yol: string[]): void => {
    for (const dugum of dugumler) {
      const parcalar = [...yol, dugum.name];
      secenekler.push({ id: dugum.id, etiket: parcalar.join(' › ') });
      gez(dugum.children, parcalar);
    }
  };

  gez(agac, []);
  return secenekler;
}
