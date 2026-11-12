import "./style.css";

const app = document.querySelector("#app");
if (!app) throw new Error("缺少应用页面入口");

app.innerHTML = `
  <header>
    <p class="label">本机妆容工作台</p>
    <h1>MakeupMirror</h1>
    <p>在自己的照片上预览妆容，分层调整颜色和强度。</p>
  </header>
  <section aria-labelledby="getting-started">
    <h2 id="getting-started">如何开始</h2>
    <ol>
      <li>选择一个本机项目文件夹，导入一张正面照。</li>
      <li>比较推荐妆容，分别调整口红、眼影和腮红。</li>
      <li>保存妆容草稿，或导出预览图。</li>
    </ol>
    <p class="status">当前版本可启动工作台，照片导入与试妆功能尚未开放。</p>
  </section>
`;
