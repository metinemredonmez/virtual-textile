'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ImageOff } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { TBody, THead, TD, TH, TR, Table } from '@/components/ui/table';
import { tarih } from '@/lib/tarih';
import { incelemeEngelleri, kullaniciMesaji, stokDurumu, urunDurumu } from '../_lib/durum';
import { skorRozeti } from '@/components/tryon/tryon-oneriler';
import type { SellerProductSummaryWire } from '@vt/contracts';

/**
 * ÜRÜN TABLOSU — SEÇİM + ÜST ÇUBUKTA EYLEM (Polaris kalıbı).
 *
 * ⚠️ TOPLU UÇ YOK. `apps/api` satıcı denetleyicisinde ürün için toplu bir uç
 *    bulunmuyor (`PATCH /seller/variants/bulk` yalnız VARYANT içindir). Yani
 *    "3 ürünü arşivle" üç ayrı istektir ve KISMİ BAŞARI mümkündür — bu ekranda
 *    gizlenmez: hangi ürünün neden geçmediği tek tek yazılır. Gizlenseydi
 *    satıcı "arşivledim" der, ürün vitrinde kalırdı.
 *
 * ⚠️ İstekler SIRAYLA gidiyor, `Promise.all` ile değil: 50 seçili üründe 50
 *    eşzamanlı istek satıcının kendi hız limitini yer (ve `requireActive`
 *    her istekte bir sorgu açar).
 */
export interface UrunTablosuProps {
  urunler: SellerProductSummaryWire[];
}

type Eylem = 'incelemeye' | 'taslaga' | 'arsivle';

interface EylemBilgisi {
  readonly etiket: string;
  readonly calisan: string;
}

const EYLEMLER: Record<Eylem, EylemBilgisi> = {
  incelemeye: { etiket: 'İncelemeye gönder', calisan: 'Gönderiliyor…' },
  taslaga: { etiket: 'Taslağa al', calisan: 'Alınıyor…' },
  arsivle: { etiket: 'Arşivle', calisan: 'Arşivleniyor…' },
};

interface SatirHatasi {
  baslik: string;
  mesaj: string;
}

