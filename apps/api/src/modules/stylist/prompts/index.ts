import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * SİSTEM PROMPTU — VERSİYONLU DOSYA
 *
 * Prompt kod içine gömülmez: metni değiştirmek davranışı değiştirir, yani bir
 * ürün kararıdır ve diff'te tek başına görünmelidir. Versiyon numarası da
 * kayıtlıdır — bir öneri şikâyeti geldiğinde o mesajın HANGİ prompt ile
 * üretildiği bilinmeden inceleme yapılamaz.
 *
 * ⚠️ Yeni sürüm eklerken eskisini SİLME: geçmiş mesajlar o sürüme referans
 *    veriyor. `stylist.v2.md` ekle ve `ACTIVE_PROMPT_VERSION` değerini güncelle.
 */
export const ACTIVE_PROMPT_VERSION = 'stylist.v1';

/**
 * NEEDS-BUILD-ASSET: apps/api/nest-cli.json içine
 *   "compilerOptions": { "assets": ["modules/**\/prompts/*.md"] }
 * eklenmeli ki `.md` dosyaları dist'e kopyalansın. Kopyalanmazsa aşağıdaki
 * kaynak-ağacı yedeği devreye girer; üretimde bu yedeğe güvenilmemeli.
 */
function candidatePaths(version: string): string[] {
  const file = `${version}.md`;
  const paths: string[] = [];

  // CommonJS derleme hedefi: __dirname mevcut. Vitest ESM dönüşümünde olmayabilir.
  if (typeof __dirname === 'string') {
    paths.push(join(__dirname, file));
    // dist/modules/stylist/prompts → src/modules/stylist/prompts
    paths.push(join(__dirname.replace(`${sep}dist${sep}`, `${sep}src${sep}`), file));
  }

  paths.push(resolve(process.cwd(), 'src/modules/stylist/prompts', file));
  paths.push(resolve(process.cwd(), 'apps/api/src/modules/stylist/prompts', file));

  return paths;
}

const cache = new Map<string, string>();

/**
 * Prompt metnini okur ve önbelleğe alır.
 *
 * Dosya bulunamazsa AÇIKÇA patlar. Sessizce boş prompt ile devam etmek en
 * tehlikeli seçenek olurdu: model kuralsız kalır ve "uydurma ürün" koruması
 * yalnızca araç katmanına iner.
 */
export function loadSystemPrompt(version: string = ACTIVE_PROMPT_VERSION): string {
  const cached = cache.get(version);
  if (cached !== undefined) return cached;

  for (const path of candidatePaths(version)) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8').trim();
    if (text.length === 0) continue;
    cache.set(version, text);
    return text;
  }

  throw new Error(
    `Stil danışmanı sistem promptu bulunamadı: ${version}.md. ` +
      'Derleme sırasında .md dosyalarının dist klasörüne kopyalandığını doğrulayın.',
  );
}
