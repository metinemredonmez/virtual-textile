import { z } from 'zod';

/**
 * Konuşma başlığı isteğe bağlı: ilk mesajdan türetmek daha iyi bir deneyim ama
 * istemci "Yaz kombinleri" gibi bir bağlamla da başlatabilir.
 */
export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

/**
 * ⚠️ Uzunluk sınırı bir maliyet kontrolüdür, biçim kontrolü değil.
 * 4000 karakterlik bir mesaj tek başına ~1000 token; sınır olmadan tek
 * kullanıcı günlük bütçeyi tüketebilir.
 */
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Mesaj boş olamaz.').max(2000),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
