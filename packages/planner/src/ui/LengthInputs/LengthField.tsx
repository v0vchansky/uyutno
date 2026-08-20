import type React from 'react';
import { useCallback, useState } from 'react';

import type { EdgePlacement } from '../../document/geometry/measure/labelPlacement';
import type { LengthFieldDescriptor } from './lengthFields';

/**
 * Одно поле ввода длины (или статическая подпись, если сегмент короче порога инпута) — handoff
 * `docs/ui/handoffs/planner/planner-editor-ui.md`, разделы «Поле ввода длины», «Подписи», «Доступность»;
 * числа стилей — из прототипа `Planner P0 Constructor.dc.html` (блок `e4`, сцены 13/14 в `e8`).
 *
 * Стили инлайновые, цвета — CSS-переменные темы платформы: пакет не знает её CSS-стека (ADR 0015 A8) и не
 * должен зависеть от того, сканирует ли её сборка `packages/planner` — та же причина, что у канвасов в
 * `ui/Planner/Planner.tsx`.
 *
 * Поле повёрнуто по углу ребра (`placement.angle` уже с авторазворотом, `document/geometry/measure/labelPlacement.ts`),
 * а **плашка ошибки поворот не наследует** (решение 5): на вертикальной стене текст в ней был бы нечитаем.
 * Поэтому компонент отдаёт два соседних абсолютных элемента, а не вкладывает плашку в повёрнутую обёртку.
 *
 * TODO (задача 0060, вынесено в «нужно от дизайна»): анимационной подсказки-стрелки «куда поедет геометрия»
 * (спека 07 «Правка размера по клику», handoff «Подсказка-стрелка») здесь нет — в поставке нет ни правил
 * анимации, ни геометрии стрелки на повёрнутом поле.
 */
export interface LengthFieldProps {
  field: LengthFieldDescriptor;
  /** Что показать: черновик пользователя или отформатированное значение (в том числе живой пересчёт пары). */
  text: string;
  /** Суффикс единиц — `см` / `м` / `мм`, **снаружи рамки** (handoff «Поле ввода длины»). */
  suffix: string;
  focused: boolean;
  /** Сфокусировано парное поле — это поле пассивное (handoff, строка «пассивное поле пары»). */
  passive: boolean;
  /** Текст ошибки; `null` — ошибки нет. */
  error: string | null;
  onChange: (raw: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Реестр DOM-узлов: по нему оверлей переносит фокус по Tab на соседнее поле. */
  registerInput: (key: string, input: HTMLInputElement | null) => void;
}

/** Высота поля и радиус — прототип, блок `e4`; `tabular-nums` держит ширину цифр (handoff «Поле ввода длины»). */
const FIELD_BASE: React.CSSProperties = {
  height: 26,
  padding: '0 8px',
  borderRadius: 8,
  fontSize: 12,
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--foreground)',
  border: 'none',
  outline: 'none',
  textAlign: 'center',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Ширина по содержимому: `Nch` под текст плюс 16 px горизонтальных паддингов. Минимум два знака — иначе поле
 * скакало бы на каждый символ в начале ввода.
 */
const fieldWidth = (text: string): string => `calc(${Math.max(2, text.length)}ch + 16px)`;

/** Обёртка поля: повёрнута под ребро, центр — на точке привязки подписи. */
const wrapperStyle = (placement: EdgePlacement, interactive: boolean): React.CSSProperties => ({
  position: 'absolute',
  left: placement.x,
  top: placement.y,
  transform: `translate(-50%, -50%) rotate(${placement.angle}deg)`,
  transformOrigin: 'center',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
  // Статическая подпись кликов не принимает: редактировать в ней нечего, а клик должен уйти в холст.
  pointerEvents: interactive ? 'auto' : 'none',
});

/**
 * Шесть состояний таблицы handoff'а «Поле ввода длины». Порядок проверок — по приоритету: ошибка перекрывает
 * фокус, фокус — наведение, наведение — пассивность пары.
 */
const stateStyle = (state: {
  focused: boolean;
  hovered: boolean;
  passive: boolean;
  invalid: boolean;
}): React.CSSProperties => {
  if (state.invalid) return { background: 'var(--surface)', boxShadow: '0 0 0 2px var(--danger)' };
  if (state.focused) return { background: 'var(--surface)', boxShadow: '0 0 0 2px var(--accent)' };
  if (state.hovered) return { background: 'var(--surface)', boxShadow: '0 0 0 1px var(--accent)' };
  if (state.passive) {
    return { background: 'var(--surface)', boxShadow: '0 0 0 1px var(--border)', color: 'var(--muted)' };
  }
  return { background: 'transparent', boxShadow: 'none' };
};

/** Плашка ошибки: всегда горизонтальна, под точкой привязки, кликов не принимает (решение 5). */
const errorPlateStyle = (placement: EdgePlacement): React.CSSProperties => ({
  position: 'absolute',
  left: placement.x,
  top: placement.y + 20,
  transform: 'translate(-50%, 0)',
  height: 24,
  padding: '0 8px',
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  background: 'var(--surface)',
  boxShadow: '0 2px 8px rgb(0 0 0 / 0.10)',
  fontSize: 12,
  color: 'var(--danger)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
});

const SUFFIX_STYLE: React.CSSProperties = { fontSize: 11, color: 'var(--muted)' };

export const LengthField: React.FC<LengthFieldProps> = ({
  field,
  text,
  suffix,
  focused,
  passive,
  error,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  registerInput,
}) => {
  const [hovered, setHovered] = useState(false);
  const errorId = `${field.key}-error`;

  /**
   * Ref-колбэк обязан быть стабильным: инлайновая стрелка меняет идентичность на каждый рендер, и React на
   * каждом рендере отвязывал бы узел (`ref(null)`) и привязывал заново — оверлей принимал бы это за уход поля
   * с экрана и снимал фокус.
   */
  const setInput = useCallback(
    (input: HTMLInputElement | null): void => {
      registerInput(field.key, input);
    },
    [registerInput, field.key],
  );

  return (
    <>
      <div style={wrapperStyle(field.placement, field.editable)}>
        {field.editable ? (
          <input
            type='text'
            inputMode='decimal'
            aria-label={field.ariaLabel}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            value={text}
            ref={setInput}
            style={{
              ...FIELD_BASE,
              width: fieldWidth(text),
              ...stateStyle({ focused, hovered, passive, invalid: error !== null }),
            }}
            onChange={event => onChange(event.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          />
        ) : (
          // Ниже порога инпута это просто текст: ни фокуса, ни `tabIndex` (handoff «Доступность»: Tab обходит
          // только видимые поля).
          <span style={{ ...FIELD_BASE, width: fieldWidth(text), background: 'transparent', boxShadow: 'none' }}>
            {text}
          </span>
        )}
        <span style={SUFFIX_STYLE}>{suffix}</span>
      </div>
      {error !== null && (
        <div id={errorId} style={errorPlateStyle(field.placement)}>
          {error}
        </div>
      )}
    </>
  );
};
