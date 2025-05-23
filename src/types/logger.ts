export interface Logger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

export type LoggerProvider = Logger|(() => Logger);