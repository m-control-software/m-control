'use strict';

/**
 * Runs yt-dlp and turns its output into protocol events.
 *
 * yt-dlp reports through marker lines this tool asks for (`--print`,
 * `--progress-template`). Their JSON uses the `j` conversion without the `+`
 * flag, so it is ASCII-escaped: titles survive a Windows console code page.
 * Every other line yt-dlp prints is forwarded to stderr, never to stdout.
 */

const fs = require('node:fs');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');

const { ToolFailure, createProgressReporter, log } = require('./protocol');

const MARK = {
  plan: 'YTDL-PLAN ',
  item: 'YTDL-ITEM ',
  post: 'YTDL-POST ',
  done: 'YTDL-DONE ',
  progress: 'YTDL-PROGRESS ',
};

const OUTPUT_TEMPLATE = '%(title)s [%(id)s].%(ext)s';

/**
 * yt-dlp arguments for one run. `opts`: url, format ('video'|'audio'),
 * maxHeight (number|undefined), playlist, check, outDir, ffmpeg (path),
 * node (path of the JavaScript runtime yt-dlp uses for YouTube).
 */
function buildArgs(opts) {
  const args = [
    // Only what this tool passes counts: no user yt-dlp.conf.
    '--ignore-config',
    '--no-js-runtimes',
    '--js-runtimes',
    `node:${opts.node}`,
    '--ffmpeg-location',
    opts.ffmpeg,
    '--color',
    'never',
    opts.playlist ? '--yes-playlist' : '--no-playlist',
  ];

  if (opts.format === 'audio') {
    args.push(
      '-f',
      'ba/b',
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '--embed-thumbnail',
      '--embed-metadata'
    );
  } else {
    // Highest resolution first; among equals prefer H.264 + AAC, which play
    // everywhere. Separate streams are merged into mp4 by ffmpeg.
    const res = opts.maxHeight ? `res:${opts.maxHeight}` : 'res';
    args.push(
      '-f',
      'bv*+ba/b',
      '-S',
      `${res},vcodec:h264,acodec:m4a`,
      '--merge-output-format',
      'mp4',
      '--embed-metadata'
    );
  }

  if (opts.check) {
    args.push(
      '--simulate',
      '--print',
      `video:${MARK.plan}%(.{id,title,duration,webpage_url})j`
    );
  } else {
    args.push(
      '--no-simulate',
      '--no-overwrites',
      '--progress',
      '--newline',
      '-P',
      opts.outDir,
      '-o',
      OUTPUT_TEMPLATE,
      '--print',
      `before_dl:${MARK.item}%(.{id,title})j`,
      '--print',
      `post_process:${MARK.post}%(.{id})j`,
      '--print',
      `after_move:${MARK.done}%(.{id,title,filepath,duration})j`,
      '--progress-template',
      `download:${MARK.progress}%(info.id)s %(progress.downloaded_bytes)s ` +
        `%(progress.total_bytes)s %(progress.total_bytes_estimate)s`
    );
  }
  // `--` so a URL can never be read as an option.
  args.push('--', opts.url);
  return args;
}

/**
 * Maps a yt-dlp ERROR message to a code. yt-dlp has no machine-readable
 * error output, so this matches its wording; unknown text is YTDLP_FAILED.
 */
function classify(message, ytDlpVersion) {
  const m = message;
  if (/Unsupported URL|is not a valid URL/i.test(m)) {
    return {
      code: 'INPUT_INVALID',
      recoverable: true,
      hint: 'Check the url.',
    };
  }
  if (/confirm you.?re not a bot/i.test(m)) {
    return {
      code: 'VIDEO_UNAVAILABLE',
      recoverable: true,
      hint:
        'YouTube is asking this network to sign in (bot check). Try again ' +
        'later or from another network.',
    };
  }
  if (
    /Video unavailable|Private video|members[- ]only|Join this channel|confirm your age|age[- ]restricted|not available in your country|geo[- ]?restrict|has been removed|This live event|Premieres in/i.test(
      m
    )
  ) {
    return {
      code: 'VIDEO_UNAVAILABLE',
      recoverable: true,
      hint: 'The video cannot be downloaded without signing in, or at all.',
    };
  }
  if (
    /Unable to extract|Requested format is not available|nsig|n challenge|signature|Failed to parse JSON|Some formats may be missing|No video formats found/i.test(
      m
    )
  ) {
    return {
      code: 'EXTRACTION_FAILED',
      recoverable: true,
      hint:
        `yt-dlp ${ytDlpVersion || '(configured)'} is probably outdated for ` +
        `YouTube's current site. Bump the pin in deps.json (README -> ` +
        `Updating the pins) and run action=setup.`,
    };
  }
  if (
    /Unable to download (webpage|API page)|getaddrinfo|timed out|Connection (reset|refused|aborted)|Temporary failure in name resolution|HTTP Error 5\d\d|HTTP Error 429/i.test(
      m
    )
  ) {
    return {
      code: 'NETWORK_ERROR',
      recoverable: true,
      hint: 'Check the network connection and try again.',
    };
  }
  return {
    code: 'YTDLP_FAILED',
    recoverable: false,
    hint: 'Unrecognised yt-dlp failure; its full output is on stderr.',
  };
}

