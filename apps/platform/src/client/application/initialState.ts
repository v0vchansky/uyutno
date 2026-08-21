import type { InitialState } from './createRegistry';

export const INITIAL_STATE_GLOBAL = '__INITIAL_STATE__';
export const CLIENT_ASSETS_GLOBAL = '__CLIENT_ASSETS__';

/**
 * Id инлайнового скрипта-бутстрапа. Клиент читает его текст **дословно** (`textContent`) и отдаёт обратно в
 * разметку своего корня: так строка на сервере и на клиенте одна и та же посимвольно, а не «должна совпасть»
 * после round-trip'а через `JSON.parse`/`JSON.stringify`.
 */
export const BOOTSTRAP_SCRIPT_ID = 'uyutno-bootstrap';

/** Пути клиентских бандлов, выбранные сервером на этот запрос (задача 0040). */
export interface ClientAssets {
  cssHref: string;
  jsPath: string;
}

/** `<` экранируется: значение уезжает внутрь `<script>`, где `</...` закрыл бы тег. */
const toJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Тело инлайнового скрипта в `<head>`: начальное состояние приложения и пути бандлов. Пути нужны клиенту не
 * ради загрузки (её делает браузер), а ради **рендера того же `<head>`**, что отдал сервер, — гидрация идёт от
 * целого документа (см. `roots.tsx`).
 */
export const serializeBootstrap = (state: InitialState, assets: ClientAssets): string =>
  `window.${INITIAL_STATE_GLOBAL}=${toJson(state)};window.${CLIENT_ASSETS_GLOBAL}=${toJson(assets)};`;
