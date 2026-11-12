import { looks, recommend, scenes, type Preset } from "./recommendations";

const layers = [
  ["lipstick", "口红"],
  ["blush", "腮红"],
  ["eyeshadow", "眼影"],
] as const;

function options(values: Readonly<Record<string, string>>) {
  return Object.entries(values)
    .map(([id, label]) => `<option value="${id}">${label}</option>`)
    .join("");
}

export function mountRecommendations(
  panel: HTMLElement,
  apply: (preset: Preset) => string[] | null,
) {
  panel.innerHTML = `
    <h2 id="recommendation-title">妆容推荐</h2>
    <div class="recommendation-filters">
      <div><label for="recommendation-scene">场景</label> <select id="recommendation-scene">${options(scenes)}</select></div>
      <div><label for="recommendation-look">妆感偏好</label> <select id="recommendation-look">${options(looks)}</select></div>
    </div>
    <p class="status">分析面部后，可将预设应用到当前照片。</p>
    <ol class="preset-list" aria-label="推荐方案"></ol>
    <p class="status" role="status" aria-label="预设应用结果"></p>
  `;
  const [scene, look] = panel.querySelectorAll("select");
  const list = panel.querySelector("ol")!;
  const feedback = panel.querySelector('[role="status"]')!;
  let available = false;

  function render() {
    list.replaceChildren(
      ...recommend(scene.value, look.value).map(({ preset, reason }) => {
        const card = document.createElement("li");
        card.className = "preset-card";
        card.dataset.presetId = preset.id;
        const title = document.createElement("h3");
        title.textContent = preset.name;
        const details = document.createElement("p");
        details.textContent = reason;
        const palette = document.createElement("ul");
        palette.className = "preset-palette";
        for (const [kind, label] of layers) {
          const { color, strength } = preset.layers[kind];
          const item = document.createElement("li");
          const swatch = document.createElement("span");
          swatch.className = "preset-swatch";
          swatch.style.backgroundColor = color;
          swatch.setAttribute("aria-hidden", "true");
          item.append(swatch, `${label} ${color} · ${strength}%`);
          palette.append(item);
        }
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `应用${preset.name}`;
        button.disabled = !available;
        button.addEventListener("click", () => {
          if (!available) return;
          const missing = apply(preset);
          if (missing === null) return;
          feedback.textContent = missing.length
            ? `已应用「${preset.name}」的可用图层。未定位：${missing.join("、")}。`
            : `已应用「${preset.name}」，可继续微调。`;
        });
        card.append(title, details, palette, button);
        return card;
      }),
    );
  }

  scene.addEventListener("change", render);
  look.addEventListener("change", render);
  render();
  return {
    setAvailable(value: boolean) {
      available = value;
      for (const button of list.querySelectorAll("button"))
        button.disabled = !value;
    },
    resetFeedback() {
      feedback.textContent = "";
    },
  };
}
