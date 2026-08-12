import { Skeleton } from '@/components/ui/skeleton';

/**
 * ⚠️ İskelet GERÇEK DÜZENİN ölçülerini taklit eder: solda 56 birimlik menü
 *    sütunu, sağda başlık + kart yığını. Rastgele kutular yerleşim kaymasına
 *    yol açar ve kullanıcı sayfayı iki kez okur.
 *
 * ⚠️ Menü sütunu iskelette de var: yükleme bitince menünün "yandan gelmesi"
 *    hesap bölgesinin tamamını sıçratırdı.
 */
export default function HesapLoading() {
  return (
    <div className="flex flex-col gap-8 md:flex-row md:gap-12">
      <div className="w-full shrink-0 md:w-56">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-40" />
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <Skeleton className="h-7 w-48" />
        <div className="mt-8 flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
