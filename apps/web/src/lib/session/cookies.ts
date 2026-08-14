import 'server-only';
import { cookies } from 'next/headers';
import { appUrl } from '@/lib/env';

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
/**
 * ⚠️ `secure` BAYRAĞI ŞEMADAN TÜRETİLİR — `NODE_ENV`DEN DEĞİL. Canlıda ölçüldü.
 *
 *  Eskiden `secure: process.env.NODE_ENV === 'production'` yazıyordu. Sunucu
 *  `NODE_ENV=production` ile koşuyor ama site HTTP üzerinden servis ediliyor
 *  (`http://91.99.183.64` — alan adı ve TLS henüz yok). Sonuç:
 *
 *      sunucu  → 200 OK, `set-cookie: vt_sid=…; Secure`
 *      tarayıcı → çerezi SESSİZCE ATAR (Secure çerez HTTP'de kabul edilmez)
 *      kullanıcı → doğru şifreyi girer, hiçbir şey olmaz
 *
 *  ⚠️ VE BU `curl` İLE GÖRÜNMEZ. Sunucudan atılan istek 200 dönüyordu, çünkü
 *     curl `Secure` kuralını UYGULAMAZ. Aynı tuzağa bu depoda ikinci kez
 *     düşüldü: r2.dev de curl'de başka, tarayıcıda başka davranıyordu.
 *     Kimlik akışını yalnızca curl ile doğrulamak bu arızayı GÖREMEZ.
 *
 *  DOĞRU SİNYAL ŞEMADIR: `NODE_ENV` "bu bir üretim derlemesi" der, "bu bağlantı
 *  şifreli" DEMEZ. `APP_URL` ise tam olarak hangi şema üzerinden servis
 *  edildiğimizi söylüyor — TLS geldiği gün `https://` olacak ve bayrak
 *  KENDİLİĞİNDEN açılacak; burada ikinci bir düzenleme gerekmeyecek.
 *
 * ⚠️ BU BİR GÜVENLİK GEVŞETMESİ DEĞİL, GERÇEĞİN KABULÜ. HTTP üzerinde `Secure`
 *    bayrağı hiçbir şey korumuyordu — çerez zaten hiç yazılmıyordu. Asıl
 *    koruma TLS'tir ve o ayrı bir iş olarak duruyor. Aşağıdaki uyarı, bu
 *    durumun unutulmasını engellemek için var.
 */
function sifreliBaglanti(): boolean {
  return appUrl().startsWith('https://');
}

/**
 * ⚠️ SESSİZ KALMIYOR. Üretim derlemesinde şifresiz bağlantı gerçek bir risktir
 *    (oturum çerezi ağda düz geçer, araya giren çalabilir). Kabul edilmiş bir
 *    geçici durum ama görünür olmalı — yoksa TLS işi "sonra" diye sonsuza
 *    kadar ertelenir.
 */
let uyarildi = false;
function baseOptions() {
  const secure = sifreliBaglanti();

  if (!secure && process.env.NODE_ENV === 'production' && !uyarildi) {
    uyarildi = true;
    console.warn(
      '[oturum] ⚠️ ÜRETİM DERLEMESİ ŞİFRESİZ BAĞLANTIDA: ' +
        `APP_URL=${appUrl()} (https değil). Oturum çerezi 'Secure' bayrağı ` +
        'OLMADAN yazılıyor — ağda düz geçiyor. TLS kurulduğunda bayrak ' +
        'kendiliğinden açılır; ayrıca bir değişiklik gerekmez.',
    );
  }

  return {
    httpOnly: true,
    secure,
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
