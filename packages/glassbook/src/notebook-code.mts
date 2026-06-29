export function gateCodeSource(args: { repoDir: string; command: string }): string {
  return [
    "import { execSync } from 'node:child_process';",
    '',
    `const command = ${JSON.stringify(args.command)};`,
    `const cwd = ${JSON.stringify(args.repoDir)};`,
    '',
    "const output = execSync(command, { cwd, encoding: 'utf8', stdio: 'pipe' });",
    'console.log(output || `gate passed: ${command}`);',
  ].join('\n');
}
