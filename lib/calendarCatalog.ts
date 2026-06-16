export interface CalendarDesign {
  slug: string;
  name: string;
}

export const CALENDAR_CATALOG: CalendarDesign[] = [
  { slug: 'global-festival', name: 'Global Festival' },
  { slug: 'minimal-dark', name: 'Minimal DARK' },
  { slug: 'mu-te-lu', name: 'Mu Te Lu' },
  { slug: 'phra-racha-nai-duang-jai', name: 'พระราชาในดวงใจ' },
  { slug: 'tang-toe-jin-yer', name: 'ตั้งโต๊ะจีนเยอะ' },
  { slug: 'two-tone', name: 'TwoTone' },
  { slug: 'raeng-banda-jai', name: 'แรงบันดาลใจ' },
  { slug: 'cat-meaw', name: 'Cat-Meaw' },
  { slug: 'planner-post-it', name: 'Planner Post-it' },
  { slug: 'capybara', name: 'คาบีบาร่า' },
];

const VALID_SLUGS = new Set(CALENDAR_CATALOG.map((d) => d.slug));

export function isValidDesignSlug(slug: string): boolean {
  return VALID_SLUGS.has(slug);
}
