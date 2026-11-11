/**
 * Fictional demo catalogue for local development and tests. Brand and product names are
 * invented on purpose; do not seed real brands.
 */

type Layered = { top: string[]; middle: string[]; base: string[] };

type DemoProduct = {
  concentration: 'edt' | 'edp' | 'parfum';
  gender: 'male' | 'female' | 'unisex';
  subtitle: { vi: string; en: string };
  families: string[];
  notes: Layered;
  categories: string[];
  longevity: number;
  sillage: number;
  seasons: string[];
  occasions: string[];
  englishPublished: boolean;
  variants: {
    sizeMl: number;
    type: 'full_size' | 'travel' | 'tester';
    price: number;
    weightG: number;
    stock: number;
  }[];
};

export const demoCatalog = {
  families: [
    { key: 'woody', vi: 'Hương gỗ', en: 'Woody' },
    { key: 'floral', vi: 'Hương hoa', en: 'Floral' },
    { key: 'citrus', vi: 'Hương cam chanh', en: 'Citrus' },
    { key: 'amber', vi: 'Hương hổ phách', en: 'Amber' },
  ],
  notes: [
    { key: 'bergamot', vi: 'Cam bergamot', en: 'Bergamot' },
    { key: 'grapefruit', vi: 'Bưởi', en: 'Grapefruit' },
    { key: 'rose', vi: 'Hoa hồng', en: 'Rose' },
    { key: 'jasmine', vi: 'Hoa nhài', en: 'Jasmine' },
    { key: 'cedar', vi: 'Gỗ tuyết tùng', en: 'Cedarwood' },
    { key: 'sandalwood', vi: 'Gỗ đàn hương', en: 'Sandalwood' },
    { key: 'vanilla', vi: 'Vani', en: 'Vanilla' },
    { key: 'amber', vi: 'Hổ phách', en: 'Amber' },
  ],
  categories: [
    { key: 'men', vi: 'Nước hoa nam', en: "Men's fragrances" },
    { key: 'women', vi: 'Nước hoa nữ', en: "Women's fragrances" },
    { key: 'unisex', vi: 'Nước hoa unisex', en: 'Unisex fragrances' },
  ],
  brands: [
    {
      name: 'Maison Lumière',
      country: 'FR',
      lines: [
        {
          name: 'Cèdre Nocturne',
          products: [
            {
              concentration: 'edt',
              gender: 'male',
              subtitle: { vi: 'Gỗ tuyết tùng tươi mát', en: 'Fresh cedarwood' },
              families: ['woody', 'citrus'],
              notes: { top: ['bergamot', 'grapefruit'], middle: ['cedar'], base: ['sandalwood'] },
              categories: ['men'],
              longevity: 3,
              sillage: 3,
              seasons: ['spring', 'summer'],
              occasions: ['day', 'office'],
              englishPublished: true,
              variants: [
                { sizeMl: 100, type: 'full_size', price: 3_200_000, weightG: 450, stock: 12 },
                { sizeMl: 50, type: 'full_size', price: 2_300_000, weightG: 300, stock: 8 },
              ],
            },
            {
              concentration: 'edp',
              gender: 'male',
              subtitle: { vi: 'Gỗ ấm và hổ phách', en: 'Warm woods and amber' },
              families: ['woody', 'amber'],
              notes: { top: ['bergamot'], middle: ['cedar'], base: ['amber', 'sandalwood'] },
              categories: ['men'],
              longevity: 4,
              sillage: 4,
              seasons: ['autumn', 'winter'],
              occasions: ['night'],
              englishPublished: true,
              variants: [
                { sizeMl: 100, type: 'full_size', price: 3_900_000, weightG: 480, stock: 5 },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'Atelier Sương',
      country: 'VN',
      lines: [
        {
          name: 'Hoa Đêm',
          products: [
            {
              concentration: 'edp',
              gender: 'female',
              subtitle: {
                vi: 'Hoa nhài và hoa hồng về đêm',
                en: 'Night-blooming jasmine and rose',
              },
              families: ['floral'],
              notes: { top: ['bergamot'], middle: ['jasmine', 'rose'], base: ['vanilla'] },
              categories: ['women'],
              longevity: 4,
              sillage: 3,
              seasons: ['spring', 'autumn'],
              occasions: ['date', 'night'],
              englishPublished: false,
              variants: [
                { sizeMl: 75, type: 'full_size', price: 2_750_000, weightG: 380, stock: 10 },
                { sizeMl: 10, type: 'travel', price: 650_000, weightG: 60, stock: 30 },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'Ambre Studio',
      country: 'IT',
      lines: [
        {
          name: 'Soleil Ambré',
          products: [
            {
              concentration: 'parfum',
              gender: 'unisex',
              subtitle: { vi: 'Hổ phách và vani', en: 'Amber and vanilla' },
              families: ['amber', 'woody'],
              notes: {
                top: ['grapefruit'],
                middle: ['rose'],
                base: ['amber', 'vanilla', 'sandalwood'],
              },
              categories: ['unisex'],
              longevity: 5,
              sillage: 4,
              seasons: ['winter'],
              occasions: ['night', 'special'],
              englishPublished: true,
              variants: [
                { sizeMl: 50, type: 'full_size', price: 5_400_000, weightG: 350, stock: 4 },
              ],
            },
          ],
        },
      ],
    },
  ],
} satisfies {
  families: { key: string; vi: string; en: string }[];
  notes: { key: string; vi: string; en: string }[];
  categories: { key: string; vi: string; en: string }[];
  brands: { name: string; country: string; lines: { name: string; products: DemoProduct[] }[] }[];
};
