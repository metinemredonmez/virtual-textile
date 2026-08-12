import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { oneriler, skorRozeti, sorunlariCoz, TRYON_ESIK } from '@/components/tryon/tryon-oneriler';

/**
 * SANAL DENEME UYGUNLUK SKORU — SAYI TEK BAŞINA GÖSTERİLMEZ.
 *
 * `design-system.md`: "Skor 42/100 — arka planı sade bir görsel ekleyin, sanal
 * deneme kalitesi belirgin biçimde artar. Sayı tek başına eyleme dönüşmez; ne
 * yapılacağı yazılır."
 *
 * ⚠️ RENK YALNIZCA EŞİKTE: 60 altı uyarı, üstü olumlu, `null` RENKSİZ. Skoru
 *    yüzdelik bir çubukla renklendirmek (yeşilden kırmızıya geçen bir gradyan)
 *    denenmedi bile: o gösterim 58 ile 62 arasında görsel bir fark yaratmazken
 *    ekranın en renkli öğesi olurdu ve ürün fotoğrafıyla yarışırdı.
 *
 * ⚠️ `null` skor "0 puan" DEĞİLDİR: hiç görsel yüklenmemiş, skor hiç
 *    hesaplanmamıştır. "0/100" yazmak satıcıya ölçülmemiş bir başarısızlık
 *    bildirmek olurdu.
 */
export interface TryOnUygunlukProps {
  skor: number | null;
  /** `tryOnIssues` — telde `unknown`, dizi olmayabilir. */
  sorunlar: unknown;
  gorsellerHref: string;
}

export function TryOnUygunluk({
  skor,
  sorunlar,
  gorsellerHref,
}: TryOnUygunlukProps): React.ReactElement {
  const kodlar = sorunlariCoz(sorunlar);
  const liste = oneriler(kodlar);

  return (
    <div className="rounded-lg border border-kenar p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold">Sanal deneme uygunluğu</h2>
        {skor === null ? (
          <Badge>Henüz ölçülmedi</Badge>
        ) : (
          <Badge durum={skorRozeti(skor)}>
            <span className="rakam">{skor}</span>/100
          </Badge>
        )}
      </div>

      <p className="mt-2 max-w-prose text-sm text-metin-soluk">
        {skor === null
          ? 'Bu ürüne henüz görsel yüklenmedi, bu yüzden skor hesaplanmadı. Sanal denemenin kalitesini en çok belirleyen şey ürün fotoğrafıdır.'
          : skor < TRYON_ESIK
            ? 'Skor eşiğin altında. Aşağıdaki düzeltmeler sanal deneme kalitesini belirgin biçimde artırır.'
            : 'Skor yeterli. Görselleri değiştirdiğinizde skor yeniden hesaplanır.'}
      </p>

      {liste.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {liste.map((oneri) => (
            <li key={oneri.kod} className="flex gap-2 text-sm">
              {/* ⚠️ Kazanç puanı `rakam` sınıfı taşır: alt alta hizalanır. */}
              <span className="rakam shrink-0 text-metin-soluk">+{oneri.kazanc}</span>
              <span className="text-metin">{oneri.eylem}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Button asChild variant="ikincil" size="sm" className="mt-4">
        <Link href={gorsellerHref}>Görselleri düzenle</Link>
      </Button>
    </div>
  );
}
