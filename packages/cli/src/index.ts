import { Command } from 'commander';
import { registerRunCommand } from './commands/run.js';
import { registerBaselineCommand } from './commands/baseline.js';
import { registerInitCommand } from './commands/init.js';
import { registerConfigCommand } from './commands/config.js';
import { registerCompareCommand } from './commands/compare.js';

async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('drift-ci')
    .description('Behaviour regression testing for LLM applications')
    .version('0.1.0');

  registerInitCommand(program);
  registerRunCommand(program);
  registerBaselineCommand(program);
  registerConfigCommand(program);
  registerCompareCommand(program);

  await program.parseAsync(argv);
}

main(process.argv).catch((err) => {
  const code = (err as { code?: string }).code;
  if (code === 'RUN_ABORTED_TRANSIENT') {
    console.error(`\n${(err as Error).message}`);
    process.exit(2);
  }
  console.error((err as Error).message ?? err);
  process.exit(1);
});
