import path from 'node:path';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';

import { definePlugin, isProd, platformRoot } from './common.js';

/** @type {import('webpack').Configuration} */
const config = {
  mode: isProd ? 'production' : 'development',
  name: 'client',
  entry: path.resolve(platformRoot, 'src/client/client.tsx'),
  output: {
    filename: `bundle${isProd ? '.[contenthash]' : ''}.js`,
    path: path.resolve(platformRoot, 'dist/client'),
    publicPath: '/static/',
    clean: true,
  },
  devtool: isProd ? false : 'source-map',
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    plugins: [
      new TsconfigPathsPlugin({
        configFile: path.resolve(platformRoot, 'src/client/tsconfig.json'),
        extensions: ['.tsx', '.ts', '.js'],
      }),
    ],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        loader: 'swc-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, { loader: 'css-loader', options: { import: false } }, 'postcss-loader'],
      },
    ],
  },
  plugins: [
    definePlugin,
    new MiniCssExtractPlugin({
      filename: isProd ? '[name].[contenthash].css' : 'styles.css',
    }),
  ],
};

export default config;
