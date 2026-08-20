import type React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Состояние скина, общее для DOM-оверлея размеров (задача 0060) и панелей конструктора (задача 0061). Два
 * факта, которых нет ни в документе, ни в `ToolState`:
 *
 * 1. **Фокус в поле длины** (решение 3): полосе подсказки клавиш нужны две строки нормативной таблицы
 *    handoff'а («фокус в поле длины», «выделено ребро, правка длины»), а автомат инструментов про фокус в DOM
 *    не знает и знать не должен — событий о фокусе на шине нет (инварианты `packages/planner/CLAUDE.md`:
 *    «События — свершившиеся факты» домена, без UI-подсказок).
 * 2. **Тумблеры подписей** (решение 15, спека 07 «Автоматические размеры на стенах»): переключатели «Размеры»,
 *    «Имя комнаты», «Площадь» живут в панели инструментов, а рисует подписи оверлей. В документе полей под
 *    них нет (`DocumentSettings = { units, wallHeight }`), команды тоже нет — до отдельного решения флаги
 *    живут в скине и с проектом не сохраняются (спека 07 «Персистентность» ждёт своего шага).
 *
 * **Почему три контекста, а не один.** Значение видимости меняется редко, фокус — на каждый клик в поле;
 * общий объект перерисовывал бы подписчиков тумблеров на каждую смену фокуса. Сеттеры вынесены отдельно и
 * стабильны по ссылке — эффект-публикатор от них не перезапускается.
 *
 * **Вне провайдера** хуки отдают дефолты и no-op-сеттеры, а не бросают: панель 0061 может отрендериться
 * раньше провайдера, и падать из-за декоративного флага целому редактору неправильно.
 */

/** Что сейчас в фокусе среди полей длины — источник для контекстной подсказки клавиш (решение 3, задача 0061). */
export interface LengthInputFocus {
  /** `drawing` — Enter ставит точку; `editing` — Enter применяет длину/ширину. */
  mode: 'drawing' | 'editing';
  /** Видимых полей больше одного — Tab есть куда переносить. */
  hasSiblings: boolean;
}

/** Тумблеры подписей холста (спека 07 «Автоматические размеры на стенах», handoff «Панель инструментов»). */
export interface LabelVisibility {
  dimensions: boolean;
  roomName: boolean;
  roomArea: boolean;
}

/** Все три подписи включены — дефолт handoff'а («три переключателя … все включены»). */
export const DEFAULT_LABEL_VISIBILITY: LabelVisibility = Object.freeze({
  dimensions: true,
  roomName: true,
  roomArea: true,
});

interface OverlaySetters {
  setLabelVisibility: (patch: Partial<LabelVisibility>) => void;
  reportLengthFocus: (focus: LengthInputFocus | null) => void;
}

/** Вне провайдера сеттеры существуют, но ничего не делают — и остаются стабильной ссылкой. */
const NO_SETTERS: OverlaySetters = Object.freeze({
  setLabelVisibility: () => {},
  reportLengthFocus: () => {},
});

const LabelVisibilityContext = createContext<LabelVisibility>(DEFAULT_LABEL_VISIBILITY);
const LengthFocusContext = createContext<LengthInputFocus | null>(null);
const SettersContext = createContext<OverlaySetters>(NO_SETTERS);

const sameFocus = (a: LengthInputFocus | null, b: LengthInputFocus | null): boolean =>
  a === b || (a !== null && b !== null && a.mode === b.mode && a.hasSiblings === b.hasSiblings);

export const PlannerOverlayProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [labelVisibility, setVisibility] = useState<LabelVisibility>(DEFAULT_LABEL_VISIBILITY);
  const [lengthFocus, setFocus] = useState<LengthInputFocus | null>(null);

  const setLabelVisibility = useCallback((patch: Partial<LabelVisibility>): void => {
    setVisibility(previous => {
      const next = { ...previous, ...patch };
      const changed = (Object.keys(next) as (keyof LabelVisibility)[]).some(key => next[key] !== previous[key]);
      return changed ? next : previous;
    });
  }, []);

  // Сравнение по содержимому: оверлей пересобирает объект фокуса на своих ре-рендерах, а подписчики не должны
  // просыпаться на каждый `pointerMove`.
  const reportLengthFocus = useCallback((focus: LengthInputFocus | null): void => {
    setFocus(previous => (sameFocus(previous, focus) ? previous : focus));
  }, []);

  const setters = useMemo<OverlaySetters>(
    () => ({ setLabelVisibility, reportLengthFocus }),
    [setLabelVisibility, reportLengthFocus],
  );

  return (
    <SettersContext value={setters}>
      <LabelVisibilityContext value={labelVisibility}>
        <LengthFocusContext value={lengthFocus}>{children}</LengthFocusContext>
      </LabelVisibilityContext>
    </SettersContext>
  );
};

/** Текущие тумблеры подписей; вне провайдера — дефолт (всё включено). */
export const usePlannerLabelVisibility = (): LabelVisibility => useContext(LabelVisibilityContext);

/** Переключение тумблеров подписей: патч по одному-двум флагам, ссылка сеттера стабильна. */
export const useSetPlannerLabelVisibility = (): ((patch: Partial<LabelVisibility>) => void) =>
  useContext(SettersContext).setLabelVisibility;

/** Фокус в полях длины для полосы подсказки клавиш (решение 3); `null` — фокуса нет. */
export const usePlannerLengthFocus = (): LengthInputFocus | null => useContext(LengthFocusContext);

/** Внутренний канал оверлея; панели им не пользуются. */
export const useReportLengthFocus = (): ((focus: LengthInputFocus | null) => void) =>
  useContext(SettersContext).reportLengthFocus;
