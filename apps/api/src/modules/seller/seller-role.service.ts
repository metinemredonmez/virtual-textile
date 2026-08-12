/**
 * SATICI ROLÜ SENKRONİZASYONU — VERİTABANI TARAFI.
 *
 * `seller-role.ts` neyin değişmesi gerektiğine karar verir; bu dosya kararı
 * ÇAĞIRANIN TRANSACTION'INDA uygular: rol yazımı, denetim kaydı ve oturum
 * düşürme.
 *
 * ⚠️ NEDEN `tx` ALIYOR, KENDİ TRANSACTION'INI AÇMIYOR:
 *    Rol, mağaza durumunun türevidir. Ayrı transaction'da yazılsaydı iki
 *    bozuk durum doğardı — mağaza onaylanır ama rol yükselmez (satıcı
 *    panelini açamaz), ya da rol yükselir ama onay geri alınır (mağazası
 *    olmayan bir SELLER_USER kalır). İkisi de elle düzeltme gerektirir.
 *
 * ⚠️ MODÜL SINIRI NOTU:
 *    Karar `SellerUser` tablosundan çıktığı için mantık satıcı modülünde
 *    duruyor; ancak yazdığı `User` ve `Session` tabloları kimlik modülünündür.
 *    Yönetim modülü buraya DI portu yerine doğrudan çağrıyla giriyor, çünkü
 *    `admin/index.ts` ve `admin.ports.ts` bu görevin yazma alanı dışında.
 *    ENTEGRASYON: kimlik modülü bir "rol yazma" yüzeyi yayımladığında bu
 *    dosya oraya devredilmeli, `AdminSellerService` bir port üzerinden
 *    çağırmalıdır. Uçtan uca davranış değişmez.
 *
 * Dosya adı `*.service.ts`: modül sınırı ESLint kuralı (`no-restricted-imports`)
 * bir modülün dışarıdan yalnızca `index` / `*.service` / `*.types` dosyalarının
 * import edilmesine izin veriyor.
 */
import type { Prisma, Role } from '@vt/db';
import { decideRoleChanges, type RoleChange } from './seller-role.js';

type Tx = Prisma.TransactionClient;

/**
 * Rol değişiminin denetim eylemi.
 *
 * ⚠️ `admin/audit.ts` içindeki `AUDIT_ACTION` KAPALI bir birleşim ve o dosya
 *    bu görevin yazma alanı dışında; bu yüzden eylem adı burada tanımlı ve
 *    satır `tx.auditLog.create` ile yazılıyor. Kaydın içeriği hassas alan
 *    taşımıyor (kullanıcı kimliği, eski/yeni rol, mağaza kimliği), dolayısıyla
 *    `redactSensitive`'in atlanması bilgi sızdırmaz.
 *    ENTEGRASYON: `AUDIT_ACTION.userRoleChanged` eklendiğinde bu sabit oradan
 *    okunmalı ve yazma `writeAuditLog`'a devredilmelidir.
 */
export const USER_ROLE_AUDIT_ACTION = 'user.role.changed';

/** Denetim kaydına yazılacak aktör — `AdminActor` ile yapısal olarak uyumlu. */
export interface RoleSyncActor {
  readonly id: string;
  readonly role: Role;
  readonly ipAddress: string;
}

export interface RoleSyncResult {
  /** Mağazanın üye sayısı — 0 ise mağaza sahipsizdir, çağıran uyarmalıdır. */
  readonly memberCount: number;
  readonly changes: readonly RoleChange[];
  readonly revokedSessions: number;
}

/**
 * Mağazanın ÜYELERİNİN rolünü güncel duruma göre eşitler.
 *
 * ⚠️ ÇAĞRI SIRASI ÖNEMLİ: mağazanın yeni durumu (`Seller.status`) AYNI
 *    transaction içinde ZATEN YAZILMIŞ olmalıdır. Aşağıdaki "hâlâ onaylı
 *    mağazası var mı" sorgusu kendi transaction'ının yazmalarını görür;
 *    durum güncellemesinden önce çağrılsaydı askıya alınan mağaza hâlâ
 *    APPROVED sayılır ve satıcı rolünü haksız yere korurdu.
 *
 * ⚠️ Tüm üyeler tek tek değerlendirilir, yalnızca başvuru sahibi değil.
 *    Mağazaya sonradan eklenen bir personelin de panele girebilmesi gerekir;
 *    "sahibi bul ve onu yükselt" kuralı o kişiyi dışarıda bırakırdı.
 */
