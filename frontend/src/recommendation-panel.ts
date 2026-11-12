import { looks, recommend, scenes } from "./recommendations";

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

export function mountRecommendations(panel: HTMLElement) {
  panel.innerHTML = `
    <h2 id="recommendation-title">妆容推荐</h2>
    <div class="recommendation-filters">
      <div><label for="recommendation-scene">场景</label> <select id="recommendation-scene">${options(scenes)}</select></div>
      <div><label for="recommendation-look">妆感偏好</label> <select id="recommendation-look">${options(looks)}</select></div>
    </div>
    <ol class="preset-list" aria-label="推荐方案"></ol>
  `;
  const [scene, look] = panel.querySelectorAll("select");
  const list = panel.querySelector("ol")!;

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
        card.append(title, details, palette);
        return card;
      }),
    );
  }

  scene.addEventListener("change", render);
  look.addEventListener("change", render);
  render();
}
