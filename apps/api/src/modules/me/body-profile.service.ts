import { Injectable } from '@nestjs/common';
import type { BodyProfileWire, BodyProfileWriteInput } from '@vt/contracts';
import { PrismaService } from '../../infra/prisma.service.js';

/**
 * VÜCUT ÖLÇÜLERİ — okuma ve yazma.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ VARLIK SEBEBİ: ÖLÇÜLER TOPLANIYORDU AMA HİÇBİR YERE YAZILAMIYORDU.
 *
 *  Ölçüldü: `BodyProfile` tablosuna yazan TEK BİR uç yoktu. Kullanıcı ürün
 *  sayfasında ölçülerini giriyordu (`useBedenOnerisi` → `POST /size/recommend`)
 *  ve o hook'un kendi docblock'u şunu söylüyordu: "bu ölçüler sunucuda
 *  saklanmaz". Yani her ürün sayfasında aynı ölçüler yeniden isteniyordu ve
 *  hiçbiri kalıcı olmuyordu. Motor `profile`ı okuyordu ama o satır hiç
 *  DOLMUYORDU — beden önerisinin en güçlü girdisi boş bir tabloydu.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ KİMLİK HER ZAMAN OTURUMDAN. `userId` parametre olarak geliyor ama
 *    çağıran onu `user.sub`tan veriyor; uçta gövdeden ya da yoldan
 *    OKUNMUYOR. Aksi hâlde kimliği değiştiren biri başkasının vücut
 *    ölçülerini okuyup değiştirebilirdi.
 */
@Injectable()
export class BodyProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async read(userId: string): Promise<BodyProfileWire | null> {
    const satir = await this.prisma.bodyProfile.findUnique({ where: { userId } });
    return satir ? this.tele(satir) : null;
  }

  /**
   * ⚠️ PATCH SEMANTİĞİ, PUT DEĞİL — ve fark burada gerçek bir davranış:
   *
   *    · alan GÖNDERİLMEDİ (`undefined`) → DOKUNULMAZ
   *    · alan `null` GÖNDERİLDİ         → SİLİNİR
   *
   *    Zod şeması `.nullable().optional()` taşıdığı için ikisi telde ayrı
   *    ayrı ifade edilebiliyor. PUT olsaydı, kullanıcı yalnız göğüs ölçüsünü
   *    güncellediğinde gönderilmeyen bel/kalça SİLİNİRDİ — kimse bunu
   *    istemez ve arıza ancak "ölçülerim niye kayboldu" şikâyetiyle görünürdü.
   *
   * ⚠️ `updatedAt` Prisma'nın `@updatedAt`ından gelir; elle yazılmaz.
   */
  async write(userId: string, input: BodyProfileWriteInput): Promise<BodyProfileWire> {
    // ⚠️ `undefined` alanlar nesneden ELENİYOR: Prisma `undefined`ı "dokunma"
    //    diye okur ama açıkça yazmak, bir gün `exactOptionalPropertyTypes`
    //    değişirse davranışın kaymasını engeller.
    const yazilacak = Object.fromEntries(
      Object.entries(input).filter(([, deger]) => deger !== undefined),
    );

    const satir = await this.prisma.bodyProfile.upsert({
      where: { userId },
      create: { userId, ...yazilacak },
      update: yazilacak,
    });
    return this.tele(satir);
  }

  /**
   * ⚠️ TELE ÇEVİRİ ELLE YAZILIYOR, SATIR OLDUĞU GİBİ DÖNDÜRÜLMÜYOR.
   *    `BodyProfile` satırı `userId` taşıyor ve `updatedAt` bir `Date`.
   *    Satırı doğrudan döndürmek (a) kimliği telde gereksiz yere gösterirdi,
   *    (b) `Date`i JSON'a bırakırdı — sözleşme `string` diyor.
   */
  private tele(satir: {
    heightCm: number | null;
    weightKg: number | null;
    chestCm: number | null;
    waistCm: number | null;
    hipCm: number | null;
    shoulderCm: number | null;
    inseamCm: number | null;
    usualSize: string | null;
    fitPref: string | null;
    updatedAt: Date;
  }): BodyProfileWire {
    return {
      heightCm: satir.heightCm,
      weightKg: satir.weightKg,
      chestCm: satir.chestCm,
      waistCm: satir.waistCm,
      hipCm: satir.hipCm,
      shoulderCm: satir.shoulderCm,
      inseamCm: satir.inseamCm,
      usualSize: satir.usualSize,
      fitPref: satir.fitPref as BodyProfileWire['fitPref'],
      updatedAt: satir.updatedAt.toISOString(),
    };
  }
}