export function UrunTablosu({ urunler }: UrunTablosuProps): React.ReactElement {
  const router = useRouter();
  const [secili, setSecili] = React.useState<ReadonlySet<string>>(new Set());
  const [calisan, setCalisan] = React.useState<Eylem | null>(null);
  const [satirHatalari, setSatirHatalari] = React.useState<SatirHatasi[]>([]);
  const [atlanan, setAtlanan] = React.useState<string[]>([]);

  const seciliUrunler = urunler.filter((urun) => secili.has(urun.id));
  const hepsiSecili = urunler.length > 0 && secili.size === urunler.length;

  function degistir(id: string, acik: boolean): void {
    const sonraki = new Set(secili);
    if (acik) sonraki.add(id);
    else sonraki.delete(id);
    setSecili(sonraki);
  }

  function hepsiniDegistir(acik: boolean): void {
    setSecili(acik ? new Set(urunler.map((urun) => urun.id)) : new Set());
  }

  async function calistir(eylem: Eylem): Promise<void> {
    setCalisan(eylem);
    setSatirHatalari([]);
    setAtlanan([]);

    /**
     * ⚠️ İNCELEMEYE GÖNDERMEDEN ÖNCE ELEME. Backend `PENDING_REVIEW` geçişini
     *    koşulsuz kabul ediyor; koşullar ADMIN ONAYINDA işliyor (görsel yoksa
     *    ya da AI etiketleri onaylanmadıysa 400). Elenmezse satıcı ürünü
     *    gönderir, sırada bekler ve günler sonra reddedilir.
     */
    const hedefler =
      eylem === 'incelemeye'
        ? seciliUrunler.filter((urun) => incelemeEngelleri(urun).length === 0)
        : seciliUrunler;

    if (eylem === 'incelemeye') {
      setAtlanan(
        seciliUrunler
          .filter((urun) => incelemeEngelleri(urun).length > 0)
          .map((urun) => `${urun.title} — ${incelemeEngelleri(urun).join(', ')}`),
      );
    }

    const hatalar: SatirHatasi[] = [];

    for (const urun of hedefler) {
      try {
        if (eylem === 'arsivle') {
          await apiFetch<{ archived: true }, `/seller/products/${string}/archive`>(
            `/seller/products/${urun.id}/archive`,
            { method: 'POST' },
          );
        } else {
          await apiFetch<unknown, `/seller/products/${string}`>(`/seller/products/${urun.id}`, {
            method: 'PATCH',
            json: { status: eylem === 'incelemeye' ? 'PENDING_REVIEW' : 'DRAFT' },
          });
        }
      } catch (istekHatasi) {
        /**
         * ⚠️ `error.message` OLDUĞU GİBİ taşınıyor — yeniden yazılmıyor. Satır
         *    başına gösterilmesinin sebebi `hata-kapsami.ts`teki gerekçenin
         *    aynısı: "Mağazanız askıya alındı" cümlesi sayfanın tepesinde
         *    HANGİ ürünün geçmediğini söylemez.
         */
        hatalar.push({ baslik: urun.title, mesaj: kullaniciMesaji(istekHatasi) });
      }
    }

    setSatirHatalari(hatalar);
    setCalisan(null);
    setSecili(new Set());
    // Sunucudan gelen liste tazelensin: durum değişimi sunucuda oldu.
    router.refresh();
  }

  return (
    <div>
      {/*
        ÜST ÇUBUK — yalnız seçim varken. Boşken de duran bir çubuk, tablonun
        üstünde her zaman devre dışı üç düğme demek olurdu.
      */}
      {secili.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-kenar bg-yuzey px-3 py-2">
          <span className="rakam text-sm text-metin-soluk">{secili.size} ürün seçildi</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {(Object.keys(EYLEMLER) as Eylem[]).map((eylem) => (
              <Button
                key={eylem}
                variant="ikincil"
                size="sm"
                disabled={calisan !== null}
                onClick={() => void calistir(eylem)}
              >
                {calisan === eylem ? EYLEMLER[eylem].calisan : EYLEMLER[eylem].etiket}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {atlanan.length > 0 ? (
        <div className="mb-3 rounded-md border border-kenar bg-yuzey p-3 text-sm">
          <p className="text-metin">Şu ürünler gönderilmedi, çünkü moderasyonda reddedilirdi:</p>
          <ul className="mt-1 list-disc pl-5 text-metin-soluk">
            {atlanan.map((satir) => (
              <li key={satir}>{satir}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {satirHatalari.length > 0 ? (
        <div className="mb-3 rounded-md border border-kenar bg-yuzey p-3 text-sm">
          <p className="text-metin">Bazı ürünler güncellenemedi:</p>
          <ul className="mt-1 list-disc pl-5 text-metin-soluk">
            {satirHatalari.map((satir) => (
              <li key={satir.baslik}>
                <span className="text-metin">{satir.baslik}</span> — {satir.mesaj}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Table>
        <THead>
          <TR>
            <TH className="w-8">
              <input
                type="checkbox"
                aria-label="Tümünü seç"
                checked={hepsiSecili}
                onChange={(olay) => hepsiniDegistir(olay.target.checked)}
              />
            </TH>
            <TH>Ürün</TH>
            <TH>Durum</TH>
            <TH>Sanal deneme</TH>
            <TH sayisal>Satılabilir</TH>
            <TH sayisal>En düşük fiyat</TH>
            <TH sayisal>Güncellendi</TH>
          </TR>
        </THead>
        <TBody>
          {urunler.map((urun) => {
            const durum = urunDurumu(urun.status);
            const stok = stokDurumu(urun.availableStock);
            const engeller = incelemeEngelleri(urun);

            return (
              <TR key={urun.id}>
                <TD>
                  <input
                    type="checkbox"
                    aria-label={`${urun.title} seç`}
                    checked={secili.has(urun.id)}
                    onChange={(olay) => degistir(urun.id, olay.target.checked)}
                  />
                </TD>
                <TD className="py-2">
                  <Link href={`/satici/urunler/${urun.id}`} className="font-medium hover:underline">
                    {urun.title}
                  </Link>
                  <p className="text-xs text-metin-soluk">
                    {urun.brandName} · <span className="rakam">{urun.variantCount}</span> varyant
                  </p>
                  {engeller.length > 0 ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-metin-soluk">
                      {/* ⚠️ İkon RENKSİZ: eksik görsel bir durum değil, bir iş. */}
                      <ImageOff className="size-3.5 text-ikon" strokeWidth={1.5} />
                      Yayına hazır değil: {engeller.join(', ')}
                    </p>
                  ) : null}
                </TD>
                <TD>
                  <Badge durum={durum.rozet}>{durum.metin}</Badge>
                </TD>
                <TD>
                  {urun.tryOnScore === null ? (
                    <span className="text-xs text-metin-soluk">Henüz ölçülmedi</span>
                  ) : (
                    <Badge durum={skorRozeti(urun.tryOnScore)}>
                      <span className="rakam">{urun.tryOnScore}</span>/100
                    </Badge>
                  )}
                </TD>
                <TD sayisal>
                  {urun.availableStock}
                  {stok ? (
                    <Badge durum={stok.rozet} className="ml-2">
                      {stok.metin}
                    </Badge>
                  ) : null}
                </TD>
                <TD sayisal>
                  {/* ⚠️ Aktif varyantı olmayan üründe `minPriceMinor` null gelir. */}
                  {urun.minPriceMinor === null ? (
                    <span className="text-metin-soluk">—</span>
                  ) : (
                    <Fiyat value={urun.minPriceMinor} className="justify-end" />
                  )}
                </TD>
                <TD sayisal>{tarih(urun.updatedAt)}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
