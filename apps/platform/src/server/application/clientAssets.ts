import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { AppError } from '../common';

/**
 * Пути клиентских ассетов для SSR-обёртки (`<script src>` / `<link href>`). Имена файлов задаёт
 * `webpack/webpack.client.js`: dev — фиксированные `bundle.js` + `styles.css`, prod — `bundle.<hash>.js` +
 * `main.<hash>.css`. Здесь — единственное место на сервере, которое знает эти имена.
 */
export interface ClientAssets {
  jsPath: string;
  cssHref: string;
}

export type ClientAssetsResolver = () => Promise<ClientAssets>;

/** Ошибка запроса страницы, когда dev-бандл ещё не собран (клиентский watch не успел или не запущен). */
export class ClientAssetsUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503);
  }
}

const DEV_JS_FILE = 'bundle.js';
const DEV_CSS_FILE = 'styles.css';
const PROD_JS_PATTERN = /^bundle\.[0-9a-f]+\.js$/;
const PROD_CSS_PATTERN = /^main\.[0-9a-f]+\.css$/;

const DEFAULT_DEV_WAIT_TIMEOUT_MS = 90_000;
const DEFAULT_DEV_POLL_INTERVAL_MS = 200;

interface CreateClientAssetsResolverOptions {
  /** Директория с клиентской сборкой (`dist/client`). */
  staticDir: string;
  /** URL-префикс, под которым `staticDir` раздаётся (`/static`). */
  staticUrl: string;
  mode: 'development' | 'production';
  /** Dev: сколько ждать появления бандла до 503. */
  devWaitTimeoutMs?: number;
  devPollIntervalMs?: number;
}

/**
 * Prod: читаем `dist/client` один раз при старте и падаем с понятной ошибкой, если хешированных
 * ассетов нет или их несколько (посторонние/реликтовые файлы) — тихо отдавать HTML с битыми ссылками нельзя.
 */
export const resolveProdClientAssets = (staticDir: string, staticUrl: string): ClientAssets => {
  let files: string[];
  try {
    files = fs.readdirSync(staticDir);
  } catch {
    throw new Error(`Client build directory not found: ${staticDir} — did you run \`pnpm build\`?`);
  }

  const pickOne = (pattern: RegExp, label: string): string => {
    const matches = files.filter(file => pattern.test(file));
    const [only] = matches;
    if (matches.length === 1 && only !== undefined) return only;
    const found = matches.length === 0 ? 'none' : matches.join(', ');
    throw new Error(
      `Expected exactly one ${label} in ${staticDir}, found ${found} — did you run \`pnpm build\` (and is dist/client clean)?`,
    );
  };

  const jsFile = pickOne(PROD_JS_PATTERN, 'bundle.<hash>.js');
  const cssFile = pickOne(PROD_CSS_PATTERN, 'main.<hash>.css');
  return { jsPath: `${staticUrl}/${jsFile}`, cssHref: `${staticUrl}/${cssFile}` };
};

const devAssetsExist = (staticDir: string): boolean =>
  fs.existsSync(path.join(staticDir, DEV_JS_FILE)) && fs.existsSync(path.join(staticDir, DEV_CSS_FILE));

/**
 * Dev: имена фиксированы, диск при старте не читаем — клиентский watch (`pnpm dev`) эмитит бандл параллельно
 * со стартом сервера, и первые запросы могут прийти раньше. Поэтому на каждом запросе страницы проверяем,
 * что файлы есть (два `existsSync` — дёшево), а если нет — ждём их появления, а не отдаём HTML с 404-ссылками.
 */
const createDevClientAssetsResolver = (
  staticDir: string,
  staticUrl: string,
  waitTimeoutMs: number,
  pollIntervalMs: number,
): ClientAssetsResolver => {
  const assets: ClientAssets = { jsPath: `${staticUrl}/${DEV_JS_FILE}`, cssHref: `${staticUrl}/${DEV_CSS_FILE}` };
  let waiting: Promise<void> | null = null;

  const waitForAssets = async (): Promise<void> => {
    console.info(`Client bundle not found in ${staticDir} yet — waiting for the client webpack watch…`);
    const deadline = Date.now() + waitTimeoutMs;
    while (!devAssetsExist(staticDir)) {
      if (Date.now() >= deadline) {
        throw new ClientAssetsUnavailableError(
          `Dev client bundle (${DEV_JS_FILE}, ${DEV_CSS_FILE}) did not appear in ${staticDir} within ${waitTimeoutMs} ms — is the client webpack watch running (\`pnpm dev\`)?`,
        );
      }
      await sleep(pollIntervalMs);
    }
    console.info('Client bundle is ready');
  };

  return async () => {
    if (!devAssetsExist(staticDir)) {
      // Один общий ожидатель на все параллельные запросы, чтобы не плодить поллеры и логи.
      waiting ??= waitForAssets().finally(() => {
        waiting = null;
      });
      await waiting;
    }
    return assets;
  };
};

export const createClientAssetsResolver = ({
  staticDir,
  staticUrl,
  mode,
  devWaitTimeoutMs = DEFAULT_DEV_WAIT_TIMEOUT_MS,
  devPollIntervalMs = DEFAULT_DEV_POLL_INTERVAL_MS,
}: CreateClientAssetsResolverOptions): ClientAssetsResolver => {
  if (mode === 'production') {
    const assets = resolveProdClientAssets(staticDir, staticUrl);
    return () => Promise.resolve(assets);
  }
  return createDevClientAssetsResolver(staticDir, staticUrl, devWaitTimeoutMs, devPollIntervalMs);
};
