/**
 * STİL DANIŞMANI AKIŞ OLAYLARI.
 *
 * ⚠️ Bu union bugün `apps/api/src/modules/stylist/stylist.service.ts` içinde de
 *    tanımlı. Kalıcı çözüm API'nin buradan import etmesidir; iki kopya kaldığı
 *    sürece sunucu yeni bir olay tipi yayınladığında istemci onu sessizce
 *    yok sayar (switch'te dal yok, hata da yok). Taşıma ayrı bir kartta.
 */
export type StylistEventWire =
  | { type: 'start'; data: { conversationId: string } }
  | { type: 'delta'; data: { text: string } }
  | { type: 'tool'; data: { name: string; status: 'running' | 'ok' | 'error' } }
  | { type: 'action'; data: { type: string; payload: unknown } }
  | {
      type: 'done';
      data: { messageId: string; suggestedProductIds: string[]; promptVersion: string };
    }
  /**
   * ⚠️ Akış İÇİNDEKİ hata. Kota/kapı hataları akış AÇILMADAN normal JSON
   *    zarfıyla döner (429/503). İstemci `content-type` denetlemezse SSE
   *    ayrıştırıcısı o gövdeyi "boş yanıt" sanar ve kullanıcı hiçbir şey görmez.
   */
  | { type: 'error'; data: { code: string; message: string; retryable: boolean } };

export interface StylistMessageWire {
  id: string;
  role: string;
  content: string;
  suggestedProductIds: string[];
  createdAt: string;
}

export interface StylistConversationWire {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages: StylistMessageWire[];
}
