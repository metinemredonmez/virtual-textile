import { describe, expect, it } from 'vitest';
import type { Prisma, Role } from '@vt/db';
import { decideRoleChange, decideRoleChanges, isProtectedRole } from './seller-role.js';
import { syncSellerMemberRoles, USER_ROLE_AUDIT_ACTION } from './seller-role.service.js';

/**
 * Bu testlerin varlık sebebi: satıcı paneli `@Roles('SELLER_USER')` ile
 * korunuyor ve karar TOKEN'daki role bakıyor. Rol ataması bozulursa
 * "onaylanmış ama paneline giremeyen satıcı" ya da — çok daha kötüsü —
 * "yönetim yetkisini sessizce kaybetmiş admin" doğar. İkisi de modül
 * testlerinden kaçar, çünkü diğer testler JwtPayload'ı elle kurup rolü
 * kendileri veriyor.
 */

// ══════════════════════════ SAF KURAL ═══════════════════════════════════════

describe('decideRoleChange — rol, onaylı mağaza üyeliğinin türevidir', () => {
  it('onaylanmış mağazası olan CUSTOMER, SELLER_USER olur', () => {
    expect(
      decideRoleChange({
        userId: 'u1',
        currentRole: 'CUSTOMER',
        hasApprovedMembership: true,
      }),
    ).toEqual({ userId: 'u1', from: 'CUSTOMER', to: 'SELLER_USER', direction: 'promote' });
  });

  it('onaylı mağazası kalmayan SELLER_USER, CUSTOMER’a döner', () => {
    expect(
      decideRoleChange({
        userId: 'u1',
        currentRole: 'SELLER_USER',
        hasApprovedMembership: false,
      }),
    ).toEqual({ userId: 'u1', from: 'SELLER_USER', to: 'CUSTOMER', direction: 'demote' });
  });

  it('⚠️ İKİNCİ MAĞAZASI HÂLÂ ONAYLIYKEN SELLER_USER DÜŞÜRÜLMEZ', () => {
    // Bir mağazası askıya alındı ama başka bir onaylı mağazası var: kural
    // "hangi işlem yapıldı"ya değil "geriye ne kaldı"ya baktığı için rol durur.
    // Aksi hâlde satıcı, çalışmaya devam eden mağazasından da edilirdi.
    expect(
      decideRoleChange({
        userId: 'u1',
        currentRole: 'SELLER_USER',
        hasApprovedMembership: true,
      }),
    ).toBeNull();
  });

  it('⚠️ ADMIN EZİLMEZ — satıcı olsa bile SELLER_USER’a çekilmez', () => {
    expect(
      decideRoleChange({
        userId: 'yonetici',
        currentRole: 'ADMIN',
        hasApprovedMembership: true,
      }),
    ).toBeNull();
  });

  it('⚠️ ADMIN EZİLMEZ — mağazası askıya alınsa bile CUSTOMER’a düşürülmez', () => {
    expect(
      decideRoleChange({
        userId: 'yonetici',
        currentRole: 'ADMIN',
        hasApprovedMembership: false,
      }),
    ).toBeNull();
  });

  it('SUPPORT de korunur — her iki yönde', () => {
    expect(
      decideRoleChange({ userId: 'destek', currentRole: 'SUPPORT', hasApprovedMembership: true }),
    ).toBeNull();
    expect(
      decideRoleChange({ userId: 'destek', currentRole: 'SUPPORT', hasApprovedMembership: false }),
    ).toBeNull();
  });

  it('rol zaten doğruysa değişiklik üretilmez (gereksiz yazma ve çıkış olmasın)', () => {
    expect(
      decideRoleChange({ userId: 'u1', currentRole: 'SELLER_USER', hasApprovedMembership: true }),
    ).toBeNull();
    expect(
      decideRoleChange({ userId: 'u2', currentRole: 'CUSTOMER', hasApprovedMembership: false }),
    ).toBeNull();
  });

  it('isProtectedRole yalnızca ADMIN ve SUPPORT için doğrudur', () => {
    expect(isProtectedRole('ADMIN')).toBe(true);
    expect(isProtectedRole('SUPPORT')).toBe(true);
    expect(isProtectedRole('SELLER_USER')).toBe(false);
    expect(isProtectedRole('CUSTOMER')).toBe(false);
  });
});

describe('decideRoleChanges', () => {
  it('yalnızca gerçekten değişenleri döndürür', () => {
    const changes = decideRoleChanges([
      { userId: 'sahip', currentRole: 'CUSTOMER', hasApprovedMembership: true },
      { userId: 'personel', currentRole: 'SELLER_USER', hasApprovedMembership: true },
      { userId: 'yonetici', currentRole: 'ADMIN', hasApprovedMembership: true },
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ userId: 'sahip', to: 'SELLER_USER' });
  });
});

