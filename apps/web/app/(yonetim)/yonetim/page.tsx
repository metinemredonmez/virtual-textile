export default function YonetimPanoPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Yönetim panosu</h1>
      {/* ⚠️ Pano bütçesi 5–9 öğe. Fazlası yeni bir ekran gerektirir. */}
      <p className="mt-2 max-w-prose text-sm text-metin-soluk">
        Panodaki özet kartları ve soldaki listede görünen bölümler henüz yazılmadı. Yönetim
        işlemleri bugün API üzerinden yürütülür.
      </p>
    </section>
  );
}
