import chalk from 'chalk';

export interface Logger {
  section(name: string): void;
  info(message: string): void;
  step(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(verbose: boolean = true): Logger {
  const out = (message: string) => {
    if (verbose) {
      process.stdout.write(message + '\n');
    }
  };

  return {
    section(name: string) {
      out('\n' + chalk.bold.cyan(`── ${name} ` + '─'.repeat(Math.max(0, 40 - name.length))));
    },
    info(message: string) {
      out(chalk.gray(message));
    },
    step(message: string) {
      out(chalk.white('  • ' + message));
    },
    success(message: string) {
      out(chalk.green('  ✓ ' + message));
    },
    warn(message: string) {
      out(chalk.yellow('  ! ' + message));
    },
    error(message: string) {
      out(chalk.red('  ✗ ' + message));
    },
  };
}
