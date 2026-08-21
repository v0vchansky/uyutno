import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_WALL_WIDTH } from '../../document/geometry/band/blocksFromContour';
import { labelFits } from '../../document/geometry/measure/labelPlacement';
import { pointAtLength } from '../../document/geometry/measure/pointAtLength';
import type { PlanPosition } from '../../document/PlannerDocument';
import { usePlannerManager } from '../PlannerContext';
import { usePlannerLabelVisibility, useReportLengthFocus, type LengthInputFocus } from '../PlannerOverlayContext';
import { usePlannerSelector } from '../usePlannerSelector';
import { formatLength, unitSuffix } from './formatLength';
import { LengthField } from './LengthField';
import { buildLengthFields, previewFieldValue, type LengthFieldDescriptor } from './lengthFields';
import {
  lengthErrorText,
  MIN_INPUT_LENGTH,
  MIN_INPUT_WIDTH,
  resolveLength,
  sanitizeLengthInput,
  type LengthErrorKind,
} from './parseLength';
import { RoomLabels } from './RoomLabels';

/**
 * DOM-оверлей подписей и полей ввода длины поверх холста конструктора (ADR 0020 P2: подписи длин, поля ввода и
 * подписи комнат — не чертёжная графика, а обычная вёрстка над канвасом; ADR 0015 «слой ui»).
 *
 * Что делает: собирает поля кадра чистой `buildLengthFields`, показывает их значения в текущих единицах,
 * принимает ввод (посимвольная фильтрация, `parseLength.ts`) и отправляет результат в команды фасада —
 * `tools.commitPoint` / `tools.setDraftPoint` при рисовании, `document.setEdgeLength` / `document.setWallWidth`
 * при правке готовой геометрии. Своего состояния документа не держит: всё, кроме черновиков ввода и фокуса,
 * читается из фасада через `usePlannerSelector` (ADR 0015 A4).
 *
 * Клавиатуру глобально не слушает: пока фокус в поле, голые горячие клавиши редактора не срабатывают — это
 * обеспечивает единственный владелец клавиатуры (`isEditableTarget` в `projection/input/keymap.ts`), поэтому
 * `stopPropagation` здесь не нужен и не ставится (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`,
 * «Ввод»; ADR 0019 E5). Исключение — команды уровня документа, не конфликтующие с правкой текста: Ctrl/Cmd+S
 * работает и при фокусе в поле (`survivesEditableFocus`, задача `0094`).
 */

/**
 * Отказ команды → код ошибки поля. `too-short`/`duplicate-point` — «слишком мало» (введённая длина схлопнула
 * ребро или совпала с уже поставленной точкой), `out-of-range` — «слишком много», самопересечение — своя
 * строка. Всё остальное (`unknown-axis`, `unknown-point`, `degenerate-edge`, `not-drawing`, `invalid-point`,
 * `unknown-floor`, `unknown-draft-point`) пользователю не объяснить иначе, чем «так не получится»: это
 * рассинхрон UI и документа между вводом и коммитом.
 */
const COMMAND_ERROR: Readonly<Record<string, LengthErrorKind>> = {
  'too-short': 'too-small',
  'duplicate-point': 'too-small',
  'out-of-range': 'too-large',
  'contour-self-intersected': 'self-intersected',
};

const commandErrorKind = (kind: string): LengthErrorKind => COMMAND_ERROR[kind] ?? 'rejected';

/**
 * Относительные формы `+N` / `−N` принимают только поля правки **готовой** геометрии (спека 01 «Форматы
 * ввода»): у полей рисования «текущей длины», от которой считать дельту, ещё нет — там только абсолютная длина.
 */
const allowsRelative = (field: LengthFieldDescriptor): boolean =>
  field.target.kind === 'edge' || field.target.kind === 'wall-width';

/** Знак направления по оси: вырожденный случай (угол совпал с курсором) уводим вперёд, а не в ноль. */
const axisSign = (from: number, to: number): number => Math.sign(to - from) || 1;

/**
 * Оценка ширины знака подписи, CSS px: 12 px с табличными цифрами — примерно 0.6 em. Точных метрик шрифта
 * поставка не даёт (Заметки задачи 0060), а мерить реальный бокс значило бы второй проход layout'а на каждое
 * движение мыши.
 */
const TEXT_CHAR_WIDTH = 7.2;

/** Ширина подписи целиком: текст плюс горизонтальные паддинги поля (8 + 8) плюс суффикс единиц с зазором 4. */
const estimatedTextWidth = (text: string, suffix: string): number =>
  (text.length + suffix.length) * TEXT_CHAR_WIDTH + 20;

