/**
 * cli-agent-bot 入口文件
 */

import { createApplication, Application } from './app';
import { getLogger } from './core/logger';
import { registerClaudeAdapter } from './adapter/claude/adapter';
import { registerOpenCodeAdapter } from './adapter/opencode/adapter';
import { chatAdapterRegistry } from './adapter/chat-adapter';
import { FeishuAdapter } from './adapter/feishu';

// 注册 CLI 适配器
registerClaudeAdapter();
registerOpenCodeAdapter();

// 注册 IM 适配器
chatAdapterRegistry.register('feishu', (config) => new FeishuAdapter(config));

let app: Application | null = null;

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 从命令行参数或环境变量获取配置路径
  const configPath = process.env.CONFIG_PATH || process.argv[2];

  console.log('');
  console.log('');
  console.log('CLI Agent Bot v1.0.0');
  console.log('');

  try {
    // 创建应用
    app = await createApplication(configPath);

    // 启动应用
    await app.start();

    // 优雅关闭
    setupGracefulShutdown();

  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

/**
 * 设置优雅关闭
 */
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);

    if (app) {
      try {
        await app.stop();
      } catch (error) {
        console.error('Error during shutdown:', error);
      }
    }

    process.exit(0);
  };

  // 监听关闭信号
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Windows 平台特殊处理
  if (process.platform === 'win32') {
    // 在 Windows 上，Ctrl+C 会发送 SIGINT
    // 但某些终端可能需要额外处理
    const rl = require('readline');
    const rli = rl.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rli.on('SIGINT', () => {
      shutdown('SIGINT');
    });
  }

  // 未捕获的异常处理
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    if (app) {
      app.stop().finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
  });
}

// 运行主函数
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
