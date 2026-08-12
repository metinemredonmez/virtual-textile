/**
 * ⚠️ METİN "SOLDAKİ MENÜDEN AÇILIR" DEMİYOR ARTIK. Diyordu — ve soldaki menü
 *    404 üreten üç bağlantıdan ibaretti; yani sayfa kullanıcıyı çalışmayan
 *    bağlantılara yönlendiriyordu. Boş durum NE OLDUĞUNU söyler
 *    (`design-system.md`): ekranlar yazılmadı, bugün yapılabilecek iş API'dedir.
 */
export default function SaticiPanoPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Satıcı paneli</h1>
      <p className="mt-2 max-w-prose text-sm text-metin-soluk">
        Ürün, sipariş ve finans ekranları henüz yazılmadı; soldaki listede yalnızca panelin
        kapsayacağı bölümler görünüyor. Bu ekranlar açılana kadar satıcı işlemleri API üzerinden
        yürütülür.
      </p>
    </section>
  );
}
