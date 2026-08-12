'use client';

import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

/**
 * MOBİL FİLTRE ÇEKMECESİ — Grailed'dan alınan tek şey.
 *
 * ⚠️ Bu bileşen filtreleri BİLMEZ; panelin kendisini `children` olarak alır.
 *    Sebep: panel bir Sunucu Bileşeni ve fasetleri sunucuda çiziliyor. Çekmece
 *    kendi panelini kursaydı masaüstü kenar çubuğuyla iki ayrı kopya olurdu ve
 *    biri diğerinden sessizce ayrışırdı — bu depoda üç kez yaşanan hatanın
 *    aynısı, bu kez arayüzde.
 *
 * ⚠️ İçerideki form düz bir `GET` gönderimidir; gönderim sayfayı değiştirir ve
 *    çekmece kendiliğinden yok olur. Bu yüzden "gönderdikten sonra kapat" diye
 *    bir durum yönetimi YOK — olsaydı gezinme ile yarışırdı.
 */
export interface FiltreCekmecesiProps {
  /** Sunucuda çizilmiş filtre paneli. */
  children: React.ReactNode;
  /** Seçili faset sayısı; düğmenin üstünde rozet olarak görünür. */
  secimSayisi: number;
}

export function FiltreCekmecesi({
  children,
  secimSayisi,
}: FiltreCekmecesiProps): React.ReactElement {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ikincil" size="sm">
          {/* İkon metinden bir ton soluk ve RENKSİZ — filtre bir durum değil. */}
          <SlidersHorizontal className="text-ikon" />
          Filtrele
          {secimSayisi > 0 ? <span className="rakam">({secimSayisi})</span> : null}
        </Button>
      </SheetTrigger>

      {/*
        Yandan değil ALTTAN girer: mobilde başparmak ekranın altındadır ve
        çekmecenin "Uygula" düğmesi oraya en yakın yerde olmalı.
        ⚠️ `overflow-y-auto` şart — faset listeleri 85vh'yi aşabiliyor ve taşan
           içerik dokunmatikte hiç görünmüyor.
      */}
      <SheetContent side="bottom" className="overflow-y-auto pb-8">
        <SheetTitle className="mb-4 text-sm font-semibold tracking-tight">Filtreler</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