/**
 * Нижний порог поля. У ширины стены он **свой** — `MIN_INPUT_WIDTH = 1` см, а не пол длины 15 см: стена по
 * умолчанию 10 см толщиной, и с порогом 15 её нельзя было бы ни утоньшить, ни ввести `−N` (ADR 0018 D1,
 * «Уточнения реализации (задача 0055)»; тот же порог у самой команды `setWallWidth`).
 */
const minLengthOf = (field: LengthFieldDescriptor): number =>
  field.target.kind === 'wall-width' ? MIN_INPUT_WIDTH : MIN_INPUT_LENGTH;

/** «Слишком мало» у ширины стены объясняется своим текстом: 15 см — про длину, к толщине оно неприменимо. */
const scaleError = (field: LengthFieldDescriptor, kind: LengthErrorKind): LengthErrorKind =>
  field.target.kind === 'wall-width' && kind === 'too-small' ? 'width-too-small' : kind;

export const LengthInputsOverlay: React.FC = () => {
  const manager = usePlannerManager();
  // Отдельные вызовы селектора: каждый возвращает снимок фасада как есть — новый объект дал бы бесконечный
  // ре-рендер, `tools:changed` летит на каждый `pointerMove` (ADR 0015 «Что важно знать»).
  const activeView = usePlannerSelector(m => m.view.get().activeView);
  const doc = usePlannerSelector(m => m.document.get());
  const derived = usePlannerSelector(m => m.document.getDerived());
  const tools = usePlannerSelector(m => m.tools.get());
  const labels = usePlannerLabelVisibility();
  const reportFocus = useReportLengthFocus();

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  /** Введённый, но не применённый текст по ключу поля. Переживает уход поля за порог видимости (спека 01). */
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<{ key: string; kind: LengthErrorKind } | null>(null);

  /**
   * Зеркало черновиков в ref: обработчики (Tab → применить → перевести фокус → чужой `blur`) идут в одном
   * тике, а состояние React к этому моменту ещё старое. Через ref `commit` видит, что черновик уже применён и
   * удалён, — и `blur` не применяет то же значение второй раз.
   */
  const draftsRef = useRef<Readonly<Record<string, string>>>(drafts);
  /** Тот же приём для фокуса: его читает уборка ref'а поля, до которой обновление состояния ещё не дошло. */
  const focusedKeyRef = useRef<string | null>(focusedKey);
  /** Реестр DOM-узлов полей: Tab переносит фокус по кругу вызовом `focus()` у соседа. */
  const inputsRef = useRef(new Map<string, HTMLInputElement>());

  const setFocused = (key: string | null): void => {
    focusedKeyRef.current = key;
    setFocusedKey(key);
  };

  const units = doc.settings.units;
  const floor = doc.floors[0];
  const layout = floor?.layout ?? null;
  const derivedFloor = derived.floors[0] ?? null;
  const overrides = tools.kind === 'dragging-point' || tools.kind === 'dragging-wall' ? tools.pointOverrides : null;

  const fields = useMemo(
    () => (layout ? buildLengthFields({ layout, derived: derivedFloor, tools, wallWidth: DEFAULT_WALL_WIDTH }) : []),
    [layout, derivedFloor, tools],
  );

  /**
   * Черновик поля. Черновик **парного** поля при этом снимается: пассивное поле обязано показывать живой
   * пересчёт по активному (решение 24), а собственный, набранный до переключения фокуса, текст этот пересчёт
   * перекрыл бы — на паре прямоугольника это давало бы «внешняя 500, внутренняя 620» вместо «620 / 600».
   */
  const writeDraft = (key: string, text: string, pairKey?: string): void => {
    const next = { ...draftsRef.current, [key]: text };
    if (pairKey !== undefined) delete next[pairKey];
    draftsRef.current = next;
    setDrafts(next);
  };

  const dropDraft = (key: string): void => {
    if (!(key in draftsRef.current)) return;
    const next = { ...draftsRef.current };
    delete next[key];
    draftsRef.current = next;
    setDrafts(next);
  };

  // Смена единиц отбрасывает частично введённые строки (спека 07 «Крайние случаи»): `250,5` в метрах и в
  // сантиметрах — разные длины, и дописывать такую строку в новых единицах бессмысленно.
  useEffect(() => {
    if (Object.keys(draftsRef.current).length > 0) {
      draftsRef.current = {};
      setDrafts(draftsRef.current);
    }
    setError(null);
  }, [units]);

  // Активным считается только **редактируемое** поле: ушло за порог инпута — фокуса в нём уже нет, и ни
  // подсветки пары, ни живого пересчёта по его черновику быть не должно.
  const activeField =
    focusedKey === null ? undefined : fields.find(field => field.key === focusedKey && field.editable);
  const editableCount = fields.reduce((count, field) => (field.editable ? count + 1 : count), 0);
  const focusMode: LengthInputFocus['mode'] | null = activeField
    ? activeField.target.kind.startsWith('draw')
      ? 'drawing'
      : 'editing'
    : null;
  const hasSiblings = editableCount > 1;
  // Объект собирается только при смене содержимого: иначе публикация шла бы на каждый `pointerMove` (0061).
  const focus = useMemo<LengthInputFocus | null>(
    () => (focusMode === null ? null : { mode: focusMode, hasSiblings }),
    [focusMode, hasSiblings],
  );

  useEffect(() => {
    reportFocus(focus);
  }, [reportFocus, focus]);
  // Отдельным эффектом — только уборка: он не должен перезапускаться при смене фокуса, иначе снимал бы свежий.
  useEffect(() => () => reportFocus(null), [reportFocus]);

  /**
   * Реестр DOM-узлов + снятие протухшего фокуса. Поле, ушедшее за порог инпута (зум/панорама) или пропавшее
   * вместе с оверлеем при смене вида, размонтируется **без** события `blur`: браузер просто переводит фокус на
   * `body`. Уборка ref'а — единственный момент, когда об этом становится известно; без неё кольцо фокуса
   * вернулось бы вместе с полем при обратном зуме, хотя фокус давно в другом месте.
   */
  const registerInput = useCallback((key: string, input: HTMLInputElement | null): void => {
    if (input) {
      inputsRef.current.set(key, input);
      return;
    }
    inputsRef.current.delete(key);
    if (focusedKeyRef.current === key) {
      focusedKeyRef.current = null;
      setFocusedKey(null);
    }
  }, []);

  /** Разбор черновика без порогов — только для живого пересчёта пассивного поля; пороги проверяет `commit`. */
  const previewLength = (field: LengthFieldDescriptor, text: string): number | null => {
    const parsed = resolveLength(text, {
      units,
      current: field.value,
      allowRelative: allowsRelative(field),
      min: Number.NEGATIVE_INFINITY,
      max: Number.POSITIVE_INFINITY,
    });
    return parsed.ok ? parsed.value : null;
  };

  /**
   * Поле пары, из чьего **непринятого** черновика выводится значение этого поля (решение 24). Привязки к фокусу
   * тут нет намеренно: черновик живёт до Enter, поэтому после Tab на соседнее поле пара обязана показывать всё
   * тот же пересчёт, а не откатываться к геометрии.
   */
  const driverOf = (field: LengthFieldDescriptor): { key: string; value: number } | null => {
    if (field.pairKey === undefined) return null;
    const driver = fields.find(candidate => candidate.key === field.pairKey);
    const draft = driver === undefined ? undefined : drafts[driver.key];
    if (driver === undefined || draft === undefined) return null;
    const value = previewLength(driver, draft);
    return value === null ? null : { key: driver.key, value };
  };

  /** Текст поля: свой черновик, иначе значение — с живым пересчётом пары, пока в ней печатают (решение 24). */
  const textOf = (field: LengthFieldDescriptor): string => {
    const draft = drafts[field.key];
    // Ниже порога инпута поле — подпись: показывает геометрию, а черновик ждёт возврата за порог.
    if (field.editable && draft !== undefined) return draft;
    const driver = driverOf(field);
    const previewed = driver === null ? field.value : previewFieldValue(fields, driver.key, driver.value, field.key);
    return formatLength(Number.isFinite(previewed) ? previewed : field.value, units);
  };

  /** Сторона кольца → внешняя сторона прямоугольника: внутреннее ужато на толщину стены с обеих сторон. */
  const toOuter = (length: number, ring: 'outer' | 'inner', wallWidth: number): number =>
    ring === 'outer' ? length : length + 2 * wallWidth;

  /**
   * Ещё не применённая внешняя сторона прямоугольника по оси — из черновика любого из двух её полей.
   * `null` — по этой оси ничего не вводили. Так «ввёл ширину → Tab → ввёл высоту → Enter» даёт прямоугольник
   * с **обеими** введёнными сторонами, а не с одной и курсором.
   */
  const pendingRectSide = (axis: 'x' | 'y'): number | null => {
    for (const candidate of fields) {
      const target = candidate.target;
      if (target.kind !== 'draw-rect' || target.axis !== axis) continue;
      const draft = draftsRef.current[candidate.key];
      if (draft === undefined) continue;
      const parsed = resolveLength(draft, {
        units,
        current: candidate.value,
        allowRelative: allowsRelative(candidate),
        min: MIN_INPUT_LENGTH,
      });
      if (parsed.ok) return toOuter(parsed.value, target.ring, target.wallWidth);
    }
    return null;
  };

  /** Применение принятой длины к документу/автомату; `null` — успех, иначе код ошибки для плашки. */
  const applyLength = (field: LengthFieldDescriptor, length: number): LengthErrorKind | null => {
    const target = field.target;
    const floorId = floor?.id;

    switch (target.kind) {
      case 'draw-current':
      case 'draw-first': {
        const point = pointAtLength(target.from, target.towards, length);
        // Направление не определено (точки совпали) — считать новую позицию не от чего.
        if (!point) return 'rejected';
        const result =
          target.kind === 'draw-current' ? manager.tools.commitPoint(point) : manager.tools.setDraftPoint(0, point);
        return result.ok ? null : commandErrorKind(result.error.kind);
      }
      case 'draw-rect': {
        // Прямоугольник задают **две** стороны (спека 07: «сразу два инпута для ширины и высоты; после ввода
        // обновляются обе смежные стороны»), поэтому Enter собирает угол из обеих осей: своя — из принятого
        // значения, чужая — из ещё не применённого черновика соседнего поля, а если его нет — из живого угла.
        const outerOf = (axis: 'x' | 'y'): number =>
          axis === target.axis
            ? toOuter(length, target.ring, target.wallWidth)
            : (pendingRectSide(axis) ?? Math.abs(target.cursor[axis] - target.origin[axis]));
        const corner: PlanPosition = {
          x: target.origin.x + axisSign(target.origin.x, target.cursor.x) * outerOf('x'),
          y: target.origin.y + axisSign(target.origin.y, target.cursor.y) * outerOf('y'),
        };
        const result = manager.tools.commitPoint(corner);
        return result.ok ? null : commandErrorKind(result.error.kind);
      }
      case 'edge': {
        if (floorId === undefined) return 'rejected';
        const result = manager.document.setEdgeLength(
          floorId,
          target.edge,
          length,
          target.anchor === undefined ? undefined : { anchor: target.anchor },
        );
        return result.ok ? null : commandErrorKind(result.error.kind);
      }
      case 'wall-width': {
        if (floorId === undefined) return 'rejected';
        const result = manager.document.setWallWidth(floorId, target.faces, length);
        return result.ok ? null : commandErrorKind(result.error.kind);
      }
    }
  };

  /**
   * Применение поля: разбор → пороги → команда. Любой отказ показывает плашку и **откатывает черновик на
   * последнее валидное значение** (спека 07 «Крайние случаи»), фокус при этом остаётся в поле.
   */
  const commit = (field: LengthFieldDescriptor, fallback?: string): void => {
    // Ничего не вводили — применять нечего (пустой blur по клику мимо не трогает геометрию). Исключение —
    // `fallback`: Enter в поле рисования ставит точку **всегда**, как клик, даже если в само поле не печатали
    // (спека 01 «Enter в инпуте текущего ребра — это постановка точки»; handoff «Enter ставит точку — как клик»).
    const text = draftsRef.current[field.key] ?? fallback;
    if (text === undefined) return;
    const parsed = resolveLength(text, {
      units,
      current: field.value,
      allowRelative: allowsRelative(field),
      min: minLengthOf(field),
    });
    dropDraft(field.key);
    if (!parsed.ok) {
      setError({ key: field.key, kind: scaleError(field, parsed.error.kind) });
      return;
    }
    const failure = applyLength(field, parsed.value);
    setError(failure === null ? null : { key: field.key, kind: scaleError(field, failure) });
  };

  /** Следующее/предыдущее видимое редактируемое поле — по кругу (handoff «Ввод», «Доступность»). */
  const focusNeighbour = (key: string, step: 1 | -1): void => {
    const order = fields.filter(field => field.editable).map(field => field.key);
    if (order.length === 0) return;
    const index = order.indexOf(key);
    const next = order[(((index === -1 ? 0 : index + step) % order.length) + order.length) % order.length]!;
    inputsRef.current.get(next)?.focus();
  };

  const handleKeyDown =
    (field: LengthFieldDescriptor) =>
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      switch (event.key) {
        case 'Enter':
          // При рисовании Enter ставит точку и фокус не отпускает: точки ставятся подряд (спека 01). Значение
          // берётся из показанного текста, если в само поле не печатали, — на паре прямоугольника пассивное
          // поле показывает пересчёт по соседнему черновику, и Enter в нём обязан этот пересчёт применить.
          event.preventDefault();
          commit(field, field.commitOn === 'enter' ? textOf(field) : undefined);
          break;
        case 'Escape':
          event.preventDefault();
          dropDraft(field.key);
          setError(null);
          event.currentTarget.blur();
          break;
        case 'Tab':
          event.preventDefault();
          if (field.commitOn === 'enter-blur-tab') commit(field);
          focusNeighbour(field.key, event.shiftKey ? -1 : 1);
          break;
        default:
          // Стрелки не обрабатываются вовсе: внутри поля это обычное перемещение курсора в тексте (решение 20).
          break;
      }
    };

  /**
   * Потеря фокуса применяет введённое — у полей, чьё применение меняет размер (`edge`, `wall-width` и
   * `draw-first`: он двигает уже поставленную точку). У `draw-current` и `draw-rect` применение **ставит
   * точку / завершает прямоугольник**, а `blur` случается на каждом клике по холсту — применять там значило бы
   * ставить точку мимо клика пользователя, поэтому им остаётся только Enter (handoff «Ввод»).
   */
  const handleBlur = (field: LengthFieldDescriptor) => (): void => {
    if (focusedKeyRef.current === field.key) setFocused(null);
    const hadDraft = field.key in draftsRef.current;
    if (field.commitOn === 'enter-blur-tab') commit(field);
    // Применять было нечего — значит и объяснять нечего: плашка прошлой ошибки не должна пережить уход фокуса.
    if (!hadDraft) setError(previous => (previous !== null && previous.key === field.key ? null : previous));
  };

  /**
   * Вторая половина порога подписи (спека 07 «Ограничения и пороги»: «подпись прячется, если её текст с
   * запасом 30 px не влезает в длину сегмента»; handoff «Подписи», состояние «скрыта по порогу»). Касается
   * только **подписей**: у поля ввода свой порог 45/70 px, и прятать сфокусированное поле из-за длины текста
   * значило бы отнимать фокус на ровном месте.
   *
   * Ширина текста считается по числу знаков: точных метрик шрифта в поставке нет, а мерить реальный бокс
   * пришлось бы вторым проходом layout'а на каждый `pointerMove`. Оценка — `TEXT_CHAR_WIDTH` на знак (12 px
   * с табличными цифрами) плюс горизонтальные паддинги и суффикс единиц.
   */
  const visible = (field: LengthFieldDescriptor): boolean =>
    field.editable || labelFits(field.placement.screenLength, estimatedTextWidth(textOf(field), unitSuffix(units)));

  if (activeView !== 'constructor' || layout === null) return null;

  return (
    // Оверлей прозрачен для указателя целиком; «auto» включают сами поля — клик мимо уходит в холст.
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {labels.dimensions &&
        fields.filter(visible).map(field => (
          <LengthField
            key={field.key}
            field={field}
            text={textOf(field)}
            suffix={unitSuffix(units)}
            focused={focusedKey === field.key}
            passive={focusedKey !== null && field.pairKey === focusedKey}
            error={error !== null && error.key === field.key ? lengthErrorText(error.kind) : null}
            onChange={raw => {
              writeDraft(field.key, sanitizeLengthInput(raw, { allowSign: allowsRelative(field) }), field.pairKey);
              setError(previous => (previous !== null && previous.key === field.key ? null : previous));
            }}
            onFocus={() => {
              setFocused(field.key);
              // Ошибка живёт вместе со своим полем: ушли в другое — плашка гаснет, иначе она висела бы над
              // чужим полем и объясняла ввод, которого пользователь уже не видит. Правила handoff не задаёт.
              setError(previous => (previous !== null && previous.key !== field.key ? null : previous));
            }}
            onBlur={handleBlur(field)}
            onKeyDown={handleKeyDown(field)}
            registerInput={registerInput}
          />
        ))}
      <RoomLabels
        layout={layout}
        derived={derivedFloor}
        viewport={tools.viewport}
        overrides={overrides}
        showName={labels.roomName}
        showArea={labels.roomArea}
      />
    </div>
  );
};
