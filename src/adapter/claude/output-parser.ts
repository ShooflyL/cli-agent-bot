/**
 * 输出解析器
 * 解析Claude Code的输出，识别不同类型的输出块
 */

import { OutputBlock, OutputType } from '../../core/types';
import { createLogger } from '../../core/logger';

const logger = createLogger('output-parser');

/**
 * 交互式选择信息
 */
export interface InteractiveSelect {
  id: string;
  prompt: string;
  options: string[];
  selectedIndex: number;
}

/**
 * 输出解析器类
 */
export class OutputParser {
  // ANSI转义序列
  private readonly ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;
  private readonly ANSI_CURSOR_PATTERN = /\x1b\[(\d+)([ABCD])/g;

  // 错误模式
  private readonly ERROR_PATTERNS = [
    /^Error:/m,
    /^ERROR:/m,
    /Failed to:/i,
    /Exception:/i,
    /command not found/i,
    /permission denied/i
  ];

  /**
   * 解析输出数据
   * @param data 原始输出数据
   * @returns 解析后的输出块数组
   */
  parse(data: string): OutputBlock[] {
    const blocks: OutputBlock[] = [];

    // 首先检测是否是交互式选择
    const interactiveSelect = this.detectInteractiveSelect(data);
    if (interactiveSelect) {
      blocks.push(this.createBlock(OutputType.CONFIRM, this.formatInteractiveSelect(interactiveSelect), {
        requiresConfirm: true,
        confirmOptions: interactiveSelect.options, // 保留原始选项文本
        confirmId: interactiveSelect.id
      }));
      return blocks;
    }

    // 检测普通确认提示
    const confirmMatch = this.detectConfirmPrompt(data);
    if (confirmMatch) {
      blocks.push(this.createBlock(OutputType.CONFIRM, this.stripAnsi(data).trim(), {
        requiresConfirm: true,
        confirmOptions: confirmMatch.options,
        confirmId: confirmMatch.id
      }));
      return blocks;
    }

    // 检测错误
    const isErrorCode = this.detectError(data);

    // 普通输出
    const cleanContent = this.stripAnsi(data).trim();
    if (cleanContent) {
      blocks.push(this.createBlock(
        isErrorCode ? OutputType.ERROR : OutputType.NORMAL,
        cleanContent
      ));
    }

    return blocks;
  }

  /**
   * 检测交互式选择
   */
  private detectInteractiveSelect(data: string): InteractiveSelect | null {
    // 首先清理 ANSI 序列，在干净的数据上检测
    const cleanData = this.stripAnsi(data);
    const lines = cleanData.split('\n');

    // 排除明显的输入建议（不是确认提示）
    // 如果包含这些特征，很可能是输入提示而不是确认对话框
    if (/don't ask|ctrl\+t|shift\+tab|tab to cycle/i.test(cleanData)) {
      return null;
    }

    // 检测确认提示
    const hasConfirmHint = /Enter to confirm|Press Enter|to confirm/i.test(cleanData) ||
                           /Esc to cancel|to cancel/i.test(cleanData) ||
                           /use (arrow |↑↓ )?keys/i.test(cleanData) ||
                           /Press .* to select/i.test(cleanData);

    // 检测带有选择标记的选项列表
    const options: string[] = [];
    let selectedIndex = 0;
    let promptText = '';

    // 匹配模式1: 带有 ❯ 或 > 标记的选项
    const arrowPattern = /^\s*[❯►→>]\s*(.+)$/;

    // 匹配模式2: 数字编号选项 (如 "1. Option" 或 "1) Option")
    const numberedPattern = /^\s*(\d+)[.)\]]\s*(.+)$/;

    let foundInteractive = false;
    let foundArrow = false;

