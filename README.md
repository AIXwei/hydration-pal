# 喝水小助手（hydration-pal）

猫咪主题的桌面喝水提醒应用。Windows桌面端，Electron实现。记录每日饮水量，按间隔提醒，猫咪随水位在玻璃杯里上浮，达标后探出杯口庆祝。

GitHub：https://github.com/AIXwei/hydration-pal

## 怎么跑

```bash
npm install
npm start          # 开发模式运行
npm run dist       # 打包 exe（产物在 dist/：免安装版 + NSIS 安装版）
```

## 功能

- 今日页：玻璃杯水位可视化（三阶段猫：趴底/浮水/达标庆祝）、快捷加水按钮、今日流水
- 成就页：连续达标、勋章（首滴水/达标三连/周冠军等7种）、猫咪等级成长（奶猫→猫猫大师7级）
- 悬浮窗：桌面小杯子常驻，点击展开快捷加水
- 提醒：按设置间隔在活跃时段内弹提醒，可暂停1小时
- 设置：每日目标、提醒间隔、活跃时段、杯量、昵称、开机自启
- 托盘：关闭主窗口=隐藏后台，托盘右键退出

## 文件结构

```
app/
  main.js           主进程：数据IO、提醒定时器、窗口/托盘、IPC、单实例锁、开机自启
  preload.js        contextBridge，暴露 window.api
  main-window.js    主窗口渲染逻辑（今日页/成就页/设置抽屉）
  index.html        主窗口（无边框，自定义标题栏+窗口控制按钮）
  floating.html     悬浮窗（结构+逻辑内联）
  build/
    preprocess.py   素材预处理：抠白底、三猫归一化（按泳圈宽度）、水贴片裁剪
    杯子.png         原始素材（1536×1024）
    cup.png         抠白后的杯子（最顶层覆层）
    cat_1s/2s/3s.png 归一化后三猫（趴底/浮水/庆祝）
    water_crop.png  水体贴片
    icon.png        应用图标（256×256，Python生成）
    new/            六层分层合成素材（回退掉的方案，仅本地保留，不进git不进安装包）
```

## 关键坐标（素材坐标系 1536×1024）

- 水区：POOL_TOP=207，POOL_BOT=700，内壁 x=278~1237，内径半宽480
- 水位公式：`wY = POOL_BOT - p * WH`，p=今日量/目标
- 波浪面：water_crop.png 顶部约65px是气泡区，猫跟踪 `waveSvgY = wY + 65*waterH/745`
- cat_2 泳圈中心卡波浪面：`y = waveSvgY - 445`
- 改水位/猫位置时 index.html、floating.html、main-window.js 三处必须同步

## 数据

用户数据存 `%APPDATA%/hydration-pal/data.json`（settings/today/history/stats），仓库不含。

## 依赖

- electron ^31
- electron-builder ^26（打包）
- Python + Pillow（仅素材预处理时需要）

## 安卓版（mobile/）

Capacitor 封装的安卓 App，主界面复用桌面版杯子 SVG 和渲染逻辑：

```
mobile/
  www/
    index.html   移动版主界面（桌面版去掉标题栏+viewport+安全区适配）
    app.js       渲染逻辑（同 main-window.js，去掉窗口控制）
    store.js     数据层：localStorage 实现 window.api 同款接口，业务逻辑复刻主进程
    build/       素材（cup/water_crop/三猫/icon）
  android/       Capacitor 生成的 gradle 工程（build.gradle 已换华为 maven 镜像）
  capacitor.config.json
```

构建：

```bash
cd mobile
npx cap sync android
cd android
JAVA_HOME=C:/MK/_shared/android-toolchain/jdk-21.0.2 ANDROID_HOME=C:/MK/_shared/android-toolchain/sdk ./gradlew assembleDebug
# 产物 android/app/build/outputs/apk/debug/app-debug.apk
```

- 工具链在 `C:\MK\_shared\android-toolchain\`（JDK21 + SDK platform-36/build-tools-36，全部来自国内镜像，本机网络访问不到 google/adoptium 源）
- 提醒用 @capacitor/local-notifications 排未来48小时通知，设置变更/回前台时重排
- 双端数据独立：桌面 data.json，安卓 localStorage，互不同步
- debug 签名 APK 可直接安装；手机会提示「未知来源」，允许即可

## 已知注意点

- exe 无代码签名，首次运行会被 SmartScreen 拦，点「更多信息→仍要运行」
- 开机自启只对打包后的 exe 有效，开发模式写入的启动项指向 electron.exe
- 单实例锁已加（main.js 顶部）：重复启动会聚焦已有实例，不会出现双悬浮窗
- 修改水杯渲染逻辑时，第四处同步点是 mobile/www/（index.html/app.js 复制自桌面版）
