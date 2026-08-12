import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * @vt/web TEST PROJESİ.
 *
 * ⚠️ NEDEN SONRADAN EKLENDİ (ve bu bir kapı hikâyesidir): kök
 *    `vitest.config.ts` projeleri `apps/<paket>/vitest.config.ts` glob'uyla topluyor.
 *    Bu dosya YOKKEN `@vt/web` hiç proje olarak yüklenmiyordu; `pnpm exec
 *    vitest run` 1175 test geçiyor diyor, `grep -c '|web|'` ise 0 döndürüyordu.
 *    Yani frontend'in TEK SATIRI bile ölçülmüyorken kapı yeşildi — bu depoda üç
 *    kez yaşanan "testler yeşilken bağlantı kopuk" deseninin frontend
 *    karşılığı. Kapının kendisi sessizce eksikti.
 *
 * ⚠️ `environment: 'node'`: buradaki testler SAF modüller içindir (para okuma,
 *    BigInt aritmetiği, ayraç sezgiseli, URL ayrıştırma). Bileşen testi için
 *    jsdom + testing-library gerekir; onu eklemek ayrı bir iştir ve bugün
 *    yapılmadığı AGENTS.md §10'da yazılı. Yarım bir jsdom kurulumu, "bileşenler
 *    test ediliyor" yanılsaması üretirdi.
 */
export default defineConfig({
  test: {
    name: 'web',
    environment: 'node',
    include: ['{app,src}/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // `tsconfig.json` içindeki `@/*` yolunun test tarafındaki karşılığı.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
