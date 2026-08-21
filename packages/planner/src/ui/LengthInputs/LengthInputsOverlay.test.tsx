/** @jest-environment jsdom */
import type React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { PlanPosition, PlannerDocument } from '../../document/PlannerDocument';
import type { PlannerManager } from '../../engine/PlannerManager';
import { createTestManager, ringDocument } from '../../engine/testing/testManager';
import { DEFAULT_VIEWPORT } from '../../engine/tools/ToolState';
import type { PlannerInstance, PlannerProjections } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';
import {
  PlannerOverlayProvider,
  useSetPlannerLabelVisibility,
  usePlannerLengthFocus,
  type LabelVisibility,
} from '../PlannerOverlayContext';
import { LengthInputsOverlay } from './LengthInputsOverlay';

/**
 * Оверлей поверх **реального** фасада (образец — `../ToolPanel/ToolPanel.test.tsx`), но без канвасов:
 * проекции оверлею не нужны вовсе — viewport он берёт из `ToolState`, а всё остальное из снимков фасада.
 * Поэтому в контекст кладётся заглушка: тип требует объект, обращений к нему в этом слое нет.
 */
const instanceOf = (manager: PlannerManager): PlannerInstance => ({
  manager,
  projections: {} as unknown as PlannerProjections,
  dispose: () => manager.dispose(),
});

/** Зонд контекста: показывает, что оверлей опубликовал про фокус (решение 3 — источник для полосы подсказки). */
const FocusProbe: React.FC = () => {
  const focus = usePlannerLengthFocus();
  return <span data-testid='focus'>{focus === null ? 'нет' : `${focus.mode}/${focus.hasSiblings}`}</span>;
};

/**
 * Тумблеры подписей живут в панели инструментов (0061) — здесь их роль играет зонд: он забирает сеттер общего
 * контекста скина, как это сделает панель.
 */
const VISIBILITY_PATCHES: Readonly<Record<string, Partial<LabelVisibility>>> = {
  'hide-dimensions': { dimensions: false },
  'show-dimensions': { dimensions: true },
  'hide-area': { roomArea: false },
};

const VisibilityProbe: React.FC = () => {
  const setVisibility = useSetPlannerLabelVisibility();
  return (
    <>
      {Object.entries(VISIBILITY_PATCHES).map(([id, patch]) => (
        <button key={id} type='button' data-testid={id} onClick={() => setVisibility(patch)} />
      ))}
    </>
  );
};

const toggleLabels = (id: keyof typeof VISIBILITY_PATCHES): void => {
  fireEvent.click(screen.getByTestId(id));
};

const setup = (document?: PlannerDocument) => {
  const { manager, events } = createTestManager(document);
  const utils = render(
    <PlannerContext value={instanceOf(manager)}>
      <PlannerOverlayProvider>
        <LengthInputsOverlay />
        <FocusProbe />
        <VisibilityProbe />
      </PlannerOverlayProvider>
    </PlannerContext>,
  );
  return { manager, events, ...utils };
};

const MODS = { ctrl: false, meta: false, shift: false, alt: false };

/** Полный цикл клика указателем в координатах плана: точку ставит `pointerUp` основной кнопки. */
const click = (manager: PlannerManager, { x, y }: PlanPosition): void => {
  act(() => {
    manager.tools.pointerMove({ x, y, mods: MODS, button: 0 });
    manager.tools.pointerDown({ x, y, mods: MODS, button: 0 });
    manager.tools.pointerUp({ x, y, mods: MODS, button: 0 });
  });
};

const move = (manager: PlannerManager, { x, y }: PlanPosition): void => {
  act(() => {
    manager.tools.pointerMove({ x, y, mods: MODS, button: 0 });
  });
};

const setScale = (manager: PlannerManager, scale: number): void => {
  act(() => {
    manager.tools.setViewport({ ...DEFAULT_VIEWPORT, scale });
  });
};

const inputs = (container: HTMLElement): HTMLInputElement[] => [...container.querySelectorAll('input')];

const withValue = (list: readonly HTMLElement[], value: string): HTMLInputElement =>
  list.find(element => (element as HTMLInputElement).value === value) as HTMLInputElement;

const focus = (element: HTMLElement): void => {
  act(() => {
    element.focus();
  });
};

const type = (element: HTMLElement, value: string): void => {
  fireEvent.change(element, { target: { value } });
};

const press = (element: HTMLElement, key: string, init: { shiftKey?: boolean } = {}): void => {
  fireEvent.keyDown(element, { key, ...init });
};

