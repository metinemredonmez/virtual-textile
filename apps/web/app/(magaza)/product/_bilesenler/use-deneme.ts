'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiFailure,
  ERROR_CATALOG,
  isApiFailure,
  isErrorCode,
  PERMANENT_TRYON_FAILURE_CODES,
  type OutfitStepWire,
  type OutfitTryOnResultWire,
  type TryOnCreateResponseWire,
  type ErrorCode,
  type UploadTicketWire,
  type UserPhotoWire,
} from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { assertNever, useTryOnJob } from '@/components/tryon/use-tryon-job';
import { denemeImzasi, type Parca } from './parca';

/**
 * ═══════════════════ SANAL DENEME AKIŞININ TEK YÖNETİCİSİ ═══════════════════
 *
 * Fotoğraf, rıza, üretim ve yoklama TEK yerde durur. Ekrana dağıtılsaydı rıza
 * hatası iki ayrı yerden (fotoğraf yükleme ve deneme başlatma) gelebildiği için
 * biri ele alınır, diğeri unutulurdu — bu depoda üç kez yaşanan "yazıldı ama
 * hiçbir yerden çağrılmadı" hatasının aynı ailesi.
 *
 * ⚠️ SIRA SUNUCUNUN SIRASIDIR, tahmin edilmez:
 *      POST /me/photos          → CONSENT_REQUIRED (PHOTO_PROCESSING)
 *      PUT  imzalı R2 adresi    → dosya vekilden GEÇMEZ
 *      POST /me/photos/:id/confirm
 *      POST /tryon | /tryon/outfit → CONSENT_CROSS_BORDER_REQUIRED
 *    Rızayı önden "acaba var mı" diye sormuyoruz: her deneme öncesi bir okuma
 *    isteği daha atmak, üstelik kullanıcı zaten onaylamışken, bedava değil.
 *    Kapıyı sunucu açıyor; arayüz yalnızca hangi kapının kapalı olduğunu okuyor.
 */

/** ⚠️ Tek üründe boş; kombinde katman başına bir adım. `reused` olan çizilmez. */
export interface DenemeSonucu {
  jobId: string;
  /** ⚠️ İMZALI, ömrü 900 sn. `mediaUrl()`den GEÇMEZ, doğrudan kullanılır. */
  gorselUrl: string | null;
  gorselGuveni: number | null;
  dusukGuven: boolean;
  adimlar: readonly OutfitStepWire[];
  /**
   * Yarım kombin: giydirilemeyen parça. ⚠️ Bu bir HATA DEĞİL, sonucun kendisi —
   * sunucu 200 döndürüyor. Hata gibi gösterip görseli saklamak, kullanıcının
   * ödediği üç katmanı çöpe atmak olurdu.
   */
  eksikVaryantId: string | null;
}

export type DenemeAsamasi =
  | { tur: 'bos' }
  | { tur: 'gonderiliyor' }
  | { tur: 'uretiliyor'; jobId: string; adimlar: readonly OutfitStepWire[] }
  | { tur: 'sonuc'; sonuc: DenemeSonucu }
  /** `kalici` → "Tekrar dene" GÖSTERİLMEZ; üçüncü denemede de aynı duvar. */
  | { tur: 'hata'; hata: unknown; kalici: boolean };

/**
 * ⚠️ MODÜL DÜZEYİNDE ÖNBELLEK — bileşen state'i DEĞİL.
 *
 * Kullanıcı karuselde ileri geri gezerken bileşen yeniden bağlanabilir
 * (yönlendirme, ürün detayına gidip dönme). State'te tutulan sonuç orada
 * kaybolur ve HAZIR bir görsel için ikinci kez üretim başlatılırdı. Bu bir
 * "global durum" değil, sunucu yanıtının bellekteki kopyasıdır; tek yazarı
 * aşağıdaki `uret()` fonksiyonudur.
 */
const SONUC_ONBELLEGI = new Map<string, DenemeSonucu>();

