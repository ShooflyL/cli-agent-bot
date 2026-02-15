/**
 * 配置加载模块
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'yaml';
import { AppConfig, FeishuConfig, CliConfig, SecurityConfig, LoggingConfig, SessionConfigRoot, WebUIConfig, IMAdapterConfig } from './types';
import { getLogger } from './logger';

const DEFAULT_CONFIG: Partial<AppConfig> = {
  im: {
    default: 'feishu',
    feishu: {
      appId: '',
      appSecret: '',
      mode: 'webhook',
      webhookPort: 3000
    }
  },
  cli: {
    default: 'claude',
    claude: {
      executable: 'claude'
    },
    opencode: {
      executable: 'opencode'
    }
  },
  logging: {
    level: 'info',
    console: true
  },
  session: {
    maxSessions: 10,
    bufferSize: 65536,
    pollInterval: 500,
    messageFilter: {
      enabled: true,
      minLength: 5
    }
  },
  security: {
    mode: 'none',
    userWhitelist: [],
    chatWhitelist: []
  },
  webUI: {
    enabled: false,
    port: 8080
  }
};

const logger = getLogger();

/**
 * 加载配置文件
 */
export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath || join(process.cwd(), 'config.yaml');
  
  logger.info(`Loading config from: ${resolvedPath}`);

  if (!existsSync(resolvedPath)) {
    logger.warn(`Config file not found: ${resolvedPath}, using defaults`);
    return mergeConfig({});
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    const parsed = yaml.parse(content);
    return mergeConfig(parsed);
  } catch (error) {
    logger.error(`Failed to load config: ${error}`);
    throw new Error(`Failed to load config file: ${resolvedPath}`);
  }
}

/**
 * 从环境变量加载配置
 */
function loadFromEnv(): AppConfig {
  return mergeConfig({
    im: {
      default: (process.env.IM_DEFAULT as any) || 'feishu',
      feishu: {
        appId: process.env.FEISHU_APP_ID || '',
        appSecret: process.env.FEISHU_APP_SECRET || '',
        encryptKey: process.env.FEISHU_ENCRYPT_KEY,
        verificationToken: process.env.FEISHU_VERIFICATION_TOKEN
      }
    },
    cli: {
      default: (process.env.CLI_DEFAULT as 'claude' | 'opencode') || 'claude',
      claude: {
        executable: process.env.CLAUDE_EXECUTABLE || 'claude',
        skipPermissions: process.env.CLAUDE_SKIP_PERMISSIONS === 'true',
        extraArgs: process.env.CLAUDE_EXTRA_ARGS?.split(' ')
      },
      opencode: {
        executable: process.env.OPENCODE_EXECUTABLE || 'opencode'
      }
    },
    security: {
      mode: (process.env.SECURITY_MODE as SecurityConfig['mode']) || 'none',
      userWhitelist: process.env.USER_WHITELIST?.split(',').map(s => s.trim()) || [],
      chatWhitelist: process.env.CHAT_WHITELIST?.split(',').map(s => s.trim()) || []
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      file: process.env.LOG_FILE,
      console: process.env.LOG_CONSOLE !== 'false'
    },
    session: {
      maxSessions: parseInt(process.env.MAX_SESSIONS || '10', 10),
      bufferSize: parseInt(process.env.BUFFER_SIZE || '65536', 10),
      pollInterval: parseInt(process.env.POLL_INTERVAL || '500', 10),
      messageFilter: {
        enabled: process.env.MESSAGE_FILTER_ENABLED !== 'false',
        minLength: parseInt(process.env.MESSAGE_FILTER_MIN_LENGTH || '5', 10)
      }
    },
    webUI: {
      enabled: process.env.WEBUI_ENABLED !== 'false',
      port: parseInt(process.env.WEBUI_PORT || '8080', 10)
    }
  });
}

/**
 * 合并配置（深度合并）
 */
function mergeConfig(parsed: Partial<AppConfig>): AppConfig {
  return {
    im: {
      default: parsed.im?.default || DEFAULT_CONFIG.im?.default || 'feishu',
      feishu: {
        ...DEFAULT_CONFIG.im?.feishu,
        ...parsed.im?.feishu
      } as FeishuConfig
    } as IMAdapterConfig,
    cli: {
      default: parsed.cli?.default || DEFAULT_CONFIG.cli?.default || 'claude',
      defaultWorkdir: parsed.cli?.defaultWorkdir,
      skipPermissions: parsed.cli?.skipPermissions,
      messageFilters: parsed.cli?.messageFilters,
      claude: {
        ...DEFAULT_CONFIG.cli?.claude,
        ...parsed.cli?.claude
      },
      opencode: {
        ...DEFAULT_CONFIG.cli?.opencode,
        ...parsed.cli?.opencode
      }
    } as CliConfig,
    security: {
      ...DEFAULT_CONFIG.security,
      ...parsed.security
    } as SecurityConfig,
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...parsed.logging
    } as LoggingConfig,
    session: {
      ...DEFAULT_CONFIG.session,
      ...parsed.session
    } as SessionConfigRoot,
    webUI: {
      ...DEFAULT_CONFIG.webUI,
      ...parsed.webUI
    } as WebUIConfig
  };
}

export function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  // 验证 IM 配置
  if (!config.im.default) {
    errors.push('im.default is required');
  }

  // 验证 CLI 配置
  if (!config.cli.default) {
    errors.push('cli.default is required');
  }

  // 验证会话配置
  if (!config.session.maxSessions || config.session.maxSessions < 1) {
    errors.push('session.maxSessions must be >= 1');
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n${errors.join('\n')}`);
  }
}
