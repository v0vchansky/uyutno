import { Button, Modal, useOverlayState } from '@heroui/react';
import type React from 'react';
import { Link } from 'react-router';

import { Route } from '../../../../shared/router/routes';
import type { SaveAlertView } from '../../hooks/saveIndicatorState';

/** Габарит кнопки действия из макета: 40px, боковой padding 12px, 15px/500 — тот же, что у модалок открытия. */
const ACTION = 'h-10 whitespace-nowrap px-3 text-[15px] font-medium';

/** «В галерею» — переход, поэтому ссылка: она обязана открываться средствами браузера. Вид — вторичная кнопка. */
const GALLERY_LINK = `${ACTION} inline-flex cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] text-[color:var(--accent-foreground)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]`;

const SECONDARY = `${ACTION} bg-[var(--surface-secondary)] text-[color:var(--foreground)]`;

interface Props {
  view: SaveAlertView;
  /** Снимает ждущий отказ в `persistence` — единственный способ убрать модалку без нового сохранения. */
  onDismiss: () => void;
  /** Повторяет **ручное** сохранение; для веток офлайна и «Проект удалён» не зовётся — повторять нечего. */
  onRetry: () => void;
}

/**
 * Модалка отказа **ручного** сохранения (задача 0084; handoff, «Индикатор состояния сохранения»; прототип
 * `Planner Editor Shell.dc.html`, кадры `s3`).
 *
 * Носителей ровно два, и граница между ними жёсткая: ручное действие пользователя → модалка, фоновое →
 * тихая иконка. Поэтому сюда попадает только `alert` из `persistence`, а его заводит один лишь
 * `save('manual')` — ошибка автосейва модалку не поднимает ни при каких обстоятельствах.
 *
 * Три ветки — три состава кнопок:
 * - **офлайн** — «Понятно»: повторять нечего, сохранение продолжится само; статус в шапке при этом
 *   остаётся и снимается только с возвратом сети (единственное место, где статус и модалка живут вместе);
 * - **«Проект удалён»** (404 во второй вкладке) — единственная кнопка «В галерею» на `/projects`:
 *   сохранять больше некуда;
 * - **прочий отказ** — «Отмена» и «Повторить» с текстом сервера, если он что-то внятное сказал.
 *
 * Закрытие по Esc и клику мимо оставлено намеренно — в отличие от модалок открытия проекта: там за
 * модалкой пустой экран и выхода нет, а здесь под ней живой редактор с работой пользователя, и запирать
 * его диалогом нельзя. Любое закрытие идёт через `dismissAlert()`, то есть состояние движка и экран не
 * расходятся.
 */
export const SaveErrorModal: React.FC<Props> = ({ view, onDismiss, onRetry }) => {
  const state = useOverlayState({ isOpen: true, onOpenChange: open => !open && onDismiss() });

  return (
    <Modal state={state}>
      <Modal.Backdrop className='bg-black/40'>
        <Modal.Container placement='center'>
          <Modal.Dialog className='flex w-full max-w-[400px] flex-col gap-4 rounded-3xl bg-[var(--surface)] p-6 shadow-xl outline-none'>
            <Modal.Heading className='m-0 text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]'>
              {view.title}
            </Modal.Heading>

            <p className='m-0 text-[14px] leading-[1.55] text-pretty text-[color:var(--muted)]'>{view.text}</p>

            <div className='flex justify-end gap-2'>
              {view.kind === 'offline' && (
                <Button autoFocus onPress={onDismiss} className={ACTION}>
                  Понятно
                </Button>
              )}

              {view.kind === 'not-found' && (
                <Link to={Route.Projects} className={GALLERY_LINK}>
                  В галерею
                </Link>
              )}

              {view.kind === 'unknown' && (
                <>
                  <Button onPress={onDismiss} className={SECONDARY}>
                    Отмена
                  </Button>
                  <Button autoFocus onPress={onRetry} className={ACTION}>
                    Повторить
                  </Button>
                </>
              )}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};
