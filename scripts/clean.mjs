// Removes every workspace build output (dist/). Cross-platform replacement for
// `find … | xargs rm -rf`, which does not exist on Windows.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

for (const group of ['apps', 'packages']) {
  const groupDir = join(root, group);
  if (!existsSync(groupDir)) continue;
  for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dist = join(groupDir, entry.name, 'dist');
    if (existsSync(dist)) {
      rmSync(dist, { recursive: true, force: true });
      console.log(`removed ${join(group, entry.name, 'dist')}`);
    }
  }
}
