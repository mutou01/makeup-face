import "./style.css";
import { mountPhotoPreview } from "./photo-preview";

const app = document.querySelector("#app");
if (!app) throw new Error("缺少应用页面入口");

app.innerHTML = `
  <header>
    <p class="label">本机妆容工作台</p>
    <h1>MakeupMirror</h1>
  </header>
  <section id="photo-preview" aria-labelledby="photo-preview-title"></section>
  <section aria-labelledby="getting-started">
    <h2 id="getting-started">如何开始</h2>
    <ol>
      <li>点击「选择本机照片」，导入一张正面照查看原图。</li>
      <li>点击「分析面部」，定位后可分别调整口红、腮红和眼影。</li>
      <li>也可以按场景和妆感挑选一套推荐，应用后再微调。</li>
      <li>勾选「查看原图」即可对比，取消后回到试妆。</li>
    </ol>
    <p class="status">试妆仅在本机完成。只有点击「保存项目」才写入照片副本和妆容。</p>
  </section>
`;

mountPhotoPreview(app.querySelector<HTMLElement>("#photo-preview")!);
