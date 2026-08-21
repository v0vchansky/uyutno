import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import type { ViewKind } from '../../document/PlannerDocument';
import type { PlannerStorage, SaveTarget } from '../../engine/PersistenceNamespace';
import type { PlannerLogger } from '../../engine/PlannerManager';
import { createPlanner, type PlannerInstance } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';
import { PlannerOverlayProvider } from '../PlannerOverlayContext';
import { VIEW_RAIL_WIDTH, ViewRail } from '../ViewRail/ViewRail';
import { planDescription } from './planDescription';

/** Пропсы = DI-контракт с платформой (ADR 0015 A8): `projectId`, `logger`, `storage`; канвасы создаёт сам компонент. */
export interface PlannerProps {
  projectId: string;
  /** Может быть любой ссылкой: смена `logger` не пересоздаёт планер — новые записи идут в актуальный логгер. */
  logger: PlannerLogger;
  /**
   * Транспорт сохранения (ADR 0021): платформа знает, куда и чем писать, планер — когда. Необязателен: без него
   * `persistence` отвечает «сохранять некуда» и таймеров не заводит. Как и `logger`, может быть любой ссылкой —
   * смена не пересоздаёт планер; **присутствие** пропа читается при монтировании.
   */
  storage?: PlannerStorage;
  /**
   * Куда сохраняет автосейв (`0082`): `'server'` по умолчанию — обычный проект, раз в 60 с; `'draft'` —
   * демо-роут, где серверного автосейва нет вовсе (`0083`). Читается при монтировании.
   */
  saveTarget?: SaveTarget;
  /** Бюджет кадров render-on-demand (ADR 0015 A7); по умолчанию `FRAME_BUDGET = 5`. Читается при монтировании. */
  frameBudget?: number;
  className?: string;
  /**
   * Результат фабрики после подъёма планера — ручка для инструментов и гвардов (Playwright читает `getStats()`,
   * ADR 0015 A7). Платформа передаёт только вне прода; глобалов (`window.__*`) пакет не заводит.
   * Как и `logger`, может быть любой ссылкой — смена не пересоздаёт планер.
   */
  onReady?: (planner: PlannerInstance) => void;
  /** Панели/оверлеи скина: рендерятся внутри `PlannerContext`, когда движок поднят (после первого эффекта). */
  children?: React.ReactNode;
}

/**
 * Канвасы и раскладка строки позиционируются инлайновым стилем, а не утилитами Tailwind: пакет не знает о
 * CSS-стеке платформы (ADR 0015 A8) и не должен зависеть от того, сканирует ли её сборка `packages/planner`.
 * `display` задан явно — атрибут `hidden` пришлось бы перебивать `!important`, если бы поверх лежал класс с
 * `display`.
 */
const canvasStyle = (visible: boolean): React.CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: visible ? 'block' : 'none',
});

/** Внешний отступ рамки холста, CSS px (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Каркас»). */
const CANVAS_FRAME_GAP = 8;
/** Радиус рамки холста, CSS px (там же). */
const CANVAS_FRAME_RADIUS = 12;

const containerStyle: React.CSSProperties = { position: 'relative', display: 'flex' };

/**
 * Колонка рейла: ширина занята **с первого кадра**, ещё до подъёма движка. Иначе рамка сжималась бы на 60px
 * уже после того, как проекция измерила холст, и авто-fit (задача 0085) вписывал бы план по устаревшему кадру.
 */
const railStyle: React.CSSProperties = { flexShrink: 0, width: `${VIEW_RAIL_WIDTH}px`, display: 'flex' };

/**
 * Рамка холста: белая область с рамкой 1px `--border` и радиусом 12px, внешний отступ 8px, вокруг —
 * `--background` страницы. Цвета берутся токенами платформы (как и во всём скине), числа — из норматива.
 * `overflow: hidden` обязателен: канвас прямоугольный, и без него его углы вылезали бы за скругление.
 */
const frameStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  margin: `${CANVAS_FRAME_GAP}px`,
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  borderRadius: `${CANVAS_FRAME_RADIUS}px`,
  overflow: 'hidden',
  background: 'var(--surface)',
};

/**
 * Тонкая обёртка над фабрикой (ADR 0015 A7, ADR 0020 P6) — и **строка макета редактора** под шапкой платформы
 * (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Каркас»): контейнер-флекс (размер задаёт страница
 * через `className`), слева колонка рейла 60px, справа рамка холста — отступ 8px, радиус 12px, граница 1px.
 * Внутри рамки — два канваса абсолютом на всю её площадь (Three снизу, Canvas2D конструктора сверху, неактивный
 * скрыт атрибутом `hidden`), а над ними `children` (оверлеи скина 0061 и DOM-оверлей размеров 0060), обёрнутые в
 * `PlannerOverlayProvider`: два факта скина — фокус в поле длины и тумблеры подписей — не живут ни в документе,
 * ни в `ToolState`, но нужны и оверлею, и панелям. В `useEffect` поднимает планер через `createPlanner`, кладёт
 * `PlannerInstance` в `PlannerContext`, на unmount зовёт `dispose()`. Единственный слой пакета с React; владелец
 * канвасов один — React создаёт элементы и передаёт их фабрике.
 *
 * **Почему рамку рисует пакет, а не платформа** (задача 0089). В макете рейл стоит слева **снаружи** рамки, а
 * внутрь попадает только холст. Разделить их может лишь тот, кто владеет и рейлом, и канвасами: пока рамку рисовала
 * платформа вокруг всего контейнера, рейл оказывался её частью, и обойти это можно было только закраской зазора
 * поверх живого канваса. Отсюда же переезд рейла из `ConstructorSkin` в контейнер: снаружи рамки он обязан быть
 * флекс-соседом холста, а скин монтируется **детьми** контейнера, то есть внутри рамки. Скин от этого стал ровно
 * тем, что написано на упаковке, — оверлеями конструктора, снимаемыми вместе с видом.
 *
 * Планер пересоздаётся только при смене `projectId` — вместе с новыми `<canvas>` (`key`): после `dispose()`
 * контекст старого Three-канваса потерян (`forceContextLoss`). Скрытие через `hidden` безопасно: `ResizeObserver`
 * обеих проекций смотрит на **родителя канвасов** — то есть на рамку холста, а не на скрытый канвас с нулевым
 * rect (ADR 0020 «Что важно знать»). Контейнер со строкой рейла проекции не видят вовсе, и это правильно: холст —
 * это содержимое рамки.
 *
 * Холст конструктора — графика с текстовым описанием плана (решение 22): `role="img"` и `aria-label`,
 * обновляемый при изменении геометрии. Полной клавиатурной навигации по хендлам в этой версии нет.
 */
