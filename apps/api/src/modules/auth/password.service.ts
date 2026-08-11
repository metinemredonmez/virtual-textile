import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * PAROLA ÖZETLEME
 *
 * argon2id — bellek-zor (memory-hard) olduğu için GPU ile toplu kırma
 * saldırılarına bcrypt'ten belirgin biçimde daha dayanıklıdır.
 *
 * Parametreler OWASP asgari önerisini karşılar. Sunucu kaynağı elverdiğinde
 * `memoryCost` artırılabilir; artırılırsa eski özetler yine doğrulanır
 * (parametreler özetin içinde kodludur) ve giriş sırasında kademeli olarak
 * yeniden özetlenir — bkz. `needsRehash`.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Bozuk veya tanınmayan özet biçimi — doğrulama başarısız sayılır.
      return false;
    }
  }

  /** Parametreler sıkılaştırıldığında eski özetleri kademeli yükseltmek için. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, OPTIONS);
    } catch {
      return true;
    }
  }

  /**
   * ZAMANLAMA SALDIRISI KORUMASI
   *
   * Kullanıcı bulunamadığında da parola doğrulaması kadar zaman harcanmalıdır.
   * Aksi hâlde yanıt süresi farkından "bu e-posta kayıtlı mı" bilgisi sızar
   * (kullanıcı numaralandırma).
   */
  async wasteTime(): Promise<void> {
    await argon2.hash('zamanlama-saldirisi-koruma-dolgusu', OPTIONS);
  }
}

/** Sabit zamanlı string karşılaştırma — OTP ve sıfırlama tokenı için. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // Uzunluk farkı zaten eşitsizlik demek; timingSafeEqual eşit uzunluk ister.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