    for (let i = 0; i < lines.length; i++) {
      const cleanLine = lines[i].trim();

      if (!cleanLine) continue;

      // 尝试匹配箭头选择
      const arrowMatch = cleanLine.match(arrowPattern);
      if (arrowMatch) {
        foundInteractive = true;
        foundArrow = true;

        // 提取选项文本
        let optionText = arrowMatch[1].trim();

        // 如果选项包含数字编号（如 "1. Yes, I trust"），提取完整内容
        const numMatch = optionText.match(/^(\d+)\.\s*(.+)$/);
        if (numMatch) {
          optionText = numMatch[2].trim();
        }

        options.push(optionText);
        selectedIndex = options.length - 1;

        // 尝试获取提示文本（向前查找非空行）
        if (!promptText) {
          for (let j = i - 1; j >= 0; j--) {
            const prevLine = lines[j].trim();
            if (prevLine && !prevLine.match(arrowPattern) && !prevLine.match(numberedPattern)) {
              promptText = prevLine;
              break;
            }
          }
        }
        continue;
      }

      // 如果已经找到箭头选择，检查缩进的选项行（没有箭头标记的）
      if (foundArrow) {
        // 匹配类似 "2. No, exit" 的行
        const numberedMatch = cleanLine.match(numberedPattern);
        if (numberedMatch) {
          options.push(numberedMatch[2].trim());
          continue;
        }

        // 匹配缩进的普通选项行
        if (lines[i].match(/^\s{2,}/)) {
          const plainOption = cleanLine;
          if (plainOption && !plainOption.match(/Enter to confirm|Esc to cancel/i)) {
            options.push(plainOption);
            continue;
          }
        }
      }

      // 如果有确认提示但没有箭头，检测纯数字编号选项
      if (hasConfirmHint && !foundArrow) {
        const numberedMatch = cleanLine.match(numberedPattern);
        if (numberedMatch) {
          foundInteractive = true;
          options.push(numberedMatch[2].trim());
          continue;
        }
      }
    }

    // 如果检测到了选项，返回交互式选择信息
    // 添加更严格的条件：必须有明确的确认提示，或者选项看起来像确认选项
    const hasConfirmKeywords = options.some(opt =>
      /yes|no|confirm|cancel|proceed|abort|continue|exit/i.test(opt)
    );

    if (options.length >= 2 && (hasConfirmHint || hasConfirmKeywords)) {
      return {
        id: `interactive_${Date.now()}`,
        prompt: promptText || '请选择一个选项',
        options,
        selectedIndex
      };
    }