// ═════════════════════ TRANSACTION UYGULAYICISI ═════════════════════════════

interface SahteUye {
  userId: string;
  role: Role;
  /** İşlem SONRASI hâlâ APPROVED bir mağazada üyeliği var mı. */
  onayliUyelikKaldi: boolean;
}

interface SellerUserFindManyArgs {
  where: { sellerId?: string; userId?: { in: string[] }; seller?: { status: string } };
}

interface UserUpdateArgs {
  where: { id: string };
  data: { role: Role };
}

interface SessionUpdateManyArgs {
  where: { userId: { in: string[] }; revokedAt: null };
  data: { revokedAt: Date };
}

/**
 * Prisma yerine geçen en küçük sahte: iki `sellerUser.findMany` çağrısını
 * (mağazanın üyeleri / kullanıcının onaylı bağları) `where` biçiminden ayırır.
 * Ölçülen şey sorgu değil, YAZMALARDIR — hangi role yazıldı, denetim kaydı
 * düştü mü, oturum düşürüldü mü.
 */
function sahteTx(uyeler: SahteUye[]) {
  const rolYazmalari: Array<{ userId: string; role: Role }> = [];
  const denetimKayitlari: Array<Record<string, unknown>> = [];
  const dusurulenOturumlar: string[][] = [];

  const tx = {
    sellerUser: {
      findMany: (args: SellerUserFindManyArgs): Promise<unknown[]> => {
        if (args.where.sellerId !== undefined) {
          return Promise.resolve(
            uyeler.map((uye) => ({ userId: uye.userId, user: { role: uye.role } })),
          );
        }
        const istenen = args.where.userId?.in ?? [];
        return Promise.resolve(
          uyeler
            .filter((uye) => istenen.includes(uye.userId) && uye.onayliUyelikKaldi)
            .map((uye) => ({ userId: uye.userId })),
        );
      },
    },
    user: {
      update: (args: UserUpdateArgs): Promise<unknown> => {
        rolYazmalari.push({ userId: args.where.id, role: args.data.role });
        return Promise.resolve({});
      },
    },
    auditLog: {
      create: (args: { data: Record<string, unknown> }): Promise<unknown> => {
        denetimKayitlari.push(args.data);
        return Promise.resolve({});
      },
    },
    session: {
      updateMany: (args: SessionUpdateManyArgs): Promise<{ count: number }> => {
        dusurulenOturumlar.push(args.where.userId.in);
        return Promise.resolve({ count: args.where.userId.in.length });
      },
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    rolYazmalari,
    denetimKayitlari,
    dusurulenOturumlar,
  };
}

const AKTOR = { id: 'admin-1', role: 'ADMIN' as Role, ipAddress: '10.0.0.1' };

describe('syncSellerMemberRoles', () => {
  it('onayda rolü yükseltir, denetim kaydı yazar ve oturumları düşürür', async () => {
    const { tx, rolYazmalari, denetimKayitlari, dusurulenOturumlar } = sahteTx([
      { userId: 'satici-1', role: 'CUSTOMER', onayliUyelikKaldi: true },
    ]);

    const sonuc = await syncSellerMemberRoles(tx, {
      sellerId: 'seller-1',
      actor: AKTOR,
      reason: 'Belgeler tamam',
    });

    expect(rolYazmalari).toEqual([{ userId: 'satici-1', role: 'SELLER_USER' }]);
    expect(sonuc.changes).toHaveLength(1);
    expect(sonuc.revokedSessions).toBe(1);

    // Oturum düşürme isteğe bağlı değil: token'daki eski rol 15 dakika daha
    // geçerli kalırdı ve satıcı "onaylandım ama giremiyorum" derdi.
    expect(dusurulenOturumlar).toEqual([['satici-1']]);

    // Denetim: kim, kimi, hangi role, neden.
    expect(denetimKayitlari).toHaveLength(1);
    expect(denetimKayitlari[0]).toMatchObject({
      actorId: 'admin-1',
      actorRole: 'ADMIN',
      action: USER_ROLE_AUDIT_ACTION,
      entityType: 'User',
      entityId: 'satici-1',
      before: { role: 'CUSTOMER' },
      after: { role: 'SELLER_USER', sellerId: 'seller-1', direction: 'promote' },
      reason: 'Belgeler tamam',
      ipAddress: '10.0.0.1',
    });
  });

  it('askıda son mağazası da gidince CUSTOMER’a döner', async () => {
    const { tx, rolYazmalari, dusurulenOturumlar } = sahteTx([
      { userId: 'satici-1', role: 'SELLER_USER', onayliUyelikKaldi: false },
    ]);

    const sonuc = await syncSellerMemberRoles(tx, {
      sellerId: 'seller-1',
      actor: AKTOR,
      reason: 'Sahte ürün',
    });

    expect(rolYazmalari).toEqual([{ userId: 'satici-1', role: 'CUSTOMER' }]);
    expect(sonuc.changes[0]).toMatchObject({ direction: 'demote' });
    expect(dusurulenOturumlar).toEqual([['satici-1']]);
  });

  it('⚠️ İKİNCİ MAĞAZASI VARKEN askı rolü DÜŞÜRMEZ ve oturumu kapatmaz', async () => {
    const { tx, rolYazmalari, denetimKayitlari, dusurulenOturumlar } = sahteTx([
      { userId: 'satici-1', role: 'SELLER_USER', onayliUyelikKaldi: true },
    ]);

    const sonuc = await syncSellerMemberRoles(tx, {
      sellerId: 'seller-1',
      actor: AKTOR,
      reason: 'Askı',
    });

    expect(rolYazmalari).toEqual([]);
    expect(denetimKayitlari).toEqual([]);
    // Değişmeyen rol için oturum düşürmek, çalışan mağazasındaki satıcıyı
    // sebepsiz yere dışarı atardı.
    expect(dusurulenOturumlar).toEqual([]);
    expect(sonuc).toMatchObject({ memberCount: 1, revokedSessions: 0 });
  });

  it('⚠️ ADMIN EZİLMEZ — ne rolü yazılır ne oturumu düşürülür', async () => {
    const { tx, rolYazmalari, denetimKayitlari, dusurulenOturumlar } = sahteTx([
      { userId: 'yonetici', role: 'ADMIN', onayliUyelikKaldi: true },
      { userId: 'personel', role: 'CUSTOMER', onayliUyelikKaldi: true },
    ]);

    const sonuc = await syncSellerMemberRoles(tx, {
      sellerId: 'seller-1',
      actor: AKTOR,
      reason: null,
    });

    expect(rolYazmalari).toEqual([{ userId: 'personel', role: 'SELLER_USER' }]);
    expect(denetimKayitlari.map((kayit) => kayit.entityId)).toEqual(['personel']);
    expect(dusurulenOturumlar).toEqual([['personel']]);
    expect(sonuc.changes).toHaveLength(1);
  });

  it('⚠️ ADMIN EZİLMEZ — mağazası askıya alınınca da CUSTOMER’a düşmez', async () => {
    const { tx, rolYazmalari, dusurulenOturumlar } = sahteTx([
      { userId: 'yonetici', role: 'ADMIN', onayliUyelikKaldi: false },
    ]);

    const sonuc = await syncSellerMemberRoles(tx, {
      sellerId: 'seller-1',
      actor: AKTOR,
      reason: 'Askı',
    });

    expect(rolYazmalari).toEqual([]);
    expect(dusurulenOturumlar).toEqual([]);
    expect(sonuc.changes).toEqual([]);
  });

  it('mağazanın birden fazla üyesi varsa hepsi tek seferde düşürülür', async () => {
    const { tx, rolYazmalari, dusurulenOturumlar } = sahteTx([
      { userId: 'sahip', role: 'CUSTOMER', onayliUyelikKaldi: true },
      { userId: 'personel', role: 'CUSTOMER', onayliUyelikKaldi: true },
    ]);

    await syncSellerMemberRoles(tx, { sellerId: 'seller-1', actor: AKTOR, reason: null });

    expect(rolYazmalari).toEqual([
      { userId: 'sahip', role: 'SELLER_USER' },
      { userId: 'personel', role: 'SELLER_USER' },
    ]);
    expect(dusurulenOturumlar).toEqual([['sahip', 'personel']]);
  });

  it('üyesi olmayan mağazada hiçbir yazma yapılmaz', async () => {
    const { tx, rolYazmalari, denetimKayitlari, dusurulenOturumlar } = sahteTx([]);

    const sonuc = await syncSellerMemberRoles(tx, {
      sellerId: 'seller-1',
      actor: AKTOR,
      reason: null,
    });

    expect(sonuc).toEqual({ memberCount: 0, changes: [], revokedSessions: 0 });
    expect(rolYazmalari).toEqual([]);
    expect(denetimKayitlari).toEqual([]);
    expect(dusurulenOturumlar).toEqual([]);
  });
});
