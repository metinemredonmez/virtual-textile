import * as React from 'react';
import { TEMA_BETIGI } from '@/lib/tema';

/**
 * TEMA BETİĞİ — kök düzende, GÖVDENİN İLK BETİĞİ olarak çizilir.
 *
 * ⚠️ "`<body>`nin İLK ÇOCUĞU" DİYE OKUMAYIN — üretilen HTML'de öyle değil.
 *    Next araya kendi akış işaretçisini koyuyor
 *    (`<div hidden=""><!--$--><!--/$--></div>`); görünmez olduğu için zararsız,
 *    ama korunması gereken değişmez şudur: betik GÖRÜNÜR HİÇBİR İÇERİKTEN
 *    SONRA gelmez. Ölçüm (`/products`, `next start`, 2026-08-13): betik
 *    1591. baytta, ilk görünür eleman 2157. baytta.
 *
 * ⚠️ YERİ PAZARLIK KONUSU DEĞİL. Betik `<html>` ayrıştırıldıktan sonra ama
 *    gövdenin geri kalanı ayrıştırılmadan önce çalışmalı; bloklayan bir
 *    `<script>` tam olarak bunu yapar. `next/script` KULLANILMAZ:
 *    `beforeInteractive` bile React'in yüklenmesine bağlıdır ve ilk boyamadan
 *    ÖNCE çalışacağının garantisi yoktur — FOUC'un tanımı budur.
 *
 * ⚠️ Sunucu HTML'i TEMASIZ gider ve bu bilinçli: kök düzende `cookies()`
 *    çağırmak statik rotaları dinamiğe düşürür (gerekçe `lib/tema.ts`
 *    başlığında) ve `sistem` seçeneği sunucuda ZATEN çözülemez. Sunucudan
 *    dönen ilk HTML'de bulunan şey TEMA DEĞİL, TEMA KARARIDIR — ve o karar
 *    ilk boyamadan önce uygulanır. Ölçümü: `data-tema-cozum` niteliğinin ilk
 *    göründüğü an `first-contentful-paint`ten ÖNCE olmalı.
 *
 * ⚠️ CSP: bugün depoda `Content-Security-Policy` başlığı HİÇ YOK (`infra/`,
 *    `next.config.ts`, `ecosystem.config.cjs`, `nginx/vt.conf` tarandı).
 *    Eklendiği gün bu betik `nonce` almak zorunda; aksi hâlde sessizce
 *    çalışmaz ve FOUC geri gelir.
 */
export function TemaBetigi(): React.ReactElement {
  return <script dangerouslySetInnerHTML={{ __html: TEMA_BETIGI }} />;
}
