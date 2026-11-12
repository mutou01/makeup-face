import "./style.css";
import { mountPhotoPreview } from "./photo-preview";
import { sampleLipstick } from "./sample-lipstick";

const app = document.querySelector("#app");
if (!app) throw new Error("缺少应用页面入口");

app.innerHTML = `
  <header>
    <p class="label">本机妆容工作台</p>
    <h1>MakeupMirror</h1>
  </header>
  <section id="photo-preview" aria-labelledby="photo-preview-title"></section>
  <section aria-labelledby="lipstick-title">
    <h2 id="lipstick-title">口红试妆</h2>
    <p class="sample-note">内置合成图。关闭口红可随时对比原图。</p>
    <div class="editor">
      <canvas role="img" aria-label="口红试妆预览"></canvas>
      <div class="controls">
        <label class="toggle"><input id="lipstick-enabled" type="checkbox" /> 启用口红</label>
        <label class="color-field">口红颜色 <input id="lipstick-color" type="color" value="#ae344d" /></label>
        <div>
          <div class="intensity-field">
            <label for="lipstick-strength">口红强度</label>
            <output id="lipstick-strength-value" for="lipstick-strength" aria-hidden="true"></output>
          </div>
          <input id="lipstick-strength" type="range" min="0" max="100" value="65" />
        </div>
      </div>
    </div>
  </section>
  <section aria-labelledby="getting-started">
    <h2 id="getting-started">如何开始</h2>
    <ol>
      <li>点击「选择本机照片」，导入一张正面照查看原图。</li>
      <li>要体验妆容控件，可在合成图上试涂口红。</li>
    </ol>
    <p class="status">原图只供本次预览。真实照片试妆和项目保存将在后续开放。</p>
  </section>
`;

mountPhotoPreview(app.querySelector<HTMLElement>("#photo-preview")!);

const canvas = app.querySelector<HTMLCanvasElement>("canvas")!;
const enabled = app.querySelector<HTMLInputElement>("#lipstick-enabled")!;
const color = app.querySelector<HTMLInputElement>("#lipstick-color")!;
const strength = app.querySelector<HTMLInputElement>("#lipstick-strength")!;
const strengthValue = app.querySelector<HTMLOutputElement>(
  "#lipstick-strength-value",
)!;
const render = sampleLipstick(canvas);
function updatePreview() {
  strengthValue.value = `${strength.value}%`;
  render(enabled.checked, color.value, strength.valueAsNumber);
}
for (const control of [enabled, color, strength]) {
  control.addEventListener("input", updatePreview);
}
updatePreview();
