/**
 * PTY进程管理
 * 封装node-pty，管理与Claude Code的交互
 */

import * as pty from 'node-pty';
import { createLogger } from '../../core/logger';

const logger = createLogger('pty');

/**
 * PTY进程配置
 */
export interface PtyOptions {
  /** 可执行文件路径 */
  executable: string;
  /** 工作目录 */
  cwd: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 列数 */
  cols?: number;
  /** 行数 */
  rows?: number;
  /** 额外的命令行参数 */
  args?: string[];
  /** 跳过权限确认 */
  skipPermissions?: boolean;
}

/**
 * PTY进程实例
 */
export interface PtyInstance {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number, signal: number) => void) => void;
  init(): void;
}

/**
 * 创建PTY进程
 */
export function spawnPty(options: PtyOptions): PtyInstance {
  const { executable, cwd, env, cols = 120, rows = 40, args: extraArgs = [], skipPermissions = false } = options;

  logger.info(`Spawning PTY: ${executable} in ${cwd}`);
  logger.debug(`Skip permissions: ${skipPermissions}, Extra args: ${extraArgs.join(' ')}`);

  // 合并环境变量
  const processEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      processEnv[key] = value;
    }
  }

  const finalEnv: Record<string, string> = {
    ...processEnv,
    ...env,
    // 确保使用UTF-8
    LANG: 'en_US.UTF-8',
    TERM: 'xterm-256color'
  };

  // 构建 CLI 参数
  let claudeArgs: string[] = [];

  // 如果启用跳过权限确认
  if (skipPermissions) {
    claudeArgs.push('--dangerously-skip-permissions');
    claudeArgs.push('--add-dir', cwd);
    logger.info(`Using dangerously-skip-permissions, pre-authorizing directory: ${cwd}`);
  }

  // 添加额外参数
  claudeArgs = claudeArgs.concat(extraArgs);

  // 平台处理
  let finalExecutable = executable;
  let args: string[] = [];

  if (process.platform === 'win32') {
    // Windows: 使用 PowerShell 启动 CLI 工具
    finalExecutable = 'powershell.exe';
    args = ['-NoProfile', '-Command', `& '${executable}' ${claudeArgs.join(' ')}`];
    logger.info(`Windows platform: executing via PowerShell: ${executable} ${claudeArgs.join(' ')} in ${cwd}`);
  } else {
    // Unix平台直接传递参数
    args = claudeArgs;
  }

  const ptyProcess = pty.spawn(finalExecutable, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: finalEnv,
    encoding: 'utf8'
  });

  logger.info(`PTY spawned with PID: ${ptyProcess.pid}`);

  return {
    pid: ptyProcess.pid,

    write(data: string): void {
      logger.debug(`PTY write: ${data.replace(/\n/g, '\\n').substring(0, 100)}...`);
      ptyProcess.write(data);
    },

    resize(cols: number, rows: number): void {
      ptyProcess.resize(cols, rows);
    },

    init(): void {
      logger.debug('Initializing PTY terminal environment');
      ptyProcess.resize(cols, rows);
      ptyProcess.write('\x1b[9999;1R');
    },

    kill(signal?: string): void {
      logger.info(`Killing PTY process ${ptyProcess.pid}`);
      try {
        ptyProcess.kill(signal || 'SIGTERM');
      } catch (error) {
        logger.error(`Failed to kill PTY: ${error}`);
      }
    },

    onData(callback: (data: string) => void): void {
      ptyProcess.onData(callback);
    },

    onExit(callback: (code: number, signal: number) => void): void {
      ptyProcess.onExit(({ exitCode, signal: sig }) => {
        callback(exitCode, sig || 0);
      });
    }
  };
}

/**
 * 检测平台是否支持PTY
 */
export function isPtySupported(): boolean {
  try {
    require.resolve('node-pty');
    return true;
  } catch {
    return false;
  }
}
