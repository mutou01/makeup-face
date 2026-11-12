import { blushMask } from "./blush";
import { eyeshadowMask } from "./eyeshadow";
import type { Point } from "./face-analysis";
import { lipstickMask } from "./lipstick";

export type LayerSettings = {
  enabled: boolean;
  color: string;
  strength: number;
};
const kinds = ["lipstick", "blush", "eyeshadow"] as const;
type Settings = Record<(typeof kinds)[number], LayerSettings>;

function compile(mask: Uint8ClampedArray, maxOpacity: number) {
  const pixels: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) pixels.push(i);
  return { mask, pixels, maxOpacity };
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
    lipstick: compile(lips, 0.85),
    blush: cheeks ? compile(cheeks, 0.45) : null,
    eyeshadow: lids ? compile(lids, 0.52) : null,
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
        const { enabled, color, strength } = settings[kind];
        if (!layer || !enabled || strength === 0) continue;
        const target = [1, 3, 5].map((start) =>
          Number.parseInt(color.slice(start, start + 2), 16),
        );
        const opacity = (strength / 100) * layer.maxOpacity;
        for (const pixel of layer.pixels) {
          const amount = (layer.mask[pixel] / 255) * opacity;
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
