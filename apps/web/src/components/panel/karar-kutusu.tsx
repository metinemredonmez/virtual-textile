'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldMessage } from '@/components/hata/alan-hatalari';

/**
 * KARAR KUTUSU — geri alınamayan panel kararlarının ORTAK arayüzü: satıcı
 * onayı/reddi/askısı, ürün moderasyonu, payout onayı/reddi.
 *
 * Dört şeyi tek yerde çözer, çünkü dördü de her karar ekranında lazım ve
 * ayrı ayrı yazılsalardı ilk ayrışan yer gerekçe zorunluluğu olurdu:
 *   1. Gerekçe alanı (zorunlu / isteğe bağlı / yok)
 *   2. Çift tıklama koruması
 *   3. `details.fields[]` hatasının gerekçe alanının ALTINA basılması
 *   4. Başarıdan sonra `router.refresh()` ile sunucudan yeniden okuma
 *
 * ⚠️ IDEMPOTENCY ANAHTARI YOK ve OLMAMALI. `core.ts`teki `IdempotentPath`
 *    listesinde yönetim kararlarından yalnız `/admin/payouts/:id/approve` ve
 *    `/admin/orders/:id/refund` var; satıcı ve ürün kararları LİSTEDE DEĞİL,
 *    yani uçlar `Idempotency-Key` beklemiyor. Uydurma bir anahtar göndermek
 *    API'de hiçbir şey yapmaz ama burada "korumalı" yanılsaması üretirdi.
 *    Çift tıklamanın gerçek koruması iki katmanlı: bu bileşendeki `calisiyor`
 *    kilidi ve sunucudaki `lockAndRead` + geçiş makinesi (ikinci istek
 *    `DUPLICATE_RESOURCE` alır, veri bozulmaz).
 *
 * ⚠️ `otomatikTekrarla()` BURADA KULLANILMAZ. Bu uçlar idempotent değil;
 *    otomatik tekrar, kararın ikinci kez denenmesi demek — ve karar
 *    denetim kaydı yazan, satıcıya bildirim gönderen bir işlem.
 */

export interface Karar {
  anahtar: string;
  /** Düğme metni — fiil, emir kipi: "Onayla", "Reddet". */
  etiket: string;
  /** Geri alınamayan / olumsuz sonuç doğuran karar. Renk BURADA durum taşıyor. */
  yikici?: boolean;
  gerekce: 'zorunlu' | 'istege-bagli' | 'yok';
  /** Gerekçe alanının başlığı — ne yazılacağını söyler. */
  gerekceEtiketi?: string;
  /** Formu onaylayan düğmenin metni. */
  onayEtiketi: string;
  /** Kararın gerçekten uygulanmasını engelleyen ön koşul; doluysa düğme kapalı. */
  engel?: string | null;
  calistir: (gerekce: string) => Promise<void>;
}

/** `reasonSchema` (`admin.schema.ts:22`) ile aynı sınırlar. */
const GEREKCE_ASGARI = 10;
const GEREKCE_AZAMI = 500;

