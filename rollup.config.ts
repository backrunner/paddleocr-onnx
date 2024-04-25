import path from 'path';

import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';

import pkg from './package.json';

const plugins = [
  json(),
  resolve({
    browser: false,
    preferBuiltins: true,
  }),
  replace({
    __dirname: path.resolve(__dirname, './src'),
  }),
  commonjs({
    ignoreDynamicRequires: true,
  }),
  typescript({ useTsconfigDeclarationDir: true }),
  sourceMaps(),
];

export default {
  input: `src/main.ts`,
  output: [
    {
      file: pkg.main,
      name: pkg.name,
      format: 'cjs',
      sourcemap: false,
    },
    {
      file: pkg.module,
      name: pkg.name,
      format: 'esm',
      sourcemap: false,
    },
  ],
  external: ['sharp', 'onnxruntime-node', '@doodle3d/clipper-js', '@techstark/opencv-js'],
  watch: {
    include: 'src/**',
  },
  plugins,
};
