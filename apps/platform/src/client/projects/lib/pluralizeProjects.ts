/**
 * Плюрализация счётчика в шапке экрана «Проекты».
 * По русским правилам: «1 проект», «2 проекта», «5 проектов».
 */
export const pluralizeProjects = (count: number): string => {
  const abs = Math.abs(count) % 100;
  const tens = abs % 10;

  if (abs > 10 && abs < 20) return `${count} проектов`;
  if (tens > 1 && tens < 5) return `${count} проекта`;
  if (tens === 1) return `${count} проект`;
  return `${count} проектов`;
};
