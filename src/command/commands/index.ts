/**
 * 内置指令导出
 */

export { newCommand } from './new';
export { listCommand } from './list';
export { switchCommand } from './switch';
export { closeCommand } from './close';
export { pollCommand } from './poll';
export { statusCommand } from './status';
export { helpCommand } from './help';
export { modelCommand } from './model';
export { upCommand, downCommand, enterCommand, escCommand } from './keys';

import { newCommand } from './new';
import { listCommand } from './list';
import { switchCommand } from './switch';
import { closeCommand } from './close';
import { pollCommand } from './poll';
import { statusCommand } from './status';
import { helpCommand } from './help';
import { modelCommand } from './model';
import { upCommand, downCommand, enterCommand, escCommand } from './keys';
import { CommandDefinition } from '../../core/types';

/**
 * 所有内置指令
 */
export const builtinCommands: CommandDefinition[] = [
  newCommand,
  listCommand,
  switchCommand,
  closeCommand,
  pollCommand,
  statusCommand,
  helpCommand,
  modelCommand,
  upCommand,
  downCommand,
  enterCommand,
  escCommand
];
