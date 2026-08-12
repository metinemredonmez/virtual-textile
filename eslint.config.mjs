// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

/**
 * PARA OKUMA YASAĞI — sözdizimsel seçiciler.
 *
 * Tip-farkında kural KULLANILMIYOR: kökte `parserOptions.project` yok ve açmak
 * tüm deponun lint süresini katlar. Sözdizimsel seçici `Minor` sonekini okur —
 * sonek tesadüf değil, `serializeBigInts`in dokunduğu her alan onu taşıyor.
 *
 * ⚠️ SONEK YÜK TAŞIR: bir para alanını frontend'de `total` diye yeniden
 *    adlandırmak, o alan üzerindeki `Number()` korumasını SESSİZCE kapatır.
 *    Wire tipinde para alanı adı değiştirilmez.
 */
const NUMBER_CALL = 'CallExpression[callee.name=/^(Number|parseInt|parseFloat)$/]';
const PARA_MESAJI =
  'Para alanı Number/parseInt ile okunamaz — sessizce yanlış tutar gösterir. lib/money.ts → readMinor/formatMinor kullan.';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Bölüm 5.2 — modül sınırı: hiçbir modül başka modülün iç dosyasına giremez.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/!(index|*.service|*.types)'],
              message:
                'Modül sınırı ihlali: bir modülün yalnızca index / *.service / *.types dosyaları dışarıdan import edilebilir.',
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // NestJS bağımlılık enjeksiyonu, `emitDecoratorMetadata` ile üretilen
    // `design:paramtypes` verisine dayanır ve bu veri SINIF REFERANSINI
    // gerektirir. Bir servisi `import type` ile içeri almak referansı derleme
    // sırasında siler; Nest çalışma zamanında "bağımlılık çözümlenemedi" der.
    // Kural burada bilinçli olarak kapalıdır — otomatik düzeltme uygulamayı bozar.
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // ⚠️ `consistent-type-imports` apps/web'de KAPATILMAZ. Burada dekoratör/DI
    //    yok, dolayısıyla yukarıdaki muafiyetin gerekçesi geçerli değil; üstelik
    //    `import type` bir sunucu-only modülün istemci paketine sızmasını
    //    engellediği için web'de daha da değerli.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // ⚠️ `exhaustive-deps` olmadan try-on yoklama döngüsündeki stale-closure
      //    hatası (iş SUCCEEDED, arayüz sonsuza kadar RUNNING) hiçbir yerde
      //    yakalanmaz — testler taklit zamanlayıcıyla yeşil kalır.
      'react-hooks/exhaustive-deps': 'error',

      'no-restricted-syntax': [
        'error',
        { selector: `${NUMBER_CALL} > MemberExpression[property.name=/Minor$/]`, message: PARA_MESAJI },
        // obj['unitPriceMinor'] — nokta gösterimi kadar geçerli bir kaçış yolu.
        { selector: `${NUMBER_CALL} > MemberExpression[property.value=/Minor$/]`, message: PARA_MESAJI },
        // const { totalMinor } = cart;  Number(totalMinor)
        { selector: `${NUMBER_CALL} > Identifier[name=/Minor$/]`, message: PARA_MESAJI },
        { selector: "UnaryExpression[operator='+'] > MemberExpression[property.name=/Minor$/]", message: PARA_MESAJI },
        { selector: "UnaryExpression[operator='+'] > Identifier[name=/Minor$/]", message: PARA_MESAJI },
      ],

      // ⚠️ `@vt/db` apps/web'in bağımlılık listesinde YOK; bu kural ikinci
      //    savunma hattı, çünkü pnpm isolated linker bir gün gevşetilirse
      //    Prisma istemcisi tarayıcı paketine girmeye çalışır.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@vt/db',
              message:
                'Veritabanı istemcisi frontend paketine giremez. Veri API üzerinden alınır.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'packages/db/prisma/seed.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
