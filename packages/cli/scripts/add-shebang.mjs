#!/usr/bin/env node
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'dist', 'index.js');
const shebang = '#!/usr/bin/env node\n';

const content = readFileSync(target, 'utf8');
if (!content.startsWith(shebang)) {
  writeFileSync(target, shebang + content);
}
try {
  chmodSync(target, 0o755);
} catch {
  // chmod fails on Windows file systems without ACL support — ignore.
}
