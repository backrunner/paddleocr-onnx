import { Decimal } from 'decimal.js';
import sharp, { type Sharp } from 'sharp';
import ort from 'onnxruntime-node';
import cv, { type Mat } from '@techstark/opencv-js';
import Shape from '@doodle3d/clipper-js';

import { SIDE_LENGTH_LIMIT } from '../constants/model';
import type { DetectedBoxRect, ImageDescriptor, SharpInput } from '../types';

import { normalizeImage } from './operators';

const CNT_MIN_SIZE = 3;

// preprocessing
const beforeDetection = async (image: Sharp): Promise<ImageDescriptor> => {
  const metadata = await image.metadata();
  let converted: Sharp | undefined;
  let newWidth = 0;
  let newHeight = 0;
  let ratio = new Decimal(1);
  if (metadata.width && metadata.width > SIDE_LENGTH_LIMIT) {
    ratio = new Decimal(metadata.width).dividedBy(SIDE_LENGTH_LIMIT);
    const calcedNewHeight = new Decimal(metadata.height || 0).dividedBy(ratio).round();
    newHeight = Math.max(calcedNewHeight.dividedBy(32).round().mul(32).toNumber(), 32);
    newWidth = Math.max(new Decimal(SIDE_LENGTH_LIMIT).dividedBy(32).round().mul(32).toNumber(), 32);
    converted = image
      .resize({
        width: newWidth,
        height: newHeight,
        fit: 'fill',
        kernel: 'nearest',
      })
      .removeAlpha();
  } else {
    if (metadata.height && metadata.height > SIDE_LENGTH_LIMIT) {
      ratio = new Decimal(metadata.height).dividedBy(SIDE_LENGTH_LIMIT);
      newHeight = Math.max(new Decimal(SIDE_LENGTH_LIMIT).dividedBy(32).round().mul(32).toNumber(), 32);
      const calcedNewWidth = new Decimal(metadata.width || 0).dividedBy(ratio).round();
      newWidth = Math.max(calcedNewWidth.dividedBy(32).round().mul(32).toNumber(), 32);
      converted = image
        .resize({
          width: newWidth,
          height: newHeight,
          fit: 'fill',
          kernel: 'nearest',
        })
        .removeAlpha();
      ratio = new Decimal(metadata.height).dividedBy(SIDE_LENGTH_LIMIT);
    } else {
      newWidth = Math.max(new Decimal(metadata.width || 0).dividedBy(32).round().mul(32).toNumber(), 32);
      newHeight = Math.max(new Decimal(metadata.height || 0).dividedBy(32).round().mul(32).toNumber(), 32);
      converted = image
        .resize({
          width: newWidth,
          height: newHeight,
          fit: 'fill',
          kernel: 'nearest',
        })
        .removeAlpha();
    }
  }

  if (!converted) {
    throw new Error('Cannot get the converted image.');
  }
  const [red, green, blue] = await Promise.all(
    (['red', 'green', 'blue'] as ('red' | 'green' | 'blue')[]).map((channel) =>
      converted!.raw().extractChannel(channel).toBuffer(),
    ),
  );

  if (!newWidth || !newHeight) {
    throw new Error('Wrong image shape.');
  }

  return {
    image: { red, green, blue },
    width: metadata.width || 0,
    height: metadata.height || 0,
    destWidth: newWidth,
    destHeight: newHeight,
  };
};

function boxPoints(center: { x: number; y: number }, size: { width: number; height: number }, angle: number) {
  const { width, height } = size;
  const { x: cx, y: cy } = center;
  const radian = new Decimal(angle).mul(Decimal.set({ precision: 100 }).acos(-1).dividedBy(180));

  const points = [];
  for (let i = 0; i < 4; i++) {
    const x = new Decimal(i & 1 ? -1 : 1).mul(width).dividedBy(2);
    const y = new Decimal(i & 2 ? -1 : 1).mul(height).dividedBy(2);

    const sinVal = Decimal.sin(radian);
    const cosVal = Decimal.cos(radian);

    const rotatedX = x.mul(cosVal).minus(y.mul(sinVal));
    const rotatedY = x.mul(sinVal).add(y.mul(cosVal));

    points.push([rotatedX.add(cx).toNumber(), rotatedY.add(cy).toNumber()]);
  }

  return points;
}

const getMiniBoxes = (contour: Mat) => {
  const boundingBox = cv.minAreaRect(contour);
  const points = Array.from(boxPoints(boundingBox.center, boundingBox.size, boundingBox.angle)).sort(
    (a, b) => a[0] - b[0],
  ) as [number, number][];

  let index_1 = 0;
  let index_2 = 1;
  let index_3 = 2;
  let index_4 = 3;
  if (points[1][1] > points[0][1]) {
    index_1 = 0;
    index_4 = 1;
  } else {
    index_1 = 1;
    index_4 = 0;
  }
  if (points[3][1] > points[2][1]) {
    index_2 = 2;
    index_3 = 3;
  } else {
    index_2 = 3;
    index_3 = 2;
  }

  const box = [points[index_1], points[index_2], points[index_3], points[index_4]];
  const side = Math.min(boundingBox.size.height, boundingBox.size.width);

  return { points: box, sside: side };
};

function polygonPolygonArea(polygon: [number, number][]) {
  let i = -1;
  let n = polygon.length;
  let a: [number, number];
  let b = polygon[n - 1];
  let area = new Decimal(0);

  while (++i < n) {
    a = b;
    b = polygon[i];
    area = area.add(new Decimal(a[1]).mul(b[0]).minus(new Decimal(a[0]).mul(b[1])));
  }

  return area.dividedBy(2).toNumber();
}

