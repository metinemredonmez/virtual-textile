import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { NotificationModule } from '../notification/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { PasswordService } from './password.service.js';
import { OtpService } from './otp.service.js';
import { JwtAuthGuard, RolesGuard, SellerScopeGuard } from './auth.guard.js';

@Module({
  // Gizli anahtar imzalama anında env()'den okunur; burada sabitlenmez.
  // ⚠️ NotificationModule: OTP kodunu kullanıcıya ULAŞTIRAN bağ. Bu import
  //    olmadan `/auth/otp/send` kodu üretir ama kimseye göndermez.
  imports: [JwtModule.register({}), NotificationModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    OtpService,
    {
      provide: TokenService,
      inject: [JwtService, PrismaService, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof TokenService>) =>
        new TokenService(...args),
    },
    {
      provide: AuthService,
      inject: [PrismaService, PasswordService, TokenService, OtpService, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof AuthService>) => new AuthService(...args),
    },
    SellerScopeGuard,
    // ⚠️ Kimlik doğrulama VARSAYILAN OLARAK AÇIK.
    // Bir uç açıkça @Public() ile işaretlenmediyse token ister. Tersi tehlikeli
    // olurdu: yeni uç eklerken guard koymayı unutmak onu herkese açık bırakırdı.
    {
      provide: APP_GUARD,
      inject: [TokenService, Reflector],
      useFactory: (tokens: TokenService, reflector: Reflector) =>
        new JwtAuthGuard(tokens, reflector),
    },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenService, AuthService, SellerScopeGuard],
})
export class AuthModule {}
