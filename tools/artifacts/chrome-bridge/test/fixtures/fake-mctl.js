#!/usr/bin/env node
/**
 * Stands in for mctl.js in the host tests: records its argv in
 * $FAKE_MCTL_ARGS, prints the NDJSON a yt-download run would, and exits with
 * $FAKE_MCTL_EXIT (default 0) after $FAKE_MCTL_DELAY_MS.
 */
'use strict';

const fs = require('node:fs');

fs.writeFileSync(
  process.env.FAKE_MCTL_ARGS,
  JSON.stringify(process.argv.slice(2))
);
const ev = (type, payload) =>
  process.stdout.write(
    JSON.stringify({
      type,
      ts: new Date().toISOString(),
      toolId: 'yt-download',
      payload,
    }) + '\n'
  );
ev('started', { meta: {} });
process.stdout.write('not json: mctl chatter is ignored\n');
ev('log', { level: 'info', message: 'Track: 40% of 5.2 MB' });
setTimeout(
  () => {
    const code = Number(process.env.FAKE_MCTL_EXIT || 0);
    if (code === 0) {
      ev('result', {
        items: [{ id: 'x', title: 'Track', file: 'C:/out/Track [x].mp3' }],
        failed: [],
      });
    } else {
      ev('error', {
        message: 'This video is unavailable',
        code: 'VIDEO_UNAVAILABLE',
        recoverable: true,
      });
    }
    process.exitCode = code;
  },
  Number(process.env.FAKE_MCTL_DELAY_MS || 0)
);
