import { Separator } from '@heroui/react';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ProjectDto } from '../../../../shared/projects';

const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Слушает медиа-запрос и возвращает true/false. `null` на первом рендере (SSR/hydration),
 * чтобы не рендерить не тот вариант меню до подхвата CSS-переменной. По умолчанию, если
 * `window` ещё не готов (SSR), возвращаем `null`.
 */
const useIsDesktop = (isEnabled: boolean): boolean | null => {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.matchMedia(DESKTOP_QUERY).matches;
  });

  useEffect(() => {
    if (!isEnabled) return;
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const update = (): void => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [isEnabled]);

  return isDesktop;
};

interface Props {
  project: ProjectDto;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  isOpen: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const MENU_ITEMS = [
  { key: 'rename', label: 'Переименовать', icon: Pencil, danger: false },
  { key: 'duplicate', label: 'Дублировать', icon: Copy, danger: false },
  { key: 'delete', label: 'Удалить', icon: Trash2, danger: true },
] as const;

type MenuItemKey = (typeof MENU_ITEMS)[number]['key'];

/**
 * Меню карточки проекта. На десктопе (≥1024px) — Popover, прижатый к правому краю
 * триггера, справа под ним. До 1024px — bottom sheet с ручкой, именем проекта
 * и пунктами 44px.
 *
 * Свой лёгкий реализованный вручную дропдаун — та же причина, что и у
 * `ProfileMenu` (см. `common/PublicLayout/ProfileMenu.tsx`): HeroUI Popover/Dropdown
 * (React Aria) в non-modal режиме ломает outside-close/toggle, а modal — блокирует
 * скролл страницы. Здесь нужен точный контроль поведения — Escape, клик вне,
 * возврат фокуса на «…» — плюс раздельный десктоп/мобилка рендер.
 *
 * Точка перелома — 1024px, выбирается через CSS-медиа (`lg:` / `max-lg:`),
 * а не через JS-детект, чтобы не гонять пересчёты при resize.
 */
export const ProjectCardMenu: React.FC<Props> = ({
  project,
  triggerRef,
  isOpen,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
}) => {
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  const mobileSheetRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsDesktop(isOpen);

  const handleAction = useCallback(
    (key: MenuItemKey): void => {
      if (key === 'rename') onRename();
      else if (key === 'duplicate') onDuplicate();
      else if (key === 'delete') onDelete();
    },
    [onRename, onDuplicate, onDelete],
  );

  // Клик вне, Escape, скролл → закрыть. Возврат фокуса на триггер — по умолчанию через
  // ту же ссылку `triggerRef`. `useEffect` на `isOpen`, а не на монтировании — компонент
  // остаётся в дереве, но слушатели живут только пока открыт.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (desktopMenuRef.current?.contains(target)) return;
      if (mobileSheetRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose, triggerRef]);

  // Возврат фокуса на триггер после закрытия — только если фокус ушёл внутрь меню.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      // Ставим фокус на первый пункт, чтобы стрелки вверх/вниз сразу работали.
      const raf = requestAnimationFrame(() => {
        firstItemRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
    return undefined;
  }, [isOpen, triggerRef]);

  // Роняем скролл при открытии bottom sheet на мобилке.
  useEffect(() => {
    if (!isOpen) return;
    if (isDesktop !== false) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen, isDesktop]);

  // Стрелки вверх/вниз перемещают фокус между пунктами в дереве `role="menu"`.
  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const container = event.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIndex = items.findIndex(item => item === active);
    const nextIndex =
      event.key === 'ArrowDown'
        ? currentIndex >= items.length - 1
          ? 0
          : currentIndex + 1
        : currentIndex <= 0
          ? items.length - 1
          : currentIndex - 1;
    items[nextIndex]?.focus();
  };

  if (!isOpen) return null;
  // На первом рендере до подхвата media-query — ничего не рисуем, чтобы избежать
  // мигания «десктоп → мобилка» и наоборот. Это редкий кадр (только сразу после
  // открытия при холодном рендере), пользователь не заметит.
  if (isDesktop === null) return null;

  const renderMenuItems = (variant: 'desktop' | 'mobile'): React.ReactNode => {
    return MENU_ITEMS.map((item, index) => {
      const Icon = item.icon;
      const isDesktop = variant === 'desktop';
      const heightClass = isDesktop ? 'h-9' : 'h-11';
      const iconSize = isDesktop ? 16 : 20;
      const gapClass = isDesktop ? 'gap-2' : 'gap-3';
      const dangerClass = item.danger
        ? 'text-[color:#C63C2E] hover:bg-[color:#C63C2E] hover:text-white focus-visible:bg-[color:#C63C2E] focus-visible:text-white'
        : 'text-[color:var(--foreground)] hover:bg-[var(--surface-secondary)] focus-visible:bg-[var(--surface-secondary)]';

      const button = (
        <button
          key={item.key}
          ref={index === 0 ? firstItemRef : undefined}
          type='button'
          role='menuitem'
          onClick={() => handleAction(item.key)}
          className={`flex ${heightClass} w-full cursor-pointer items-center ${gapClass} rounded-lg border-0 bg-transparent px-3 text-left text-[14px] font-normal transition-colors focus:outline-none ${dangerClass}`}
        >
          <Icon size={iconSize} strokeWidth={1.5} aria-hidden='true' />
          {item.label}
        </button>
      );

      if (item.key === 'delete') {
        return (
          <div key='delete-group'>
            {/* Разделитель перед «Удалить» — библиотечный, как в `ProfileMenu` (задача 0093). */}
            <Separator className='mx-2 my-1 w-auto' />
            {button}
          </div>
        );
      }
      return button;
    });
  };

  const menuLabel = `Действия с проектом ${project.name}`;

  if (isDesktop) {
    // Десктоп: Popover справа под кнопкой «…», абсолютное позиционирование внутри
    // relative-обёртки триггера.
    return (
      <div
        ref={desktopMenuRef}
        role='menu'
        aria-label={menuLabel}
        onKeyDown={handleMenuKeyDown}
        className='absolute right-0 top-full z-50 mt-2 flex w-[200px] flex-col rounded-xl border border-[var(--separator)] bg-[var(--surface)] p-1 shadow-[0_2px_8px_rgb(0_0_0_/_0.10)]'
      >
        {renderMenuItems('desktop')}
      </div>
    );
  }

  // Мобилка: bottom sheet во всю ширину, портал в body, чтобы не оказаться внутри <Link>.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className='fixed inset-0 z-50 bg-black/40 motion-safe:animate-[uyutno-sheet-fade_180ms_ease-out]'
        aria-hidden='true'
        onClick={onClose}
      />
      <div
        ref={mobileSheetRef}
        role='menu'
        aria-label={menuLabel}
        onKeyDown={handleMenuKeyDown}
        className='fixed inset-x-0 bottom-0 z-50 flex w-full flex-col rounded-t-3xl bg-[var(--surface)] pt-2 pb-4 shadow-[0_-4px_20px_rgb(0_0_0_/_0.15)] motion-safe:animate-[uyutno-sheet-in_200ms_ease-out]'
      >
        <div className='mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--separator)]' aria-hidden='true' />
        <div className='border-b border-[var(--separator)] px-4 py-3 text-[15px] font-medium text-[color:var(--foreground)]'>
          <span className='block truncate'>{project.name}</span>
        </div>
        <div className='flex flex-col px-2 pt-2'>{renderMenuItems('mobile')}</div>
      </div>
    </>,
    document.body,
  );
};
