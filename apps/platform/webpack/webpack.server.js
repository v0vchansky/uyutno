import path from 'node:path';
import nodeExternals from 'webpack-node-externals';

import { definePlugin, isProd, platformRoot, swcRule } from './common.js';

/** @type {import('webpack').Configuration} */
const config = {
  mode: isProd ? 'production' : 'development',
  name: 'server',
  target: 'node',
  entry: path.resolve(platformRoot, 'src/server/server.ts'),
  experiments: {
    outputModule: true,
  },
  output: {
    filename: 'server.js',
    path: path.resolve(platformRoot, 'dist/server'),
    clean: true,
    module: true,
    chunkFormat: 'module',
    library: { type: 'module' },
  },
  devtool: isProd ? false : 'source-map',
  externalsPresets: { node: true },
  externals: [
    // Bare-импорты (npm-зависимости) — внешние; воркспейс-пакеты `@uyutno/*` бандлятся: у них нет
    // build/dist, платформа потребляет исходники (ADR 0002, 0015). Их собственные зависимости
    // (`three`, `immer`, `mitt`), которых нет в node_modules платформы, попадают в SSR-бандл by design.
    nodeExternals({
      allowlist: [/^@heroui\//, /^@uyutno\//],
      importType: 'module',
    }),
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
    alias: {
      '@server': path.resolve(platformRoot, 'src/server'),
      '@app': path.resolve(platformRoot, 'src/client'),
    },
  },
  module: {
    rules: [swcRule],
  },
  plugins: [definePlugin],
};

export default config;
