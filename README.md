# cli-agent-bot

通过飞书（Feishu）远程控制 Claude Code、OpenCode 等 CLI 编程助手。

在手机或任意设备上通过飞书消息发送指令，即可操控本地或服务器上运行的 CLI 编程工具，实现随时随地写代码。

## 功能特性

- **多 CLI 工具支持** - 同时支持 Claude Code 和 OpenCode，可按会话切换
- **多会话管理** - 同时运行多个独立工作区会话，互不干扰
- **飞书集成** - 支持 Webhook 和长连接两种接入模式
- **按键模拟** - 通过 `/up` `/down` `/enter` `/esc` 指令模拟键盘操作
- **Web 管理界面** - 内置 Web UI，可查看会话状态、通讯历史、修改系统配置
- **安全控制** - 用户/群聊白名单机制，防止未授权访问
- **消息过滤** - 自动过滤 CLI 输出中的无关信息
- **自动推送** - CLI 输出自动推送到飞书，无需手动轮询
- **自动重启** - 会话崩溃时自动检测并尝试重启

## 架构概览

```
飞书客户端 (手机/PC)
    │
    ▼
飞书开放平台 ──webhook/longpoll──▶ cli-agent-bot
                                      │
                          ┌───────────┼───────────┐
                          ▼           ▼           ▼
                     Session A    Session B    Session C
                     (Claude)    (Claude)     (OpenCode)
                        │           │           │
                        ▼           ▼           ▼
                      PTY A       PTY B       PTY C
                   (项目目录A)   (项目目录B)   (项目目录C)
```

## 环境要求

- **Node.js** >= 18.0.0
- **npm** >= 8.0.0
- **Claude Code CLI**（需提前安装并可在终端中运行 `claude` 命令）
- **Windows**: 需安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（`node-pty` 编译依赖）
- **Linux/macOS**: 需安装 `build-essential` 或 Xcode Command Line Tools

## 安装部署

### 1. 克隆项目

```bash
git clone https://github.com/your-username/cli-agent-bot.git
cd cli-agent-bot
```

### 2. 安装依赖

```bash
npm install
```

> **Windows 用户注意**: 如果 `node-pty` 编译失败，请先安装 Visual Studio Build Tools：
> ```bash
> npm install --global windows-build-tools
> ```
> 或者手动安装 Visual Studio Build Tools 并勾选 "C++ 桌面开发" 工作负载。

### 3. 创建配置文件

```bash
cp config.example.yaml config.yaml
```

