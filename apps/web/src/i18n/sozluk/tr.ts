/**
 * TÜRKÇE SÖZLÜK — ŞEKLİN KAYNAĞI.
 *
 * ⚠️ BU DOSYA TİPİN KENDİSİDİR. `Sozluk = typeof tr` ve `en.ts`
 *    `satisfies Sozluk` taşıyor; yani buraya eklenen bir anahtarın İngilizcesi
 *    yazılmadan DERLEME GEÇMEZ. Çeviri eksiği ölü bağlantıdan daha sinsidir —
 *    ölü bağlantı 404 verir, eksik çeviri 200 döner ve kullanıcı ham anahtar
 *    ya da yanlış dil görür. Kapı derleme düzeyinde olmak zorunda.
 *
 * ⚠️ JSON DEĞİL `.ts` ve bu bilinçli: JSON'dan `typeof` türetmek için
 *    `resolveJsonModule` + `as const` gerekiyor, `as const` JSON'a yazılamıyor
 *    ve tip `string`e genişliyor. Genişlediği an anahtar kontrolü tamamen
 *    kayboluyor — koruma sessizce kapanmış olur.
 *
 * ⚠️ ICU. Metin `{sayi, plural, …}` yazımını destekliyor (next-intl) ve bu
 *    süs değil: Türkçede sayıdan sonra çoğul eki YOK, İngilizcede VAR. Düz
 *    sözlükle çevrilen "3 parça" İngilizcede "1 items" üretir.
 *
 * KAPSAM. Bu turda ARAYÜZ KABUĞU ve DURUM TABLOLARI çevrildi. Ürün başlığı ve
 * açıklaması ÇEVRİLMEDİ — gerekçesi `docs/i18n.md`de, şema işi olduğu için.
 */
