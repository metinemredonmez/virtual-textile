import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import type { Role } from '@vt/db';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.guard.js';
import {
  MeService,
  type AccountDeletionView,
  type ConsentListView,
  type ConsentWriteView,
  type DataExportView,
} from './me.service.js';
import {
  accountDeletionSchema,
  consentWriteSchema,
  type AccountDeletionInput,
  type ConsentWriteInput,
} from './me.schema.js';

/**
 * ═════════════════════ KVKK md.11 — "HESABIM" UÇLARI ════════════════════════
 *
 * ⚠️ SINIF DÜZEYİNDE `@Public()` YOK ve OLMAMALI. Buradaki her uç, isteği
 *    yapanın VERİ SAHİBİ olduğu varsayımıyla çalışır: kullanıcı kimliği HER
 *    ZAMAN oturumdan (`user.sub`) okunur, gövdeden veya yoldan ASLA.
 *    Bir `userId` parametresi kabul edilseydi, kimliği değiştiren biri
 *    başkasının rıza geçmişini okuyabilir, verisini indirebilir ya da hesabını
 *    sildirebilirdi.
 *
 * ⚠️ Misafirin rızası kanıtlanamaz (`ConsentRecord.userId` zorunlu), bu yüzden
 *    rıza uçlarının public olması teknik olarak da anlamsızdır.
 */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /**
   * Rıza durumları ve TAM GEÇMİŞ.
   *
   * Geçmiş de dönüyor: "ne zaman verildi, ne zaman geri çekildi" sorusunun
   * kullanıcı tarafından her an cevaplanabilmesi KVKK gereğidir.
   */
  @Get('consents')
  async consents(@CurrentUser() user: JwtPayload): Promise<ConsentListView> {
    return this.me.listConsents(user.sub);
  }

  /**
   * Rıza verir veya geri çeker.
   *
   * ⚠️ APPEND-ONLY: geri çekme mevcut satırı GÜNCELLEMEZ, `granted=false` olan
   *    yeni bir satır yazar. Bu yüzden uç PUT/PATCH değil POST'tur — kaynak
   *    güncellenmiyor, geçmişe yeni bir olay ekleniyor.
   *
   * ⚠️ `@Idempotent()` KULLANILMADI ve bu bilinçli: her çağrı ayrı bir irade
   *    beyanıdır ve kendi zamanı/IP'siyle kaydedilmelidir. Tekrarlanan istek
   *    "zaten yaptın" diye reddedilseydi, kullanıcının rızayı geri çekme
   *    girişimi bir önbellek yüzünden sessizce düşebilirdi.
   */
  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  async recordConsent(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(consentWriteSchema)) body: ConsentWriteInput,
  ): Promise<ConsentWriteView> {
    return this.me.recordConsent({ userId: user.sub, role: user.role as Role }, body);
  }

  /** Bekleyen veya hazır veri indirme talebinin durumu. */
  @Get('data-export')
  async dataExportStatus(@CurrentUser() user: JwtPayload): Promise<DataExportView> {
    return this.me.getDataExport(user.sub);
  }

  /**
   * Veri indirme talebi açar.
   *
   * ⚠️ 202 — SENKRON ÇALIŞMAZ. Arşiv worker tarafından hazırlanır, bağlantı
   *    kullanıcıya gönderilir ve 48 saat geçerlidir. Uç dosya DÖNMEZ: tüm
   *    tabloları tarayıp arşivleyen bir işi HTTP isteği içinde çalıştırmak,
   *    isteği zaman aşımına, işi de yarıda kalmaya mahkûm ederdi.
   */
  @Post('data-export')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestDataExport(@CurrentUser() user: JwtPayload): Promise<DataExportView> {
    return this.me.requestDataExport({ userId: user.sub, role: user.role as Role });
  }

  /**
   * Hesap silme TALEBİ.
   *
   * ⚠️ 202 ve "DELETED" değil "PENDING_DELETION" döner — çünkü hiçbir şey
   *    silinmedi. 30 günlük geri alma penceresi başlar; kullanıcı bu sürede
   *    giriş yaparsa talep iptal olur. Talep anında tüm oturumları düşer.
   *
   * ⚠️ `@Delete()` gövde kabul ediyor: sebep isteğe bağlı ve sabit listeden.
   *    Gövdesiz de çağrılabilmesi için şemanın tüm alanları optional.
   */
  @Delete()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestAccountDeletion(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(accountDeletionSchema)) body: AccountDeletionInput,
  ): Promise<AccountDeletionView> {
    return this.me.requestAccountDeletion(
      { userId: user.sub, role: user.role as Role },
      body.reason ?? null,
    );
  }
}
