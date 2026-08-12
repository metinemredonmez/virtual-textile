import type { NotificationTemplate, TemplateKey, TemplateRegistry } from '../template.js';
import { TR_TEMPLATES } from './tr.js';

/**
 * ŞABLON KAYIT DEFTERİ
 *
 * Tek dil (tr) var; yine de bir arayüzün arkasında duruyor. Sebep test:
 * şablon doldurma kuralları gerçek metinlerden BAĞIMSIZ doğrulanabilmeli,
 * yoksa her metin düzeltmesi testleri kırar ve testler zamanla metnin
 * kopyasına dönüşür.
 */
export const TR_TEMPLATE_REGISTRY: TemplateRegistry = {
  get: (key: TemplateKey): NotificationTemplate | undefined => TR_TEMPLATES[key],
};

/** Bir şablonun hangi kanalları desteklediği — çağıran taraf buna göre seçer. */
export function templateChannels(key: TemplateKey): readonly ('SMS' | 'EMAIL')[] {
  const template = TR_TEMPLATES[key];
  return [
    ...(template.sms ? (['SMS'] as const) : []),
    ...(template.email ? (['EMAIL'] as const) : []),
  ];
}

export { TR_TEMPLATES } from './tr.js';
