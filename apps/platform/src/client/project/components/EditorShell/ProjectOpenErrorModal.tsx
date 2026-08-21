import { Button, Modal, useOverlayState } from '@heroui/react';
import type React from 'react';
import { Link } from 'react-router';

import { Route } from '../../../../shared/router/routes';

/** Какой из двух отказов открытия показывается (спека 10, «Ошибочные сценарии»). */
export type ProjectOpenErrorKind = 'failed' | 'unsupported-version';

interface Props {
  kind: ProjectOpenErrorKind;
  /** Повторяет загрузку документа; для ветки «версия новее» не зовётся — там повторять нечего. */
  onRetry: () => void;
}

/**
 * Габарит кнопки действия из макета: высота 40px, боковой padding 12px, 15px/500, и **в одну строку** —
 * «Вернуться в галерею» иначе переносится и не помещается в ряд из двух кнопок на 400px.
 */
const ACTION = 'h-10 whitespace-nowrap px-3 text-[15px] font-medium';

/**
 * «Вернуться в галерею» — ссылка, а не кнопка: это переход, и он обязан открываться средствами браузера.
 * Оформление — вторичная кнопка из макета, те же цвета, что у «Отмена» в модалке переименования.
 */
const GALLERY_LINK = `${ACTION} inline-flex cursor-pointer items-center justify-center rounded-lg bg-[var(--surface-secondary)] text-[color:var(--foreground)] no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]`;

/**
 * Модалки отказа открытия проекта (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Состояния
 * экрана · оболочка» → «Ошибка открытия» и «Устаревшая версия формата»; прототип `Planner Editor
 * Shell.dc.html`, кадры «ошибка открытия» и «устаревшая версия формата»).
 *
 * Затемнение накрывает экран целиком, включая шапку (handoff, «Что перекрывает затемнение»), — это делает
 * сам `Modal.Backdrop` в портале. Закрыть модалку «мимо» нельзя: редактора за ней нет, и единственный
 * выход — одно из предложенных действий, поэтому `onOpenChange` состояние не меняет.
 *
 * **Названия кнопок ветки «битый проект» — из спеки 10** («Попробовать ещё раз» и «Вернуться в галерею»),
 * а не сокращённые подписи прототипа: при расхождении макета со спекой верна спека. Порядок и роли
 * кнопок макетные — вторичная слева, подтверждающая справа, фокус на подтверждающей.
 */
export const ProjectOpenErrorModal: React.FC<Props> = ({ kind, onRetry }) => {
  const state = useOverlayState({ isOpen: true, onOpenChange: () => undefined });

  return (
    <Modal state={state}>
      <Modal.Backdrop className='bg-black/40'>
        <Modal.Container placement='center'>
          <Modal.Dialog className='flex w-full max-w-[400px] flex-col gap-4 rounded-3xl bg-[var(--surface)] p-6 shadow-xl outline-none'>
            <Modal.Heading className='m-0 text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]'>
              {kind === 'failed' ? 'Не удалось открыть проект' : 'Обновите редактор'}
            </Modal.Heading>

            <p className='m-0 text-[14px] leading-[1.55] text-pretty text-[color:var(--muted)]'>
              {kind === 'failed'
                ? 'Файл проекта не читается. Можно попробовать ещё раз или вернуться в галерею.'
                : 'Проект сохранён более новой версией редактора. Обновите страницу, чтобы открыть его.'}
            </p>

            <div className='flex justify-end gap-2'>
              {kind === 'failed' ? (
                <>
                  <Link to={Route.Projects} className={GALLERY_LINK}>
                    Вернуться в галерею
                  </Link>
                  <Button autoFocus onPress={onRetry} className={ACTION}>
                    Попробовать ещё раз
                  </Button>
                </>
              ) : (
                /*
                 * Кнопка перезагружает вкладку, а не «обновляет редактор»: у нас веб, обновлять
                 * пользователю нечего — у него просто устаревший бандл во вкладке (ADR 0021).
                 */
                <Button autoFocus onPress={() => window.location.reload()} className={ACTION}>
                  Обновить страницу
                </Button>
              )}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};
