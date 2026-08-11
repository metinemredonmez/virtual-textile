import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@vt/db';

/**
 * İstek bağlamı — parametre olarak taşımak yerine AsyncLocalStorage ile
 * her katmandan erişilebilir. Log'lar ve audit kayıtları bunu okur.
 */
export interface RequestContext {
  requestId: string;
  /** Giriş yapmış kullanıcı; misafirse undefined. */
  userId?: string;
  role?: Role;
  /** Satıcı paneli isteklerinde aktif mağaza. */
  sellerId?: string;
  /** Misafir sepeti/try-on kotası için tarayıcı oturumu. */
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Bağlam yoksa hata fırlatır — audit yazarken bağlamsız çalışmak istemeyiz. */
export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error('RequestContext bulunamadı — bu kod istek bağlamı dışında çalışıyor.');
  }
  return context;
}

/** Kota ve hız limiti anahtarı: giriş yapmışsa kullanıcı, değilse oturum/IP. */
export function quotaSubject(context: RequestContext): { key: string; isGuest: boolean } {
  if (context.userId) return { key: `user:${context.userId}`, isGuest: false };
  if (context.sessionId) return { key: `session:${context.sessionId}`, isGuest: true };
  return { key: `ip:${context.ipAddress}`, isGuest: true };
}
