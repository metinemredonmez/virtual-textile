/**
 * SATICI ROLÜ — SAF KARAR KURALLARI.
 *
 * `Role` alanı satıcılığın TÜREVİDİR: onaylanmış bir mağazanın üyesi olan
 * kullanıcı satıcı panelini açabilmeli (`@Roles('SELLER_USER')`), olmayan
 * açamamalıdır. Bu dosya o türetmeyi veritabanından bağımsız yapar; sorgular ve
 * yazma işi `seller-role.service.ts` içinde.
 *
 * ⚠️ KARAR "HANGİ İŞLEM YAPILDI"YA DEĞİL, "İŞLEMDEN SONRA NE KALDI"YA BAKAR.
 *    Onay/red/askı işlemine göre dallanan bir kural yazmak cazip ama yanlış:
 *    iki mağazası olan bir satıcının birinci mağazası askıya alındığında
 *    "askı → CUSTOMER" kuralı onu ikinci, hâlâ çalışan mağazasından da ederdi.
 *    Tek doğru soru şudur: bu kullanıcının APPROVED durumda bir mağazası
 *    kaldı mı?
 */
import type { Role } from '@vt/db';

/**
 * SATICI AKIŞININ ASLA EZMEDİĞİ ROLLER.
 *
 * ⚠️ `Role` düz bir enum; ADMIN > SELLER_USER > CUSTOMER gibi bir hiyerarşi
 *    YOK. Bu yüzden "yükseltme" ve "düşürme" aynı alanı EZER:
 *      • Kendi mağazasını da açan bir admini SELLER_USER'a çekmek onu yönetim
 *        panelinden atardı.
 *      • O mağaza askıya alındığında CUSTOMER'a çekmek aynı felaketi sessizce
 *        yapardı — üstelik kimse bunu bir hata olarak raporlamaz.
 *    SUPPORT için de aynısı geçerlidir: destek ekibinin bir mağazada üyeliği
 *    olması, destek yetkisini kaybetmesi için sebep değildir.
 *
 *    Yetki KAYBI, yetki fazlasından daha tehlikelidir: fazlalık denetim
 *    kaydında görünür, kayıp ise yalnızca "neden giremiyorum" sorusuyla ve
 *    genelde çok geç fark edilir.
 */
export const PROTECTED_ROLES = ['ADMIN', 'SUPPORT'] as const satisfies readonly Role[];

export function isProtectedRole(role: Role): boolean {
  return (PROTECTED_ROLES as readonly Role[]).includes(role);
}

/** Tek bir kullanıcı için karar girdisi — hepsi işlem SONRASI gerçeklerdir. */
export interface SellerRoleFacts {
  readonly userId: string;
  /** Kullanıcının veritabanındaki güncel rolü. */
  readonly currentRole: Role;
  /**
   * İşlemden SONRA kullanıcının APPROVED durumda en az bir mağazası var mı.
   * ⚠️ "Üyeliği var mı" değil: PENDING/REJECTED/SUSPENDED mağaza üyeliği
   *    satıcı panelini kullanma hakkı vermez.
   */
  readonly hasApprovedMembership: boolean;
}

export interface RoleChange {
  readonly userId: string;
  readonly from: Role;
  readonly to: Role;
  /** Denetim kaydında ve logda okunabilirlik için: hangi yöne gidildi. */
  readonly direction: 'promote' | 'demote';
}

/**
 * Tek kullanıcının rolünü karara bağlar.
 *
 * `null` döner = DOKUNMA. Üç ayrı sebeple olabilir ve üçü de yazma
 * yapılmamasını gerektirir: rol korunan bir roldür, ya da rol zaten doğrudur
 * (gereksiz yazma denetim kaydını ve oturum düşürmeyi de tetiklerdi).
 */
export function decideRoleChange(facts: SellerRoleFacts): RoleChange | null {
  if (isProtectedRole(facts.currentRole)) return null;

  const target: Role = facts.hasApprovedMembership ? 'SELLER_USER' : 'CUSTOMER';
  if (target === facts.currentRole) return null;

  return {
    userId: facts.userId,
    from: facts.currentRole,
    to: target,
    direction: facts.hasApprovedMembership ? 'promote' : 'demote',
  };
}

/** Bir mağazanın tüm üyeleri için karar — değişmeyenler listede yer almaz. */
export function decideRoleChanges(facts: readonly SellerRoleFacts[]): RoleChange[] {
  return facts
    .map((entry) => decideRoleChange(entry))
    .filter((change): change is RoleChange => change !== null);
}
