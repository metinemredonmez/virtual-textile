import type { CategoryNodeWire } from '@vt/contracts';
import { serverFetch } from '@/lib/api/server';

/**
 * KATEGORİ AĞACI — vitrin, kategori ekranları VE satıcı ürün formunun ortak
 * kaynağı.
 *
 * ⚠️ Dosya bir dönem `(magaza)/kategori/_veri/` altındaydı ve satıcı paneli ona
 *    rota grubunun DIŞINDAN göreli yolla ulaşıyordu. Buraya taşındı; ikinci bir
 *    çekim yazılsaydı 46 KB'lık ağaç iki ayrı önbellek penceresiyle iki kez
 *    çekilir ve iki ekran farklı bir taksonomi gösterebilirdi.
 *
 * ⚠️ `forwardClientIp` YOK ve olmamalı: `GET /v1/categories` ucunda hız limiti
 *    tanımlı değil (`catalog.controller.ts`), üstelik IP okumak `headers()`
 *    demektir ve bu isteği önbelleklenemez yapardı. `/products` için gereken
 *    şey burada zararlı.
 *
 * ⚠️ Yanıt ÖLÇÜLDÜ: 46 KB, 288 kök düğüm. Ağaç saniyede değil günde birkaç kez
 *    değişiyor; her sayfa görüntülemesinde yeniden çekmek 46 KB'ı boşuna taşır.
 */
const TAZELEME_SANIYE = 600;

export async function kategoriAgaci(): Promise<CategoryNodeWire[]> {
  const sonuc = await serverFetch<CategoryNodeWire[], '/categories'>('/categories', {
    next: { revalidate: TAZELEME_SANIYE },
  });
  return sonuc.data;
}

/** Ağacı derinlemesine tarar — kategori yalnızca kökte değil, altta da olabilir. */
export function kategoriBul(agac: CategoryNodeWire[], slug: string): CategoryNodeWire | null {
  for (const dugum of agac) {
    if (dugum.slug === slug) return dugum;
    const alt = kategoriBul(dugum.children, slug);
    if (alt) return alt;
  }
  return null;
}

/**
 * VİTRİNDE GÖSTERİLECEK KATEGORİLER.
 *
 * ⚠️ LİSTE SINIRSIZ ÇİZİLEMEZ. Geliştirme veritabanında ölçülen kök sayısı
 *    288 ve bunların 287'si E2E koşularından kalan artık ("E2E Üst Giyim").
 *    Artığın kendisi bu dosyanın sorunu değil, ama sınırsız çizen bir şerit
 *    ana sayfanın öğe bütçesini (3 bölüm) tek başına yiyor ve gerçek kategoriyi
 *    gürültünün içine gömüyor. Bütçe aşılıyorsa yeni bir ekran gerekir,
 *    sıkıştırma değil — o ekran `/category`.
 *
 * ⚠️ Sıralama ölçütü ALT KATEGORİSİ OLANLAR ÖNCE: alt dalı olan bir düğüm
 *    gerçek bir taksonomi başlığıdır, yaprak bir kök çoğunlukla tek ürünlük
 *    bir kayıttır. API zaten `sortOrder`a göre sıralı geliyor; bu yalnızca
 *    kararlı bir öncelik ekliyor.
 */
export function vitrinKategorileri(agac: CategoryNodeWire[], azami: number): CategoryNodeWire[] {
  return [...agac]
    .sort((a, b) => (b.children.length > 0 ? 1 : 0) - (a.children.length > 0 ? 1 : 0))
    .slice(0, azami);
}