/** Длина ребра `a→b` первого контура этажа — проверка «геометрия не изменилась». */
const firstEdgeLength = (manager: PlannerManager): number => {
  const { layout } = manager.document.get().floors[0]!;
  const contour = layout.contours[0]!;
  const a = layout.points[contour.points[0]!]!;
  const b = layout.points[contour.points[1]!]!;
  return Math.hypot(a.x - b.x, a.y - b.y);
};

describe('<LengthInputsOverlay />', () => {
  it('у сегмента полой комнаты два поля: внешнее и внутреннее ребро, оба — input', () => {
    setup(ringDocument());
    const outer = screen.getAllByLabelText('длина внешнего ребра');
    const inner = screen.getAllByLabelText('длина внутреннего ребра');

    expect(outer).toHaveLength(4);
    expect(inner).toHaveLength(4);
    for (const element of [...outer, ...inner]) expect(element.tagName).toBe('INPUT');
    expect(outer.map(element => (element as HTMLInputElement).value).sort()).toEqual(['300', '300', '400', '400']);
    expect(inner.map(element => (element as HTMLInputElement).value).sort()).toEqual(['280', '280', '380', '380']);
  });

  it('вне конструктора оверлея нет вовсе', () => {
    const { manager, container } = setup(ringDocument());
    expect(inputs(container)).toHaveLength(8);
    act(() => {
      manager.view.setActive('plan');
    });
    expect(inputs(container)).toHaveLength(0);
  });

  it('Tab переносит фокус с внешнего поля на внутреннее и дальше по кругу, Shift+Tab — назад', () => {
    const { container } = setup(ringDocument());
    const all = inputs(container);
    expect(all).toHaveLength(8);

    focus(all[0]!);
    expect(document.activeElement).toBe(all[0]);
    // Пара сегмента лежит подряд: следующее поле — второе кольцо того же ребра.
    expect(all[0]!.getAttribute('aria-label')).not.toBe(all[1]!.getAttribute('aria-label'));

    press(all[0]!, 'Tab');
    expect(document.activeElement).toBe(all[1]);

    press(all[1]!, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(all[0]);

    // По кругу: Shift+Tab с первого уводит на последнее.
    press(all[0]!, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(all[7]);
    press(all[7]!, 'Tab');
    expect(document.activeElement).toBe(all[0]);
  });

  it('пассивное поле пары прямоугольника пересчитывается на лету, до Enter', () => {
    const { manager } = setup();
    act(() => {
      manager.tools.start('rect');
    });
    click(manager, { x: 0, y: 0 });
    move(manager, { x: 400, y: 300 });

    const outer = screen.getByLabelText('внешняя ширина прямоугольника') as HTMLInputElement;
    const inner = screen.getByLabelText('внутренняя ширина прямоугольника') as HTMLInputElement;
    expect(outer.value).toBe('400');
    expect(inner.value).toBe('380');

    focus(outer);
    type(outer, '500');
    expect(outer.value).toBe('500');
    expect(inner.value).toBe('480');
    // Высота осталась своей: пересчитывается только пара одной оси.
    expect((screen.getByLabelText('внешняя высота прямоугольника') as HTMLInputElement).value).toBe('300');
    // Геометрия до Enter не тронута: прямоугольник ещё рисуется.
    expect(manager.tools.get().kind).toBe('making-rect');
    expect(manager.document.getDerived().floors[0]!.rooms).toHaveLength(0);
  });

  it('Enter в поле правки ребра зовёт setEdgeLength: геометрия поехала, в истории ровно одна запись', () => {
    const { manager, events } = setup(ringDocument());
    const field = withValue(screen.getAllByLabelText('длина внешнего ребра'), '400');
    expect(manager.history.get().canUndo).toBe(false);
    events.length = 0;

    focus(field);
    type(field, '500');
    press(field, 'Enter');

    expect(field.value).toBe('500');
    expect(events.filter(event => event === 'document:changed')).toHaveLength(1);
    expect(manager.history.get().canUndo).toBe(true);
    // Фокус остаётся в поле — при рисовании это даёт ставить точки подряд, при правке не сбивает Tab.
    expect(document.activeElement).toBe(field);
  });

  it('потеря фокуса применяет, Escape отменяет и откатывает текст', () => {
    const { manager } = setup(ringDocument());
    const applied = withValue(screen.getAllByLabelText('длина внешнего ребра'), '400');
    focus(applied);
    type(applied, '500');
    fireEvent.blur(applied);
    expect(applied.value).toBe('500');

    // Внутреннее кольцо правка внешнего ребра не тронула — берём поле оттуда.
    const cancelled = withValue(screen.getAllByLabelText('длина внутреннего ребра'), '380');
    const before = manager.document.get();
    focus(cancelled);
    type(cancelled, '250');
    expect(cancelled.value).toBe('250');
    press(cancelled, 'Escape');

    expect(cancelled.value).toBe('380');
    expect(manager.document.get()).toBe(before);
    expect(document.activeElement).not.toBe(cancelled);
  });

  it('Enter в поле рисуемого ребра ставит точку, документ при этом не меняется', () => {
    const { manager, events } = setup();
    act(() => {
      manager.tools.start('walls');
    });
    click(manager, { x: 0, y: 0 });
    click(manager, { x: 200, y: 0 });
    move(manager, { x: 200, y: 200 });

    const field = screen.getByLabelText('длина текущего ребра') as HTMLInputElement;
    expect(field.value).toBe('200');
    events.length = 0;

    focus(field);
    type(field, '250');
    press(field, 'Enter');

    const state = manager.tools.get();
    expect(state.kind === 'making-walls' && state.points).toHaveLength(3);
    expect(events.filter(event => event === 'document:changed')).toHaveLength(0);
    expect(document.activeElement).toBe(field);
  });

  it('слишком короткая длина: aria-invalid, плашка с текстом, геометрия и текст поля откатились', () => {
    const { manager, events } = setup(ringDocument());
    const field = withValue(screen.getAllByLabelText('длина внешнего ребра'), '400');
    const before = firstEdgeLength(manager);
    events.length = 0;

    focus(field);
    type(field, '5');
    press(field, 'Enter');

    expect(field.getAttribute('aria-invalid')).toBe('true');
    const plate = screen.getByText('Стена короче 15 см');
    expect(field.getAttribute('aria-describedby')).toBe(plate.getAttribute('id'));
    expect(field.value).toBe('400');
    expect(firstEdgeLength(manager)).toBe(before);
    expect(events.filter(event => event === 'document:changed')).toHaveLength(0);

    // Ввод следующего символа гасит ошибку — залипнуть на невалидном нельзя (спека 07).
    type(field, '450');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Стена короче 15 см')).toBeNull();
  });

  it('плашка ошибки гаснет, когда фокус ушёл в другое поле: она объясняет своё поле, а не соседнее', () => {
    const { container } = setup(ringDocument());
    const field = withValue(screen.getAllByLabelText('длина внешнего ребра'), '400');

    focus(field);
    type(field, '5');
    press(field, 'Enter');
    expect(screen.getByText('Стена короче 15 см')).toBeTruthy();

    const other = inputs(container).find(input => input !== field)!;
    focus(other);
    expect(screen.queryByText('Стена короче 15 см')).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBeNull();
  });

  it('стрелки в поле фокус не переключают — это перемещение курсора в тексте (решение 20)', () => {
    const { container } = setup(ringDocument());
    const field = inputs(container)[0]!;
    focus(field);
    press(field, 'ArrowRight');
    press(field, 'ArrowLeft');
    press(field, 'ArrowUp');
    expect(document.activeElement).toBe(field);
  });

  it('ниже порога инпута поле пропадает, а введённый текст возвращается при обратном зуме', () => {
    const { manager, container } = setup(ringDocument());
    const field = withValue(screen.getAllByLabelText('длина внешнего ребра'), '400');
    focus(field);
    type(field, '250');
    expect(field.value).toBe('250');

    // scale 0.1: ребро 400 см → 40 px, ниже порога инпута (45). Подписью оно тоже не остаётся: текст «400 см»
    // с запасом 30 px в сорок пикселей не влезает (спека 07 «Ограничения и пороги»).
    setScale(manager, 0.1);
    expect(screen.queryAllByLabelText('длина внешнего ребра')).toHaveLength(0);
    expect(inputs(container)).toHaveLength(0);
    expect(screen.queryAllByText('400')).toHaveLength(0);
    expect(screen.queryAllByText('280')).toHaveLength(0);

    // Черновик пережил скрытие и вернулся вместе с полем (спека 01: «значение сохраняется в памяти инпута»).
    setScale(manager, 1);
    const back = screen.getAllByLabelText('длина внешнего ребра');
    expect(withValue(back, '250')).toBeTruthy();
  });

  it('подпись гаснет, когда её текст не влезает в сегмент, хотя тот длиннее 30 px', () => {
    const { manager } = setup(ringDocument());
    // scale 0.2: внешнее ребро 400 см → 80 px. Порог подписи (30) пройден, порог инпута (45) — тоже,
    // поэтому поле остаётся полем; внутреннее 280 см → 56 px — подписью уже не помещается.
    setScale(manager, 0.2);
    expect(screen.queryAllByLabelText('длина внешнего ребра')).toHaveLength(4);

    // scale 0.12: внешнее 400 см → 48 px (поле), внутреннее 280 см → 33,6 px — длиннее 30, но текст не влезает.
    setScale(manager, 0.12);
    expect(screen.queryAllByText('280')).toHaveLength(0);
  });

  it('прямоугольник задаётся обеими сторонами: ширина → Tab → высота → Enter', () => {
    const { manager } = setup();
    act(() => {
      manager.tools.start('rect');
    });
    click(manager, { x: 0, y: 0 });
    move(manager, { x: 400, y: 300 });

    const width = screen.getByLabelText('внешняя ширина прямоугольника') as HTMLInputElement;
    focus(width);
    type(width, '500');
    // Tab у полей прямоугольника фокус переносит, но прямоугольник не завершает: его завершает только Enter.
    press(width, 'Tab');
    expect(manager.tools.get().kind).toBe('making-rect');

    const height = screen.getByLabelText('внешняя высота прямоугольника') as HTMLInputElement;
    focus(height);
    type(height, '200');
    press(height, 'Enter');

    // Обе введённые стороны попали в геометрию — ширина не потерялась вместе с фокусом (спека 07).
    expect(manager.tools.get().kind).toBe('editing');
    const { layout } = manager.document.get().floors[0]!;
    const outer = layout.contours.find(contour => contour.kind === 'outer')!;
    const xs = outer.points.map(id => layout.points[id]!.x);
    const ys = outer.points.map(id => layout.points[id]!.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(500, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200, 6);
  });

  it('пересчёт пары держится за черновик, а не за фокус: после Tab пассивное поле не откатывается', () => {
    const { manager } = setup();
    act(() => {
      manager.tools.start('rect');
    });
    click(manager, { x: 0, y: 0 });
    move(manager, { x: 400, y: 300 });

    const width = screen.getByLabelText('внешняя ширина прямоугольника') as HTMLInputElement;
    focus(width);
    type(width, '620');
    // Пока печатают — пассивное поле пары уже пересчитано (решение 24).
    expect((screen.getByLabelText('внутренняя ширина прямоугольника') as HTMLInputElement).value).toBe('600');

    // Tab уводит фокус, но черновик 620 никуда не делся — значит и пересчёт остаётся.
    press(width, 'Tab');
    expect((screen.getByLabelText('внутренняя ширина прямоугольника') as HTMLInputElement).value).toBe('600');
    expect((screen.getByLabelText('внешняя ширина прямоугольника') as HTMLInputElement).value).toBe('620');
  });

  it('Enter в пассивном поле пары применяет показанный пересчёт, а не молчит', () => {
    const { manager } = setup();
    act(() => {
      manager.tools.start('rect');
    });
    click(manager, { x: 0, y: 0 });
    move(manager, { x: 400, y: 300 });

    const width = screen.getByLabelText('внешняя ширина прямоугольника') as HTMLInputElement;
    focus(width);
    type(width, '620');
    press(width, 'Tab');

    // Фокус на пассивном поле: печатали не в него, но показанные 600 — это и есть будущая внутренняя ширина.
    const inner = screen.getByLabelText('внутренняя ширина прямоугольника') as HTMLInputElement;
    expect(inner.value).toBe('600');
    focus(inner);
    press(inner, 'Enter');

    expect(manager.tools.get().kind).toBe('editing');
    const { layout } = manager.document.get().floors[0]!;
    const outerContour = layout.contours.find(contour => contour.kind === 'outer')!;
    const xs = outerContour.points.map(id => layout.points[id]!.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(620, 6);
  });

  it('ширина стены: свой пол 1 см — стену можно утоньшить и абсолютом, и относительной формой', () => {
    const { manager } = setup(ringDocument());
    // Клик по стороне внешнего контура выделяет стену: у неё есть ось, значит и поле ширины (спека 07).
    // Не в середину: там ручка деления грани, и нажатие делило бы стену вместо выделения (0096).
    click(manager, { x: 150, y: 0 });
    expect(manager.tools.get()).toMatchObject({ kind: 'editing', selection: { kind: 'wall' } });

    const width = screen.getByLabelText('ширина стены') as HTMLInputElement;
    expect(width.value).toBe('10');

    // Пол длины 15 см к толщине неприменим (ADR 0018 D1): 8 см — валидная ширина, а не «стена короче 15 см».
    focus(width);
    type(width, '8');
    press(width, 'Enter');
    expect(screen.queryByText('Стена короче 15 см')).toBeNull();
    expect((screen.getByLabelText('ширина стены') as HTMLInputElement).value).toBe('8');

    // Ниже собственного порога — своя ошибка, про толщину, а не про длину.
    const thin = screen.getByLabelText('ширина стены') as HTMLInputElement;
    focus(thin);
    type(thin, '0');
    press(thin, 'Enter');
    expect(screen.getByText('Стена тоньше 1 см')).toBeTruthy();
  });

  it('подписи комнаты: имя и площадь в центре, без имени — только площадь', () => {
    const { manager } = setup(ringDocument());
    expect(screen.getByText(/м²$/).textContent).toMatch(/^10,6 м²$/);

    const floorId = manager.document.get().floors[0]!.id;
    const roomId = manager.document.getDerived().floors[0]!.rooms[0]!.roomId;
    expect(screen.queryByText('Кухня')).toBeNull();
    act(() => {
      // Имя комнаты хранится в документе; команды переименования в шаге 2 ещё нет — правим через `load`.
      const next = JSON.parse(JSON.stringify(manager.document.get())) as PlannerDocument;
      next.floors.find(item => item.id === floorId)!.layout.rooms.find(item => item.id === roomId)!.name = 'Кухня';
      manager.document.load(next);
    });
    expect(screen.getByText('Кухня')).toBeTruthy();
  });

  it('usePlannerLengthFocus отдаёт режим и наличие соседей', () => {
    const { manager, container } = setup(ringDocument());
    expect(screen.getByTestId('focus').textContent).toBe('нет');

    focus(inputs(container)[0]!);
    expect(screen.getByTestId('focus').textContent).toBe('editing/true');

    fireEvent.blur(inputs(container)[0]!);
    expect(screen.getByTestId('focus').textContent).toBe('нет');

    act(() => {
      manager.tools.start('walls');
    });
    click(manager, { x: 0, y: 0 });
    move(manager, { x: 200, y: 0 });
    focus(screen.getByLabelText('длина текущего ребра'));
    // При рисовании ломаной видимое поле одно — переносить Tab некуда.
    expect(screen.getByTestId('focus').textContent).toBe('drawing/false');
  });

  it('тумблеры подписей: «Размеры» гасят поля длин, «Имя» и «Площадь» — подписи комнаты по отдельности', () => {
    const { container } = setup(ringDocument());
    expect(inputs(container)).toHaveLength(8);
    expect(screen.getByText(/м²$/)).toBeTruthy();

    toggleLabels('hide-dimensions');
    expect(inputs(container)).toHaveLength(0);
    // Подписи комнаты — свои флаги, тумблер размеров их не трогает.
    expect(screen.getByText(/м²$/)).toBeTruthy();

    toggleLabels('hide-area');
    expect(screen.queryByText(/м²$/)).toBeNull();

    toggleLabels('show-dimensions');
    expect(inputs(container)).toHaveLength(8);
  });

  it('вне провайдера скина оверлей работает с дефолтами, а не падает', () => {
    const { manager } = createTestManager(ringDocument());
    const { container } = render(
      <PlannerContext value={instanceOf(manager)}>
        <LengthInputsOverlay />
      </PlannerContext>,
    );
    expect(inputs(container)).toHaveLength(8);
    expect(container.textContent).toMatch(/м²/);
  });

  it('смена единиц отбрасывает частично введённую строку и перерисовывает подписи', () => {
    const { manager } = setup(ringDocument());
    const field = withValue(screen.getAllByLabelText('длина внешнего ребра'), '400');
    focus(field);
    type(field, '25');

    act(() => {
      manager.document.setSettings({ units: 'm' });
    });

    const inMeters = screen.getAllByLabelText('длина внешнего ребра').map(item => (item as HTMLInputElement).value);
    expect(inMeters.sort()).toEqual(['3', '3', '4', '4']);
    expect(screen.getAllByText('м')).not.toHaveLength(0);
  });
});
