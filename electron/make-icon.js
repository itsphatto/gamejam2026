// Renders "อ" in white on black to build/icon.png (512x512)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, useContentSize: true,
    webPreferences: { offscreen: true } });
  const html = `<body style="margin:0;background:#000;width:512px;height:512px;display:flex;align-items:center;justify-content:center;overflow:hidden">
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;opacity:0.16;font:800 470px 'Leelawadee UI','Tahoma',sans-serif;line-height:1;letter-spacing:-20px;padding-bottom:30px">51</div>
  <div style="position:relative;color:#fff;font:bold 560px 'Leelawadee UI','Tahoma','Noto Sans Thai',sans-serif;line-height:1;margin-top:-150px">อ</div></body>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  app.quit();
});