const ERROR_LINE = /^ERROR: (?:\[[^\]]+\] )?(?:([A-Za-z0-9_-]{11}): )?(.*)$/;

function parseJson(line, marker) {
  try {
    return JSON.parse(line.slice(marker.length));
  } catch {
    process.stderr.write(`yt-download: unparseable yt-dlp line: ${line}\n`);
    return undefined;
  }
}

/** `yt-dlp --version`, or a CONFIG_INVALID failure if it does not run. */
function versionOf(ytDlp) {
  const r = spawnSync(ytDlp, ['--version'], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) {
    throw new ToolFailure(
      `yt-dlp at ${ytDlp} does not run (${r.error ? r.error.message : `exit ${r.status}`}). ` +
        `Fix tools.yt-download.ytDlpPath, or remove it to use the managed one.`,
      'CONFIG_INVALID'
    );
  }
  return r.stdout.trim();
}

/**
 * Spawns yt-dlp with `args` and collects the outcome:
 * `{ exitCode, plans, items, failed, stderrTail }`.
 */
function run(ytDlp, args, ytDlpVersion) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    // When mctl's runner stops this tool (timeout, Ctrl+C), take yt-dlp
    // with it. Windows has no SIGTERM for the runner to deliver, so this only
    // helps on POSIX; see README -> Limitations.
    const forward = (signal) => {
      child.kill(signal);
      process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
    };
    process.once('SIGTERM', forward);
    process.once('SIGINT', forward);

    const plans = [];
    const items = new Map();
    const done = [];
    const failed = [];
    const stderrTail = [];
    const titles = new Map();

    const onLine = (line, fromStderr) => {
      if (line.startsWith(MARK.progress)) {
        const [id, downloaded, total, estimate] = line
          .slice(MARK.progress.length)
          .split(' ');
        const item = items.get(id);
        if (item) {
          const size = Number(total) || Number(estimate);
          item.progress.update(Number(downloaded), size);
        }
      } else if (line.startsWith(MARK.plan)) {
        const p = parseJson(line, MARK.plan);
        if (p) {
          plans.push({
            id: p.id,
            title: p.title,
            durationSec: p.duration ?? null,
            url: p.webpage_url,
          });
          log('info', `Would download: ${p.title} [${p.id}]`);
        }
      } else if (line.startsWith(MARK.item)) {
        const p = parseJson(line, MARK.item);
        if (p) {
          titles.set(p.id, p.title);
          items.set(p.id, {
            progress: createProgressReporter(p.title),
          });
          log('info', `Downloading: ${p.title} [${p.id}]`);
        }
      } else if (line.startsWith(MARK.post)) {
        const p = parseJson(line, MARK.post);
        if (p) {
          log('info', `Processing: ${titles.get(p.id) ?? p.id}`);
        }
      } else if (line.startsWith(MARK.done)) {
        const p = parseJson(line, MARK.done);
        if (p) {
          let bytes = null;
          try {
            bytes = fs.statSync(p.filepath).size;
          } catch (err) {
            log('warn', `Cannot stat ${p.filepath}: ${err.message}`);
          }
          done.push({
            id: p.id,
            title: p.title,
            file: p.filepath,
            bytes,
            durationSec: p.duration ?? null,
          });
          log('info', `Saved: ${p.filepath}`);
        }
      } else {
        process.stderr.write(line + '\n');
        if (fromStderr) {
          stderrTail.push(line);
          if (stderrTail.length > 20) stderrTail.shift();
          const m = ERROR_LINE.exec(line);
          if (m) {
            const [, id, message] = m;
            const c = classify(message, ytDlpVersion);
            failed.push({
              id: id ?? null,
              title: (id && titles.get(id)) ?? null,
              code: c.code,
              recoverable: c.recoverable,
              message: `${message} — ${c.hint}`,
            });
          }
        }
      }
    };

    const stdoutDone = new Promise((r) =>
      readline
        .createInterface({ input: child.stdout })
        .on('line', (l) => onLine(l, false))
        .on('close', r)
    );
    const stderrDone = new Promise((r) =>
      readline
        .createInterface({ input: child.stderr })
        .on('line', (l) => onLine(l, true))
        .on('close', r)
    );

    child.on('error', (err) => {
      process.removeListener('SIGTERM', forward);
      process.removeListener('SIGINT', forward);
      reject(
        new ToolFailure(
          `Could not start yt-dlp at ${ytDlp}: ${err.message}. Run ` +
            `'mctl run yt-download action=setup' again, or fix ` +
            `tools.yt-download.ytDlpPath.`,
          'DEPS_MISSING'
        )
      );
    });
    child.on('close', async (exitCode, signal) => {
      await Promise.all([stdoutDone, stderrDone]);
      process.removeListener('SIGTERM', forward);
      process.removeListener('SIGINT', forward);
      resolve({ exitCode, signal, plans, items: done, failed, stderrTail });
    });
  });
}

module.exports = { MARK, buildArgs, classify, run, versionOf };