function polygonPolygonLength(polygon: [number, number][]) {
  let i = -1;
  let n = polygon.length;
  let b = polygon[n - 1];
  let xa: number;
  let ya: number;
  let xb = b[0];
  let yb = b[1];
  let perimeter = 0;

  while (++i < n) {
    xa = xb;
    ya = yb;
    b = polygon[i];
    xb = b[0];
    yb = b[1];
    xa -= xb;
    ya -= yb;
    perimeter += Math.hypot(xa, ya);
  }

  return perimeter;
}

const unclip = async (box: [number, number][]) => {
  const unclip_ratio = 1.5;
  const area = Math.abs(polygonPolygonArea(box));
  const length = polygonPolygonLength(box);
  const distance = (area * unclip_ratio) / length;
  const boxPoints: { X: number; Y: number }[] = [];
  box.forEach((item) => {
    const obj = {
      X: 0,
      Y: 0,
    };
    obj.X = item[0];
    obj.Y = item[1];
    boxPoints.push(obj);
  });
  const shape = new Shape([boxPoints]);
  return shape.offset(distance, {
    jointType: 'jtRound',
  });
};

function orderPointsClockwise(pts: [number, number][]) {
  const rect: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const s = pts.map((pt) => pt[0] + pt[1]);
  rect[0] = pts[s.indexOf(Math.min(...s))];
  rect[2] = pts[s.indexOf(Math.max(...s))];
  const tmp = pts.filter((pt) => pt !== rect[0] && pt !== rect[2]);
  const diff = tmp[1].map((e, i) => e - tmp[0][i]);
  rect[1] = tmp[diff.indexOf(Math.min(...diff))];
  rect[3] = tmp[diff.indexOf(Math.max(...diff))];
  return rect;
}

function linalgNorm(p0: [number, number], p1: [number, number]) {
  const p0_x = new Decimal(p0[0]);
  const p0_y = new Decimal(p0[1]);
  const p1_x = new Decimal(p1[0]);
  const p1_y = new Decimal(p1[1]);
  return p0_x.minus(p1_x).pow(2).add(p0_y.minus(p1_y).pow(2)).sqrt().toNumber();
}

function clip(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

// Reference:
// https://github.com/triwinds/ppocr-onnx/blob/main/ppocronnx/det/postprocess.py
// https://github.com/xushengfeng/eSearch-OCR/blob/master/src/main.ts
const getBoxRects = async (descriptor: ImageDescriptor, bitmap: cv.Mat) => {
  // the res is actually a bitmap
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bitmap, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const boxes: DetectedBoxRect[] = [];

  // get contours
  for (let i = 0; i < (contours as any).size(); i++) {
    const cnt = contours.get(i);
    const { points, sside } = getMiniBoxes(cnt);
    if (sside < CNT_MIN_SIZE) {
      continue;
    }

    const clipBox = await unclip(points);

    const boxMap = cv.matFromArray(
      clipBox.paths[0].length,
      1,
      cv.CV_32SC2,
      clipBox.paths[0].flatMap((item) => [item.X, item.Y]),
    );

    const miniBox = getMiniBoxes(boxMap);
    if (miniBox.sside < CNT_MIN_SIZE + 2) {
      continue;
    }

    // sort points by clockwise order
    const detRect = orderPointsClockwise(miniBox.points);

    let rx = new Decimal(descriptor.width).dividedBy(descriptor.destWidth);
    let ry = new Decimal(descriptor.height).dividedBy(descriptor.destHeight);

    detRect.forEach((point) => {
      point[0] = clip(new Decimal(point[0]).mul(rx).toNumber(), 0, descriptor.destWidth);
      point[1] = clip(new Decimal(point[1]).mul(ry).toNumber(), 0, descriptor.destHeight);
    });

    const rectWidth = Math.round(linalgNorm(detRect[0], detRect[1]));
    const rectHeight = Math.round(linalgNorm(detRect[0], detRect[3]));

    if (rectWidth <= CNT_MIN_SIZE || rectHeight <= CNT_MIN_SIZE) continue;

    boxes.push({
      rect: detRect,
      width: rectWidth,
      height: rectHeight,
    });
  }

  return boxes;
};

const createInferenceSession = async (modelPath: string) => {
  return await ort.InferenceSession.create(modelPath);
};

export const detect = async ({ input, modelPath }: { input: SharpInput; modelPath: string }) => {
  const loadedImage = await sharp(input);
  const descriptor = await beforeDetection(loadedImage);

  const normalized = normalizeImage(descriptor).flat(Infinity) as number[];

  const session = await createInferenceSession(modelPath);
  const feed = {
    [session.inputNames[0]]: new ort.Tensor('float32', Float32Array.from(normalized), [
      1,
      3,
      descriptor.destHeight,
      descriptor.destWidth,
    ]),
  };

  const res = await session.run(feed);

  const output = res[session.outputNames[0]];

  await new Promise((resolve) => {
    cv.onRuntimeInitialized = resolve as () => any;
  });

  const resData = {
    width: descriptor.destWidth,
    height: descriptor.destHeight,
    data: output.data,
  };

  const mat = new cv.Mat(resData.height, resData.width, cv.CV_8UC1);
  mat.data.set(output.data as Uint8Array);

  const rects = await getBoxRects(descriptor, mat);

  return { descriptor, rects };
};
