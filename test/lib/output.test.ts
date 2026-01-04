import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock output-mode to always return TUI mode (so tests get styled output)
vi.mock('../../src/lib/output-mode.js', () => ({
  isPlainMode: () => false,
  isTuiMode: () => true,
  getOutputMode: () => 'tui',
  setOutputMode: vi.fn(),
  resetOutputMode: vi.fn(),
}));

// Mock chalk to return plain strings for testing
vi.mock('chalk', () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    blue: (s: string) => s,
    gray: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
    bold: { underline: (s: string) => s },
    bgYellow: { black: (s: string) => s },
  }
}));

// Mock cli-table3
vi.mock('cli-table3', () => ({
  default: class MockTable {
    private rows: string[][] = [];
    head: string[] = [];

    constructor(options: { head: string[] }) {
      this.head = options.head;
    }

    push(row: string[]): void {
      this.rows.push(row);
    }

    toString(): string {
      return [this.head.join(' | '), ...this.rows.map(r => r.join(' | '))].join('\n');
    }
  }
}));

// Mock ink (not used in basic tests but imported)
vi.mock('ink', () => ({
  render: vi.fn(() => ({ unmount: vi.fn() })),
}));

// Mock TUI components
vi.mock('../../src/tui/components/Table.js', () => ({
  Table: vi.fn(),
}));

vi.mock('../../src/tui/components/List.js', () => ({
  List: vi.fn(),
  Card: vi.fn(),
  StatusIndicator: vi.fn(),
  ProgressBar: vi.fn(),
}));

describe('output', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('success', () => {
    it('should print success message with checkmark', async () => {
      const { success } = await import('../../src/lib/output.js');
      success('Operation completed');

      expect(consoleSpy).toHaveBeenCalledWith('✓', 'Operation completed');
    });
  });

  describe('error', () => {
    it('should print error message with X', async () => {
      const { error } = await import('../../src/lib/output.js');
      error('Something went wrong');

      expect(consoleErrorSpy).toHaveBeenCalledWith('✗', 'Something went wrong');
    });
  });

  describe('warn', () => {
    it('should print warning message', async () => {
      const { warn } = await import('../../src/lib/output.js');
      warn('Be careful');

      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠', 'Be careful');
    });
  });

  describe('info', () => {
    it('should print info message', async () => {
      const { info } = await import('../../src/lib/output.js');
      info('For your information');

      expect(consoleSpy).toHaveBeenCalledWith('ℹ', 'For your information');
    });
  });

  describe('json', () => {
    it('should print formatted JSON', async () => {
      const { json } = await import('../../src/lib/output.js');
      json({ name: 'test', value: 123 });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ name: 'test', value: 123 }, null, 2));
    });
  });

  describe('formatStatus', () => {
    it('should return status string', async () => {
      const { formatStatus } = await import('../../src/lib/output.js');

      expect(formatStatus('active')).toBe('active');
      expect(formatStatus('disabled')).toBe('disabled');
      expect(formatStatus('locked')).toBe('locked');
    });
  });

  describe('formatBool', () => {
    it('should format boolean values', async () => {
      const { formatBool } = await import('../../src/lib/output.js');

      expect(formatBool(true)).toBe('yes');
      expect(formatBool(false)).toBe('no');
    });
  });

  describe('formatDate', () => {
    it('should format date strings', async () => {
      const { formatDate } = await import('../../src/lib/output.js');

      const result = formatDate('2024-01-15T10:30:00Z');
      expect(result).toBeTruthy();
      expect(result).not.toBe('-');
    });

    it('should return dash for null/undefined', async () => {
      const { formatDate } = await import('../../src/lib/output.js');

      expect(formatDate(null)).toBe('-');
      expect(formatDate(undefined)).toBe('-');
    });
  });

  describe('formatRelativeTime', () => {
    it('should format relative time for recent dates', async () => {
      const { formatRelativeTime } = await import('../../src/lib/output.js');

      const now = new Date();
      const tenSecondsAgo = new Date(now.getTime() - 10000);
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 3600000);
      const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);

      expect(formatRelativeTime(tenSecondsAgo)).toMatch(/\d+s ago/);
      expect(formatRelativeTime(fiveMinutesAgo)).toMatch(/\d+m ago/);
      expect(formatRelativeTime(twoHoursAgo)).toMatch(/\d+h ago/);
      expect(formatRelativeTime(threeDaysAgo)).toMatch(/\d+d ago/);
    });
  });
});
