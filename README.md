# dsh-power

为 **DeepSeek Harness** 的 Web GUI 添加「关闭 / 重启 dsh」电源控制。

Power and restart controls for the DeepSeek Harness Web GUI, placed in **Settings → General**.

按钮位于 **设置（齿轮）→ 通用 →「dsh 电源」**，不在侧边栏，且每次操作都需要二次确认，避免误触。

---

## 功能

- **关闭 dsh**：通过 dsh launcher 自带的 `appExit` 优雅退出，先释放插件树、会话存储和监听端口。
- **重启 dsh**：启动一个分离的 helper，等旧进程退出、端口释放后，按**原可执行文件、原参数、原工作目录、原环境变量**重新启动 dsh。
- **自动恢复**：重启期间页面显示不可交互的状态层；新进程恢复响应后自动刷新页面，无需手动 F5。
- **防误触**：点击按钮只打开确认框，默认焦点在「取消」上；确认后才执行。
- **独立状态层**：重启进度注册在 `shell.overlay`，关闭设置面板也不会丢失。
- **中英双语**，跟随 Harness 当前语言。
- 使用主题 token（`--dsw-alias-*`），自动适配浅色 / 深色主题。

## 界面位置

```
设置（左下角齿轮）
└─ 通用
   ├─ 权限
   ├─ 语言
   ├─ 外观
   ├─ …
   ├─ dsh 电源        ← 这一行
   └─ 当前版本
```

行内右侧有两个按钮：

| 按钮 | 图标 | 行为 |
|---|---|---|
| 关闭 dsh | 电源 | 停止 dsh 进程 |
| 重启 dsh | 环形箭头 | 停止并按原命令重新启动 |

## 安装

本插件是一个普通的 DSH bundle 包，安装到当前 profile 后会影响该 profile 的所有会话。

### 方式一：Web Plugins 页面

1. 打开左侧 **Plugins** 页面。
2. 选择安装（Add）/ 输入安装来源。
3. 填入本目录的**绝对路径**，例如：

   ```text
   C:\Users\you\Documents\dsh-power
   ```

   或 macOS / Linux：

   ```text
   /Users/you/dsh-power
   ```

4. 确认安装。当前 profile 启用了 HMR 时会立即生效；否则按页面提示重启 dsh。

### 方式二：交给 Agent 安装

在 Harness 会话中让 Agent 执行：

```text
plugin_manager install_bundle target=<本目录绝对路径>
```

安装结果中的 `application: applied` 表示已生效。

### 安装后

- 打开 **设置 → 通用**，应该能看到「dsh 电源」行。
- 如果页面没有立刻出现，刷新一次页面。
- 插件会写入当前 profile 的 bundle 列表，重启 dsh 后仍然存在。

## 使用

1. 打开 **设置 → 通用**。
2. 点击「关闭 dsh」或「重启 dsh」。
3. 在确认框中选择「取消」或确认。
4. 重启时等待状态层提示，服务恢复后页面会自动刷新。

> ⚠️ **关闭或重启会中断当前正在运行的会话**，包括正在生成的 Agent 回复。会话记录是持久化的，重启后可以从侧边栏重新打开。

## 安全与边界

- 关闭 / 重启接口注册在本地 Web Server 上，并要求**已登录浏览器的签名 Cookie**；没有 Cookie 的请求返回 `401`，不会暴露操作能力。
- 接口同时经过 Host/Origin 校验，跨站请求会被拒绝。
- 以下情况会**禁用重启**，但「关闭 dsh」仍可用：
  - dsh 由桌面应用通过 IPC 托管（`process.connected === true`）；
  - 启动参数使用 `--port 0`，重启后地址会变化，页面无法跟随。
- 关闭走 launcher 的 bounded shutdown：先等待插件树 dispose，最多 5 秒后强制退出。
- 重启 helper 只在旧进程退出且端口空闲后 300 ms 才拉起新进程，避免端口占用和 profile 文件句柄竞争。

## 工作原理

### Host 侧（`index.js`）

