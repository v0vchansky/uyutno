/** @jest-environment jsdom */
import type React from 'react';
import { act, render, screen } from '@testing-library/react';

import { createEmptyDocument } from '../../document/createEmptyDocument';
import { PlannerManager, type PlannerLogger } from '../../engine/PlannerManager';
import { createEditingState, DEFAULT_VIEWPORT, type ToolState } from '../../engine/tools/ToolState';
import { DEFAULT_SNAP_FLAGS } from '../../document/geometry/snap/getSnapPoint';
import type { PlannerInstance, PlannerProjections } from '../../projection/createPlanner';
import type { ViewportInsets } from '../../projection/canvas2d/camera';
import { PlannerContext } from '../PlannerContext';
import { CONSTRUCTOR_SKIN_INSETS, ConstructorSkin, RAIL_ONLY_INSETS } from './ConstructorSkin';
import { isCanvasEmpty } from './FirstStepHint';

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const FIRST_STEP = 'Выберите инструмент и поставьте первую точку';

let manager: PlannerManager | null = null;
let setViewportInsets: jest.Mock<void, [Partial<ViewportInsets>]>;

/** Проекции — фейк: скину нужны только `canvas2d.getZoom/onZoomChanged/fitToContent/resetCamera/setViewportInsets`. */
const renderSkin = () => {
  setViewportInsets = jest.fn<void, [Partial<ViewportInsets>]>();
  const instance: PlannerInstance = {
    manager: (manager = new PlannerManager({ projectId: 'p', logger: silentLogger })),
    projections: {
      three: {},
      canvas2d: {
        getZoom: () => ({ index: 20, scale: 1, steps: 41, canZoomIn: true, canZoomOut: true }),
        onZoomChanged: () => () => {},
        zoomBy: () => {},
        fitToContent: () => {},
        resetCamera: () => {},
        setViewportInsets,
      },
    } as unknown as PlannerProjections,
    dispose: () => manager?.dispose(),
  };
  return render(
    <PlannerContext value={instance}>
      <ConstructorSkin />
    </PlannerContext>,
  );
};

/** Прямоугольник 400×300 кликами инструмента — единственный способ положить точки в документ через фасад. */
const drawRoom = (): void => {
  const { tools } = live();
  const mods = { ctrl: false, meta: false, shift: false, alt: false };
  const click = (x: number, y: number): void => {
    tools.pointerMove({ x, y, mods, button: 0 });
    tools.pointerDown({ x, y, mods, button: 0 });
    tools.pointerUp({ x, y, mods, button: 0 });
  };
  tools.start('rect');
  click(0, 0);
  click(400, 300);
};

afterEach(() => {
  manager?.dispose();
  manager = null;
});

/** Менеджер поднятого скина; юнит-тесты чистой функции его не поднимают. */
const live = (): PlannerManager => {
  if (!manager) throw new Error('скин не отрендерен');
  return manager;
};

const editing = (): ToolState => ({
  ...createEditingState(),
  snapFlags: DEFAULT_SNAP_FLAGS,
  viewport: DEFAULT_VIEWPORT,
});

describe('isCanvasEmpty', () => {
  it('пустой документ без рисования — пусто', () => {
    expect(isCanvasEmpty(createEmptyDocument(), editing())).toBe(true);
  });

  it('точка в рисуемом контуре считается поставленной, хотя в документе её ещё нет', () => {
    const document = createEmptyDocument();
    const common = { snapFlags: DEFAULT_SNAP_FLAGS, viewport: DEFAULT_VIEWPORT };
    const drawing: ToolState = {
      ...common,
      kind: 'making-walls',
      points: [{ x: 0, y: 0 }],
      cursor: null,
      side: 'left',
      sideFixed: false,
      startNeighbours: null,
      preview: [],
      snap: null,
      guides: [],
      undo: [],
      redo: [],
    };
    expect(isCanvasEmpty(document, drawing)).toBe(false);
    expect(isCanvasEmpty(document, { ...drawing, points: [] })).toBe(true);
  });

  it('первый угол прямоугольника — уже не пусто, без угла — пусто', () => {
    const document = createEmptyDocument();
    const common = { snapFlags: DEFAULT_SNAP_FLAGS, viewport: DEFAULT_VIEWPORT };
    const rect: ToolState = {
      ...common,
      kind: 'making-rect',
      origin: { x: 1, y: 2 },
      cursor: null,
      preview: [],
      snap: null,
      guides: [],
    };
    expect(isCanvasEmpty(document, rect)).toBe(false);
    expect(isCanvasEmpty(document, { ...rect, origin: null })).toBe(true);
  });
});

