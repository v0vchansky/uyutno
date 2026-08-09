import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';

const __filename = fileURLToPath(import.meta.url);
export const platformRoot = path.resolve(path.dirname(__filename), '..');
export const isProd = process.env.NODE_ENV === 'production';

export const definePlugin = new webpack.DefinePlugin({
  'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
});
