import { blushMask } from "./blush";
import { eyeshadowMask } from "./eyeshadow";
import type { Point } from "./face-analysis";
import { lipstickMask } from "./lipstick";
import { insideDistance } from "./mask-coverage";

export const MIN_COVERAGE = 50;
export const FULL_COVERAGE = 100;

export type LayerSettings = {
  enabled: boolean;
  color: string;
  strength: number;
  coverage: number;
};
const kinds = ["lipstick", "blush", "eyeshadow"] as const;
type Settings = Record<(typeof kinds)[number], LayerSettings>;

function compile(
  mask: Uint8ClampedArray,
  maxOpacity: number,
  width: number,
  height: number,
) {
  const pixels: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) pixels.push(i);
  return { mask, pixels, maxOpacity, ...insideDistance(mask, width, height) };
}

export function prepareMakeup(
  canvas: HTMLCanvasElement,
  frame: HTMLCanvasElement,
  points: Point[],
) {
  const { width, height } = frame;
  const lips = lipstickMask(width, height, points);
  if (!lips) return null;
  const cheeks = blushMask(width, height, points, lips);
  const lids = eyeshadowMask(width, height, points, lips, cheeks);
  const layers = {
    lipstick: compile(lips, 0.85, width, height),
    blush: cheeks ? compile(cheeks, 0.45, width, height) : null,
    eyeshadow: lids ? compile(lids, 0.52, width, height) : null,
  };
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(frame, 0, 0);
  const original = ctx.getImageData(0, 0, width, height);
  const output = ctx.createImageData(width, height);

  return {
    hasBlush: cheeks !== null,
    hasEyeshadow: lids !== null,
    paint(settings: Settings) {
      output.data.set(original.data);
      for (const kind of kinds) {
        const layer = layers[kind];
        const { enabled, color, strength, coverage } = settings[kind];
        if (!layer || !enabled || strength === 0) continue;
        const target = [1, 3, 5].map((start) =>
          Number.parseInt(color.slice(start, start + 2), 16),
        );
        const opacity = (strength / 100) * layer.maxOpacity;
        const reduction =
          (FULL_COVERAGE - coverage) / (FULL_COVERAGE - MIN_COVERAGE);
        const inset = layer.maxInset * Math.min(1, Math.max(0, reduction));
        for (const pixel of layer.pixels) {
          const edge = Math.max(0, Math.min(1, layer.distance[pixel] - inset));
          if (!edge) continue;
          const amount = (layer.mask[pixel] / 255) * opacity * edge;
          for (let c = 0; c < 3; c++) {
            const i = pixel * 4 + c;
            const source = original.data[i];
            output.data[i] = source + (target[c] - source) * amount;
          }
        }
      }
      ctx.putImageData(output, 0, 0);
    },
  };
}