编辑 `config.yaml`，填入飞书应用凭证和其他配置（详见下方 [配置说明](#配置说明)）。

### 4. 构建项目

```bash
npm run build
```

### 5. 启动

```bash
# 生产模式
npm start

# 开发模式（支持 TypeScript 直接运行）
npm run dev
```

启动成功后会看到日志输出，Web UI 默认在 `http://localhost:9998` 可用。

---

## 飞书开放平台配置

### 第一步：创建应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)，登录后进入 **开发者后台**
2. 点击 **创建企业自建应用**
3. 填写应用名称（如 `CLI Agent Bot`）和描述，创建完成

### 第二步：获取凭证

1. 在应用页面进入 **凭证与基础信息**
2. 记录 **App ID** 和 **App Secret**，填入 `config.yaml` 的 `im.feishu.appId` 和 `im.feishu.appSecret`

### 第三步：配置权限

进入 **权限管理** 页面，搜索并开通以下权限：

| 权限名称 | 权限标识 | 用途 |
|----------|---------|------|
| 获取与发送单聊、群组消息 | `im:message` | 收发消息 |
| 以应用的身份发消息 | `im:message:send_as_bot` | Bot 发送消息 |
| 获取群组信息 | `im:chat` | 获取群聊信息 |
| 读取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收私聊消息 |
| 获取群组中所有消息 | `im:message.group_msg:readonly` | 接收群聊消息 |
| 接收群聊中@机器人消息事件 | `im:message.group_at_msg` | 群聊中被@时响应 |
| 获取用户基本信息 | `contact:user.base:readonly` | 获取用户身份 |

### 第四步：配置事件订阅

进入 **事件订阅** 页面：

1. 选择接收方式（根据你的部署方式）：

   - **使用 Webhook 方式**：填写请求地址为你的服务器 URL（如 `https://your-domain.com/webhook/event`），配合 ngrok 使用时填入 ngrok 生成的地址
   - **使用长连接方式**：无需填写 URL，适合本地开发

2. 添加事件：
   - `im.message.receive_v1` — 接收消息

3. 如选择 Webhook 方式，飞书会发送一个验证请求，确保你的服务正在运行

### 第五步：启用机器人能力

1. 进入 **应用功能** > **机器人**
2. 开启机器人功能

### 第六步：发布应用

1. 进入 **版本管理与发布**
2. 创建版本并提交审核
3. 审核通过后（企业自建应用通常自动通过），在飞书中搜索机器人名称即可开始使用

### 获取白名单 ID

**获取用户 open_id:**
- 在飞书开放平台的 **API 调试台** 中调用 [获取用户信息](https://open.feishu.cn/document/server-docs/contact-v3/user/get) 接口
- 或在 bot 启动后发送任意消息，控制台日志中会打印 `userId`

**获取群聊 chat_id:**
- 将机器人拉入群聊，在日志中查看 `chatId`
- 或通过 API 调试台的 [获取群列表](https://open.feishu.cn/document/server-docs/group/chat/list) 接口查询

---

## 使用 ngrok 进行内网穿透

如果你在本地开发环境运行 bot，需要使用 ngrok 将本地端口暴露到公网，以便飞书 Webhook 回调。

### 1. 安装 ngrok

```bash
# macOS
brew install ngrok

# Windows (使用 Chocolatey)
choco install ngrok

# 或直接下载：https://ngrok.com/download
```

### 2. 注册并配置 authtoken

在 [ngrok 官网](https://dashboard.ngrok.com/signup) 注册账号，获取 authtoken：

```bash
ngrok config add-authtoken <your-authtoken>
```

### 3. 启动隧道

假设 `config.yaml` 中 `webhookPort` 配置为 `9999`：

```bash
ngrok http 9999
```

ngrok 会输出一个公网 URL，类似：

```
Forwarding  https://xxxx-xx-xx-xxx-xx.ngrok-free.app -> http://localhost:9999
```

### 4. 配置飞书回调地址

将 ngrok 生成的 HTTPS 地址填入飞书开放平台的 **事件订阅** 请求地址中：

```
https://xxxx-xx-xx-xxx-xx.ngrok-free.app/webhook/event
```

> **注意:**
> - ngrok 免费版每次启动 URL 会变化，需要重新配置飞书的回调地址
> - 生产环境建议使用固定域名的服务器，或 ngrok 付费版的固定子域名
> - 如果使用长连接模式（`mode: "longpoll"`），则不需要 ngrok

---

## 配置说明

配置文件为项目根目录下的 `config.yaml`，完整示例参见 `config.example.yaml`。

### IM 配置 (`im`)

```yaml
im:
  default: "feishu"         # 默认 IM 平台
  feishu:
    appId: ""               # 飞书 App ID
    appSecret: ""           # 飞书 App Secret
    encryptKey: ""          # 加密密钥（可选）
    verificationToken: ""   # 验证令牌（可选）
    mode: "webhook"         # webhook 或 longpoll
    webhookPort: 9999       # Webhook 监听端口
```

### CLI 配置 (`cli`)

```yaml
cli:
  default: "claude"                    # 默认 CLI 工具
  defaultWorkdir: "D:/Projects"        # 默认工作目录
  claude:
    executable: "claude"               # Claude Code 可执行文件路径
  opencode:
    executable: "opencode"             # OpenCode 可执行文件路径
  skipPermissions: false               # 跳过 Claude Code 操作确认
  messageFilters:                      # 输出过滤关键词列表
    - "◯ /ide for Visual Studio Code"
```

- `defaultWorkdir`: `/new` 命令中使用相对路径时的基准目录
- `skipPermissions`: 设为 `true` 时 Claude Code 将使用 `--dangerously-skip-permissions` 参数启动，跳过所有操作确认弹窗，仅在可信环境中使用
- `messageFilters`: CLI 输出中包含这些字符串的行将被过滤，不会推送到飞书

### 安全配置 (`security`)

```yaml
security:
  mode: "both"               # none / user / chat / both
  userWhitelist:
    - "ou_xxxxx"             # 允许的用户 open_id
  chatWhitelist:
    - "oc_xxxxx"             # 允许的群聊 chat_id
```

### Web UI 配置 (`webUI`)

```yaml
webUI:
  enabled: true    # 启用 Web 管理界面
  port: 9998       # 监听端口
```

启用后可通过 `http://localhost:9998` 访问管理界面，包含三个页面：
- **会话状态** - 查看当前所有会话的运行状态
- **通讯历史** - 查看飞书消息收发记录
- **系统配置** - 在线修改配置（修改后自动保存到 `config.yaml`）

---

## 指令列表

在飞书中发送以下指令与 bot 交互：

### 会话管理

| 指令 | 用法 | 说明 |
|------|------|------|
| `/new` | `/new <名称> [目录] [--cli claude\|opencode]` | 创建新会话 |
| `/list` | `/list` | 列出当前聊天的所有会话 |
| `/switch` | `/switch <名称>` | 切换到指定会话 |
| `/close` | `/close <名称>` | 关闭指定会话 |

`/new` 示例：
```
/new myproject                     # 使用默认工作目录
/new myproject ./myproject         # 在默认工作目录下创建子目录
/new myproject --cli opencode      # 使用 OpenCode
```

### 信息查询

| 指令 | 用法 | 说明 |
|------|------|------|
| `/status` | `/status` | 查看系统运行状态 |
| `/poll` | `/poll` | 手动获取当前会话的缓存输出 |
| `/help` | `/help` | 显示帮助信息 |

### 模型切换

| 指令 | 用法 | 说明 |
|------|------|------|
| `/model` | `/model <模型名>` | 切换 Claude 模型（sonnet/opus/haiku） |

### 按键模拟

用于在 CLI 工具的交互式界面中进行选择操作：

| 指令 | 作用 | 别名 |
|------|------|------|
| `/up` | 发送向上箭头键 | `/arrow-up`, `/keyup` |
| `/down` | 发送向下箭头键 | `/arrow-down`, `/keydown` |
| `/enter` | 发送回车键 | `/return`, `/confirm` |
| `/esc` | 发送 ESC 键 | `/escape`, `/cancel`, `/skip` |

### 直接对话

创建会话后，直接发送文本消息（不带 `/` 前缀）即可与 CLI 工具对话。CLI 的输出会自动推送到飞书。

---

## 项目结构

```
cli-agent-bot/
├── src/
│   ├── index.ts                # 入口文件
│   ├── app.ts                  # 应用主类，协调所有模块
│   ├── core/
│   │   ├── types.ts            # 全局类型定义
│   │   ├── config.ts           # 配置加载与合并
│   │   ├── events.ts           # 事件系统
│   │   ├── logger.ts           # 日志模块 (Winston)
│   │   └── message-history.ts  # 消息历史记录
│   ├── adapter/
│   │   ├── cli-adapter.ts      # CLI 适配器接口与注册表
│   │   ├── chat-adapter.ts     # IM 适配器注册表
│   │   ├── claude/             # Claude Code 适配器
│   │   │   ├── adapter.ts      #   适配器实现
│   │   │   ├── pty-process.ts  #   PTY 进程管理
│   │   │   └── output-parser.ts#   输出解析
│   │   ├── opencode/           # OpenCode 适配器
│   │   │   └── adapter.ts      #   适配器实现
│   │   └── feishu/             # 飞书 IM 适配器
│   │       ├── index.ts        #   适配器实现
│   │       └── card.ts         #   卡片消息构建
│   ├── command/
│   │   ├── registry.ts         # 指令注册表
│   │   ├── parser.ts           # 指令解析与执行
│   │   └── commands/           # 内置指令
│   │       ├── new.ts          #   /new
│   │       ├── list.ts         #   /list
│   │       ├── switch.ts       #   /switch
│   │       ├── close.ts        #   /close
│   │       ├── status.ts       #   /status
│   │       ├── help.ts         #   /help
│   │       ├── poll.ts         #   /poll
│   │       ├── model.ts        #   /model
│   │       └── keys.ts         #   /up /down /enter /esc
│   ├── session/
│   │   ├── manager.ts          # 会话管理器
│   │   ├── session.ts          # 会话类
│   │   └── output-buffer.ts    # 输出缓冲区
│   ├── security/
│   │   └── whitelist.ts        # 白名单验证
│   └── webui/
│       └── index.ts            # Web 管理界面
├── config.example.yaml         # 配置文件模板
├── package.json
└── tsconfig.json
```

## 常见问题

### node-pty 编译失败

**Windows**: 安装 Visual Studio Build Tools，确保包含 C++ 构建工具。

**Linux**: 安装编译依赖：
```bash
sudo apt-get install -y build-essential python3
```

**macOS**: 安装 Xcode Command Line Tools：
```bash
xcode-select --install
```

### Claude Code 启动失败

- 确保 `claude` 命令在终端中可直接运行
- Windows 用户确保 Claude Code 已添加到系统 PATH
- 检查日志中的错误信息（设置 `logging.level: "debug"` 获取详细日志）

### 飞书收不到消息

- 确认应用已发布并通过审核
- 确认机器人能力已启用
- 确认事件订阅地址可访问（Webhook 模式）
- 确认权限已全部开通
- 检查白名单配置是否正确

### ngrok 隧道断开后飞书无法回调

ngrok 免费版每次重启会分配新 URL。重启 ngrok 后需要到飞书开放平台更新事件订阅的请求地址。建议开发阶段使用长连接模式（`mode: "longpoll"`）避免此问题。

## License

MIT