export const tr = {
  ortak: {
    yukleniyor: 'Yükleniyor…',
    tekrarDene: 'Tekrar dene',
    kapat: 'Kapat',
    iptal: 'İptal',
    kaydet: 'Kaydet',
    devamEt: 'Devam et',
    geriDon: 'Geri dön',
    ara: 'Ara',
    filtrele: 'Filtrele',
    temizle: 'Temizle',
    detay: 'Detay',
    /** ⚠️ `#` sayının biçimlenmiş hâli; `{n}` yazmak binlik ayracı kaybettirir. */
    sonuc: '{n, plural, other {# sonuç}}',
  },

  dil: {
    etiket: 'Dil',
    /**
     * ⚠️ Dil ADLARI ÇEVRİLMEZ — her dil KENDİ adıyla yazılır. Türkçe arayüzde
     *    "İngilizce" yazan bir seçenek, İngilizce bilen ama Türkçe bilmeyen
     *    kullanıcının aradığı satırı okunamaz kılar. Dil seçici, dilini
     *    bilmeyenin de kullanabilmesi gereken tek bileşendir.
     */
    tr: 'Türkçe',
    en: 'English',
    degistir: 'Dili değiştir',
  },

  gezinme: {
    urunler: 'Ürünler',
    kategoriler: 'Kategoriler',
    koleksiyonlar: 'Koleksiyonlar',
    stilDanismani: 'Stil danışmanı',
    hesaplayici: 'Beden hesaplayıcı',
    sepet: 'Sepet',
    hesabim: 'Hesabım',
    giris: 'Giriş yap',
    kayit: 'Kayıt ol',
    cikis: 'Çıkış yap',
    saticiPaneli: 'Satıcı paneli',
    yonetimPaneli: 'Yönetim paneli',
    menuAc: 'Menü',
    menuKapat: 'Kapat',
  },

  altbilgi: {
    kullanimKosullari: 'Kullanım koşulları',
    aydinlatmaMetni: 'Aydınlatma metni',
    hakkimizda: 'Hakkımızda',
    iletisim: 'İletişim',
    telifHakki: '© {yil} Virtual Textile',
  },

  /**
   * ⚠️ VİTRİN METİNLERİ SÖZLÜKTE, JSX'te DEĞİL. Ana sayfaya yedi bölüm
   *    eklendiğinde bu metinler doğrudan JSX'e yazılmıştı ve
   *    `gomulu-metin.test.ts` çeviri borcunu 687'den 694'e çıkararak KIRMIZI
   *    yandı. Testin kendi uyarısı: "Tavanı BÜYÜTME — metni sözlüğe taşı."
   *    Doğru olan oydu; tavan yükseltilmedi.
   */
  vitrin: {
    baslik: 'Satın almadan önce üzerinizde görün.',
    aciklama:
      'Sanal deneme ile kıyafetin üzerinizde nasıl durduğunu görün, bedeninize uygun olup olmadığını ayrı bir skorla değerlendirin.',
    urunleriKesfet: 'Ürünleri keşfet',
    vitrinde: 'Vitrinde',
    oneCikanlar: 'Öne çıkanlar',
    tumunuGor: 'Tümünü gör',
    tumu: 'Tümü',
    tumKategoriler: 'Tüm kategoriler',

    nasilCalisir: 'Nasıl çalışır',
    adim1Baslik: 'Fotoğrafınızı yükleyin',
    adim1Metin:
      'Tek bir boy fotoğrafı yeterli. Yalnızca bu deneme için kullanılmasını ya da profilinizde saklanmasını siz seçersiniz.',
    adim2Baslik: 'Ürünü seçin',
    adim2Metin:
      'Beğendiğiniz parçada "Üzerimde Dene" düğmesine basın. Farklı mağazaların parçalarını tek kombinde birleştirebilirsiniz.',
    adim3Baslik: 'Sonucu değerlendirin',
    adim3Metin:
      'Görsel benzerliği ve beden uyumu ayrı skorlarla gösterilir — iyi durmak ile üzerinize olmak farklı sorulardır.',

    /**
     * ⚠️ Bu liste bir VAAT LİSTESİ DEĞİL: her madde bugün çalışan bir şeye
     *    işaret eder. Yazılmamış bir özelliği buraya eklemek, kullanıcıyı
     *    olmayan bir düğmeyi aramaya göndermektir.
     */
    ozellikler: 'Neler yapabilirsiniz',
    ozelliklerNot: 'Hepsi bugün çalışıyor — yakında gelecek olanlar bu listede yok.',
    ozellikDeneme: 'Sanal deneme',
    ozellikDenemeMetin: 'Kendi fotoğrafınızda, üst giyim · alt giyim · elbise · dış giyim.',
    ozellikKombin: 'Markalar arası kombin',
    ozellikKombinMetin: 'Bir mağazanın ceketi, diğerinin pantolonu — aynı görselde, tek sepette.',
    ozellikBeden: 'Beden önerisi',
    ozellikBedenMetin:
      'Ölçüleriniz ve iade geri bildirimleriyle; güven düşükse öneri değil ölçü tablosu.',
    ozellikDanisman: 'Stil danışmanı',
    ozellikDanismanMetin: 'Dolabınızı ve beğenilerinizi okuyup kombin öneren yapay zekâ.',
    ozellikGardirop: 'Dijital gardırop',
    ozellikGardiropMetin: 'Satın aldığınız parçalar dolabınıza otomatik eklenir.',
    ozellikArama: 'Doğal dilde arama',
    ozellikAramaMetin: '"Düğüne gidecek bir şey" yazın; filtrelerle uğraşmayın.',

    koleksiyonlar: 'Koleksiyonlar',
    kategoriler: 'Kategoriler',
    koleksiyonlarNot: 'Aradığınız şeye göre hazırlanmış giriş noktaları.',
    magazalar: 'Mağazalar',
    magazalarNot:
      'Farklı mağazaların parçalarını aynı kombinde deneyebilir, tek sepette satın alabilirsiniz.',
    danismanBaslik: 'Ne giyeceğinize karar veremiyorsanız',
    danismanMetin:
      'Stil danışmanı dolabınızdaki parçaları ve beğendiklerinizi birlikte değerlendirip kombin önerir.',
    danismanDugme: 'Danışmana sor',
  },

  panel: {
    sekmeler: 'Durum filtresi',
    sonrakiSayfa: 'Sonraki sayfa',
    /**
     * ⚠️ "Önceki sayfa" DEĞİL ve olamaz: imleçli sayfalamada geri anahtarı
     *    yoktur (gerekçe `panel/duzen.tsx` → `ImlecSayfalama`). Çeviren kişi
     *    burayı "Previous page" yaparsa var olmayan bir davranış vaat eder.
     */
    ilkSayfa: 'İlk sayfaya dön',
    listeSonu: 'Listenin sonundasınız.',
    /**
     * ⚠️ "Kayıt bulunamadı" YETMEZ ve `duzen.tsx` bunu ayrıca yazıyor: boşluğun
     *    İKİ sebebi var. Süzgeç yüzünden boş olan liste ile gerçekten boş olan
     *    liste aynı cümleyi görürse kullanıcı süzgeci temizlemeyi denemez.
     */
    bosListe: 'Henüz kayıt yok.',
    bosSuzgec: 'Bu süzgeçle eşleşen kayıt yok.',
    suzgeciTemizle: 'Süzgeci temizle',
    ozetHatasi: 'Özet yüklenemedi.',
  },

  hata: {
    beklenmeyen: 'Beklenmeyen bir hata oluştu.',
    istekNo: 'İstek no: {requestId}',
    geriSayim: '{dakika, plural, other {# dakika}} sonra tekrar deneyebilirsiniz.',
    siparislerimeGit: 'Siparişlerime git',
  },

  /**
   * FORM ALANI HATALARI — sunucunun Zod VARSAYILANINA düştüğü hâlin karşılığı.
   *
   * ⚠️ BURASI KATALOĞUN İKAMESİ DEĞİL. Hata CÜMLESİ `error-catalog.ts`te ve
   *    oradan gelir; buradaki yedi metin yalnızca `details.fields[].message`
   *    kullanıcı için ÜRETİLMEMİŞ bir Zod varsayılanı olduğunda
   *    (`"Required"`, `"String must contain at least 3 character(s)"`) devreye
   *    girer. Gerekçenin tamamı `components/hata/alan-hatalari.ts` başlığında.
   *
   * ⚠️ ANAHTARLAR ZOD KURAL KODUNUN KENDİSİ DEĞİL. `too_small` bir Zod iç
   *    adıdır ve sürüm başına değişebilir; sözlüğe girseydi bir kütüphane
   *    yükseltmesi çeviri anahtarını kırardı. Eşleme `alan-hatalari.ts`te.
   */
  alanHatasi: {
    zorunlu: 'Bu alan zorunlu.',
    cokKisa: 'Girilen değer çok kısa.',
    cokUzun: 'Girilen değer çok uzun.',
    bicim: 'Biçim geçersiz.',
    secim: 'Geçersiz seçim.',
    eposta: 'Geçerli bir e-posta adresi girin.',
    gecersiz: 'Girilen değer geçersiz.',
  },

  urun: {
    sepeteEkle: 'Sepete Ekle',
    uzerimdeDene: 'Üzerimde Dene',
    tukendi: 'Tükendi',
    sonucYok: 'Aradığınız kritere uygun ürün bulunamadı.',
    /** ⚠️ Görsel yedeğinin ekran okuyucu metni — kırık ikon yerine anlam. */
    gorselYok: 'Ürün görseli yok',
  },

  /**
   * DURUM TABLOLARI — `lib/durum-etiketleri.ts` bu anahtarları okur.
   *
   * ⚠️ ROZET RENGİ BURADA YOK. Renk bir DAVRANIŞ kararı ve dile göre değişmez;
   *    sözlüğe konsaydı iki dilde farklı renk vermek mümkün olurdu.
   *    `design-system.md`nin "renk yalnızca DURUM taşır" kuralı ancak rengin
   *    tek yerde durmasıyla ölçülebilir kalır.
   *
   * ⚠️ SATICININ GÖRDÜĞÜ metinler burada DEĞİL: `AWAITING_APPROVAL` müşteriye
   *    "Satıcı onayı bekleniyor", satıcıya "Onayınız bekleniyor"dur. Kopya
   *    değil KARŞILIK; birleştirmek kime seslenildiğini bilmeyen ekran üretir.
   */
  durum: {
    urun: {
      DRAFT: 'Taslak',
      PENDING_REVIEW: 'İncelemede',
      PUBLISHED: 'Yayında',
      REJECTED: 'Reddedildi',
      ARCHIVED: 'Arşivde',
    },
    satici: {
      PENDING: 'Başvuru bekliyor',
      APPROVED: 'Onaylı',
      SUSPENDED: 'Askıda',
      REJECTED: 'Reddedildi',
    },
    siparis: {
      PENDING_PAYMENT: 'Ödeme bekleniyor',
      PAYMENT_FAILED: 'Ödeme başarısız',
      EXPIRED: 'Süresi doldu',
      PAID: 'Ödendi',
      PARTIALLY_SHIPPED: 'Kısmen kargoda',
      SHIPPED: 'Kargoda',
      DELIVERED: 'Teslim edildi',
      COMPLETED: 'Tamamlandı',
      CANCELLED: 'İptal edildi',
      REFUNDED: 'İade edildi',
    },
    paket: {
      AWAITING_APPROVAL: 'Satıcı onayı bekleniyor',
      PREPARING: 'Hazırlanıyor',
      SHIPPED: 'Kargoda',
      DELIVERED: 'Teslim edildi',
      CANCELLED: 'İptal edildi',
      RETURN_REQUESTED: 'İade talebi açık',
      RETURNED: 'İade alındı',
    },
    iade: {
      REQUESTED: 'Talep alındı',
      APPROVED: 'Onaylandı',
      REJECTED: 'Reddedildi',
      IN_TRANSIT: 'Yolda',
      RECEIVED: 'Satıcıya ulaştı',
      REFUNDED: 'Ücret iadesi yapıldı',
      CANCELLED: 'İptal edildi',
    },
  },

  iadeSebebi: {
    SIZE_TOO_SMALL: 'Beden küçük geldi',
    SIZE_TOO_LARGE: 'Beden büyük geldi',
    NOT_AS_DESCRIBED: 'Ürün açıklamaya uymuyor',
    DAMAGED: 'Ürün hasarlı geldi',
    WRONG_ITEM: 'Yanlış ürün gönderildi',
    CHANGED_MIND: 'Vazgeçtim',
    QUALITY: 'Kalitesi beklediğim gibi değil',
    OTHER: 'Diğer',
  },

  tryonKategori: {
    UPPER_BODY: 'Üst giyim',
    LOWER_BODY: 'Alt giyim',
    DRESS: 'Elbise',
    OUTERWEAR: 'Dış giyim',
    SHOES: 'Ayakkabı',
    JEWELRY: 'Takı',
    BAG: 'Çanta',
    ACCESSORY: 'Aksesuar',
  },
} as const;

