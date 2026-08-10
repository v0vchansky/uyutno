import path from 'node:path';
import nodeExternals from 'webpack-node-externals';

import { definePlugin, isProd, platformRoot } from './common.js';

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
    clean: isProd,
    module: true,
    chunkFormat: 'module',
    library: { type: 'module' },
  },
  devtool: isProd ? false : 'source-map',
  externalsPresets: { node: true },
  externals: [
    nodeExternals({
      allowlist: [/^@heroui\//],
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
    rules: [
      {
        test: /\.(ts|tsx)$/,
        loader: 'swc-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [definePlugin],
};

export default config;
