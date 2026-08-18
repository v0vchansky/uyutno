import * as fc from 'fast-check';

import { arbConvexPolygon, fcParams } from '../testing/arbitraries';
import { REATTACH_GRID, compareContours, compareContoursByArea, compareContoursOnePoint } from './compareContours';

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const OUTER = rect(0, 0, 100, 100);

describe('compareContours', () => {
  it('belong / contain: вложенность без общей границы (симметрично)', () => {
    const inner = rect(20, 20, 30, 30);
    expect(compareContours(inner, OUTER)).toBe('belong');
    expect(compareContours(OUTER, inner)).toBe('contain');
  });

  it('contactBelong / contactContain: вложенность с общим куском границы', () => {
    const inner = rect(0, 20, 30, 30); // левая сторона на левой стороне OUTER
    expect(compareContours(inner, OUTER)).toBe('contactBelong');
    expect(compareContours(OUTER, inner)).toBe('contactContain');
  });

  it('outside: разнесённые (bbox-предфильтр) и рядом без нахлёста', () => {
    expect(compareContours(OUTER, rect(500, 500, 10, 10))).toBe('outside');
    expect(compareContours(OUTER, rect(100.5, 0, 10, 10))).toBe('outside');
  });

  it('contact: снаружи с общим ребром; точечное касание углами — outside', () => {
    expect(compareContours(OUTER, rect(100, 20, 50, 30))).toBe('contact');
    expect(compareContours(rect(100, 20, 50, 30), OUTER)).toBe('contact');
    expect(compareContours(OUTER, rect(100, 100, 50, 50))).toBe('outside');
  });

  it('intersect: рёберное пересечение', () => {
    expect(compareContours(OUTER, rect(50, 50, 100, 100))).toBe('intersect');
    expect(compareContours(rect(50, 50, 100, 100), OUTER)).toBe('intersect');
  });

  it('intersect через середины рёбер: коллинеарный частичный нахлёст без рёберных пересечений', () => {
    // B шире A по x на одной высоте: рёбра A целиком на границе/внутри B? Нет — A выступает влево.
    const a = rect(-50, 0, 100, 100); // x ∈ [−50, 50]
    // Все вершины A: (−50,0) снаружи B, (50,0) на границе... смешанность вершин → intersect.
    expect(compareContours(a, OUTER)).toBe('intersect');
    // Контур, чьи вершины все лежат на границе другого, но середина ребра — снаружи (треугольник на стороне).
    const wedge = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: -50 },
    ];
    // Вершины (0,0),(100,0) на границе OUTER, (50,−50) снаружи → aOutB; B против A: вершины OUTER (0,100)…
    // снаружи wedge → и aOut, и bOut, контакт по ребру y=0 → contact.
    expect(compareContours(wedge, OUTER)).toBe('contact');
  });

  it('coincide: одинаковые контуры (в т.ч. с циклическим сдвигом и разной ориентацией)', () => {
    expect(compareContours(OUTER, OUTER)).toBe('coincide');
    expect(compareContours(OUTER, [...OUTER.slice(1), OUTER[0]!])).toBe('coincide');
    expect(compareContours(OUTER, [...OUTER].reverse())).toBe('coincide');
  });

  it('зазор между контурами: L_EPS-слак bbox — outside; общее ребро — контакт только при точной коллинеарности', () => {
    expect(compareContours(OUTER, rect(100.00005, 20, 50, 30))).toBe('outside');
    // Общая сторона со сдвигом 1e-9 (внутри L_EPS) — контакт; со сдвигом 1e-6 — уже нет.
    expect(compareContours(OUTER, rect(100 + 1e-9, 20, 50, 30))).toBe('contact');
    expect(compareContours(OUTER, rect(100 + 1e-6, 20, 50, 30))).toBe('outside');
  });

  it('асимметричный остаток → intersect: вырожденный контур целиком на границе другого, но B снаружи него', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(compareContours(OUTER, line)).toBe('intersect');
  });

  it('пустой контур — outside, без исключений', () => {
    expect(compareContours([], OUTER)).toBe('outside');
    expect(compareContours(OUTER, [])).toBe('outside');
  });

  it('property: контур совпадает с собой; выпуклый и его уменьшенная копия — contain/belong', () => {
    fc.assert(
      fc.property(arbConvexPolygon, polygon => {
        expect(compareContours(polygon, polygon)).toBe('coincide');
        const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
        const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
        const shrunk = polygon.map(p => ({ x: cx + (p.x - cx) * 0.5, y: cy + (p.y - cy) * 0.5 }));
        expect(compareContours(polygon, shrunk)).toBe('contain');
        expect(compareContours(shrunk, polygon)).toBe('belong');
      }),
      fcParams,
    );
  });
});

