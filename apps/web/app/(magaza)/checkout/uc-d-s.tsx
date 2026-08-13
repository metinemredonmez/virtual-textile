'use client';

import * as React from 'react';

/**
 * 3DS ÇERÇEVESİ — bankanın formu.
 *
 * `checkout/pay` sağlayıcının ürettiği TAM bir HTML belgesi döndürüyor
 * (`threeDsHtml`): kendi kendine post eden bir form. Kart verisi bizden
 * GEÇMİYOR; kullanıcı kartını bankanın/sağlayıcının sayfasına giriyor ve biz
 * PCI-DSS kapsamı dışında kalıyoruz.
 *
 * ⚠️ `dangerouslySetInnerHTML` KULLANILMAZ. Belgeyi kendi DOM'umuza gömmek,
 *    üçüncü taraf betiğini KENDİ KÖKENİMİZDE çalıştırmak demektir; o betiğin
 *    `document.cookie`e ve tüm sayfaya erişimi olurdu.
 *
 * ⚠️ `sandbox` içinde `allow-same-origin` YOK ve bu bilinçli: `srcdoc` belgesi
 *    varsayılan olarak ANA SAYFANIN KÖKENİNİ miras alır. `allow-same-origin`
 *    eklenseydi sandbox'ın tek anlamlı koruması kalkar ve bankaya giden form
 *    bizim kökenimizde çalışırdı. Formun kendini post edebilmesi için
 *    `allow-forms` + `allow-scripts` yetiyor; banka sayfası çerçeve içinde
 *    KENDİ kökeninde açılıyor, sandbox onun kendi çerezlerini kullanmasını
 *    engellemiyor.
 *
 * ⚠️ ÖLÇÜLEMEDİ — dürüstçe yazılıyor: bu ortamda ödeme sağlayıcısı bağlı değil
 *    (`createPaymentProvider` yer tutucuya düşüyor, `POST /v1/checkout/pay`
 *    ölçümde `PAYMENT_PROVIDER_DOWN` döndürdü). Yani gerçek bir banka formu bu
 *    çerçevede HİÇ ÇALIŞTIRILMADI. iyzico sandbox kimlikleri tanımlandığında
 *    ilk sınanacak şey burasıdır: bazı bankalar `_top` hedefiyle çerçeveden
 *    çıkmaya çalışır ve o durumda `allow-top-navigation` gerekir.
 */
export function UcDs({
  html,
  orderNumber,
}: {
  html: string;
  orderNumber: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">3D Secure doğrulaması</h2>
        <p className="mt-1 text-sm text-metin-soluk">
          Bankanızın doğrulama adımı aşağıda açıldı. Bu pencereyi kapatmayın; işlem tamamlandığında
          sonuç sayfasına yönlendirileceksiniz. Sipariş numaranız{' '}
          <span className="rakam font-medium text-metin">{orderNumber}</span>.
        </p>
      </div>

      <iframe
        title="3D Secure doğrulama"
        srcDoc={html}
        // ⚠️ `allow-top-navigation`: banka doğrulamayı bitirince tarayıcıyı
        //    `callbackUrl`e gönderiyor. Çerçeve bunu kendi içinde yapabilirse
        //    iyi; yapamayan sağlayıcılar üst pencereyi kullanır ve bu izin
        //    olmadan ödeme sessizce yarım kalır.
        sandbox="allow-forms allow-scripts allow-top-navigation"
        className="h-[32rem] w-full rounded-md border border-kenar bg-zemin"
      />
    </div>
  );
}
