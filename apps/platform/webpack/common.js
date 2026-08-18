import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';

const __filename = fileURLToPath(import.meta.url);
export const platformRoot = path.resolve(path.dirname(__filename), '..');
export const repoRoot = path.resolve(platformRoot, '../..');
export const isProd = process.env.NODE_ENV === 'production';

export const definePlugin = new webpack.DefinePlugin({
  'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
});

/**
 * Единое правило транспиляции TS/TSX для обоих бандлов (ADR 0013). Опции SWC — только из корневого
 * `.swcrc` монорепы (один источник правды для платформы и воркспейс-пакетов вроде `packages/planner`;
 * `configFile` задан явно, чтобы не зависеть от cwd и поиска `.swcrc` вверх от файла).
 * `exclude` — `node_modules` по реальному пути; воркспейс-пакеты (`packages/*`) резолвятся через симлинк
 * в реальную директорию и под `exclude` не попадают — их исходники транспилируются как свои.
 */
export const swcRule = {
  test: /\.(ts|tsx)$/,
  loader: 'swc-loader',
  exclude: /node_modules/,
  options: {
    configFile: path.resolve(repoRoot, '.swcrc'),
  },
};
