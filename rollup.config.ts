import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';
import pkg from './package.json';

const plugins = [
  json(),
  resolve({
    browser: false,
    preferBuiltins: true,
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
  ],
  external: ['sharp', 'onnxruntime-node', '@doodle3d/clipper-js', '@techstark/opencv-js'],
  watch: {
    include: 'src/**',
  },
  plugins,
};
