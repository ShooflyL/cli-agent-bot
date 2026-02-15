/**
 * cli-code-bot 核心类型定义
 */

// ============ 会话相关 ============

/** 会话状态 */
export enum SessionStatus {
  IDLE = 'idle',
  PROCESSING = 'processing',
  WAITING_CONFIRM = 'waiting_confirm',
  ERROR = 'error'
}

/** 输出类型 */
export enum OutputType {
  NORMAL = 'normal',
  CONFIRM = 'confirm',
  ERROR = 'error',
  SYSTEM = 'system'
}

/** 会话信息 */
export interface SessionInfo {
  name: string;
  workDir: string;
  status: SessionStatus;
  createdAt: Date;
  lastActiveAt: Date;
}

/** 会话配置 */
export interface SessionConfig {
  name: string;
  workDir: string;
  claudePath: string;
  env?: Record<string, string>;
}

// ============ 输出相关 ============

/** 输出块 */
export interface OutputBlock {
  type: OutputType;
  content: string;
  timestamp: Date;
  /** 是否需要确认 */
  requiresConfirm?: boolean;
  /** 确认选项 */
  confirmOptions?: string[];
  /** 确认ID（用于回调） */
  confirmId?: string;
}

/** 输出缓冲区配置 */
export interface OutputBufferConfig {
  maxSize: number;
  pollInterval: number;
}

// ============ 消息相关 ============

/** 收到的消息 */
export interface IncomingMessage {
  /** 聊天ID（私聊为用户open_id，群聊为群id） */
  chatId: string;
  /** 用户ID */
  userId: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type: MessageType;
  /** 原始消息ID */
  messageId?: string;
  /** 时间戳 */
  timestamp: Date;
}

/** 消息类型 */
export enum MessageType {
  TEXT = 'text',
  COMMAND = 'command',
  INTERACTIVE = 'interactive'
}

/** 发送消息选项 */
export interface SendOptions {
  /** 是否@发送者 */
  atSender?: boolean;
  /** 引用消息ID */
  replyTo?: string;
}

// ============ 适配器相关 ============

/** 卡片消息载荷 */
export interface CardPayload {
  title: string;
  content: string;
  /** 卡片类型 */
  type?: CardType;
  /** 按钮列表 */
  buttons?: CardButton[];
}

/** 卡片类型 */
export enum CardType {
  DEFAULT = 'default',
  CONFIRM = 'confirm',
  ERROR = 'error',
  SUCCESS = 'success'
}

/** 卡片按钮 */
export interface CardButton {
  text: string;
  action: string;
  value?: Record<string, unknown>;
}

/** 适配器接口 */
export interface IChatAdapter {
  /** 启动适配器 */
  start(): Promise<void>;
  /** 停止适配器 */
  stop(): Promise<void>;
  /** 发送文本消息 */
  sendText(chatId: string, text: string, options?: SendOptions): Promise<void>;
  /** 发送卡片消息 */
  sendCard(chatId: string, card: CardPayload, options?: SendOptions): Promise<void>;
  /** 注册消息处理器 */
  onMessage(handler: MessageHandler): void;
  /** 响应交互回调 */
  respondInteraction(token: string, response: unknown): Promise<void>;
}

/** 消息处理器 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>;

// ============ 指令相关 ============

/** 指令上下文 */
export interface CommandContext {
  message: IncomingMessage;
  session?: SessionInfo;
  args: string[];
  rawArgs: string;
}

/** 指令处理器 */
export type CommandHandler = (ctx: CommandContext) => Promise<void>;

/** 指令定义 */
export interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  handler: CommandHandler;
}

// ============ 配置相关 ============

/** IM 适配器配置 */
export interface IMAdapterConfig {
  /** 默认使用的 IM 应用 */
  default: 'feishu' | 'slack' | 'discord' | 'whatsapp' | 'telegram';
  /** 飞书配置 */
  feishu?: FeishuConfig;
  /** Slack 配置 */
  slack?: any;
  /** Discord 配置 */
  discord?: any;
  /** WhatsApp 配置 */
  whatsapp?: any;
  /** Telegram 配置 */
  telegram?: any;
}

/** CLI 工具配置 */
export interface CliConfig {
  /** 默认使用的 CLI 工具 */
  default: 'claude' | 'opencode';
  /** 默认工作目录 */
  defaultWorkdir?: string;
  /** 全局环境变量 */
  env?: Record<string, string>;
  /** 全局跳过权限确认 */
  skipPermissions?: boolean;
  /** 全局消息过滤 */
  messageFilters?: string[];
  /** Claude Code 配置 */
  claude?: {
    executable: string;
    env?: Record<string, string>;
    skipPermissions?: boolean;
    extraArgs?: string[];
    messageFilters?: string[];
  };
  /** OpenCode 配置 */
  opencode?: {
    executable: string;
    env?: Record<string, string>;
    extraArgs?: string[];
  };
}

/** 应用配置 */
export interface AppConfig {
  im: IMAdapterConfig;
  cli: CliConfig;
  security: SecurityConfig;
  logging: LoggingConfig;
  session: SessionConfigRoot;
  webUI?: WebUIConfig;
}

/** 飞书配置 */
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  /** 连接模式：webhook（Webhook回调）或 longpoll（长连接） */
  mode?: 'webhook' | 'longpoll';
  /** Webhook 模式下的服务器端口（默认 3000） */
  webhookPort?: number;
}


/** 安全配置 */
export interface SecurityConfig {
  mode: 'user' | 'chat' | 'both' | 'none';
  userWhitelist: string[];
  chatWhitelist: string[];
}

/** 日志配置 */
export interface LoggingConfig {
  level: string;
  file?: string;
  console: boolean;
}

/** 消息过滤配置 */
export interface MessageFilterConfig {
  enabled: boolean;
  minLength: number;
}

/** 会话配置 */
export interface SessionConfigRoot {
  maxSessions: number;
  bufferSize: number;
  pollInterval: number;
  messageFilter: MessageFilterConfig;
}

// ============ 事件相关 ============

/** 事件类型 */
export enum EventType {
  SESSION_CREATED = 'session:created',
  SESSION_CLOSED = 'session:closed',
  SESSION_SWITCHED = 'session:switched',
  OUTPUT_RECEIVED = 'output:received',
  CONFIRM_REQUIRED = 'confirm:required',
  CONFIRM_RESPONSE = 'confirm:response',
  ERROR = 'error'
}

/** 事件载荷 */
export interface EventPayload {
  type: EventType;
  data: unknown;
  timestamp: Date;
}

/** 事件监听器 */
export type EventListener = (payload: EventPayload) => void | Promise<void>;

// ============ Web UI 相关 ============

/** Web UI 配置 */
export interface WebUIConfig {
  /** 是否启用Web UI */
  enabled: boolean;
  /** Web UI 端口 */
  port: number;
}
