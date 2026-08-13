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
    hesaplayici: 'Size calculator',
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

  vitrin: {
    baslik: 'See it on you before you buy.',
    aciklama:
      'Use virtual try-on to see how a garment looks on you, and check the fit with a separate score.',
    urunleriKesfet: 'Explore products',
    vitrinde: 'Featured',
    oneCikanlar: 'Featured',
    tumunuGor: 'See all',
    tumu: 'All',
    tumKategoriler: 'All categories',

    nasilCalisir: 'How it works',
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
      'Try pieces from different stores in the same outfit and buy them in a single basket.',
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
} satisfies Sozluk;
