/**
 * /help 指令 - 显示帮助信息
 */

import { CommandDefinition, CommandContext } from '../../core/types';
import { buildHelpCard } from '../../adapter/feishu/card';
import { getCommandRegistry } from '../registry';

export const helpCommand: CommandDefinition = {
  name: 'help',
  description: '显示帮助信息',
  usage: '/help',
  aliases: ['h', '?'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const { message } = ctx;
    const app = (global as any).app;

    if (!app) {
      throw new Error('Application not initialized');
    }

    const registry = getCommandRegistry();
    const commands = registry.getAll().map(cmd => ({
      name: cmd.name,
      usage: cmd.usage,
      description: cmd.description
    }));

    const card = buildHelpCard(commands);

    await app.adapter.sendCard(message.chatId, {
      title: card.header?.title.content || '帮助',
      content: (card.elements[0] as any)?.content || '',
      type: 'default' as any
    });
  }
};
