import path from 'path';

const MODEL_DIR = path.resolve(__dirname, '../../models');

export const MODEL_PATH = {
  DET: path.resolve(MODEL_DIR, './det_onnx/model.onnx'),
  DET_V3: path.resolve(MODEL_DIR, './detv3_onnx/model.onnx'),
  DET_V4_TEACHER: path.resolve(MODEL_DIR, './det_onnx/model.onnx'),
  REC: path.resolve(MODEL_DIR, './rec_onnx/model.onnx'),
  REC_SERVER: path.resolve(MODEL_DIR, './rec_server_onnx/model.onnx'),
};

export type MODELS = keyof typeof MODEL_PATH;

export const SIDE_LENGTH_LIMIT = parseInt(process.env.LIMIT_SIDE_LENGTH || '', 10) || 1280;
