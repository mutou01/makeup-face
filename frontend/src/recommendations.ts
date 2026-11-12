import type { LayerSettings } from "./makeup-preview";

export const scenes = {
  any: "不限场景",
  daily: "日常",
  photo: "拍照",
  party: "聚会",
} as const;
export const looks = {
  any: "不限妆感",
  natural: "自然",
  warm: "暖色",
  bold: "浓郁",
} as const;
type Scene = keyof typeof scenes;
type Look = keyof typeof looks;

export type PresetLayer = Readonly<Pick<LayerSettings, "color" | "strength">>;
export type Preset = Readonly<{
  id: string;
  name: string;
  scene: Exclude<Scene, "any">;
  look: Exclude<Look, "any">;
  note: string;
  layers: Readonly<Record<"lipstick" | "blush" | "eyeshadow", PresetLayer>>;
}>;

// These are authored palettes, not claims about the user's skin tone or face shape.
const presets = [
  {
    id: "daily-rose",
    name: "日常豆沙",
    scene: "daily",
    look: "natural",
    note: "用低饱和豆沙和柔棕搭配，整体更柔和。",
    layers: {
      lipstick: { color: "#A55262", strength: 44 },
      blush: { color: "#C97881", strength: 35 },
      eyeshadow: { color: "#99716C", strength: 32 },
    },
  },
  {
    id: "photo-peach",
    name: "蜜桃暖妆",
    scene: "photo",
    look: "warm",
    note: "蜜桃唇颊搭配暖棕眼影，让三处色调一致。",
    layers: {
      lipstick: { color: "#C06350", strength: 57 },
      blush: { color: "#DE896D", strength: 50 },
      eyeshadow: { color: "#AC7255", strength: 45 },
    },
  },
  {
    id: "party-berry",
    name: "莓果夜妆",
    scene: "party",
    look: "bold",
    note: "莓果唇色搭配烟紫眼影，色彩对比更明显。",
    layers: {
      lipstick: { color: "#832D53", strength: 76 },
      blush: { color: "#BA5573", strength: 53 },
      eyeshadow: { color: "#725172", strength: 64 },
    },
  },
] as const satisfies readonly Preset[];

export function recommend(scene: string, look: string) {
  return presets
    .map((preset, index) => {
      const sceneMatch = preset.scene === scene;
      const lookMatch = preset.look === look;
      const reasons: string[] = [];
      if (sceneMatch) reasons.push(`符合${scenes[preset.scene]}场景`);
      if (lookMatch) reasons.push(`符合${looks[preset.look]}偏好`);
      const lead = reasons.length
        ? reasons.join("，")
        : scene === "any" && look === "any"
          ? "通用推荐"
          : "备选搭配";
      return {
        preset,
        reason: `${lead}：${preset.note}`,
        score: (sceneMatch ? 2 : 0) + (lookMatch ? 1 : 0),
        index,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
