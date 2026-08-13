import type { Metadata } from 'next';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { tarihSaat } from '@/lib/tarih';
import { ImlecSayfalama, SayfaBasligi } from '@/components/panel/duzen';
import { listeOku } from '@/lib/api/okuma';
import { baglanti, tekil, type AramaParametreleri } from '@/lib/sorgu';
import type { AdminAuditLogWire } from '@vt/contracts';

/**
 * DENETİM İZİ.
 *
 * ⚠️ BU EKRAN `SUPPORT`A AÇILMAZ. Denetim izi "kim neye BAKTI" bilgisini de
 *    taşıyor (break-glass kayıtları) ve kendisi de korunması gereken bir
 *    kayıttır; uç zaten `@Roles('ADMIN')`. Panel bugün tamamen ADMIN'e kapalı
 *    olduğu için ek bir kapı gerekmiyor — SUPPORT panele alındığı gün bu rota
 *    ayrıca kapatılmalı (kabuk yorumunda not düşüldü).
 *
 * ⚠️ SATIR SİLİNMEZ, DÜZENLENMEZ ve buna dair bir düğme YOKTUR. Uç yok, olmamalı
 *    da: silinebilir bir denetim izi denetim izi değildir.
 */
export const metadata: Metadata = {
  title: 'Denetim izi',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const YOL = '/admin/audit';
const SAYFA_BOYUTU = 25;

/**
 * Eylem kodu → Türkçe.
 *
 * ⚠️ AYNA (`apps/api/src/modules/admin/audit.ts:52` → `AUDIT_ACTION`) ve tam
 *    kapsam GARANTİ EDİLEMİYOR: `action` telde çıplak `string`, çünkü denetim
 *    kaydını yazan tek yer admin modülü değil (worker da yazabilir). Bu yüzden
 *    eşleşmeyen kod GİZLENMEZ, ham hâliyle basılır — bilinmeyen bir eylemi
 *    "Diğer" diye göstermek, denetim izinin tek işini (ne olduğunu söylemek)
 *    ortadan kaldırırdı.
 */
const EYLEM_ETIKETI: Record<string, string> = {
  'seller.approved': 'Satıcı onaylandı',
  'seller.rejected': 'Satıcı reddedildi',
  'seller.suspended': 'Satıcı askıya alındı',
  'seller.reinstated': 'Satıcı askısı kaldırıldı',
  'product.moderation.approved': 'Ürün yayına alındı',
  'product.moderation.rejected': 'Ürün reddedildi',
  'category.created': 'Kategori oluşturuldu',
  'category.updated': 'Kategori güncellendi',
  'coupon.created': 'Kupon oluşturuldu',
  'coupon.deactivated': 'Kupon pasifleştirildi',
  'commission.rule.created': 'Komisyon kuralı oluşturuldu',
  'commission.rule.version.created': 'Komisyon versiyonu başlatıldı',
  'order.refund.manual.requested': 'Manuel iade talebi',
  'payout.approved': 'Para çekme onaylandı',
  'payout.rejected': 'Para çekme reddedildi',
  'user.photo.break_glass_access': 'Kullanıcı fotoğrafına erişim (break-glass)',
};

const KAYIT_TURLERI = [
  'Seller',
  'Product',
  'Category',
  'Coupon',
  'CommissionRule',
  'Payout',
  'Order',
  'UserPhoto',
] as const;

export default async function DenetimPage({
  searchParams,
}: {
  searchParams: Promise<AramaParametreleri>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const tur = tekil(params.tur);
  const kayitId = tekil(params.kayit);
  const imlec = tekil(params.imlec);
  const sorgu = { tur, kayit: kayitId, imlec };

  const okuma = await listeOku<AdminAuditLogWire, '/admin/audit-log'>(
    '/admin/audit-log',
    baglanti(YOL, sorgu),
    {
      query: {
        entityType: tur ?? undefined,
        // ⚠️ `entityId` şemada en az 2 karakter; kısa girdi 400 döndürürdü.
        entityId: kayitId !== null && kayitId.length >= 2 ? kayitId : undefined,
        cursor: imlec ?? undefined,
        limit: SAYFA_BOYUTU,
      },
    },
  );

  return (
    <section>
      <SayfaBasligi
        baslik="Denetim izi"
        aciklama="Her yönetim kararı buraya yazılır: kim, ne zaman, hangi kaydı, hangi gerekçeyle değiştirdi. Kayıtlar değiştirilemez ve silinemez."
      />

      <form action={YOL} method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Kayıt türü
          <select
            name="tur"
            defaultValue={tur ?? ''}
            className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm"
          >
            <option value="">Tümü</option>
            {KAYIT_TURLERI.map((aday) => (
              <option key={aday} value={aday}>
                {aday}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Kayıt kimliği
          <input
            name="kayit"
            defaultValue={kayitId ?? ''}
            minLength={2}
            maxLength={80}
            placeholder="019ff704-…"
            className="rakam h-9 w-full rounded-md sm:w-72 border border-kenar bg-zemin px-2 text-sm"
          />
        </label>

        <button
          type="submit"
          className="h-9 rounded-md border border-kenar px-3 text-sm hover:bg-yuzey-vurgulu"
        >
          Filtrele
        </button>
      </form>

      {!okuma.tamam ? (
        <SunucuHatasi govde={okuma.hata} />
      ) : okuma.veri.items.length === 0 ? (
        <p className="py-8 text-sm text-metin-soluk">
          Bu filtreyle eşleşen denetim kaydı yok. Filtreleri temizleyip son kayıtlara bakın.
        </p>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH scope="col">Zaman</TH>
                <TH scope="col">Eylem</TH>
                <TH scope="col">Kayıt</TH>
                <TH scope="col">Yönetici</TH>
                <TH scope="col">Gerekçe</TH>
              </TR>
            </THead>
            <TBody>
              {okuma.veri.items.map((kayit) => (
                <TR key={kayit.id} className="align-top">
                  <TD className="whitespace-nowrap py-2 text-metin-soluk">
                    {tarihSaat(kayit.createdAt)}
                  </TD>
                  <TD className="py-2">
                    {/* Eşleşme yoksa ham kod — gerekçe dosya başında. */}
                    {EYLEM_ETIKETI[kayit.action] ?? kayit.action}
                    {/* ⚠️ `<div>`, `<span>` DEĞİL: içindeki `<details>` akış
                        içeriği ve bir `<span>`ın içine konamaz — geçersiz iç
                        içe geçme, React'ta hidrasyon uyarısı üretir. */}
                    <div className="text-xs text-metin-soluk">
                      {/*
                        ⚠️ `before`/`after` KAPALI BİR AÇILIR BLOKTA. Her satırda
                           açık gösterilseydi 25 satırlık tablo JSON duvarına
                           döner ve "kim ne yaptı" sorusu okunmaz olurdu.
                           Yine de GİZLENMİYOR: kararın gerçek içeriği bu iki
                           alanda ve hassas alanlar sunucuda zaten ayıklanmış
                           (`audit.ts` → `SENSITIVE_KEYS`).
                      */}
                      <Degisiklik before={kayit.before} after={kayit.after} />
                    </div>
                  </TD>
                  <TD className="py-2">
                    {kayit.entityType}
                    <span className="rakam block text-xs text-metin-soluk">{kayit.entityId}</span>
                  </TD>
                  <TD className="py-2">
                    {kayit.actorRole}
                    <span className="rakam block text-xs text-metin-soluk">{kayit.actorId}</span>
                    <span className="rakam block text-xs text-metin-soluk">{kayit.ipAddress}</span>
                  </TD>
                  <TD className="max-w-xs py-2 text-metin-soluk">{kayit.reason ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <ImlecSayfalama
            ilkSayfaHref={baglanti(YOL, { ...sorgu, imlec: null })}
            sonrakiHref={
              okuma.veri.nextCursor === null
                ? null
                : baglanti(YOL, { ...sorgu, imlec: okuma.veri.nextCursor })
            }
            ilkSayfada={imlec === null}
          />
        </>
      )}
    </section>
  );
}

function Degisiklik({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}): React.ReactElement | null {
  if (before === null && after === null) return null;

  return (
    <details>
      <summary className="cursor-pointer select-none hover:text-metin">Değişiklik</summary>
      <pre className="rakam mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded-sm bg-yuzey p-2 text-xs">
        {JSON.stringify({ once: before, sonra: after }, null, 2)}
      </pre>
    </details>
  );
}
