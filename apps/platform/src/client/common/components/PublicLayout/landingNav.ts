export interface LandingNavItem {
  href: string;
  label: string;
}

export const LANDING_NAV_ITEMS: ReadonlyArray<LandingNavItem> = [
  { href: '#features', label: 'Возможности' },
  { href: '#how', label: 'Как это работает' },
  { href: '#faq', label: 'Вопросы' },
];
