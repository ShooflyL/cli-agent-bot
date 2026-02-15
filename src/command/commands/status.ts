/**
 * /status 指令 - 显示系统状态
 */

import { CommandDefinition, CommandContext } from '../../core/types';
import { buildStatusCard } from '../../adapter/feishu/card';

const START_TIME = Date.now();
const VERSION = '1.0.0';

export const statusCommand: CommandDefinition = {
  name: 'status',
  description: '显示系统状态',
  usage: '/status',
  aliases: ['info', 'stat'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const { message } = ctx;
    const app = (global as any).app;

    if (!app) {
      throw new Error('Application not initialized');
    }

    const uptime = Math.floor((Date.now() - START_TIME) / 1000);
    const stats = {
      totalSessions: app.sessionManager.getSessionCount(),
      maxSessions: app.config.session.maxSessions,
      uptime,
      version: VERSION
    };

    const card = buildStatusCard(stats);

    await app.adapter.sendCard(message.chatId, {
      title: card.header?.title.content || '系统状态',
      content: (card.elements[0] as any)?.content || '',
      type: 'default' as any
    });
  }
};