describe('<ConstructorSkin />', () => {
  it('на пустом холсте показывает строку первого шага', () => {
    renderSkin();
    expect(screen.getByText(FIRST_STEP)).toBeTruthy();
  });

  it('после поставленной точки строка первого шага исчезает', () => {
    renderSkin();
    act(() => drawRoom());
    expect(screen.queryByText(FIRST_STEP)).toBeNull();
  });

  it('рейл виден во всех видах, оверлеи конструктора — только в конструкторе', () => {
    renderSkin();
    expect(screen.getByRole('button', { name: 'Конструктор стен' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Прямоугольная комната' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Контролы холста' })).toBeTruthy();

    act(() => {
      live().view.setActive('plan');
    });

    expect(screen.getByRole('button', { name: 'Конструктор стен' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Прямоугольная комната' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Контролы холста' })).toBeNull();
    expect(screen.queryByText(FIRST_STEP)).toBeNull();
  });

  /*
   * Камера конструктора считает «в центр» и сброс по видимой части холста, а размеры панелей знает только скин —
   * значит он их и сообщает. Числа проверяются буквальные: молчаливый разъезд ширины панели и inset — ровно тот
   * дефект, ради которого всё это заведено.
   */
  describe('insets видимой части холста', () => {
    it('скин сообщает проекции полосы под своими панелями', () => {
      renderSkin();

      expect(setViewportInsets).toHaveBeenCalledWith(CONSTRUCTOR_SKIN_INSETS);
      // Рейл 60 + отступ 12 + панель 224 + отступ 12; снизу 12 + сводка 36 + зазор 8 + контролы 36.
      expect(CONSTRUCTOR_SKIN_INSETS).toEqual({ left: 308, right: 0, top: 0, bottom: 92 });
    });

    it('на чужом виде оверлеи конструктора сняты — остаётся полоса рейла', () => {
      renderSkin();
      setViewportInsets.mockClear();

      act(() => {
        live().view.setActive('plan');
      });

      expect(setViewportInsets).toHaveBeenLastCalledWith(RAIL_ONLY_INSETS);
      expect(RAIL_ONLY_INSETS).toEqual({ left: 60, right: 0, top: 0, bottom: 0 });
    });

    it('скин размонтирован — холст снова виден целиком', () => {
      const { unmount } = renderSkin();
      setViewportInsets.mockClear();

      unmount();

      expect(setViewportInsets).toHaveBeenLastCalledWith({ left: 0, right: 0, top: 0, bottom: 0 });
    });
  });

  // Единственный владелец клавиатуры — `projection/input/keyboard.ts` (ADR 0019 E5).
  it('во всём скине нет клавиатурных слушателей', () => {
    const added: string[] = [];
    const spyDocument = jest.spyOn(document, 'addEventListener');
    const spyWindow = jest.spyOn(window, 'addEventListener');
    spyDocument.mockImplementation((type: string) => void added.push(type));
    spyWindow.mockImplementation((type: string) => void added.push(type));

    renderSkin();

    expect(added.filter(type => type.startsWith('key'))).toEqual([]);
    spyDocument.mockRestore();
    spyWindow.mockRestore();
  });
});
