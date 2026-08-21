import type React from 'react';
import { useState } from 'react';
import { BrowserRouter, StaticRouter } from 'react-router';

import type { Registry } from '@app/common';

import { Application } from './Application';
import { Document } from './components/Document/Document';
import { createRegistry, type InitialState } from './createRegistry';
import type { ClientAssets } from './initialState';

/**
 * Корни рендера — серверный и клиентский — лежат в одном файле намеренно.
 *
 * React считает автоидентификаторы (`useId`) **от корня рендера**: идентификатор — это путь узла в дереве, а не
 * счётчик. Если сервер рендерит от целого документа, а клиент гидрирует поддерево внутри `#root`, пути у одного
 * и того же компонента разные — идентификаторы расходятся, и гидрация пишет в консоль ошибку несовпадения
 * (задача 0091). Практически это значит, что любой компонент с `useId` — а у HeroUI это поля, модалки, тултипы,
 * `Spinner` — нельзя было ставить в SSR-разметку.
 *
 * Поэтому корень у сторон один и тот же — `Document`, то есть целый документ, и клиент гидрирует `document`
 * целиком (`hydrateApplication.tsx`). Разница между сторонами ровно одна и на путь в дереве не влияет: серверу
 * нужен `StaticRouter` (адрес приходит с запросом), клиенту — `BrowserRouter`. **Правка тут делается сразу в
 * обоих корнях**; гвард на это — `e2e/ssr-hydration.spec.ts`.
 */
interface RootProps {
  initialState: InitialState;
  assets: ClientAssets;
  /** Тело инлайнового скрипта-бутстрапа: сервер его собирает, клиент читает из DOM (`initialState.ts`). */
  bootstrapScript: string;
}

/** Registry живёт ровно один на приложение: `AuthManager` внутри держит состояние, пересоздавать его нельзя. */
const useRegistry = (initialState: InitialState): Registry => {
  const [registry] = useState(() => createRegistry(initialState));
  return registry;
};

export const ServerRoot: React.FC<RootProps & { location: string }> = ({
  location,
  initialState,
  assets,
  bootstrapScript,
}) => {
  const registry = useRegistry(initialState);

  return (
    <Document assets={assets} bootstrapScript={bootstrapScript}>
      <StaticRouter location={location}>
        <Application registry={registry} />
      </StaticRouter>
    </Document>
  );
};

export const ClientRoot: React.FC<RootProps> = ({ initialState, assets, bootstrapScript }) => {
  const registry = useRegistry(initialState);

  return (
    <Document assets={assets} bootstrapScript={bootstrapScript}>
      <BrowserRouter>
        <Application registry={registry} />
      </BrowserRouter>
    </Document>
  );
};
