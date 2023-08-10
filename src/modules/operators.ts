import { Decimal } from 'decimal.js';
import { ImageDescriptor } from '../types';

export const normalizeImage = (
  descriptor: ImageDescriptor,
  mean: number[] = [0.485, 0.456, 0.406],
  std: number[] = [0.229, 0.224, 0.225],
) => {
  const { image } = descriptor;
  const { red, green, blue } = image;

  const redRes: number[] = [];
  const greenRes: number[] = [];
  const blueRes: number[] = [];

  for (let i = 0; i < red.length; i++) {
    redRes.push(new Decimal(red[i]).dividedBy(255).minus(mean[0]).dividedBy(std[0]).toNumber());
    greenRes.push(new Decimal(green[i]).dividedBy(255).minus(mean[1]).dividedBy(std[1]).toNumber());
    blueRes.push(new Decimal(blue[i]).dividedBy(255).minus(mean[2]).dividedBy(std[2]).toNumber());
  }

  // return a number[] contains BGR
  return [...blueRes, ...greenRes, ...redRes];
};
