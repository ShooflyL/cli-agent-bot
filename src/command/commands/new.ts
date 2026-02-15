/**
 * /new 指令 - 创建新会话
 */

import { CommandDefinition, CommandContext } from '../../core/types';
import * as path from 'path';

export const newCommand: CommandDefinition = {
  name: 'new',
  description: '创建新的Claude Code会话',
  usage: '/new <名称> [工作目录] [--cli <claude|opencode>]',
  aliases: ['create', 'n'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const { message, args, rawArgs } = ctx;
    const app = (global as any).app;

    if (!app) {
      throw new Error('Application not initialized');
    }

    // 解析参数
    if (args.length < 1) {
      await app.adapter.sendText(message.chatId,
        '用法: /new <名称> [工作目录] [--cli <claude|opencode>]\n\n' +
        '参数说明:\n' +
        '• 名称: 会话名称（必填）\n' +
        '• 工作目录: 项目路径（可选，支持相对路径）\n' +
        '• --cli: 指定使用的 CLI 工具（可选，默认使用配置中的默认值）\n\n' +
        '示例:\n' +
        '• /new myproject\n' +
        '  使用默认工作目录\n\n' +
        '• /new myproject ./myproject\n' +
        '  相对于默认工作目录的子目录\n\n' +
        '• /new myproject --cli opencode\n' +
        '  使用 OpenCode 作为 CLI 工具\n\n' +
        '• /new myproject ./myproject --cli claude\n' +
        '  指定工作目录并使用 Claude Code'
      );
      return;
    }

    // 解析 --cli 参数
    let cliType: string | undefined;
    
    const cliIndex = args.findIndex(arg => arg === '--cli' || arg === '-c');
    if (cliIndex !== -1 && cliIndex < args.length - 1) {
      cliType = args[cliIndex + 1];
      // 移除 --cli 及其值
      args.splice(cliIndex, 2);
    }

    // 验证 CLI 类型
    if (cliType && cliType !== 'claude' && cliType !== 'opencode') {
      await app.adapter.sendCard(message.chatId, {
        title: '❌ CLI 类型错误',
        content: `无效的 CLI 类型: ${cliType}\n\n支持的类型:\n• claude\n• opencode`,
        type: 'error' as any
      });
      return;
    }

    const name = args[0];
    const basePath = app.config.cli?.defaultWorkdir || process.cwd();
    let workDir: string;

    // 处理工作目录
    if (args.length >= 2) {
      const inputPath = args[1];

      // 如果是相对路径，相对于 basePath 解析
      if (!path.isAbsolute(inputPath)) {
        workDir = path.resolve(basePath, inputPath);
      } else {
        workDir = inputPath;
      }

      // 安全检查：确保路径在 basePath 内
      const normalizedWorkDir = path.normalize(workDir);
      const normalizedBasePath = path.normalize(basePath);

      if (!normalizedWorkDir.startsWith(normalizedBasePath)) {
        await app.adapter.sendCard(message.chatId, {
          title: '❌ 路径错误',
          content: `工作目录必须在默认工作目录内：\n\`${basePath}\`\n\n你提供的路径解析后为：\n\`${normalizedWorkDir}\`\n\n请使用相对路径或确保路径在workspace内。`,
          type: 'error' as any
        });
        return;
      }
    } else {
      workDir = basePath;
    }

    try {
      // 检查会话是否已存在
      const existingSession = app.sessionManager.getSession(name);
      if (existingSession) {
        // 检查是否已经是这个聊天的活跃会话
        const currentActive = app.sessionManager.getChatActiveSession(message.chatId);
        if (currentActive && currentActive.getInfo().name === name) {
          // 已经是这个聊天的活跃会话，不需要任何操作
          return;
        }
        
        // 切换到已存在的会话
        try {
          // 先尝试添加到 chat
          try {
            app.sessionManager.addSessionToChat(name, message.chatId);
          } catch {
            // 忽略添加失败
          }
          app.sessionManager.setChatActiveSession(message.chatId, name);
        } catch (e) {
          // 如果设置失败，忽略
        }
        await app.adapter.sendCard(message.chatId, {
          title: '🔄 切换到已有会话',
          content: `会话 **${name}** 已存在，已切换到该会话。\n\n可以直接发送消息与 Claude Code 交互。`,
          type: 'info' as any
        });
        return;
      }

      // 创建会话
      const cliTypeForSession = cliType || app.config.cli?.default || 'claude';
      const session = await app.sessionManager.createSession(name, workDir, message.chatId, cliTypeForSession);

      await app.adapter.sendCard(message.chatId, {
        title: '✅ 会话已创建',
        content: `**名称:** ${name}\n**目录:** \`${workDir}\`\n**CLI:** ${cliTypeForSession}\n\n已切换到该会话，可以直接发送消息与 Claude Code 交互。`,
        type: 'success' as any
      });

    } catch (error: any) {
      await app.adapter.sendCard(message.chatId, {
        title: '❌ 创建失败',
        content: `错误: ${error.message}`,
        type: 'error' as any
      });
    }
  }
};