/**
 * ⚠️ `estimatedSeconds` YALNIZCA POST yanıtında var; `GET /tryon/:jobId` onu
 *    DÖNDÜRMEZ. jobId ile anahtarlanıp burada tutulmazsa ilerleme çubuğu her
 *    yeniden bağlanmada sıfırlanır ve kullanıcı süreyi bilmez — belirsiz dönen
 *    çarkın ta kendisi.
 */
const TAHMIN_ONBELLEGI = new Map<string, number>();

/**
 * ⚠️ KOMBİN İMZASI BAŞINA TEK ANAHTAR. Aynı kombini tekrar denemek (ağ hatası,
 *    rıza sonrası tekrar) AYNI anahtarla gider; sunucu ikinci üretimi açmaz.
 *    Yeni anahtar yalnızca kullanıcı "Tekrar dene" dediğinde üretilir — yani
 *    yeni bir NİYET olduğunda.
 */
const ANAHTAR_ONBELLEGI = new Map<string, string>();

/**
 * ⚠️ Fotoğraf kimliği modül düzeyinde tutulur: `GET /me/photos` diye bir uç YOK,
 *    yani bu kimliği bilen tek yer istemci. Sekme yenilenirse kaybolur ve
 *    kullanıcı yeniden yükler — kabul edilen bedel. `sessionStorage` bilinçli
 *    olarak kullanılmadı: kişisel veriye işaret eden bir kimlik, diske yazılıp
 *    sekme kapansa bile kalmamalı.
 */
let SON_FOTOGRAF: { id: string; gecerlilikSonu: number } | null = null;

function gecerliFotograf(): string | null {
  if (!SON_FOTOGRAF) return null;
  if (SON_FOTOGRAF.gecerlilikSonu <= Date.now()) {
    SON_FOTOGRAF = null;
    return null;
  }
  return SON_FOTOGRAF.id;
}

/**
 * İş kaydındaki hata kodunu gösterilebilir bir zarfa çevirir.
 *
 * ⚠️ `TryOnJobWire` MESAJ TAŞIMIYOR, yalnızca kod. Katalog metni burada
 *    kullanılıyor ama YER TUTUCULU olanlar ELENİYOR: `PHOTO_QUALITY_LOW`
 *    metni `{reason}` içeriyor ve `ApiFailure` bilinçli olarak interpolasyon
 *    yapmıyor — doldurulmamış metni ekrana basmak, hatanın kendisinden kötü.
 *    Kalıcı çözüm sunucuda: `GET /tryon/:jobId` yanıtına `errorMessage` eklenmeli.
 */
function isHatasi(errorCode: string | null, referans: string): ApiFailure {
  const kod = errorCode ?? 'TRYON_PROVIDER_ERROR';
  const tanim = isErrorCode(kod) ? ERROR_CATALOG[kod] : null;
  const yerTutuculu = tanim ? tanim.message.includes('{') : false;

  return new ApiFailure({
    // ⚠️ Katalogda olmayan kod tolere edilir (sürüm sapması): `ApiFailure`
    //    kodu olduğu gibi taşır ve `family` `undefined` kalır.
    code: kod as ErrorCode,
    message:
      tanim && !yerTutuculu
        ? tanim.message
        : 'Sanal deneme tamamlanamadı. Farklı bir fotoğrafla tekrar deneyebilirsiniz.',
    httpStatus: tanim?.status ?? 500,
    retryable: tanim?.retryable ?? false,
    requestId: referans,
  });
}

const KALICI_KODLAR: readonly string[] = PERMANENT_TRYON_FAILURE_CODES;

/** Bekleyen niyet: rıza modalı kapandıktan sonra kaldığı yerden devam eder. */
type Bekleyen = { tur: 'yukle'; dosya: File } | { tur: 'uret' } | null;

