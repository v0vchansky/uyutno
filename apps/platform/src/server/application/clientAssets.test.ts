import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ClientAssetsUnavailableError, createClientAssetsResolver, resolveProdClientAssets } from './clientAssets';

const STATIC_URL = '/static';

const makeDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'uyutno-client-assets-'));
const touch = (dir: string, ...files: string[]): void => {
  for (const file of files) fs.writeFileSync(path.join(dir, file), '');
};

describe('resolveProdClientAssets', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('находит хешированные bundle.<hash>.js и main.<hash>.css, игнорируя посторонние файлы', () => {
    touch(
      dir,
      'bundle.2a08ac0e09f580c0c715.js',
      'bundle.2a08ac0e09f580c0c715.js.LICENSE.txt',
      'main.e289322c.css',
      'a.woff2',
    );
    expect(resolveProdClientAssets(dir, STATIC_URL)).toEqual({
      jsPath: '/static/bundle.2a08ac0e09f580c0c715.js',
      cssHref: '/static/main.e289322c.css',
    });
  });

  it('не берёт dev-имена и посторонние .js/.css за prod-бандл', () => {
    touch(dir, 'bundle.js', 'styles.css', 'vendor.js', 'extra.css');
    expect(() => resolveProdClientAssets(dir, STATIC_URL)).toThrow(
      /Expected exactly one bundle\.<hash>\.js .* found none/,
    );
  });

  it('падает, если бандлов несколько (реликты прошлой сборки)', () => {
    touch(dir, 'bundle.aaaa.js', 'bundle.bbbb.js', 'main.cccc.css');
    expect(() => resolveProdClientAssets(dir, STATIC_URL)).toThrow(/found bundle\.aaaa\.js, bundle\.bbbb\.js/);
  });

  it('падает с понятной ошибкой, если CSS нет', () => {
    touch(dir, 'bundle.aaaa.js');
    expect(() => resolveProdClientAssets(dir, STATIC_URL)).toThrow(/Expected exactly one main\.<hash>\.css/);
  });

  it('падает с понятной ошибкой, если директории сборки нет', () => {
    expect(() => resolveProdClientAssets(path.join(dir, 'missing'), STATIC_URL)).toThrow(
      /Client build directory not found/,
    );
  });
});

describe('createClientAssetsResolver', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeDir();
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('production: резолвит при создании и дальше отдаёт кэш', async () => {
    touch(dir, 'bundle.aaaa.js', 'main.bbbb.css');
    const resolve = createClientAssetsResolver({ staticDir: dir, staticUrl: STATIC_URL, mode: 'production' });
    fs.rmSync(path.join(dir, 'bundle.aaaa.js'));
    await expect(resolve()).resolves.toEqual({ jsPath: '/static/bundle.aaaa.js', cssHref: '/static/main.bbbb.css' });
  });

  it('production: бросает при создании, если бандла нет', () => {
    expect(() => createClientAssetsResolver({ staticDir: dir, staticUrl: STATIC_URL, mode: 'production' })).toThrow(
      /did you run `pnpm build`/,
    );
  });

  it('development: не читает диск при создании и отдаёт фиксированные имена, когда файлы есть', async () => {
    const resolve = createClientAssetsResolver({ staticDir: dir, staticUrl: STATIC_URL, mode: 'development' });
    touch(dir, 'bundle.js', 'styles.css', 'bundle.2a08ac0e.js', 'main.e289.css');
    await expect(resolve()).resolves.toEqual({ jsPath: '/static/bundle.js', cssHref: '/static/styles.css' });
    expect(console.info).not.toHaveBeenCalled();
  });

  it('development: ждёт появления бандла (гонка с клиентским watch при старте)', async () => {
    const resolve = createClientAssetsResolver({
      staticDir: dir,
      staticUrl: STATIC_URL,
      mode: 'development',
      devWaitTimeoutMs: 5_000,
      devPollIntervalMs: 10,
    });
    const first = resolve();
    const second = resolve();
    await new Promise(r => setTimeout(r, 50));
    touch(dir, 'bundle.js');
    await new Promise(r => setTimeout(r, 30));
    touch(dir, 'styles.css');
    await expect(first).resolves.toEqual({ jsPath: '/static/bundle.js', cssHref: '/static/styles.css' });
    await expect(second).resolves.toEqual({ jsPath: '/static/bundle.js', cssHref: '/static/styles.css' });
    // Один общий ожидатель на параллельные запросы — «waiting…» + «ready» логируются по разу.
    expect(console.info).toHaveBeenCalledTimes(2);
  });

  it('development: по таймауту — 503 с пояснением, а не HTML с битыми ссылками', async () => {
    const resolve = createClientAssetsResolver({
      staticDir: dir,
      staticUrl: STATIC_URL,
      mode: 'development',
      devWaitTimeoutMs: 40,
      devPollIntervalMs: 10,
    });
    const error = await resolve().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientAssetsUnavailableError);
    expect((error as ClientAssetsUnavailableError).status).toBe(503);
    expect((error as Error).message).toMatch(/is the client webpack watch running/);
    // После таймаута ожидание сбрасывается: следующий запрос снова ждёт и находит файлы.
    touch(dir, 'bundle.js', 'styles.css');
    await expect(resolve()).resolves.toEqual({ jsPath: '/static/bundle.js', cssHref: '/static/styles.css' });
  });
});
