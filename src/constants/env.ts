import path from 'path';

let SRC_PATH = path.resolve(__dirname, '../');

if (global.__IS_BUNDLED__) {
  SRC_PATH = path.resolve(__dirname, '../src');
}

export { SRC_PATH };
