import filesize from 'rollup-plugin-filesize';
import {terser} from 'rollup-plugin-terser';

export default {
  input: 'page.js',
  output: {
    file: 'page-bundled.js',
    format: 'esm',
  },
  plugins: [
    terser({
      warnings: true,
      mangle: {
        properties: {
          regex: /^__/,
        },
      },
    }),
    filesize({
      showBrotliSize: true,
    }),
  ],
};