    return null;
  }

  /**
   * 格式化交互式选择为可读文本
   */
  private formatInteractiveSelect(select: InteractiveSelect): string {
    let text = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '📋 ' + select.prompt + '\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    text += '请回复选项编号（1-' + select.options.length + '）或选项内容：\n\n';

    select.options.forEach((option, index) => {
      const marker = index === select.selectedIndex ? '▶ ' : '   ';
      text += `${marker}${index + 1}. ${option}\n`;
    });

    text += '\n💡 提示：直接发送数字（如 "1"）或选项内容即可选择';
    return text;
  }

  /**
   * 获取选中索引
   */
  getSelectedIndex(): number {
    return 0; // 默认第一个选项被选中
  }

  /**
   * 检测确认提示
   */
  private detectConfirmPrompt(data: string): { options: string[]; id: string } | null {
    const cleanData = this.stripAnsi(data);

    // Y/N 确认
    if (/\[(Y\/N|y\/n)\]/i.test(cleanData)) {
      return {
        options: ['Y', 'N'],
        id: `confirm_${Date.now()}`
      };
    }

    // Yes/No 确认
    if (/\[(Yes\/No|yes\/no)\]/i.test(cleanData)) {
      return {
        options: ['Yes', 'No'],
        id: `confirm_${Date.now()}`
      };
    }

    // 数字范围选择 (如 [1-5])
    const rangeMatch = cleanData.match(/\[(\d+)-(\d+)\]/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      const options: string[] = [];
      for (let i = start; i <= end; i++) {
        options.push(String(i));
      }
      return {
        options,
        id: `confirm_${Date.now()}`
      };
    }

    // Continue/Cancel
    if (/\[(Continue|Cancel)\]/i.test(cleanData)) {
      return {
        options: ['Continue', 'Cancel'],
        id: `confirm_${Date.now()}`
      };
    }

    // Proceed/Abort
    if (/\[(Proceed|Abort)\]/i.test(cleanData)) {
      return {
        options: ['Proceed', 'Abort'],
        id: `confirm_${Date.now()}`
      };
    }

    return null;
  }

  /**
   * 检测错误
   */
  private detectError(data: string): boolean {
    const cleanData = this.stripAnsi(data);
    for (const pattern of this.ERROR_PATTERNS) {
      if (pattern.test(cleanData)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 移除ANSI转义序列
   */
  private stripAnsi(text: string): string {
    // 首先处理光标定位序列，将行号变化转换为换行符
    // \e[row;colH 或 \e[row;colf 是光标定位序列
    let currentLine = 0;
    let result = text.replace(/\x1b\[(\d+);(\d+)(H|f)/g, (match, row, col, cmd) => {
      const newRow = parseInt(row, 10);
      const newCol = parseInt(col, 10);

      if (newRow > currentLine) {
        // 行号增加，插入换行符
        const lineBreaks = '\n'.repeat(newRow - currentLine);
        currentLine = newRow;
        // 如果列号大于1，还需要添加空格缩进
        const indent = newCol > 1 ? ' '.repeat(newCol - 1) : '';
        return lineBreaks + indent;
      } else if (newRow === currentLine && newCol > 1) {
        // 同一行但列号变化，添加空格
        return ' '.repeat(newCol - 1);
      }

      return '';
    });

    // 将光标前进序列转换为空格
    // \e[nC 表示光标前进 n 个位置
    result = result.replace(/\x1b\[(\d+)C/g, (match, count) => {
      return ' '.repeat(parseInt(count, 10));
    });

    // \e[n@ 表示插入 n 个字符（通常是空格）
    result = result.replace(/\x1b\[(\d+)@/g, (match, count) => {
      return ' '.repeat(parseInt(count, 10));
    });

    // 将光标下移序列转换为换行符
    // \e[nB 表示光标下移 n 行
    result = result.replace(/\x1b\[(\d+)B/g, (match, count) => {
      return '\n'.repeat(parseInt(count, 10));
    });

    // 使用更健壮的ANSI移除正则
    const ansiRegex = [
      // CSI sequences: ESC [ ... <letter>
      /\x1b\[[0-9;?]*[a-zA-Z]/g,
      // OSC sequences: ESC ] ... BEL/ST
      /\x1b\][^\x07]*\x07/g,
      /\x1b\][^\x1b]*(?:\x1b\\)?/g,
      // Other escape sequences
      /\x1b[()][A-Za-z0-9]/g,
      /\x1b[)[\]A-Za-z]/g,
      // Link escape sequences (used by some terminals)
      /\x1b]8;;[^\x1b]*\x1b\\/g,
      // SGR sequences that might have complex parameters
      /\x1b\[[\d;]*m/g,
    ];

    for (const regex of ansiRegex) {
      result = result.replace(regex, '');
    }

    // 移除控制字符（但保留换行、制表符、回车和空格）
    result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

    return result;
  }

  /**
   * 创建输出块
   */
  private createBlock(
    type: OutputType,
    content: string,
    extra?: Partial<OutputBlock>
  ): OutputBlock {
    return {
      type,
      content: content.trim(),
      timestamp: new Date(),
      ...extra
    };
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    // 无状态，无需重置
  }
}

/**
 * 将用户输入转换为交互式选择的响应
 * @param userInput 用户输入
 * @param options 可选选项列表
 * @returns 转换后的响应
 */
export function convertToInteractiveResponse(
  userInput: string,
  options?: string[]
): string | null {
  if (!options || options.length === 0) {
    return userInput;
  }

  const input = userInput.trim();

  // 尝试解析为数字
  const num = parseInt(input, 10);
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    // 用户输入的是数字，返回对应的选项
    return options[num - 1];
  }

  // 检查是否完全匹配某个选项
  const lowerInput = input.toLowerCase();
  for (const option of options) {
    if (option.toLowerCase() === lowerInput) {
      return option;
    }
  }

  // 部分匹配
  for (const option of options) {
    const lowerOption = option.toLowerCase();
    if (lowerOption.includes(lowerInput) || lowerInput.includes(lowerOption)) {
      return option;
    }
  }

  // 无法匹配，返回 null 表示需要用户重新选择
  return null;
}

/**
 * 创建输出解析器
 */
export function createOutputParser(): OutputParser {
  return new OutputParser();
}