export const Planner: React.FC<PlannerProps> = ({
  projectId,
  logger,
  storage,
  saveTarget,
  frameBudget,
  className,
  onReady,
  children,
}) => {
  const threeRef = useRef<HTMLCanvasElement>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const [instance, setInstance] = useState<PlannerInstance | null>(null);
  const [activeView, setActiveView] = useState<ViewKind>('constructor');
  const [description, setDescription] = useState<string>(() => planDescription(null));

  // Актуальные колбэки — через ref, планеру отдаётся стабильный делегат: пропсы-функции вне deps эффекта.
  const loggerRef = useRef(logger);
  const onReadyRef = useRef(onReady);
  const storageRef = useRef(storage);
  const saveTargetRef = useRef(saveTarget);
  const frameBudgetRef = useRef(frameBudget);
  useEffect(() => {
    loggerRef.current = logger;
    onReadyRef.current = onReady;
    storageRef.current = storage;
  });
  const [stableLogger] = useState<PlannerLogger>(() => ({
    debug: (message, ...args) => loggerRef.current.debug(message, ...args),
    info: (message, ...args) => loggerRef.current.info(message, ...args),
    warn: (message, ...args) => loggerRef.current.warn(message, ...args),
    error: (message, ...args) => loggerRef.current.error(message, ...args),
  }));
  /**
   * Стабильный делегат транспорта — та же схема, что у `stableLogger`: смена ссылки `storage` планер не
   * пересоздаёт, вызовы уходят в актуальную реализацию. **Присутствие** пропа и набор draft-методов читаются при
   * монтировании (как `frameBudget`): режим редактора — обычный проект или демо — по ходу жизни планера не
   * меняется, а под новый режим планер поднимается заново вместе с `projectId`.
   */
  const [stableStorage] = useState<PlannerStorage | undefined>(() => {
    if (!storage) return undefined;
    const at = (): PlannerStorage => storageRef.current ?? storage;
    const delegate: PlannerStorage = {
      load: projectId => at().load(projectId),
      save: (projectId, document, options) => at().save(projectId, document, options),
    };
    if (storage.loadDraft) delegate.loadDraft = () => at().loadDraft?.() ?? Promise.resolve(null);
    if (storage.saveDraft) delegate.saveDraft = document => at().saveDraft?.(document) ?? Promise.resolve();
    if (storage.clearDraft) delegate.clearDraft = () => at().clearDraft?.() ?? Promise.resolve();
    return delegate;
  });

  useEffect(() => {
    const three = threeRef.current;
    const canvas2d = canvas2dRef.current;
    if (!three || !canvas2d) return;

    let planner: PlannerInstance;
    try {
      planner = createPlanner({
        canvas: { three, canvas2d },
        projectId,
        logger: stableLogger,
        storage: stableStorage,
        saveTarget: saveTargetRef.current,
        frameBudget: frameBudgetRef.current,
      });
    } catch (error) {
      stableLogger.error('@uyutno/planner: failed to start planner', error);
      return;
    }
    const { manager } = planner;
    setInstance(planner);
    setActiveView(manager.view.get().activeView);
    setDescription(planDescription(manager.document.getDerived()));

    const offView = manager.on('view:changed', view => setActiveView(view.activeView));
    const offDocument = manager.on('document:changed', () =>
      setDescription(planDescription(manager.document.getDerived())),
    );

    onReadyRef.current?.(planner);
    return () => {
      offView();
      offDocument();
      setInstance(null);
      planner.dispose();
    };
  }, [projectId, stableLogger, stableStorage]);

  return (
    /*
     * Провайдер стоит над контейнером, а не внутри условия: иначе появление экземпляра меняло бы тип корневого
     * элемента дерева, React пересоздал бы контейнер вместе с канвасами — и планер поднимался бы на элементах,
     * которых уже нет в документе. Значение до подъёма — `null`, и хуки контекста об этом честно говорят.
     */
    <PlannerContext value={instance}>
      <div className={className} style={containerStyle}>
        {/* Рейл — колонка слева снаружи рамки; он виден во всех видах: без него из конструктора некуда выйти. */}
        <div style={railStyle}>{instance && <ViewRail />}</div>

        <div style={frameStyle}>
          <canvas
            key={`three-${projectId}`}
            ref={threeRef}
            style={canvasStyle(activeView !== 'constructor')}
            hidden={activeView === 'constructor'}
          />
          <canvas
            key={`canvas2d-${projectId}`}
            ref={canvas2dRef}
            style={canvasStyle(activeView === 'constructor')}
            hidden={activeView !== 'constructor'}
            role='img'
            aria-label={description}
          />
          {instance && <PlannerOverlayProvider>{children}</PlannerOverlayProvider>}
        </div>
      </div>
    </PlannerContext>
  );
};
