/**
 * /list 指令 - 列出所有会话
 */

import { CommandDefinition, CommandContext } from '../../core/types';

export const listCommand: CommandDefinition = {
  name: 'list',
  description: '列出所有Claude Code会话',
  usage: '/list',
  aliases: ['ls', 'sessions'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const { message } = ctx;
    const app = (global as any).app;

    if (!app) {
      throw new Error('Application not initialized');
    }

    // 获取当前聊天的会话列表
    const sessions = app.sessionManager.listChatSessions(message.chatId);
    const activeName = app.sessionManager.getChatActiveSession(message.chatId)?.name;

    // 构建会话列表内容
    let content = '';

    if (sessions.length === 0) {
      content = '暂无活跃会话\n\n使用 `/new <名称> <路径>` 创建新会话';
    } else {
      for (const session of sessions) {
        const statusEmoji = getStatusEmoji(session.status);
        const activeMarker = session.name === activeName ? ' **[当前]**' : '';
        content += `${statusEmoji} **${session.name}**${activeMarker}\n`;
        content += `   状态: ${session.status}\n`;
        content += `   目录: \`${session.workDir}\`\n\n`;
      }
    }

    await app.adapter.sendCard(message.chatId, {
      title: '📋 会话列表',
      content,
      type: 'default' as any
    });
  }
};

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'idle':
      return '🟢';
    case 'processing':
      return '🟡';
    case 'waiting_confirm':
      return '🔵';
    case 'error':
      return '🔴';
    default:
      return '⚪';
  }
}
