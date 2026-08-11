import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Roles } from '../auth/auth.guard.js';
import { adminActor } from './audit.js';
import { AdminReportService } from './admin-report.service.js';
import {
  aiUsageQuerySchema,
  auditLogQuerySchema,
  breakGlassSchema,
  fraudQuerySchema,
  gmvQuerySchema,
  type AiUsageQuery,
  type AuditLogQuery,
  type BreakGlassInput,
  type FraudQuery,
  type GmvQuery,
} from './admin.schema.js';

/**
 * RAPOR VE DENETİM UÇLARI.
 *
 * ⚠️ Denetim izi ve break-glass SUPPORT'a KAPALI. Denetim izi "kim neye
 *    baktı" bilgisini de taşır; kendisi de korunması gereken bir kayıttır.
 */
@Controller('admin')
export class AdminReportController {
  constructor(private readonly reports: AdminReportService) {}

  /**
   * AI MALİYET PANELİ — gün/özellik/kullanıcı kırılımı, önbellek isabet oranı
   * ve try-on başına ortalama maliyet.
   */
  @Get('ai/usage')
  @Roles('ADMIN')
  async aiUsage(@Query(zodBody(aiUsageQuerySchema)) query: AiUsageQuery): Promise<unknown> {
    return this.reports.aiCostPanel(query);
  }

  /** GMV — Order + OrderItem'dan; tutarlar bigint (kuruş) kalır. */
  @Get('reports/gmv')
  @Roles('ADMIN')
  async gmv(@Query(zodBody(gmvQuerySchema)) query: GmvQuery): Promise<unknown> {
    return this.reports.gmv(query);
  }

  /** ⚠️ Uyarılar mevcut kayıtlardan TÜRETİLİR; kalıcı bir uyarı tablosu yok. */
  @Get('fraud/alerts')
  @Roles('ADMIN', 'SUPPORT')
  async fraudAlerts(@Query(zodBody(fraudQuerySchema)) query: FraudQuery): Promise<unknown> {
    return this.reports.fraudAlerts(query);
  }

  @Get('audit-log')
  @Roles('ADMIN')
  async auditLog(@Query(zodBody(auditLogQuerySchema)) query: AuditLogQuery): Promise<unknown> {
    return this.reports.auditLog(query);
  }

  /**
   * ⚠️⚠️ BREAK-GLASS — KULLANICI FOTOĞRAFINA ERİŞİM (KVKK).
   *
   * Yöneticinin fotoğraflara serbest erişimi YOKTUR. Bu uç üç şartı birlikte
   * uygular: gerekçe zorunlu (en az 30 karakter), AuditLog kaydı,
   * kullanıcıya bildirim.
   *
   * ⚠️ POST — okuma gibi görünse de yan etkisi var (denetim kaydı + bildirim).
   *    GET yapılsaydı tarayıcı/proxy önbelleğine düşebilir ve daha kötüsü,
   *    gerekçe URL'de taşınırdı; gerekçe log'lara sızmamalı.
   *
   * ⚠️ LİSTELEME UCU YOK: "hangi kullanıcıların fotoğrafı var" sorusunun
   *    yönetim panelinde cevabı olmamalı.
   */
  @Post('users/:userId/photos/break-glass')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async breakGlassPhotoAccess(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Body(zodBody(breakGlassSchema)) body: BreakGlassInput,
  ): Promise<unknown> {
    return this.reports.breakGlassPhotoAccess(adminActor(user), userId, body);
  }
}
