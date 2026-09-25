#!/usr/bin/env node
/**
 * Stands in for yt-dlp in tests: prints the marker lines the tool asks for,
 * the way yt-dlp does (--print to stdout; progress and errors to stderr in
 * quiet mode), and writes the "downloaded" file. Behaviour is chosen by
 * FAKE_YTDLP_SCENARIO; the argv is recorded to FAKE_YTDLP_ARGS when set.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (process.env.FAKE_YTDLP_ARGS) {
  fs.writeFileSync(process.env.FAKE_YTDLP_ARGS, JSON.stringify(args));
}
if (args[0] === '--version') {
  process.stdout.write('2099.01.01\n');
  process.exit(0);
}

/** JSON with non-ASCII escaped, as yt-dlp's `j` conversion prints it. */
const j = (value) =>
  JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  );

const out = (line) => process.stdout.write(line + '\n');
const err = (line) => process.stderr.write(line + '\n');
const outDir = args[args.indexOf('-P') + 1];
const simulate = args.includes('--simulate');
const ext = args.includes('--extract-audio') ? 'mp3' : 'mp4';

function download(id, title) {
  if (simulate) {
    out(
      `YTDL-PLAN ${j({ id, title, duration: 42, webpage_url: `https://www.youtube.com/watch?v=${id}` })}`
    );
    return;
  }
  out(`YTDL-ITEM ${j({ id, title })}`);
  for (const done of [0, 250, 500, 750, 1000]) {
    err(`YTDL-PROGRESS ${id} ${done} 1000 NA`);
  }
  out(`YTDL-POST ${j({ id })}`);
  const filepath = path.join(outDir, `${title} [${id}].${ext}`);
  fs.writeFileSync(filepath, 'x'.repeat(1000));
  out(`YTDL-DONE ${j({ id, title, filepath, duration: 42 })}`);
}

switch (process.env.FAKE_YTDLP_SCENARIO) {
  case 'ok':
    err('[youtube] Extracting URL: https://youtu.be/abcdefghijk');
    download('abcdefghijk', 'Zażółć gęślą jaźń');
    process.exit(0);
    break;
  case 'partial':
    download('abcdefghijk', 'First');
    err(
      'ERROR: [youtube] zzzzzzzzzzz: Video unavailable. This video is private'
    );
    process.exit(1);
    break;
  case 'unavailable':
    err(
      'ERROR: [youtube] abcdefghijk: Private video. Sign in if you have access'
    );
    process.exit(1);
    break;
  case 'extraction':
    err('ERROR: [youtube] abcdefghijk: Unable to extract player response');
    process.exit(1);
    break;
  case 'crash':
    err('Traceback (most recent call last): boom');
    process.exit(2);
    break;
  default:
    err(
      `fake-yt-dlp: unknown FAKE_YTDLP_SCENARIO ${process.env.FAKE_YTDLP_SCENARIO}`
    );
    process.exit(3);
}
