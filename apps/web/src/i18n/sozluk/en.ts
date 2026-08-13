import type { Sozluk } from './tr';

/**
 * İNGİLİZCE SÖZLÜK.
 *
 * ⚠️ `satisfies Sozluk` = DERLEME KAPISI. `tr.ts`e bir anahtar eklenip buraya
 *    eklenmezse `tsc` kırılır; burada fazladan bir anahtar olursa da kırılır.
 *    Bu, "çeviriyi unutmak" hatasının tek yapısal çözümü — çünkü unutulmuş bir
 *    çeviri hiçbir zaman kendini göstermez: sayfa 200 döner, ESLint susar,
 *    `next build` susar, kullanıcı ham anahtar görür.
 *
 * ⚠️ DERLEMENİN GÖREMEDİĞİ İKİ ŞEY VAR ve ikisi de `sozluk.test.ts`te:
 *      1. ICU yer tutucu farkı — iki metin de `string`, tip aynı. `{yil}`
 *         yazmayı unutulan bir telif satırı sessizce yılı kaybeder.
 *      2. Çevrilmeden bırakılmış Türkçe kopya — tip düzeyinde kusursuz görünür.
 *
 * ⚠️ ÇOĞUL. Türkçe metinlerde `plural` dalları aynı sözcüğü tekrarlıyor
 *    (Türkçede sayıdan sonra çoğul eki yok); burada gerçekten farklılar. Bu
 *    yüzden `{n} results` gibi düz bir çeviri YAZILMAZ — `n=1`de "1 results"
 *    üretir.
 */
