export type CommandHandler = (...args: unknown[]) => boolean | void;

const handlers = new Map<string, CommandHandler>();

export const commandRegistry = {
  register(id: string, handler: CommandHandler): void {
    handlers.set(id, handler);
  },

  execute(id: string, ...args: unknown[]): boolean {
    const handler = handlers.get(id);
    if (!handler) return false;
    const result = handler(...args);
    return result !== false;
  },

  has(id: string): boolean {
    return handlers.has(id);
  },

  list(): string[] {
    return Array.from(handlers.keys());
  },

  _clear(): void {
    handlers.clear();
  },
};
