import { z } from 'zod';
import { consentTypeSchema } from '@vt/contracts';

/**
 * AYDINLATMA METNİ SÜRÜMÜ
 *
 * ⚠️ Rıza kaydına metnin SÜRÜMÜ de yazılır. Metin bir gün değiştiğinde
 *    "kullanıcı neyi onaylamıştı" sorusunun cevabı yalnızca bu alandır;
 *    yazılmazsa eski rızaların kapsamı ispatlanamaz ve tamamı yeniden
 *    alınmak zorunda kalınır.
 *
 * ⚠️ Sunucu tarafında sabit; istemci farklı bir sürüm gönderemez. Gönderebilseydi
 *    bir istemci hatası, hiç gösterilmemiş bir metnin onaylandığını kaydederdi.
 *    NOT: uzun vadede `@vt/config` içine taşınmalı (bkz. modül raporu).
 */
export const CONSENT_DOCUMENT_VERSION = 'kvkk-2026-01';

/**
 * Rıza verme / geri çekme.
 *
 * ⚠️ `granted` ZORUNLU ve varsayılanı YOK. `.default(true)` yazılsaydı, alanı
 *    unutan bir istemci sessizce RIZA VERMİŞ olurdu — açık rızanın tanımı
 *    gereği bu geçersizdir (KVKK md.3: "belirli bir konuya ilişkin,
 *    bilgilendirilmeye dayanan ve ÖZGÜR İRADEYLE açıklanan").
 */
export const consentWriteSchema = z.object({
  type: consentTypeSchema,
  granted: z.boolean(),
});

export type ConsentWriteInput = z.infer<typeof consentWriteSchema>;

/**
 * Hesap silme talebi.
 *
 * `reason` isteğe bağlı ve SERBEST METİN DEĞİL: sabit liste. Serbest metin
 * kutusu, kullanıcıların oraya kimlik numarası/şifre yazmasıyla sonuçlanır ve
 * o metin denetim kaydında süresiz durur.
 */
export const accountDeletionSchema = z
  .object({
    reason: z
      .enum(['NO_LONGER_USING', 'PRIVACY_CONCERN', 'TOO_MANY_EMAILS', 'FOUND_ALTERNATIVE', 'OTHER'])
      .optional(),
  })
  // ⚠️ `.default({})`: DELETE istekleri çoğu istemcide GÖVDESİZ gönderilir ve
  //    gövde `undefined` gelir. Varsayılan olmasaydı, sebep belirtmek istemeyen
  //    kullanıcının silme talebi VALIDATION_FAILED ile reddedilirdi — isteğe
  //    bağlı bir alan yüzünden bir KVKK hakkı kullanılamaz hâle gelirdi.
  .default({});

export type AccountDeletionInput = z.infer<typeof accountDeletionSchema>;
