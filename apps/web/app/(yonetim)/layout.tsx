import type { ReactNode } from 'react';
import { requireRole } from '@/lib/session/guard';
import { YanMenuKabugu } from '@/components/panel/yan-menu';
import { YONETIM_MENUSU } from './yonetim/_kabuk/yan-menu';

/**
 * YÖNETİM PANELİ — KOYU TEMA, TAMAMI korumalı.
 *
 * ⚠️ Koyu tema `.tema-koyu` sınıfıyla YALNIZCA burada açılır, `<html>` üzerinde
 *    değil. Kök düzeyde açılsaydı vitrin de koyulaşır ve beyaz fonlu ürün
 *    fotoğraflarının kesim çizgileri kaybolurdu.
 *
 * ⚠️ Rol Redis'ten değil, her istekte `GET /auth/me`den okunur: yetkisi iptal
 *    edilen bir yönetici 30 gün boyunca paneli görmeye devam ederdi.
 *
 * ⚠️ KAPI SADECE `ADMIN` — ve bu, API ile UYUŞMUYOR. `SUPPORT` rolü API'de
 *    `admin/sellers` (liste+detay), `admin/products/moderation`,
 *    `admin/categories`, `admin/orders`, `admin/payouts` (liste) ve
 *    `admin/fraud/alerts` uçlarını görebiliyor; komisyon, payout kararı,
 *    denetim izi ve break-glass ona kapalı. Yani destek ekibinin okuyabileceği
 *    ekranlar var ama panele hiç giremiyor. Rolü buraya eklemek TEK BAŞINA
 *    yetmez: menünün ve karar düğmelerinin de role göre kısılması gerekir,
 *    yoksa SUPPORT için "basınca 403 veren düğmeler" doğar — kaldırılan yedi
 *    404 düğmesinin yetki hâli. Kart açıldı, bu turda BİLEREK yapılmadı.
 *
 * ⚠️ Menü ÇİZİMİ `components/panel/yan-menu.tsx`te ve satıcı paneliyle AYNI
 *    bileşendir; burada yalnızca içerik listesi (`YONETIM_MENUSU`) veriliyor.
 *    Liste rota tablosuyla ELLE senkron tutuluyor; yeni bir `yonetim/<ad>`
 *    ekleyen kişi `yonetim/_kabuk/yan-menu.tsx` içine de bir satır eklemek
 *    zorunda. Gerekçe (iki yönlü kural) o dosyanın başlığında.
 */
export default async function YonetimLayout({ children }: { children: ReactNode }) {
  await requireRole(['ADMIN']);

  return (
    /*
      ⚠️ MOBİLDE SÜTUN, md'DEN İTİBAREN SATIR. Kabuk tek bir duyarlı ön-ek
         taşımıyordu ve bedeli ÖLÇÜLDÜ: 375px'te `aside` 224px + `main` `p-8`
         (2×32px) içerik alanını 87px'e indiriyor, `denetim` ekranındaki sabit
         `w-72` alan `document.scrollWidth`i 545'e çıkarıyordu — yani SAYFANIN
         TAMAMI yatay kayıyordu (taşma 170px). Menünün mobil hâli ve Portal
         tuzağının neden buraya girmediği `panel/yan-menu.tsx` başlığında.
    */
    <div className="tema-koyu flex min-h-dvh flex-col bg-zemin text-metin md:flex-row">
      <YanMenuKabugu baslik="Yönetim" gruplar={YONETIM_MENUSU} etiket="Yönetim bölümleri" />

      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