export const en = {
  ortak: {
    yukleniyor: 'Loading…',
    tekrarDene: 'Try again',
    kapat: 'Close',
    iptal: 'Cancel',
    kaydet: 'Save',
    devamEt: 'Continue',
    geriDon: 'Go back',
    ara: 'Search',
    filtrele: 'Filter',
    temizle: 'Clear',
    detay: 'Details',
    sonuc: '{n, plural, one {# result} other {# results}}',
  },

  dil: {
    etiket: 'Language',
    // ⚠️ Dil adları KENDİ dillerinde — gerekçe `tr.ts`te.
    tr: 'Türkçe',
    en: 'English',
    degistir: 'Change language',
  },

  gezinme: {
    urunler: 'Products',
    kategoriler: 'Categories',
    koleksiyonlar: 'Collections',
    stilDanismani: 'Style adviser',
    hesaplayici: 'Calculator for sellers',
    sepet: 'Cart',
    hesabim: 'My account',
    giris: 'Sign in',
    kayit: 'Sign up',
    cikis: 'Sign out',
    saticiPaneli: 'Seller dashboard',
    yonetimPaneli: 'Admin dashboard',
    menuAc: 'Menu',
    menuKapat: 'Close',
  },

  altbilgi: {
    kullanimKosullari: 'Terms of use',
    aydinlatmaMetni: 'Privacy notice',
    hakkimizda: 'About us',
    iletisim: 'Contact',
    telifHakki: '© {yil} Virtual Textile',
  },

  olculerim: {
    baslik: 'My measurements',
    girisMetni:
      'Your measurements power our size recommendation. The more you enter, the more reliable it gets — none of them are required.',

    nasilKullanilirBaslik: 'How are measurements used?',
    nasilKullanilir1:
      'Chest, waist, hip and shoulder are compared directly against the product size chart. Inseam only breaks the tie when two sizes come out equally close.',
    nasilKullanilir2:
      'We do not estimate a size from height and weight: at the same height and weight chest circumference can vary by around 15 cm, and we have no reliable model for that conversion. They are used only to check that the measurements you entered are consistent with each other.',
    nasilKullanilir3:
      'Your measurements are shown only to you and used in recommendations; they are never shared with sellers. Clear a field and save to delete it at any time.',

    boy: 'Height',
    boyIpucu: 'Without shoes, back against a wall.',
    kilo: 'Weight',
    kiloIpucu: 'Measuring in the morning on an empty stomach is the most consistent.',
    gogus: 'Chest',
    gogusIpucu: 'Around the fullest part of the chest, tape parallel to the floor.',
    bel: 'Waist',
    belIpucu: 'Around the narrowest part of the waist; do not hold your breath.',
    kalca: 'Hip',
    kalcaIpucu: 'Around the fullest part of the hips, feet together.',
    omuz: 'Shoulder width',
    omuzIpucu: 'Across the back, from one shoulder point to the other.',
    icBoy: 'Inseam',
    icBoyIpucu: 'From the crotch to the ankle, along the inside of the leg.',

    normalBeden: 'The size you usually wear',
    normalBedenIpucu:
      'When it conflicts with your measurements the engine says so; it never picks one silently.',
    kalipTercihi: 'Fit preference',
    kalipSlim: 'I prefer it roomy',
    kalipRegular: 'Regular',
    kalipOversize: 'I prefer it fitted',

    ayrintiAc: 'More measurements (optional)',
    kaydet: 'Save measurements',
    kaydediliyor: 'Saving…',
    kaydedildi: 'Saved.',
    kaydedilemedi: 'Measurements could not be saved.',
    kisayolAciklama: 'The measurements behind your size recommendation.',
  },

  vitrin: {
    baslik: 'Independent brands, one place.',
    aciklama:
      'Discover products from independent brands, buy from several stores in a single basket — and see it on your own photo before you buy.',
    urunleriKesfet: 'Explore products',

    yeniGelenler: 'New arrivals',
    yeniGelenlerNot: 'The latest pieces added by our stores.',
    indirimdekiler: 'On sale',
    indirimdekilerNot: 'Products currently below their list price.',
    vitrinde: 'Featured',
    oneCikanlar: 'Featured',
    tumunuGor: 'See all',
    tumu: 'All',
    tumKategoriler: 'All categories',

    afistekiParcalar: 'Items in this banner',

    nasilCalisir: 'How it works',
    nasilCalisirNot:
      'Virtual try-on in three steps; your photo is kept or deleted afterwards, whichever you choose.',
    adim1Baslik: 'Upload your photo',
    adim1Metin:
      'A single full-length photo is enough. You choose whether it is used only for this try-on or saved to your profile.',
    adim2Baslik: 'Pick a product',
    adim2Metin:
      'Press "Try it on" on any item you like. You can combine pieces from different stores into one outfit.',
    adim3Baslik: 'Judge the result',
    adim3Metin:
      'Visual similarity and size fit are shown as separate scores — looking good and fitting well are different questions.',

    ozellikler: 'What you can do',
    ozelliklerNot: 'Everything here works today — nothing on this list is "coming soon".',
    ozellikDeneme: 'Virtual try-on',
    ozellikDenemeMetin: 'On your own photo: tops, bottoms, dresses and outerwear.',
    ozellikKombin: 'Cross-brand outfits',
    ozellikKombinMetin:
      'One store\u2019s jacket, another\u2019s trousers — same image, one basket.',
    ozellikBeden: 'Size recommendation',
    ozellikBedenMetin:
      'From your measurements and return feedback; when confidence is low you get the size chart, not a guess.',
    ozellikDanisman: 'Style advisor',
    ozellikDanismanMetin: 'AI that reads your wardrobe and favourites and suggests outfits.',
    ozellikGardirop: 'Digital wardrobe',
    ozellikGardiropMetin: 'Items you buy are added to your wardrobe automatically.',
    ozellikArama: 'Natural language search',
    ozellikAramaMetin: 'Type "something for a wedding" instead of wrestling with filters.',

    koleksiyonlar: 'Collections',
    kategoriler: 'Categories',
    koleksiyonlarNot: 'Entry points curated around what you are looking for.',
    magazalar: 'Stores',
    magazalarNot:
      'Every store manages its own products; you buy pieces from several of them in a single basket.',
    magazaUrunSayisi: '{adet} products in this selection',

    saticiOl: 'Sell your brand here',
    saticiOlMetin:
      'A marketplace built for small brands: you manage your own products while payments and shipping run on the platform. Work out the commission and your payout in advance.',
    saticiOlDugme: 'Calculate payout',
    danismanBaslik: 'Not sure what to wear?',
    danismanMetin:
      'The style advisor weighs what is already in your wardrobe together with what you liked, then suggests outfits.',
    danismanDugme: 'Ask the advisor',
  },

  panel: {
    sekmeler: 'Status filter',
    sonrakiSayfa: 'Next page',
    /** ⚠️ "Previous page" DEĞİL — imleçli sayfalamada geri anahtarı yoktur. */
    ilkSayfa: 'Back to first page',
    listeSonu: 'You have reached the end of the list.',
    bosListe: 'No records yet.',
    bosSuzgec: 'No records match this filter.',
    suzgeciTemizle: 'Clear filter',
    ozetHatasi: 'The summary could not be loaded.',
  },

  hata: {
    beklenmeyen: 'Something went wrong.',
    istekNo: 'Request ID: {requestId}',
    geriSayim: 'You can try again in {dakika, plural, one {# minute} other {# minutes}}.',
    siparislerimeGit: 'Go to my orders',
  },

  alanHatasi: {
    zorunlu: 'This field is required.',
    cokKisa: 'The value entered is too short.',
    cokUzun: 'The value entered is too long.',
    bicim: 'The format is invalid.',
    secim: 'Invalid selection.',
    eposta: 'Enter a valid email address.',
    gecersiz: 'The value entered is invalid.',
  },

  urun: {
    sepeteEkle: 'Add to Cart',
    uzerimdeDene: 'Try It On',
    tukendi: 'Out of stock',
    sonucYok: 'No products match your criteria.',
    gorselYok: 'No product image',
  },

  durum: {
    urun: {
      DRAFT: 'Draft',
      PENDING_REVIEW: 'In review',
      PUBLISHED: 'Published',
      REJECTED: 'Rejected',
      ARCHIVED: 'Archived',
    },
    satici: {
      PENDING: 'Application pending',
      APPROVED: 'Approved',
      SUSPENDED: 'Suspended',
      REJECTED: 'Rejected',
    },
    siparis: {
      PENDING_PAYMENT: 'Awaiting payment',
      PAYMENT_FAILED: 'Payment failed',
      EXPIRED: 'Expired',
      PAID: 'Paid',
      PARTIALLY_SHIPPED: 'Partially shipped',
      SHIPPED: 'Shipped',
      DELIVERED: 'Delivered',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
      REFUNDED: 'Refunded',
    },
    paket: {
      AWAITING_APPROVAL: 'Awaiting seller approval',
      PREPARING: 'Being prepared',
      SHIPPED: 'Shipped',
      DELIVERED: 'Delivered',
      CANCELLED: 'Cancelled',
      RETURN_REQUESTED: 'Return request open',
      RETURNED: 'Return received',
    },
    iade: {
      REQUESTED: 'Request received',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      IN_TRANSIT: 'On its way',
      RECEIVED: 'Received by seller',
      REFUNDED: 'Refund issued',
      CANCELLED: 'Cancelled',
    },
  },

  iadeSebebi: {
    SIZE_TOO_SMALL: 'The size was too small',
    SIZE_TOO_LARGE: 'The size was too large',
    NOT_AS_DESCRIBED: 'The item does not match the description',
    DAMAGED: 'The item arrived damaged',
    WRONG_ITEM: 'The wrong item was sent',
    CHANGED_MIND: 'I changed my mind',
    QUALITY: 'The quality is not what I expected',
    OTHER: 'Other',
  },

  tryonKategori: {
    UPPER_BODY: 'Tops',
    LOWER_BODY: 'Bottoms',
    DRESS: 'Dresses',
    OUTERWEAR: 'Outerwear',
    SHOES: 'Shoes',
    JEWELRY: 'Jewellery',
    BAG: 'Bags',
    ACCESSORY: 'Accessories',
  },

  medyaYukleme: {
    dosyaSecin: 'Choose a file first.',
    bicimGecersiz: 'Only JPG, PNG or WebP files can be uploaded.',
    boyutAsildi: 'The file can be at most {mb} MB.',
    /**
     * ⚠️ Does NOT say "try again" — retrying cannot work. Measured
     *    (`infra/R2-CORS.md`): the private bucket has no CORS rules, so the
     *    preflight returns 403 while `curl PUT` to the same URL returns 200.
     *    This is a bucket setting, not a transient failure.
     */
    depoEngellendi:
      'The file could not be uploaded to storage: the browser request was blocked by the storage service. This is not a problem with the file — until CORS rules are applied to the R2 bucket (infra/r2-cors.json), no browser upload can complete. Retrying will not change the result. The same error also appears if your connection dropped.',
    depoHatasi: 'The file could not be uploaded to storage (HTTP {durum}).',
  },

  siteGorselleri: {
    baslik: 'Site images',
    aciklama:
      'Storefront banners and cover images are managed here. These are SITE images, not product photos: they are independent of seller uploads and stay in place even if a product is unpublished.',
    yuzeySekmesi: 'Image surface',
    kategoriOkunamadi:
      'The category list could not be loaded, so no new cover can be uploaded on this tab. Please refresh the page.',

    slot: {
      HERO: 'Storefront banner',
      CATEGORY_COVER: 'Category cover',
      COLLECTION_COVER: 'Collection cover',
    },

    bos: {
      HERO: 'No storefront banner is defined — the home page still works.',
      HEROAciklama:
        'While no banner is defined, the home page storefront shows the photo of the first product in the list. Publishing an uploaded banner replaces it; unpublishing it returns the site to the first product’s image.',
      CATEGORY_COVER: 'No category has a cover image.',
      CATEGORY_COVERAciklama:
        'A category page without a cover is drawn without one and does not break. When uploading a cover you must choose which category it belongs to.',
      COLLECTION_COVER: 'No collection has a cover image.',
      COLLECTION_COVERAciklama:
        'Collection copy is defined in code and cannot be edited here; the only managed item is the cover image. A collection without a cover is drawn without one.',
    },

    alan: {
      baslik: 'Title',
      altBaslik: 'Subtitle',
      bagAdresi: 'Link target',
      sira: 'Order',
      istegeBagli: '(optional)',
      bagIpucu:
        'An in-site path starting with a single slash (e.g. /collection/denim). External addresses are rejected.',
      vazgec: 'Cancel',
    },

    yukle: {
      dugme: 'Upload {yuzey}',
      formBasligi: 'New image — {yuzey}',
      dosya: 'File',
      dosyaIpucu:
        'JPG, PNG or WebP · at most {mb} MB. The storefront banner is cropped wide (16/7); a narrow image loses its top and bottom.',
      kategori: 'Category',
      koleksiyon: 'Collection',
      secin: 'Select…',
      kategoriIpucu:
        'The cover is bound to the category id, not its address: the cover stays in place even if the category address changes.',
      koleksiyonIpucu: 'Collection copy is defined in code; only the cover image is managed here.',
      pasifUyarisi:
        'An uploaded image starts out unpublished; use “Publish” on its row to make it visible on the site.',
      sonuc: 'Image uploaded ({en}×{boy}). You can publish it from the list below.',
      adimBilet: 'Requesting address…',
      adimYukleme: 'Uploading…',
      adimOnay: 'Processing…',
      gonder: 'Upload',
    },

    satir: {
      basliksiz: 'Untitled image',
      yayinda: 'Published',
      pasif: 'Unpublished',
      hedef: 'Target: {etiket}',
      hedefYok: 'not found ({anahtar}) — this cover is not shown on the site',
      siraNo: 'order {n}',
      bag: 'link: {yol}',
      yayinaAl: 'Publish',
      yayindanKaldir: 'Unpublish',
      duzenle: 'Edit',
      kaydediliyor: 'Saving…',
      medyaAdresiYok: 'Media address is not configured (NEXT_PUBLIC_MEDIA_URL)',
      sil: 'Delete',
      silOnay: 'Delete the image permanently',
      silEngeli:
        'A published image cannot be deleted — unpublish it first, check the site, then delete.',
    },

    kartlar: {
      baslik: 'Product cards on the banner',
      bos: 'No cards selected. The banner is shown on its own and no “Try It On” button appears on the home page. Select 2-3 products to show try-on right on the banner.',
      denemeKapali: 'Try-on unavailable — the card shows only “Add to Cart”',
      denemeKapaliKisa: 'Try-on unavailable',
      varyantYok: 'No active variant — “Add to Cart” will not appear either',
      kaldir: 'Remove',
      urunEkle: 'Add product',
      dolu: 'The card slots are full. Remove one to add another product.',
      urunAra: 'Search products',
      ornek: 'linen shirt',
      araniyor: 'Searching…',
      sonucYok: 'No published product matches. An unpublished product cannot be linked to a card.',
      ekle: 'Add',
      ekli: 'Added',
      kismiUyari:
        'The “Try-on unavailable” badge here reads only half of the gate; the definitive state appears in the list once the card is added. A product without try-on can still be selected — its card shows only “Add to Cart”.',
    },
  },
} satisfies Sozluk;