注册三个精确路由：

| 路由 | 方法 | 鉴权 | 作用 |
|---|---|---|---|
| `/dsh-power/ping` | GET | 否 | 存活探测 + 能力上报（`exit` / `restart`） |
| `/dsh-power/close` | POST | 是 | 调用 `ctx.appExit(0)` |
| `/dsh-power/restart` | POST | 是 | 启动 helper，然后 `ctx.appExit(0)` |

`ping` 不鉴权是为了让页面在 dsh 重启、WebSocket 尚未恢复时也能探测新进程是否就绪；它不返回任何敏感信息。

### 重启 helper（`restart-helper.cjs`）

```text
旧 dsh ──启动──> helper（detached）
                    │ 等待旧 PID 退出（最多 30s）
                    │ 等待监听端口释放（默认 3080，最多 20s）
                    │ sleep 300ms
                    └─ 启动新 dsh（原 argv / cwd / env）
```

新进程的 stdout/stderr 不继承旧终端；诊断写入系统临时目录的 `dsh-power-restart.log`。

### Client 侧（`client.js`）

- 在 `settings.general.item` 注册一行「dsh 电源」。
- 在 `shell.overlay` 注册状态层，处理关闭中、重启中、已关闭、超时、失败五种状态。
- 重启后每 500 ms 轮询 `/dsh-power/ping`，连续探测到「先断开、后恢复」后调用 `location.reload()`。
- 所有 UI 文案走 Client locale 服务，中英字典键集合一致。

## 目录结构

```text
dsh-power/
├─ package.json          # bundle 清单、dsh.bundle / dsh.client 声明、导出资源
├─ cordis.patch.yml      # 插入 Host 插件行（id: dsh-power）
├─ index.js              # Host 半：鉴权路由 + 优雅退出 + helper 启动
├─ restart-helper.cjs    # 分离的重启辅助进程
├─ client.js             # Client 半：设置行 + 确认框 + 全局状态层
├─ icon.svg              # 插件图标（Plugin Manager / Settings 使用）
├─ locale/
│  ├─ en.json            # 英文显示元数据
│  └─ zh.json            # 中文显示元数据
├─ LICENSE
├─ README.md
├─ .gitattributes
└─ .gitignore
```

## 兼容性

- 目标平台：**DSH Web GUI**（`platform: web`）；Electron 客户端不加载本 Client 插件。
- 实测环境：DeepSeek Harness `0.2.1-rc.2`，Windows，`web` profile。
- Host 侧只使用 Node 内置模块和公开的 Cordis / DSH 服务（`webServer`、`connection`、`appExit`），没有第三方运行时依赖。
- macOS / Linux 理论上可用（helper 为纯 Node 实现），但未实测。

## 故障排查

| 现象 | 处理 |
|---|---|
| 设置里看不到「dsh 电源」 | 刷新页面；确认 Plugins 页面中本 bundle 已启用 |
| 「重启 dsh」不可点击 | 当前由桌面应用托管，或使用了 `--port 0`；改为手动重启 |
| 页面提示 401 / 403 | 用带登录态的原地址重新打开页面；跨站或未登录请求会被拒绝 |
| 重启后页面没有自动刷新 | 等待 45 秒超时后点「刷新页面」；检查 `%TEMP%\dsh-power-restart.log` |
| 重启后 dsh 没有起来 | 查看上述日志，然后手动运行原来的 `dsh` 命令 |
| 关闭后想继续使用 | 重新启动 dsh，再打开原来的地址 |

系统临时目录中的日志：

- Windows：`%TEMP%\dsh-power-restart.log`
- macOS / Linux：`$TMPDIR/dsh-power-restart.log`

## 卸载

在 **Plugins** 页面移除 `@local/dsh-power`，或让 Agent 执行：

```text
plugin_manager remove_bundle target=@local/dsh-power
```

移除后重启 dsh 以彻底卸载 Host 侧代码。

## License

本项目基于 [MIT License](LICENSE) 发布。

Copyright (c) 2026 Sk1pFlow
