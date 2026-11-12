const size = 240;
const lips = new Path2D(
  "M90 158 C99 153 107 145 114 148 Q117 148 120 151 Q123 148 126 148 C133 145 141 153 150 158 C140 168 132 173 120 173 C108 173 100 168 90 158 Z",
);

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function fill(ctx: CanvasRenderingContext2D, path: string, color: string) {
  ctx.fillStyle = color;
  ctx.fill(new Path2D(path));
}

function stroke(
  ctx: CanvasRenderingContext2D,
  path: string,
  color: string,
  width: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke(new Path2D(path));
}

function drawPortrait(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#ece0e8";
  ctx.fillRect(0, 0, size, size);
  ellipse(ctx, 120, 105, 75, 87, "#3c2b39");
  ellipse(ctx, 120, 240, 94, 40, "#6f5578");
  fill(ctx, "M101 176 H139 L145 207 Q120 228 95 207 Z", "#cc947f");
  ellipse(ctx, 120, 112, 55, 77, "#e3ad98");
  fill(
    ctx,
    "M63 89 C63 45 83 25 120 25 C157 25 177 45 177 89 C155 89 128 73 119 55 C104 75 86 87 63 89 Z",
    "#3c2b39",
  );
  stroke(ctx, "M82 99 Q94 93 106 98 M134 98 Q146 93 158 99", "#704f48", 3);
  stroke(
    ctx,
    "M83 114 Q94 105 105 114 M135 114 Q146 105 157 114",
    "#563b40",
    2,
  );
  ellipse(ctx, 94, 112, 3.5, 4.5, "#4c3439");
  ellipse(ctx, 146, 112, 3.5, 4.5, "#4c3439");
  stroke(ctx, "M120 117 Q115 132 117 136 Q121 138 124 135", "#bc8473", 2);
  ctx.fillStyle = "#a75f64";
  ctx.fill(lips);
  stroke(ctx, "M93 158 Q120 163 147 158", "#78464c", 1.5);
  stroke(ctx, "M112 166 Q120 168 128 166", "#d28c8d", 1.5);
}

export function sampleLipstick(canvas: HTMLCanvasElement) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法打开画布");

  // Draw the mask once, then use its alpha as coverage. Both layers stay in memory.
  ctx.fill(lips);
  const mask = ctx.getImageData(0, 0, size, size).data;
  drawPortrait(ctx);
  const original = ctx.getImageData(0, 0, size, size);
  const output = ctx.createImageData(size, size);

  return (enabled: boolean, color: string, strength: number) => {
    if (!enabled || strength === 0) {
      ctx.putImageData(original, 0, 0);
      return;
    }
    const target = [1, 3, 5].map((start) =>
      Number.parseInt(color.slice(start, start + 2), 16),
    );
    output.data.set(original.data);
    for (let i = 0; i < mask.length; i += 4) {
      const amount = (mask[i + 3] / 255) * (strength / 100) * 0.85;
      if (amount === 0) continue;
      for (let c = 0; c < 3; c++) {
        const source = original.data[i + c];
        output.data[i + c] = source + (target[c] - source) * amount;
      }
    }
    ctx.putImageData(output, 0, 0);
  };
}