export interface DenemeDurumu {
  asama: DenemeAsamasi;
  /** 0–95; SUCCEEDED'da 100. ⚠️ %95'te durur, dolu çubuk yanıltır. */
  ilerleme: number;
  /** Kesmeye takıldı — yoklama durdu, kullanıcıya elle kontrol sunulur. */
  zamanAsimi: boolean;
  tahminSaniye: number;
  fotografVar: boolean;
  fotografAcik: boolean;
  fotografYukleniyor: boolean;
  fotografHatasi: unknown;
  rizaKodu: 'CONSENT_REQUIRED' | 'CONSENT_CROSS_BORDER_REQUIRED' | null;
  dene: () => void;
  tekrarDene: () => void;
  yeniFotograf: () => void;
  durumuKontrolEt: () => void;
  fotografGonder: (dosya: File) => void;
  fotografKapat: () => void;
  rizaOnaylandi: () => void;
  rizaKapat: () => void;
}

export function useDeneme(
  parcalar: readonly Parca[],
  mod: 'FAST' | 'QUALITY' = 'FAST',
): DenemeDurumu {
  const [fotografId, setFotografId] = useState<string | null>(() => gecerliFotograf());
  const [fotografAcik, setFotografAcik] = useState(false);
  const [fotografYukleniyor, setFotografYukleniyor] = useState(false);
  const [fotografHatasi, setFotografHatasi] = useState<unknown>(null);
  const [rizaKodu, setRizaKodu] = useState<DenemeDurumu['rizaKodu']>(null);

  /**
   * ⚠️ İmza BAŞINA aşama. Kullanıcı karuselde başka bir parçaya geçtiğinde
   *    çalışan iş KAYBOLMAZ; geri döndüğünde yoklama kaldığı yerden sürer.
   *    Tek bir `asama` state'i tutulsaydı parça değiştirmek çalışan üretimi
   *    görünmez yapardı ve kullanıcı ikinci kez üretim başlatırdı.
   */
  const [asamalar, setAsamalar] = useState<ReadonlyMap<string, DenemeAsamasi>>(() => new Map());
  const bekleyen = useRef<Bekleyen>(null);

  const imza = fotografId ? denemeImzasi(fotografId, parcalar, mod) : null;

  const yaz = useCallback((anahtar: string, asama: DenemeAsamasi): void => {
    setAsamalar((onceki) => new Map(onceki).set(anahtar, asama));
  }, []);

  /**
   * ⚠️ AŞAMA RENDER SIRASINDA TÜRETİLİR, effect ile senkronlanmaz.
   *
   * Hazır sonuç her şeyi ezer: bir imza için sonuç varsa o imza bitmiştir.
   * Effect ile senkronlanan bir türev, parça değişimi ile üretim başlangıcının
   * yarışmasına açık olurdu ve kaybeden taraf ekranda "boş" olarak görünürdü.
   */
  const onbelleklenmis = imza ? SONUC_ONBELLEGI.get(imza) : undefined;
  const kayitli = imza ? asamalar.get(imza) : undefined;

  const temelAsama: DenemeAsamasi = React.useMemo(
    () => (onbelleklenmis ? { tur: 'sonuc', sonuc: onbelleklenmis } : (kayitli ?? { tur: 'bos' })),
    [onbelleklenmis, kayitli],
  );

  const aktifJobId = temelAsama.tur === 'uretiliyor' ? temelAsama.jobId : null;
  const tahminSaniye = aktifJobId ? (TAHMIN_ONBELLEGI.get(aktifJobId) ?? 0) : 0;
  const { job, progress, timedOut, refetch } = useTryOnJob(aktifJobId, tahminSaniye, mod);

  /**
   * Yoklama sonucu aşamanın ÜSTÜNE bindirilir — yine türetme, yine effect yok.
   *
   * ⚠️ `switch` `assertNever` ile kapalı: durum union'ı ALTI değerli ve yeni bir
   *    değer eklenirse burası DERLENMEZ. Dört değerlik bir switch yazan istemcide
   *    `FAILED_PERMANENT` hiçbir dalı tutmaz ve kullanıcı sonsuza kadar bekler.
   */
  const asama: DenemeAsamasi = React.useMemo(() => {
    if (temelAsama.tur !== 'uretiliyor' || !job || job.jobId !== temelAsama.jobId) {
      return temelAsama;
    }

    switch (job.status) {
      case 'QUEUED':
      case 'RUNNING':
        return temelAsama;

      case 'SUCCEEDED':
        return {
          tur: 'sonuc',
          sonuc: {
            jobId: job.jobId,
            gorselUrl: job.resultUrl,
            gorselGuveni: job.visualConfidence,
            dusukGuven: job.lowConfidence,
            // Kombinde adımlar POST yanıtından gelmişti; yoklama onları taşımıyor.
            adimlar: temelAsama.adimlar,
            eksikVaryantId: null,
          },
        };

      case 'FAILED':
      case 'CANCELLED':
        return { tur: 'hata', hata: isHatasi(job.errorCode, job.jobId), kalici: false };

      case 'FAILED_PERMANENT':
        return { tur: 'hata', hata: isHatasi(job.errorCode, job.jobId), kalici: true };

      default:
        return assertNever(job.status);
    }
  }, [temelAsama, job]);

  /**
   * ⚠️ Bu effect state YAZMAZ; yalnızca modül önbelleklerini günceller.
   *    Türetme render'da yapıldığı için burada yapılacak tek iş, sonucu
   *    kalıcılaştırmak ve başarısız denemenin anahtarını düşürmektir —
   *    aynı anahtarla gidilen bir tekrar, idempotency katmanının başarısız
   *    yanıtı 24 saat geri oynatması demek olurdu.
   */
  useEffect(() => {
    if (!imza) return;
    if (asama.tur === 'sonuc') SONUC_ONBELLEGI.set(imza, asama.sonuc);
    if (asama.tur === 'hata') ANAHTAR_ONBELLEGI.delete(imza);
  }, [imza, asama]);

  /** POST yanıtını aşamaya çevirir; iki uç da (tek/kombin) buradan geçer. */
  const yanitiIsle = useCallback(
    (anahtar: string, yanit: TryOnCreateResponseWire | OutfitTryOnResultWire): void => {
      if ('cached' in yanit) {
        if (yanit.cached) {
          // ⚠️ Dallanma HTTP koduyla DEĞİL `cached` ile: önbellek isabetinde uç
          //    200 + HAZIR sonuç döner; 202 varsayan istemci hazır bir görseli
          //    boşuna yoklar.
          const sonuc: DenemeSonucu = {
            jobId: yanit.jobId,
            gorselUrl: yanit.resultUrl,
            gorselGuveni: yanit.visualConfidence,
            dusukGuven: yanit.lowConfidence,
            adimlar: [],
            eksikVaryantId: null,
          };
          SONUC_ONBELLEGI.set(anahtar, sonuc);
          yaz(anahtar, { tur: 'sonuc', sonuc });
          return;
        }

        TAHMIN_ONBELLEGI.set(yanit.jobId, yanit.estimatedSeconds);
        yaz(anahtar, { tur: 'uretiliyor', jobId: yanit.jobId, adimlar: [] });
        return;
      }

      switch (yanit.outcome) {
        case 'CACHED': {
          const sonuc: DenemeSonucu = {
            jobId: yanit.jobId,
            gorselUrl: yanit.resultUrl,
            gorselGuveni: yanit.visualConfidence,
            dusukGuven: yanit.lowConfidence,
            adimlar: yanit.steps,
            eksikVaryantId: null,
          };
          SONUC_ONBELLEGI.set(anahtar, sonuc);
          yaz(anahtar, { tur: 'sonuc', sonuc });
          return;
        }

        case 'PARTIAL': {
          // ⚠️ Yarım kombin GÖSTERİLİR. Sunucu 200 döndürüyor; bu başarısız bir
          //    istek değil, sonucun kendisi.
          const sonuc: DenemeSonucu = {
            jobId: yanit.jobId,
            gorselUrl: yanit.resultUrl,
            gorselGuveni: yanit.visualConfidence,
            dusukGuven: yanit.lowConfidence,
            adimlar: yanit.steps,
            eksikVaryantId: yanit.missing.variantId,
          };
          SONUC_ONBELLEGI.set(anahtar, sonuc);
          yaz(anahtar, { tur: 'sonuc', sonuc });
          return;
        }

        case 'QUEUED':
          TAHMIN_ONBELLEGI.set(yanit.jobId, yanit.estimatedSeconds);
          yaz(anahtar, { tur: 'uretiliyor', jobId: yanit.jobId, adimlar: yanit.steps });
          return;

        case 'FAILED': {
          ANAHTAR_ONBELLEGI.delete(anahtar);
          const kod = yanit.errorCode ?? 'TRYON_PROVIDER_ERROR';
          yaz(anahtar, {
            tur: 'hata',
            hata: isHatasi(kod, yanit.failedVariantId),
            kalici: KALICI_KODLAR.includes(String(kod)),
          });
          return;
        }

        default:
          assertNever(yanit);
      }
    },
    [yaz],
  );

  const hatayiIsle = useCallback(
    (anahtar: string, error: unknown): void => {
      // ⚠️ RIZA HATASI HATA OLARAK GÖSTERİLMEZ, AKIŞ AÇAR. İki kod AYRI:
      //    ikisini tek modala bağlayan istemci kullanıcıyı döngüde bırakır.
      if (isApiFailure(error)) {
        if (error.code === 'CONSENT_REQUIRED' || error.code === 'CONSENT_CROSS_BORDER_REQUIRED') {
          bekleyen.current = { tur: 'uret' };
          setRizaKodu(error.code);
          // ⚠️ Anahtar KORUNUR: rıza sonrası AYNI istek tekrarlanır.
          yaz(anahtar, { tur: 'bos' });
          return;
        }
      }

      ANAHTAR_ONBELLEGI.delete(anahtar);
      const kod = isApiFailure(error) ? error.code : '';
      yaz(anahtar, { tur: 'hata', hata: error, kalici: KALICI_KODLAR.includes(kod) });
    },
    [yaz],
  );

  const uret = useCallback(
    async (kimlik: string): Promise<void> => {
      const anahtar = denemeImzasi(kimlik, parcalar, mod);

      // ⚠️ ÖNBELLEK İSABETİ: ağ isteği YOK. Kullanıcı karuselde geri döndüğünde
      //    hazır görsel anında çıkar ve ikinci bir üretim faturası doğmaz.
      const hazir = SONUC_ONBELLEGI.get(anahtar);
      if (hazir) {
        yaz(anahtar, { tur: 'sonuc', sonuc: hazir });
        return;
      }

      let idempotencyKey = ANAHTAR_ONBELLEGI.get(anahtar);
      if (!idempotencyKey) {
        idempotencyKey = newIdempotencyKey();
        ANAHTAR_ONBELLEGI.set(anahtar, idempotencyKey);
      }

      yaz(anahtar, { tur: 'gonderiliyor' });

      try {
        const tekParca = parcalar.length === 1 ? parcalar[0] : null;

        if (tekParca) {
          // Tek parça kombin ucuna GİTMEZ: sunucu en az iki parça istiyor ve
          // tek ürün boru hattı zaten daha ucuz.
          const { data } = await apiFetch<TryOnCreateResponseWire, '/tryon'>('/tryon', {
            method: 'POST',
            json: { userPhotoId: kimlik, variantId: tekParca.variantId, mode: mod },
            idempotencyKey,
          });
          yanitiIsle(anahtar, data);
          return;
        }

        const { data } = await apiFetch<OutfitTryOnResultWire, '/tryon/outfit'>('/tryon/outfit', {
          method: 'POST',
          json: {
            userPhotoId: kimlik,
            // ⚠️ Sıra GÖNDERİLMEZ diye bir şey yok ama ÖNEMSENMEZ: katman sırası
            //    sunucudaki sabit tablodan gelir (OUTFIT_LAYER_ORDER). Buradaki
            //    sıra kullanıcının karuselde dokunma sırasıdır.
            variantIds: parcalar.map((parca) => parca.variantId),
            mode: mod,
          },
          idempotencyKey,
        });
        yanitiIsle(anahtar, data);
      } catch (error) {
        hatayiIsle(anahtar, error);
      }
    },
    [parcalar, mod, yaz, yanitiIsle, hatayiIsle],
  );

  /**
   * FOTOĞRAF ZİNCİRİ — bilet → doğrudan PUT → onay.
   *
   * ⚠️ PUT VEKİLDEN GEÇMEZ. Geçseydi 10 MB'a kadar her fotoğraf Next sürecinin
   *    belleğine tamponlanırdı (vekil gövdeyi `arrayBuffer()`a alıyor, çünkü
   *    401 sonrası isteği bir kez tekrarlaması gerekiyor).
   */
  const fotografGonder = useCallback(
    async (dosya: File): Promise<void> => {
      setFotografYukleniyor(true);
      setFotografHatasi(null);

      try {
        const { data: bilet } = await apiFetch<UploadTicketWire, '/me/photos'>('/me/photos', {
          method: 'POST',
          json: { contentType: dosya.type, sizeBytes: dosya.size, purpose: 'ONE_TIME' },
        });

        /**
         * ⚠️ ÖLÇÜLDÜ (tarayıcı, 2026-08-12): bu PUT `TypeError: Failed to fetch`
         *    ile düşüyor. Sebep ağ değil, KOVA CORS POLİTİKASI: `image/jpeg`
         *    CORS'un güvenli listesinde olmadığı için tarayıcı önce OPTIONS
         *    gönderiyor ve özel kova buna izin vermiyor. Aynı adrese `curl` ile
         *    PUT → 200 (curl CORS uygulamaz). Yani sunucu tarafı doğru, eksik
         *    olan altyapı ayarı: kovaya `AllowedOrigins: APP_URL`,
         *    `AllowedMethods: PUT`, `AllowedHeaders: content-type` eklenmeli.
         *
         *    ⚠️ Yüklemeyi vekile taşımak "çözüm" DEĞİL: 10 MB'a kadar her
         *    fotoğraf Next sürecinin belleğine tamponlanır (vekil gövdeyi
         *    `arrayBuffer()`a alıyor) ve frontend-mimari.md'nin medya kararını
         *    sessizce tersine çevirir. Doğru düzeltme kova ayarındadır.
         */
        let yukleme: Response;
        try {
          yukleme = await fetch(bilet.uploadUrl, {
            method: 'PUT',
            // ⚠️ İmzaya gömülü tip; farklı gönderilirse depo reddeder.
            headers: { 'content-type': bilet.requiredContentType },
            body: dosya,
          });
        } catch {
          // Zarfsız ağ hatası: `unwrap`ın `synthesize`ıyla aynı gerekçe —
          // istemcinin tek bir hata şekli görmesi gerekiyor.
          throw new ApiFailure({
            code: 'UPSTREAM_UNAVAILABLE',
            message:
              'Fotoğraf depoya yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin; ' +
              'sorun sürerse destek ekibine bildirin.',
            httpStatus: 0,
            retryable: true,
            requestId: 'depo',
          });
        }

        if (!yukleme.ok) {
          throw new ApiFailure({
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'Fotoğraf yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.',
            httpStatus: yukleme.status,
            retryable: true,
            requestId: 'depo',
          });
        }

        const { data: fotograf } = await apiFetch<UserPhotoWire, `/me/photos/${string}/confirm`>(
          `/me/photos/${bilet.uploadId}/confirm`,
          {
            method: 'POST',
            json: { purpose: 'ONE_TIME' },
            // ⚠️ Onay, satırı YARATAN ve saklama süresini başlatan adım; anahtarsız
            //    tekrar ikinci bir kayıt açardı.
            idempotencyKey: newIdempotencyKey(),
          },
        );

        SON_FOTOGRAF = {
          id: fotograf.id,
          gecerlilikSonu: new Date(fotograf.expiresAt).getTime(),
        };
        setFotografId(fotograf.id);
        setFotografAcik(false);

        // Fotoğraf bu ekranda tek bir sebeple yüklenir: denemek için.
        bekleyen.current = null;
        await uret(fotograf.id);
      } catch (error) {
        if (
          isApiFailure(error) &&
          (error.code === 'CONSENT_REQUIRED' || error.code === 'CONSENT_CROSS_BORDER_REQUIRED')
        ) {
          // ⚠️ Dosya SAKLANIR: rıza verildikten sonra kullanıcıdan aynı
          //    fotoğrafı ikinci kez seçmesini istemek, onayı bir cezaya çevirir.
          bekleyen.current = { tur: 'yukle', dosya };
          // ⚠️ Fotoğraf modalı KAPANIR. Açık bırakılırsa iki modal üst üste
          //    binip kullanıcıya "hangisi şimdi?" dedirtir (tarayıcıda görüldü).
          setFotografAcik(false);
          setRizaKodu(error.code);
          return;
        }

        setFotografHatasi(error);
        /**
         * ⚠️ MODAL GERİ AÇILIR. Rıza verildikten sonra yükleme kendiliğinden
         *    tekrarlanıyor ve o sırada modal KAPALI; hata yalnızca modalın
         *    içinde çizildiği için kullanıcı "izin verdim, hiçbir şey olmadı"
         *    ekranında kalırdı. Tarayıcıda tam olarak bu görüldü.
         */
        setFotografAcik(true);
      } finally {
        setFotografYukleniyor(false);
      }
    },
    [uret],
  );

  const dene = useCallback((): void => {
    const kimlik = fotografId ?? gecerliFotograf();
    if (!kimlik) {
      // ⚠️ Rıza BURADA sorulmaz: fotoğraf seçilmeden istenen onay bağlamsızdır.
      //    Kapıyı sunucu açacak (POST /me/photos → CONSENT_REQUIRED).
      bekleyen.current = { tur: 'uret' };
      setFotografHatasi(null);
      setFotografAcik(true);
      return;
    }
    void uret(kimlik);
  }, [fotografId, uret]);

  const tekrarDene = useCallback((): void => {
    if (imza) ANAHTAR_ONBELLEGI.delete(imza);
    dene();
  }, [imza, dene]);

  /** FAILED_PERMANENT'ın tek çıkışı: aynı fotoğrafla üçüncü deneme anlamsız. */
  const yeniFotograf = useCallback((): void => {
    SON_FOTOGRAF = null;
    setFotografId(null);
    setFotografHatasi(null);
    bekleyen.current = { tur: 'uret' };
    setFotografAcik(true);
  }, []);

  const rizaOnaylandi = useCallback((): void => {
    setRizaKodu(null);
    const niyet = bekleyen.current;
    bekleyen.current = null;

    if (niyet?.tur === 'yukle') {
      void fotografGonder(niyet.dosya);
      return;
    }
    const kimlik = fotografId ?? gecerliFotograf();
    if (kimlik) void uret(kimlik);
    else setFotografAcik(true);
  }, [fotografId, fotografGonder, uret]);

  const rizaKapat = useCallback((): void => {
    // ⚠️ Kapatmak onay DEĞİLDİR: bekleyen niyet düşürülür, aksi hâlde bir
    //    sonraki ilgisiz eylem sessizce fotoğraf yüklemeye çalışırdı.
    bekleyen.current = null;
    setRizaKodu(null);
  }, []);

  return {
    asama,
    ilerleme: progress,
    zamanAsimi: timedOut,
    tahminSaniye,
    fotografVar: fotografId !== null,
    fotografAcik,
    fotografYukleniyor,
    fotografHatasi,
    rizaKodu,
    dene,
    tekrarDene,
    yeniFotograf,
    durumuKontrolEt: refetch,
    fotografGonder: (dosya: File) => void fotografGonder(dosya),
    fotografKapat: () => {
      bekleyen.current = null;
      setFotografAcik(false);
    },
    rizaOnaylandi,
    rizaKapat,
  };
}
