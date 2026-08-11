import { describe, expect, it } from 'vitest';
import { isAppError, type AppError } from '@vt/contracts';
import { ORDER } from '@vt/config';
import type { PackageStatus } from '@vt/db';
import {
  assertOrderCancellable,
  assertPackageCancellable,
  assertPackageTransition,
  canTransitionPackage,
  deriveOrderStatus,
  derivePaymentPhase,
  isTerminalOrderStatus,
  type PackageSnapshot,
} from './order-status.js';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (!isAppError(error)) throw error;
    return (error as AppError).code;
  }
  throw new Error('Hata bekleniyordu ama fırlatılmadı');
};

const pkg = (status: PackageStatus, deliveredAt?: Date): PackageSnapshot => ({
  status,
  deliveredAt: deliveredAt ?? null,
});

const NOW = new Date('2026-08-11T09:00:00.000Z');
const paid = { paymentPhase: 'PAID' as const, now: NOW };
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('deriveOrderStatus — paketlerin bileşkesi', () => {
  it('ödeme tamamlanmadan paketlere bakmaz', () => {
    expect(deriveOrderStatus([pkg('SHIPPED')], { paymentPhase: 'PENDING', now: NOW })).toBe(
      'PENDING_PAYMENT',
    );
    expect(deriveOrderStatus([], { paymentPhase: 'FAILED', now: NOW })).toBe('PAYMENT_FAILED');
    expect(deriveOrderStatus([], { paymentPhase: 'EXPIRED', now: NOW })).toBe('EXPIRED');
  });

  it('ödendi ama paket yaratılmadıysa PAID', () => {
    expect(deriveOrderStatus([], paid)).toBe('PAID');
  });

  it('hepsi hazırlanıyorsa PAID', () => {
    expect(deriveOrderStatus([pkg('AWAITING_APPROVAL'), pkg('PREPARING')], paid)).toBe('PAID');
  });

  it('hepsi kargolandıysa SHIPPED', () => {
    expect(deriveOrderStatus([pkg('SHIPPED'), pkg('SHIPPED')], paid)).toBe('SHIPPED');
  });

  it('bazısı kargolandıysa PARTIALLY_SHIPPED', () => {
    expect(deriveOrderStatus([pkg('SHIPPED'), pkg('PREPARING')], paid)).toBe('PARTIALLY_SHIPPED');
  });

  it('biri teslim biri hazırlanıyorsa PARTIALLY_SHIPPED', () => {
    expect(deriveOrderStatus([pkg('DELIVERED', daysAgo(1)), pkg('AWAITING_APPROVAL')], paid)).toBe(
      'PARTIALLY_SHIPPED',
    );
  });

  it('biri teslim biri kargoda ise SHIPPED — en geride kalan paket belirler', () => {
    expect(deriveOrderStatus([pkg('DELIVERED', daysAgo(1)), pkg('SHIPPED')], paid)).toBe('SHIPPED');
  });

  it('hepsi teslim edildiyse DELIVERED', () => {
    expect(
      deriveOrderStatus([pkg('DELIVERED', daysAgo(1)), pkg('DELIVERED', daysAgo(2))], paid),
    ).toBe('DELIVERED');
  });

  it('hepsi iptal edildiyse CANCELLED', () => {
    expect(deriveOrderStatus([pkg('CANCELLED'), pkg('CANCELLED')], paid)).toBe('CANCELLED');
  });

  it('hepsi iade edildiyse REFUNDED', () => {
    expect(deriveOrderStatus([pkg('RETURNED'), pkg('RETURNED')], paid)).toBe('REFUNDED');
  });

  it('iptal edilen paket bileşkeyi geride tutmaz', () => {
    // A satıcısı iptal etti, B kargoladı: müşteri için sipariş kargolanmıştır.
    expect(deriveOrderStatus([pkg('CANCELLED'), pkg('SHIPPED')], paid)).toBe('SHIPPED');
  });

  it('iade edilen paket teslim seviyesinin ÜSTÜNDEDİR, siparişi geri çekmez', () => {
    expect(deriveOrderStatus([pkg('RETURNED'), pkg('DELIVERED', daysAgo(1))], paid)).toBe(
      'DELIVERED',
    );
  });

  it('açık iade talebi teslim seviyesindedir', () => {
    expect(
      deriveOrderStatus([pkg('RETURN_REQUESTED', daysAgo(1)), pkg('DELIVERED', daysAgo(1))], paid),
    ).toBe('DELIVERED');
  });

  it('ödeme beklerken iptal edilmişse CANCELLED', () => {
    expect(deriveOrderStatus([], { paymentPhase: 'PENDING', cancelled: true, now: NOW })).toBe(
      'CANCELLED',
    );
  });
});

describe('deriveOrderStatus — otomatik tamamlama', () => {
  const stale = daysAgo(ORDER.autoCompleteAfterDays + 1);
  const fresh = daysAgo(ORDER.autoCompleteAfterDays - 1);

  it('iade penceresi kapandıktan sonra COMPLETED', () => {
    expect(deriveOrderStatus([pkg('DELIVERED', stale), pkg('DELIVERED', stale)], paid)).toBe(
      'COMPLETED',
    );
  });

  it('bir paket bile yeni teslim edildiyse DELIVERED kalır', () => {
    expect(deriveOrderStatus([pkg('DELIVERED', stale), pkg('DELIVERED', fresh)], paid)).toBe(
      'DELIVERED',
    );
  });

  it('açık iade varken tamamlanmaz — hakediş ödenmemeli', () => {
    expect(deriveOrderStatus([pkg('DELIVERED', stale), pkg('RETURN_REQUESTED', stale)], paid)).toBe(
      'DELIVERED',
    );
  });

  it('teslim tarihi bilinmiyorsa tamamlanmaz', () => {
    expect(deriveOrderStatus([pkg('DELIVERED')], paid)).toBe('DELIVERED');
  });
});

