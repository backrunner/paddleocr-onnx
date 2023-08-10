export type SharpInput =
  | Buffer
  | ArrayBuffer
  | Uint8Array
  | Uint8ClampedArray
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array
  | string;

export interface ImageDescriptor {
  image: {
    red: Buffer;
    green: Buffer;
    blue: Buffer;
  };
  width: number;
  height: number;
  destWidth: number;
  destHeight: number;
}

export interface DetectedBoxRect {
  width: number;
  height: number;
  rect: [number, number][];
}
