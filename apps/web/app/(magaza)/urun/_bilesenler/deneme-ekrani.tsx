'use client';

import * as React from 'react';
import { isApiFailure } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Fiyat } from '@/components/fiyat/fiyat';
import { DenemeGorseli } from './deneme-gorseli';
import { GuvenSkorlari } from './guven-skorlari';
import { ParcaKaruseli } from './parca-karuseli';
import { SepeteEkle } from './sepete-ekle';
import { FotografAdimi } from './fotograf-adimi';
import { FotografIslemeRizasi, YurtDisiAktarimRizasi } from './riza-modallari';
import { useDeneme } from './use-deneme';
import { useBedenOnerisi } from './use-beden-onerisi';
import type { Parca } from './parca';

/**
 * ════════════════════════ SANAL DENEME EKRANI ═══════════════════════════════
 *
 * Düzen (design-system.md → Sanal deneme ekranı):
 *     üst   : ürün adı + mağaza rozeti
 *     orta  : TRY-ON GÖRSELİ — ekranın çoğu, kenarlıksız
 *     alt   : [Üzerimde Dene] [Sepete Ekle] — EŞİT ağırlık
 *     en alt: ürün karuseli — parça değiştir
 *
 * ⚠️ KARUSEL PARÇA DEĞİŞTİRDİĞİNDE BU BİLEŞEN YENİDEN KURULMAZ. Seçim istemci
 *    durumudur; ne URL değişir ne de sunucudan veri çekilir. Değişen tek şey
 *    `DenemeGorseli`nin proplarıdır. Bu, sunucudaki önek önbelleğinin arayüz
 *    karşılığıdır: ilk n-1 katman yeniden üretilmiyorsa ekran da baştan
 *    kurulmamalı, yoksa kazanç kullanıcıya hiç görünmez.
 */

export interface DenemeEkraniProps {
  taban: Parca;
  adaylar: readonly Parca[];
  magazaAdi: string;
}