export async function syncSellerMemberRoles(
  tx: Tx,
  params: {
    readonly sellerId: string;
    readonly actor: RoleSyncActor;
    /** Denetim kaydına geçecek gerekçe (onay notu, red/askı sebebi). */
    readonly reason: string | null;
    readonly now?: Date;
  },
): Promise<RoleSyncResult> {
  const { sellerId, actor, reason } = params;
  const now = params.now ?? new Date();

  // ⚠️ `SellerUser` bağı BURADA KURULMAZ. Bağ, başvuruyla aynı transaction'da
  //    `SellerService.apply` içinde açılıyor (Seller + SellerUser(owner) +
  //    Store). Onay anında yeniden yazmak, sahiplik devredilmiş bir mağazada
  //    eski sahibi geri getirirdi — "zaten varsa dokunma" kuralı budur.
  const members = await tx.sellerUser.findMany({
    where: { sellerId },
    select: { userId: true, user: { select: { role: true } } },
  });

  if (members.length === 0) {
    // Sahipsiz mağaza: veri bütünlüğü sorunu. Onayı burada patlatmıyoruz —
    // admin kararı zaten verilmiş durumda ve mağazayı onaysız bırakmak
    // müşteriye de satıcıya da yardımcı olmaz. Çağıran bunu loglar.
    return { memberCount: 0, changes: [], revokedSessions: 0 };
  }

  const userIds = members.map((member) => member.userId);

  const approvedLinks = await tx.sellerUser.findMany({
    where: { userId: { in: userIds }, seller: { status: 'APPROVED' } },
    select: { userId: true },
  });
  const usersWithApprovedStore = new Set(approvedLinks.map((link) => link.userId));

  const changes = decideRoleChanges(
    members.map((member) => ({
      userId: member.userId,
      currentRole: member.user.role,
      hasApprovedMembership: usersWithApprovedStore.has(member.userId),
    })),
  );

  if (changes.length === 0) {
    // Rol zaten doğru. Yazma yapılmaz — gereksiz bir güncelleme, aşağıdaki
    // oturum düşürmeyi de tetikler ve kullanıcıyı sebepsiz yere dışarı atardı.
    return { memberCount: members.length, changes: [], revokedSessions: 0 };
  }

  for (const change of changes) {
    await tx.user.update({ where: { id: change.userId }, data: { role: change.to } });

    // Rol değişimi hassas işlemdir: kim (actorId), kimi (entityId), hangi
    // role (before/after), neden (reason) — dördü birden kayda geçer.
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: USER_ROLE_AUDIT_ACTION,
        entityType: 'User',
        entityId: change.userId,
        before: { role: change.from },
        after: { role: change.to, sellerId, direction: change.direction },
        reason,
        ipAddress: actor.ipAddress,
      },
    });
  }

  // ⚠️⚠️ OTURUM DÜŞÜRME — ROL DEĞİŞİMİNİN İKİNCİ YARISI, İSTEĞE BAĞLI DEĞİL.
  //
  // Yetki kararı access token'ın İÇİNDEKİ `role` ve `sellerIds` alanlarından
  // veriliyor (RolesGuard, SellerScopeGuard). Token 15 dakika geçerli ve tek
  // tek iptal EDİLEMEZ. Veritabanındaki rolü değiştirip oturumu bırakmak iki
  // hatayı birden üretir:
  //   • DÜŞÜRMEDE: askıya alınan satıcı 15 dakika daha ürün/stok/fiyat
  //     yazmaya, sipariş görmeye devam eder. Askının anlamı kalmaz.
  //   • YÜKSELTMEDE: yeni onaylanmış satıcı elindeki eski token'la panele
  //     girmeye çalışır, AUTH_FORBIDDEN alır ve "onaylandım ama giremiyorum"
  //     diye desteğe düşer.
  // Oturum düşünce istemci yeniden giriş yapar ve token güncel rolü taşır.
  //
  // ⚠️ `TokenService.revokeAllSessions` DEĞİL, aynı yazmanın transaction
  //    içindeki hâli kullanılıyor: o metot kendi PrismaClient'ı üzerinden
  //    yazar, yani bu transaction'ın DIŞINDA kalır. Transaction geri
  //    alınsaydı, hiç gerçekleşmemiş bir rol değişimi yüzünden kullanıcının
  //    tüm cihazları çıkış yapmış olurdu.
  //
  // ⚠️ `reusedAt` alanına DOKUNULMUYOR: o alan token hırsızlığı işaretidir ve
  //    burada sıfırlanması güvenlik sinyalini silerdi.
  const revoked = await tx.session.updateMany({
    where: { userId: { in: changes.map((change) => change.userId) }, revokedAt: null },
    data: { revokedAt: now },
  });

  return { memberCount: members.length, changes, revokedSessions: revoked.count };
}