export function KararKutusu({ kararlar }: { kararlar: readonly Karar[] }): React.ReactElement {
  const router = useRouter();
  const [acik, setAcik] = React.useState<string | null>(null);
  const [gerekce, setGerekce] = React.useState('');
  const [calisiyor, setCalisiyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);

  const secili = kararlar.find((karar) => karar.anahtar === acik) ?? null;

  function ac(karar: Karar): void {
    setHata(null);
    setGerekce('');
    // Gerekçe istemeyen karar tek tıkla gider; araya boş bir form koymak
    // "onayladım mı" sorusunu ikinci kez sordurmaktan başka işe yaramaz.
    if (karar.gerekce === 'yok') void gonder(karar, '');
    else setAcik(karar.anahtar);
  }

  async function gonder(karar: Karar, metin: string): Promise<void> {
    setCalisiyor(true);
    setHata(null);
    try {
      await karar.calistir(metin);
      setAcik(null);
      setGerekce('');
      // ⚠️ Sunucudan yeniden okumak ZORUNLU: karar yanıtı yalnız yeni durumu
      //    döndürüyor, ekrandaki satırın geri kalanını (denetim izi, ürün
      //    sayısı, geçiş hakları) taşımıyor. Elle güncellemek ekranı gerçekle
      //    ayrıştırırdı.
      router.refresh();
    } catch (yakalanan) {
      setHata(yakalanan);
    } finally {
      setCalisiyor(false);
    }
  }

  const kisa = secili?.gerekce === 'zorunlu' && gerekce.trim().length < GEREKCE_ASGARI;
  const alanHatalari = isApiFailure(hata) ? hata.fields : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {kararlar.map((karar) => (
          <Button
            key={karar.anahtar}
            size="sm"
            variant={karar.yikici ? 'tehlike' : 'ikincil'}
            disabled={calisiyor || Boolean(karar.engel)}
            title={karar.engel ?? undefined}
            onClick={() => ac(karar)}
          >
            {karar.etiket}
          </Button>
        ))}
      </div>

      {/*
        ⚠️ ENGEL METNİ DÜĞMENİN YANINDA DURUR, `title` ile GİZLENMEZ. Ürün
           onayının iki ön koşulu (`aiTagsApproved`, en az bir görsel) sunucuda
           400 üretiyor; sebebini yalnız fare üstüne gelince göstermek,
           yöneticinin düğmeye basıp hatayı görmesini beklemekle aynı şey.
      */}
      {kararlar
        .filter((karar) => karar.engel)
        .map((karar) => (
          <p key={`engel-${karar.anahtar}`} className="text-xs text-metin-soluk">
            {karar.etiket}: {karar.engel}
          </p>
        ))}

      {secili ? (
        <form
          className="flex flex-col gap-2 rounded-md border border-kenar bg-yuzey p-3"
          onSubmit={(olay) => {
            olay.preventDefault();
            void gonder(secili, gerekce.trim());
          }}
        >
          <label htmlFor="karar-gerekce" className="text-sm font-medium">
            {secili.gerekceEtiketi ?? 'Gerekçe'}
            {secili.gerekce === 'istege-bagli' ? (
              <span className="ml-1 font-normal text-metin-soluk">(isteğe bağlı)</span>
            ) : null}
          </label>

          {/*
            ⚠️ ASGARİ UZUNLUK BURADA DA DENETLENİYOR ama KARAR SUNUCUNUN:
               `reasonSchema` 10-500 karakter istiyor ve reddi 400 ile döner.
               Buradaki denetim o isteği hiç göndermemek için var; sunucudakinin
               yerine geçmez ve geçemez.

            ⚠️ `outline-none` YOK ve KONULMAYACAK. Burada duruyordu ve
               `globals.css`teki `:focus-visible { outline: 2px solid var(--vurgu) }`
               kuralını sessizce eziyordu: Tailwind v4'te `utilities` katmanı
               `base` katmanını yener. ÖLÇÜLDÜ (üretim CSS'i, klavye ile Tab):
               element `:focus-visible` durumundayken `outlineStyle: "none"` —
               yani odak buradayken ekranda hiçbir işaret yok, üstelik
               `autoFocus` odağı DOĞRUDAN buraya atıyor.
               Ağırlığı bu dosyanın PAYLAŞILAN olmasından geliyor: bu alan
               satıcı onay/red, ürün moderasyonu, payout kararı ve iade kararı
               ekranlarının HEPSİNDE çıkıyor — geri alınamaz her kararın
               gerekçesi klavye kullanıcısına görünmez bir alana yazılıyordu.
               WCAG 2.4.7 (Seviye A).
               `outline-none` ancak halkayı TAŞIYAN bir kabukla birlikte
               yazılabilir (`has-[:focus-visible]:outline-2` — örnek:
               `(magaza)/urunler/_liste/arama-kutusu.tsx`). Burada kabuk yok,
               kontrolün kendisi görünen kutu; halka doğrudan ona çizilir.
          */}
          <textarea
            id="karar-gerekce"
            rows={3}
            maxLength={GEREKCE_AZAMI}
            value={gerekce}
            autoFocus
            onChange={(olay) => setGerekce(olay.target.value)}
            className="w-full rounded-md border border-kenar bg-zemin p-2 text-sm placeholder:text-metin-soluk"
            placeholder="Bu karar denetim kaydına ve satıcıya gönderilen bildirime yazılır."
          />

          <p className="rakam text-xs text-metin-soluk">
            {gerekce.trim().length} / {GEREKCE_AZAMI}
            {secili.gerekce === 'zorunlu' ? ` · en az ${GEREKCE_ASGARI} karakter` : ''}
          </p>

          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant={secili.yikici ? 'tehlike' : 'birincil'}
              disabled={calisiyor || kisa}
            >
              {calisiyor ? 'Gönderiliyor…' : secili.onayEtiketi}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="sessiz"
              disabled={calisiyor}
              onClick={() => {
                setAcik(null);
                setHata(null);
              }}
            >
              Vazgeç
            </Button>
          </div>
        </form>
      ) : null}

      {/*
        ⚠️ ALAN HATASI ÖNCE, ZARF MESAJI SONRA — ve ikisi birden gösterilir.
           Geçersiz geçişte `error.message` yalnız "Gönderilen bilgiler geçersiz."
           diyor; hangi geçişin neden reddedildiğini SADECE
           `details.fields[0].message` söylüyor ("Bu mağaza APPROVED
           durumundayken bu işlem yapılamaz."). Yalnız zarf mesajı basılsaydı
           yönetici hiçbir şey öğrenemezdi.
      */}
      {alanHatalari.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-metin">
          {alanHatalari.map((alan) => (
            <li key={alan.path}>{fieldMessage(alan)}</li>
          ))}
        </ul>
      ) : null}

      {hata !== null ? <HataGosterimi error={hata} /> : null}
    </div>
  );
}
