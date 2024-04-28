import { defineConfig } from 'rollup';

import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';

import esmShim from '@rollup/plugin-esm-shim';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';

import pkg from './package.json';

const IS_TEST = process.env.PADDLE_OCR_TEST === '1';

const plugins = [
  json(),
  resolve({
    browser: false,
    preferBuiltins: true,
  }),
  replace({
    'global.__IS_BUNDLED__': JSON.stringify(true),
    preventAssignment: true,
  }),
  commonjs({
    ignoreDynamicRequires: true,
  }),
  typescript({ useTsconfigDeclarationDir: true }),
  esmShim(),
  sourceMaps(),
];

export default defineConfig({
  input: IS_TEST ? `src/test/index.ts` : `src/main.ts`,
  output: [
    {
      file: IS_TEST ? pkg.main.replace('.cjs', '.test.cjs') : pkg.main,
      name: pkg.name,
      format: 'cjs',
      sourcemap: false,
    },
    {
      file: IS_TEST ? pkg.module.replace('.mjs', '.test.mjs') : pkg.module,
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
});