describe('derivePaymentPhase', () => {
  it('paidAt doluysa PAID', () => {
    expect(
      derivePaymentPhase({
        paidAt: daysAgo(1),
        reservationExpiresAt: daysAgo(2),
        status: 'PAID',
        now: NOW,
      }),
    ).toBe('PAID');
  });

  it('rezervasyon süresi dolduysa EXPIRED', () => {
    expect(
      derivePaymentPhase({
        paidAt: null,
        reservationExpiresAt: daysAgo(1),
        status: 'PENDING_PAYMENT',
        now: NOW,
      }),
    ).toBe('EXPIRED');
  });

  it('PAYMENT_FAILED yapışkandır', () => {
    expect(
      derivePaymentPhase({
        paidAt: null,
        reservationExpiresAt: null,
        status: 'PAYMENT_FAILED',
        now: NOW,
      }),
    ).toBe('FAILED');
  });

  it('varsayılan PENDING', () => {
    expect(
      derivePaymentPhase({
        paidAt: null,
        reservationExpiresAt: new Date(NOW.getTime() + 60_000),
        status: 'PENDING_PAYMENT',
        now: NOW,
      }),
    ).toBe('PENDING');
  });
});

describe('paket geçiş makinesi', () => {
  it('izin verilen geçişleri kabul eder', () => {
    expect(canTransitionPackage('AWAITING_APPROVAL', 'PREPARING')).toBe(true);
    expect(canTransitionPackage('PREPARING', 'SHIPPED')).toBe(true);
    expect(canTransitionPackage('SHIPPED', 'DELIVERED')).toBe(true);
    expect(canTransitionPackage('DELIVERED', 'RETURN_REQUESTED')).toBe(true);
    expect(canTransitionPackage('RETURN_REQUESTED', 'RETURNED')).toBe(true);
    // İade reddi: paket teslim edilmiş hâline döner.
    expect(canTransitionPackage('RETURN_REQUESTED', 'DELIVERED')).toBe(true);
  });

  it('geriye ve atlamalı geçişleri reddeder', () => {
    expect(canTransitionPackage('SHIPPED', 'PREPARING')).toBe(false);
    expect(canTransitionPackage('AWAITING_APPROVAL', 'DELIVERED')).toBe(false);
    expect(canTransitionPackage('RETURNED', 'DELIVERED')).toBe(false);
    expect(canTransitionPackage('CANCELLED', 'PREPARING')).toBe(false);
  });

  it('geçersiz geçişte ORDER_INVALID_TRANSITION fırlatır', () => {
    expect(codeOf(() => assertPackageTransition('SHIPPED', 'PREPARING'))).toBe(
      'ORDER_INVALID_TRANSITION',
    );
  });

  it('kargolanmış paket iptal edilemez: ORDER_NOT_CANCELLABLE', () => {
    expect(codeOf(() => assertPackageCancellable('SHIPPED'))).toBe('ORDER_NOT_CANCELLABLE');
    expect(codeOf(() => assertPackageCancellable('DELIVERED'))).toBe('ORDER_NOT_CANCELLABLE');
    expect(codeOf(() => assertPackageCancellable('RETURNED'))).toBe('ORDER_NOT_CANCELLABLE');
  });

  it('zaten iptal edilmiş paket geçersiz geçiştir', () => {
    expect(codeOf(() => assertPackageCancellable('CANCELLED'))).toBe('ORDER_INVALID_TRANSITION');
  });

  it('hazırlık aşamasındaki paket iptal edilebilir', () => {
    expect(() => assertPackageCancellable('AWAITING_APPROVAL')).not.toThrow();
    expect(() => assertPackageCancellable('PREPARING')).not.toThrow();
  });
});

describe('assertOrderCancellable', () => {
  it('paketi olmayan sipariş iptal edilebilir', () => {
    expect(() => assertOrderCancellable([])).not.toThrow();
  });

  it('hepsi hazırlıktaysa iptal edilebilir', () => {
    expect(() =>
      assertOrderCancellable([pkg('AWAITING_APPROVAL'), pkg('PREPARING')]),
    ).not.toThrow();
  });

  it('tek bir paket kargolandıysa TAMAMI reddedilir', () => {
    expect(codeOf(() => assertOrderCancellable([pkg('PREPARING'), pkg('SHIPPED')]))).toBe(
      'ORDER_NOT_CANCELLABLE',
    );
  });

  it('zaten iptal edilmiş sipariş tekrar iptal edilemez', () => {
    expect(codeOf(() => assertOrderCancellable([pkg('CANCELLED')]))).toBe(
      'ORDER_INVALID_TRANSITION',
    );
  });
});

describe('isTerminalOrderStatus', () => {
  it('kapanmış durumlardan çıkış yoktur', () => {
    expect(isTerminalOrderStatus('COMPLETED')).toBe(true);
    expect(isTerminalOrderStatus('CANCELLED')).toBe(true);
    expect(isTerminalOrderStatus('REFUNDED')).toBe(true);
    expect(isTerminalOrderStatus('EXPIRED')).toBe(true);
    expect(isTerminalOrderStatus('SHIPPED')).toBe(false);
    expect(isTerminalOrderStatus('PAID')).toBe(false);
  });
});