/**
 * SÖZLÜK ŞEKLİ — `en.ts` bunu `satisfies` ile karşılıyor.
 *
 * ⚠️ `typeof tr` DOĞRUDAN KULLANILAMAZ. `as const` yüzünden her değer kendi
 *    LİTERAL tipi (`'Yükleniyor…'`); İngilizce sözlük onu asla karşılayamazdı
 *    ve `satisfies` her satırda kırmızı yanardı. Bu eşleme yalnızca YAPIYI
 *    (anahtar ağacını) korur, değeri `string`e açar. Eksik anahtar da fazla
 *    anahtar da derlemeyi kırar; kaçan tek şey ICU yer tutucu farkıdır ve o da
 *    `sozluk.test.ts` ile kapalı.
 *
 * ⚠️ `tr` üzerindeki `as const` KALDIRILAMAZ: next-intl `t()` çağrısının
 *    argümanlarını mesajın LİTERAL metninden çıkarıyor. Literal kaybolursa
 *    `t('hata.geriSayim')` eksik `{dakika}` ile çağrıldığında derleme geçer ve
 *    kullanıcı ham yer tutucu görür.
 */
export type Sozluk = SozlukSekli<typeof tr>;

type SozlukSekli<T> = {
  [K in keyof T]: T[K] extends string ? string : SozlukSekli<T[K]>;
};