describe('compareContoursOnePoint', () => {
  it('belong / contain / outside по первой свободной вершине', () => {
    expect(compareContoursOnePoint(rect(20, 20, 30, 30), OUTER)).toBe('belong');
    expect(compareContoursOnePoint(OUTER, rect(20, 20, 30, 30))).toBe('contain');
    expect(compareContoursOnePoint(OUTER, rect(500, 0, 10, 10))).toBe('outside');
  });

  it('вершины на границе пропускаются; все на границах друг друга — coincide (не undefined)', () => {
    // Первая вершина A на границе B, вторая — внутри.
    const a = [
      { x: 0, y: 50 },
      { x: 30, y: 30 },
      { x: 30, y: 70 },
    ];
    expect(compareContoursOnePoint(a, OUTER)).toBe('belong');
    expect(compareContoursOnePoint(OUTER, OUTER)).toBe('coincide');
    expect(compareContoursOnePoint(OUTER, [...OUTER].reverse())).toBe('coincide');
  });

  it('A снаружи, все вершины B на границе A → coincide (второй проход не нашёл свободной вершины)', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    // Первая свободная вершина OUTER (100,100) снаружи «линии» → второй проход по её вершинам: все на границе.
    expect(compareContoursOnePoint(OUTER, line)).toBe('coincide');
    // Обратный порядок: все вершины «линии» на границе OUTER → проход по OUTER: (100,100) снаружи → outside.
    expect(compareContoursOnePoint(line, OUTER)).toBe('outside');
  });

  it('пустые контуры — coincide (нет свободных вершин)', () => {
    expect(compareContoursOnePoint([], [])).toBe('coincide');
  });
});

describe('compareContoursByArea', () => {
  it('REATTACH_GRID = 10 (ADR 0017 C7)', () => {
    expect(REATTACH_GRID).toBe(10);
  });

  it('перекрытие по площади — intersect; разнесённые — outside; узлы — по bbox первого', () => {
    expect(compareContoursByArea(OUTER, rect(50, 50, 100, 100))).toBe('intersect');
    expect(compareContoursByArea(OUTER, rect(200, 0, 100, 100))).toBe('outside');
    expect(compareContoursByArea(rect(20, 20, 30, 30), OUTER)).toBe('intersect');
  });

  it('контакт по ребру без общей площади — outside; правая/верхняя кромки не семплируются', () => {
    expect(compareContoursByArea(OUTER, rect(100, 0, 100, 100))).toBe('outside');
    // Перекрытие только в полосе x ∈ [95, 100] — между узлами сетки (шаг 10, последний узел 90) → пропуск.
    expect(compareContoursByArea(OUTER, rect(95, 0, 100, 100))).toBe('outside');
    // Полоса x ∈ [85, 100] захватывает узел 90 → intersect.
    expect(compareContoursByArea(OUTER, rect(85, 0, 100, 100))).toBe('intersect');
  });

  it('пустой первый контур — outside', () => {
    expect(compareContoursByArea([], OUTER)).toBe('outside');
  });
});