export function DenemeEkrani({ taban, adaylar, magazaAdi }: DenemeEkraniProps): React.ReactElement {
  const [seciliAdayId, setSeciliAdayId] = React.useState<string | null>(null);

  const secilenAday = React.useMemo(
    () => adaylar.find((aday) => aday.variantId === seciliAdayId) ?? null,
    [adaylar, seciliAdayId],
  );

  // ⚠️ Referans kararlılığı: `DenemeGorseli` memo'lu ve her render'da yeni bir
  //    dizi üretmek o memo'yu işlevsiz bırakırdı.
  const parcalar = React.useMemo(
    () => (secilenAday ? [taban, secilenAday] : [taban]),
    [taban, secilenAday],
  );

  const deneme = useDeneme(parcalar);
  const beden = useBedenOnerisi(taban.variantId, true);

  const sonuc = deneme.asama.tur === 'sonuc' ? deneme.asama.sonuc : null;

  /**
   * ⚠️ Çakışan parça İŞARETLENİR (frontend-mimari.md §6). Hangi parçanın
   *    çakıştığını istemci HESAPLAMAZ; sunucu `OUTFIT_*` kodu döndürdüğünde
   *    kullanıcının en son eklediği parça işaretlenir — kombine yeni giren
   *    tek parça odur.
   */
  const cakisanVaryantId =
    deneme.asama.tur === 'hata' &&
    isApiFailure(deneme.asama.hata) &&
    deneme.asama.hata.code.startsWith('OUTFIT_')
      ? seciliAdayId
      : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* ── ÜST: ürün adı + mağaza rozeti ─────────────────────────────── */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{taban.baslik}</h1>
          <p className="mt-1 text-sm text-metin-soluk">
            {taban.renk} · {taban.beden}
          </p>
        </div>

        {/*
          ⚠️ Mağaza rozeti RENKSİZ: satıcı adı bir durum değil, bir bilgidir.
          ⚠️ BAĞLANTI YOK: `/magaza/[slug]` ekranı henüz yazılmadı ve olmayan
             bir sayfaya götüren bağlantı, basınca hata veren düğmenin aynısıdır.
             O ekran yazıldığında slug ürün detayından tek prop olarak geçirilir.
        */}
        <Badge durum="notr">{magazaAdi}</Badge>
      </header>

      {/* ── ORTA: try-on görseli (ekranın çoğu) ───────────────────────── */}
      <DenemeGorseli
        asama={deneme.asama}
        ilerleme={deneme.ilerleme}
        tahminSaniye={deneme.tahminSaniye}
        zamanAsimi={deneme.zamanAsimi}
        parcalar={parcalar}
        onTekrarDene={deneme.tekrarDene}
        onYeniFotograf={deneme.yeniFotograf}
        onDurumuKontrolEt={deneme.durumuKontrolEt}
      />

      <GuvenSkorlari
        gorselGuveni={sonuc?.gorselGuveni ?? null}
        bedenGuveni={beden.oneri?.confidence ?? null}
        bedenGosterilsin={beden.oneri?.showRecommendation ?? false}
      />

      {/* ── ALT: EŞİT AĞIRLIKTA İKİ DÜĞME ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/*
          ⚠️ DEĞİŞMEZ KURAL: ikisi de `birincil`, ikisi de `lg`, ikisi de tam
             genişlik. "Üzerimde Dene"yi ikincil çizmek platformun tek
             ayrıştırıcısını ikincil bir özelliğe indirir.
        */}
        <Button
          variant="birincil"
          size="lg"
          className="w-full"
          onClick={deneme.dene}
          disabled={deneme.asama.tur === 'gonderiliyor' || deneme.asama.tur === 'uretiliyor'}
        >
          Üzerimde Dene
        </Button>

        <SepeteEkle variantIdler={parcalar.map((parca) => parca.variantId)} />
      </div>

      {/*
        ⚠️ TOPLAM BURADA HESAPLANMAZ — parça fiyatları AYRI AYRI listelenir.
           Sepet toplamını `cart-totals.ts` `Money.allocate()` ile kuruş kaybı
           olmadan üretiyor; burada ikinci kez toplamak farklı bir yuvarlamayla
           1 kuruş sapma üretir ve mutabakatı bozar. Toplam sepette görünür.
      */}
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-metin-soluk">
        {parcalar.map((parca) => (
          <li key={parca.variantId} className="flex items-baseline gap-2">
            <span>{parca.baslik}</span>
            <Fiyat value={parca.fiyatMinor} className="text-sm" />
          </li>
        ))}
      </ul>

      {/* ── EN ALT: parça karuseli ────────────────────────────────────── */}
      <ParcaKaruseli
        taban={taban}
        adaylar={adaylar}
        seciliVaryantId={seciliAdayId}
        onSec={setSeciliAdayId}
        cakisanVaryantId={cakisanVaryantId}
      />

      <FotografAdimi
        acik={deneme.fotografAcik}
        onKapat={deneme.fotografKapat}
        onGonder={deneme.fotografGonder}
        yukleniyor={deneme.fotografYukleniyor}
        hata={deneme.fotografHatasi}
      />

      {/* ⚠️ İKİ AYRI MODAL. Tek bir "rıza" bileşeni yazıp kodu prop yapmak,
          yarın birinin ikisini tek kutucukta birleştirmesini kolaylaştırırdı. */}
      <FotografIslemeRizasi
        acik={deneme.rizaKodu === 'CONSENT_REQUIRED'}
        onKapat={deneme.rizaKapat}
        onOnaylandi={deneme.rizaOnaylandi}
      />
      <YurtDisiAktarimRizasi
        acik={deneme.rizaKodu === 'CONSENT_CROSS_BORDER_REQUIRED'}
        onKapat={deneme.rizaKapat}
        onOnaylandi={deneme.rizaOnaylandi}
      />
    </div>
  );
}
