import { Decimal } from 'decimal.js';
import sharp, { type Sharp } from 'sharp';
import ort from 'onnxruntime-node';
import { Polygon, Point } from '@mathigon/euclid';
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
  let ratio = new Decimal(1);

  if (!metadata.width || !metadata.height) {
    throw new Error('Invalid image');
  }

  if (Math.max(metadata.width, metadata.height) > SIDE_LENGTH_LIMIT) {
    if (metadata.height > metadata.width) {
      ratio = new Decimal(SIDE_LENGTH_LIMIT).dividedBy(metadata.height);
    } else {
      ratio = new Decimal(SIDE_LENGTH_LIMIT).dividedBy(metadata.width);
    }
  }

  let resizedWidth = new Decimal(metadata.width).mul(ratio).dividedBy(32).round().mul(32).toNumber();
  let resizedHeight = new Decimal(metadata.height).mul(ratio).dividedBy(32).round().mul(32).toNumber();

  converted = image
    .resize({
      width: resizedWidth,
      height: resizedHeight,
      fit: 'fill',
      kernel: 'nearest',
    })
    .removeAlpha();

  if (!converted) {
    throw new Error('Cannot get the converted image.');
  }
  const [red, green, blue] = await Promise.all(
    (['red', 'green', 'blue'] as ('red' | 'green' | 'blue')[]).map((channel) =>
      converted!.raw().extractChannel(channel).toBuffer(),
    ),
  );

  if (!resizedWidth || !resizedHeight) {
    throw new Error('Wrong image shape.');
  }

  return {
    image: { red, green, blue },
    width: metadata.width || 0,
    height: metadata.height || 0,
    destWidth: resizedWidth,
    destHeight: resizedHeight,
  };
};

function boxPoints(center: { x: number; y: number }, size: { width: number; height: number }, angle: number) {
  const angleRad = (angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const w2 = size.width / 2;
  const h2 = size.height / 2;
  // Calculate the change in coordinates at each corner due to rotation
  const changes = [
    { dx: -w2 * cosA - h2 * sinA, dy: w2 * sinA - h2 * cosA },
    { dx: w2 * cosA - h2 * sinA, dy: -w2 * sinA - h2 * cosA },
    { dx: w2 * cosA + h2 * sinA, dy: -w2 * sinA + h2 * cosA },
    { dx: -w2 * cosA + h2 * sinA, dy: w2 * sinA + h2 * cosA },
  ];
  // Apply the rotation to each corner point
  const vertices = changes.map((change) => {
    return {
      x: center.x + change.dx,
      y: center.y + change.dy,
    };
  });
  return vertices.flatMap(({ x, y }) => [[x, y]]) as [number, number][];
}

const getMiniBoxes = (contour: Mat) => {
  const boundingBox = cv.minAreaRect(contour);

  const points = boxPoints(boundingBox.center, boundingBox.size, boundingBox.angle).sort((a, b) => a[0] - b[0]);

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

const unclip = async (box: [number, number][]) => {
  const unclipRatio = 1.5;

  const polygon = new Polygon(...box.map((item) => new Point(item[0], item[1])));
  const area = Math.abs(polygon.area);
  const length = polygon.circumference;
  const distance = (area * unclipRatio) / length;

  const shape = new ((Shape as any).default ? (Shape as any).default : Shape)([
    box.map((item) => ({
      X: item[0],
      Y: item[1],
    })),
  ]) as Shape;

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
    const epsilon = 0.001 * cv.arcLength(cnt, true);

    cv.approxPolyDP(cnt, cnt, epsilon, true);

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
    const rectWidth = Math.round(Math.max(linalgNorm(detRect[0], detRect[1]), linalgNorm(detRect[2], detRect[3])));
    const rectHeight = Math.round(Math.max(linalgNorm(detRect[0], detRect[3]), linalgNorm(detRect[1], detRect[2])));

    detRect.forEach((point) => {
      point[0] = clip(
        new Decimal(point[0]).dividedBy(descriptor.destWidth).mul(descriptor.width).round().toNumber(),
        0,
        descriptor.destWidth,
      );
      point[1] = clip(
        new Decimal(point[1]).dividedBy(descriptor.destHeight).mul(descriptor.height).round().toNumber(),
        0,
        descriptor.destHeight,
      );
    });

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
  const loadedImage = sharp(input);
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

  if (!cv) {
    await new Promise((resolve) => {
      cv.onRuntimeInitialized = resolve as () => any;
    });
  }

  const resData = {
    width: descriptor.destWidth,
    height: descriptor.destHeight,
    data: output.data as Uint8Array,
  };

  const data: number[] = [];
  resData.data.forEach((value) => {
    if (value > 0.3) data.push(255);
    else data.push(0);
  });

  const mat = new cv.Mat(resData.height, resData.width, cv.CV_8UC1);
  mat.data.set(new Uint8Array(data));

  // dilate the mat with 2x2 kernel
  const kernel = new cv.Mat(2, 2, cv.CV_8UC1);
  kernel.data.set([1, 1, 1, 1]);

  cv.dilate(mat, mat, kernel);

  const rects = await getBoxRects(descriptor, mat);

  return { descriptor, rects };
};
