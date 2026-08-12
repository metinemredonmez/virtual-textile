import 'server-only';
import { cookies } from 'next/headers';

/**
 * ÇEREZLER — tarayıcıda YALNIZCA ÜÇ opak değer, üçü de httpOnly.
 *
 * Erişim jetonu hiçbir çerezde, hiçbir storage'da tutulmaz; Redis'te durur ve
 * tarayıcı yalnızca oturumu işaret eden rastgele bir kimlik taşır.
 *
 * ⚠️ Şifreli çerez (iron-session) BİLİNÇLİ OLARAK REDDEDİLDİ. Next'te bir
 *    Sunucu Bileşeni içinden ÇEREZ YAZILAMAZ: korumalı bir sayfa SSR edilirken
 *    jeton yenilenir ama rotasyon sonucu tarayıcıya yazılamaz. Eski refresh
 *    token elde kalır, bir sonraki istek `AUTH_REFRESH_REUSED` alır ve kullanıcı
 *    HER cihazdan atılır. Yani şifreli çerez felaketi doğrudan tetikleyen bir
 *    tasarımdır. Redis zaten yığında var (BullMQ, hız limiti).
 */

export const SID_COOKIE = 'vt_sid';
export const GID_COOKIE = 'vt_gid';

/** 30 gün — refresh token ömrüyle aynı. `vt_sid` bu süre boyunca DEĞİŞMEZ. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * ⚠️ `SameSite=Lax`, `Strict` DEĞİL. Strict'te e-postadan veya Google
 *    sonuçlarından gelen kullanıcı ilk yüklemede ÇIKIŞ YAPMIŞ görünür; moda
 *    vitrininde trafiğin çoğu tam olarak böyle geliyor. Lax çapraz siteden
 *    gelen POST/PUT/PATCH/DELETE'te zaten çerez göndermiyor; asıl CSRF koruması
 *    vekildeki Origin denetimi (bkz. `app/api/[...proxy]/route.ts`).
 */
function baseOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function readSid(): Promise<string | null> {
  return (await cookies()).get(SID_COOKIE)?.value ?? null;
}

/**
 * Misafir sepeti kimliği.
 *
 * ⚠️ localStorage'da TUTULAMAZ: `cart.owner.ts` bunu bir SIR olarak ele alıyor
 *    (bilen herkes o sepeti okur ve değiştirir) ve Sunucu Bileşeni localStorage'ı
 *    okuyamadığı için sepet SSR edilemezdi.
 */
export async function readGid(): Promise<string | null> {
  return (await cookies()).get(GID_COOKIE)?.value ?? null;
}

/** Misafir kimliği yoksa üretir. ⚠️ Yalnız route handler'dan çağrılabilir. */
export async function ensureGid(): Promise<string> {
  const jar = await cookies();
  const mevcut = jar.get(GID_COOKIE)?.value;
  if (mevcut) return mevcut;
  const gid = crypto.randomUUID();
  jar.set(GID_COOKIE, gid, baseOptions());
  return gid;
}

export async function setSid(sid: string): Promise<void> {
  (await cookies()).set(SID_COOKIE, sid, baseOptions());
}

export async function clearGid(): Promise<void> {
  (await cookies()).delete({ name: GID_COOKIE, path: '/' });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: SID_COOKIE, path: '/' });
  jar.delete({ name: GID_COOKIE, path: '/' });
}
