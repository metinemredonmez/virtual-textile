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
    /**
     * ⚠️ BU İKİ CÜMLE BU TURDA DEĞİŞTİ, ÇÜNKÜ YANLIŞ İŞİ ANLATIYORDU.
     *
     *    Eskisi: "Satın almadan önce üzerinizde görün." + sanal deneme açıklaması.
     *    Yani ana sayfa kendini bir SANAL DENEME ARACI olarak tanıtıyordu.
     *
     *    Oysa burası bir PAZARYERİ: küçük markalar kendi ürünlerini satıyor,
     *    müşteri platformun. Sanal deneme bu işin bir ÖZELLİĞİ — en ayırt
     *    edici olanı, ama işin kendisi değil.
     *
     * ⚠️ AYIRT EDİCİ İDDİA "sanal deneme" DEĞİL, "TEK SEPET". Sanal denemeyi
     *    yapan başkaları da var; farklı markaların parçalarını AYNI sepette tek
     *    ödemeyle satmak bizim tarafımızda. Alt başlık ikisini birlikte söylüyor.
     */
    baslik: 'Küçük markalar, tek adres.',
    aciklama:
      'Bağımsız markaların ürünlerini keşfedin, farklı mağazalardan seçtiklerinizi tek sepette satın alın — ve satın almadan önce kendi fotoğrafınızda deneyin.',
    urunleriKesfet: 'Ürünleri keşfet',

    yeniGelenler: 'Yeni gelenler',
    yeniGelenlerNot: 'Mağazaların en son eklediği parçalar.',
    indirimdekiler: 'İndirimdekiler',
    indirimdekilerNot: 'Liste fiyatının altına düşen ürünler.',
    vitrinde: 'Vitrinde',
    oneCikanlar: 'Öne çıkanlar',
    tumunuGor: 'Tümünü gör',
    tumu: 'Tümü',
    tumKategoriler: 'Tüm kategoriler',

    /**
     * ⚠️ Afişin altına inen mobil şeridin ekran okuyucu adı.
     *    Kartların DÜĞME metinleri burada DEĞİL: `urun.uzerimdeDene` ve
     *    `urun.sepeteEkle` zaten yazılıydı ve hiçbir yerden okunmuyordu.
     *    İkinci bir kopya açmak, aynı düğmenin iki ekranda ayrışması demekti.
     */
    afistekiParcalar: 'Afişteki parçalar',

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
      'Her mağaza kendi ürünlerini yönetir; farklı mağazaların parçalarını tek sepette satın alırsınız.',
    /** ⚠️ "bu seçkide" — TOPLAM DEĞİL. Sayı 48'lik örneklemden geliyor. */
    magazaUrunSayisi: 'Bu seçkide {adet} ürün',

    saticiOl: 'Markanızı burada satın',
    saticiOlMetin:
      'Küçük markalar için kurulmuş bir pazaryeri: ürünlerinizi siz yönetirsiniz, ödeme ve kargo süreci platformda işler. Komisyon oranını ve elinize geçecek tutarı önceden hesaplayın.',
    saticiOlDugme: 'Kazancı hesapla',
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

  /**
   * İMZALI YÜKLEMENİN İSTEMCİ TARAFI METİNLERİ (`lib/media/use-imzali-yukleme`).
   *
   * ⚠️ BU ÜÇ METİN `ERROR_CATALOG`A KOYULAMAZ ve koyulmamalı: kataloğun
   *    anahtarı `ErrorCode`tur ve bu üç durumun hiçbiri sunucudan gelmiyor —
   *    ikisi istek daha atılmadan istemcide yakalanıyor, üçüncüsü ise
   *    tarayıcının ön uçuşta düşürdüğü bir istek (`OPTIONS` 403). Sunucunun
   *    haberi olmayan bir arızanın kodu da olamaz.
   */
  medyaYukleme: {
    dosyaSecin: 'Önce bir dosya seçin.',
    bicimGecersiz: 'Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.',
    boyutAsildi: 'Dosya en fazla {mb} MB olabilir.',
    /**
     * ⚠️ "Tekrar deneyin" DEMEZ, ÇÜNKÜ TEKRAR DENEMEK ÇALIŞMAZ. Ölçüldü
     *    (`infra/R2-CORS.md`): özel kovada CORS tanımlı olmadığı için ön uçuş
     *    403 dönüyor, aynı adrese `curl PUT` 200. Bu bir kova AYARI; metin
     *    bunu söylemezse yönetici aynı dosyayı beş kez dener.
     */
    depoEngellendi:
      'Dosya depoya yüklenemedi: tarayıcı isteği depo tarafından engellendi. Bu bir dosya hatası değil — R2 kovasında CORS tanımlı olmadığı sürece hiçbir tarayıcı yüklemesi tamamlanamaz (infra/r2-cors.json kovaya uygulanmalı). Tekrar denemek sonucu değiştirmez. İnternet bağlantınız koptuysa da aynı hata görünür.',
    depoHatasi: 'Dosya depoya yüklenemedi (HTTP {durum}).',
  },

  /**
   * YÖNETİM → SİTE GÖRSELLERİ.
   *
   * ⚠️ BU EKRANIN METNİ SÖZLÜKTE, kardeş yönetim ekranlarınınki JSX'te. Fark
   *    bilinçli: `gomulu-metin.test.ts` circiri "borç ARTMADI" diyor ve yeni
   *    bir ekranın metnini JSX'e gömmek o sayıyı ARTIRIR. Tavanı büyütmek
   *    (dosyanın kendi uyarısı) bir kararı sessizce geri almak olurdu; doğru
   *    hamle metni buraya taşımak. Kardeş ekranlar taşındıkça fark kapanır.
   */
  siteGorselleri: {
    baslik: 'Site görselleri',
    aciklama:
      'Vitrin afişi ve kapak görselleri buradan yönetilir. Bunlar SİTE görselidir, ürün fotoğrafı değil: satıcıların yüklediği görsellerden bağımsızdır ve ürün yayından kalksa bile yerinde durur.',
    yuzeySekmesi: 'Görsel yüzeyi',
    kategoriOkunamadi:
      'Kategori listesi okunamadı; bu sekmede yeni kapak yüklenemez. Sayfayı yenileyin.',

    slot: {
      HERO: 'Vitrin afişi',
      CATEGORY_COVER: 'Kategori kapağı',
      COLLECTION_COVER: 'Koleksiyon kapağı',
    },

    /**
     * ⚠️ BOŞ DURUM "KAYIT YOK" DEMEZ. Afiş tanımlanmamışsa ana sayfa
     *    BOZULMUYOR, bugünkü davranışına (ilk ürünün görseli) düşüyor — ve
     *    bunu söyleyen başka hiçbir yer yok. Metin bunu söylemezse yönetici
     *    "sayfa bozuldu mu" diye bakar.
     */
    bos: {
      HERO: 'Tanımlı vitrin afişi yok — ana sayfa çalışmaya devam ediyor.',
      HEROAciklama:
        'Afiş tanımlanmadığı sürece ana sayfanın vitrininde listedeki ilk ürünün fotoğrafı gösterilir. Yüklediğiniz afişi yayına aldığınızda onun yerini alır; yayından kaldırdığınızda site yine ilk ürünün görseline döner.',
      CATEGORY_COVER: 'Hiçbir kategorinin kapak görseli yok.',
      CATEGORY_COVERAciklama:
        'Kapağı olmayan kategori sayfası kapaksız çizilir, bozulmaz. Kapak yüklerken hangi kategoriye ait olduğunu seçmeniz gerekir.',
      COLLECTION_COVER: 'Hiçbir koleksiyonun kapak görseli yok.',
      COLLECTION_COVERAciklama:
        'Koleksiyon metinleri kodda tanımlı ve buradan değiştirilemez; yönetilen tek şey kapak görselidir. Kapağı olmayan koleksiyon kapaksız çizilir.',
    },

    alan: {
      baslik: 'Başlık',
      altBaslik: 'Alt başlık',
      bagAdresi: 'Bağlantı adresi',
      sira: 'Sıra',
      istegeBagli: '(isteğe bağlı)',
      bagIpucu:
        'Site içi bir yol, tek eğik çizgiyle başlar (ör. /collection/denim). Dış adres kabul edilmez.',
      vazgec: 'Vazgeç',
    },

    yukle: {
      dugme: '{yuzey} yükle',
      formBasligi: 'Yeni görsel — {yuzey}',
      dosya: 'Dosya',
      dosyaIpucu:
        'JPG, PNG veya WebP · en fazla {mb} MB. Vitrin afişi geniş kesilir (16/7); dar bir görselin üstü ve altı kırpılır.',
      kategori: 'Kategori',
      koleksiyon: 'Koleksiyon',
      secin: 'Seçin…',
      kategoriIpucu:
        'Kapak kategorinin kimliğine bağlanır, adresine değil: kategori adresi değişse de kapak yerinde kalır.',
      koleksiyonIpucu:
        'Koleksiyon metinleri kodda tanımlı; buradan yalnızca kapak görseli yönetilir.',
      pasifUyarisi:
        'Yüklenen görsel pasif başlar; sitede görünmesi için listedeki satırdan “Yayına al” deyin.',
      sonuc: 'Görsel yüklendi ({en}×{boy}). Aşağıdaki listeden yayına alabilirsiniz.',
      adimBilet: 'Adres alınıyor…',
      adimYukleme: 'Yükleniyor…',
      adimOnay: 'İşleniyor…',
      gonder: 'Yükle',
    },

    satir: {
      basliksiz: 'Başlıksız görsel',
      yayinda: 'Yayında',
      pasif: 'Pasif',
      hedef: 'Hedef: {etiket}',
      hedefYok: 'bulunamadı ({anahtar}) — bu kapak sitede gösterilmiyor',
      siraNo: 'sıra {n}',
      bag: 'bağlantı: {yol}',
      yayinaAl: 'Yayına al',
      yayindanKaldir: 'Yayından kaldır',
      duzenle: 'Düzenle',
      kaydediliyor: 'Kaydediliyor…',
      medyaAdresiYok: 'Medya adresi tanımsız (NEXT_PUBLIC_MEDIA_URL)',
      sil: 'Sil',
      silOnay: 'Görseli kalıcı olarak sil',
      silEngeli:
        'Yayındaki görsel silinemez — önce “Yayından kaldır” deyin, siteyi kontrol edin, sonra silin.',
    },

    kartlar: {
      baslik: 'Afişin üstündeki ürün kartları',
      bos: 'Kart seçilmedi. Afiş tek başına gösterilir ve ana sayfada “Üzerimde Dene” düğmesi çıkmaz. 2-3 ürün seçerek denemeyi afişin üstünde gösterebilirsiniz.',
      denemeKapali: 'Deneme kapalı — kartta yalnız “Sepete Ekle” çıkar',
      denemeKapaliKisa: 'Deneme kapalı',
      varyantYok: 'Aktif varyant yok — “Sepete Ekle” de çıkmaz',
      kaldir: 'Kaldır',
      urunEkle: 'Ürün ekle',
      dolu: 'Kart sayısı doldu. Yeni ürün eklemek için birini kaldırın.',
      urunAra: 'Ürün ara',
      ornek: 'keten gömlek',
      araniyor: 'Aranıyor…',
      sonucYok: 'Eşleşen yayındaki ürün yok. Yayında olmayan ürün karta bağlanamaz.',
      ekle: 'Ekle',
      ekli: 'Ekli',
      kismiUyari:
        'Buradaki “Deneme kapalı” rozeti kapının yalnız yarısını okur; kesin durum kart eklendikten sonra listede görünür. Denenemeyen ürün de seçilebilir — kartında yalnız “Sepete Ekle” çıkar.',
    },
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
