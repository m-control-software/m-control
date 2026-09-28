#!/usr/bin/env node
/**
 * chrome-bridge native messaging host (ADR-0014). Chrome starts it through the
 * launcher `mctl run chrome-bridge action=install` writes:
 *
 *     node host.js --mctl <mctl.js> [--log <file>] chrome-extension://<id>/ [--parent-window=<n>]
 *
 * One connection = one action. The first message is {action, url}; the host
 * accepts only actions in the allowlist (../extension/actions.js), with the URL
 * each allows, rebuilt from its parts. It then runs exactly
 * `node <mctl.js> <args>` (an argument array, no shell) and relays every NDJSON
 * event mctl prints as a native message:
 *
 *     -> {type: "accepted", action, url, pid}
 *     -> {type: "event", event: <ToolEvent>}        (repeated)
 *     -> {type: "done", exitCode}
 *     -> {type: "rejected", code, message}          (instead of all of the above)
 *
 * Only one job per URL runs at a time (./lock.js): a second one is rejected
 * with ALREADY_RUNNING instead of racing the first for the same file.
 *
 * It never runs anything else. If the port closes (the service worker stops,
 * the extension reloads, Chrome closes), the child keeps running: the download
 * finishes, only its progress has nobody to go to.
 */

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const { Rejected, resolve } = require('../extension/actions');
const { acquire } = require('./lock');
const { FramingError, createDecoder, encode } = require('./native');

/** The only caller: the extension id its pinned manifest `key` derives. */
const EXTENSION_ID = 'dgngghofokeolbfnhajhdloajhbggalo';
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
const LOG_CAP_BYTES = 256 * 1024;

function parseArgs(argv) {
  const out = { origin: undefined, mctl: undefined, log: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mctl' || a === '--log') out[a.slice(2)] = argv[++i];
    else if (a.startsWith('chrome-extension://')) out.origin = a;
  }
  return out;
}

function createLog(file) {
  if (!file) return () => {};
  try {
    if (fs.statSync(file).size > LOG_CAP_BYTES)
      fs.renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  return (message) => {
    try {
      fs.appendFileSync(
        file,
        `${new Date().toISOString()} [${process.pid}] ${message}\n`
      );
    } catch {
      // logging must never break the host
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = createLog(args.log);
  let portOpen = true;

  const send = (value) => {
    if (!portOpen) return;
    let frame;
    try {
      frame = encode(value);
    } catch (err) {
      if (!(err instanceof FramingError)) throw err;
      frame = encode({
        type: 'event',
        event: { type: value.event?.type, truncated: true },
      });
    }
    try {
      process.stdout.write(frame);
    } catch {
      portOpen = false;
    }
  };
  process.stdout.on('error', () => {
    portOpen = false;
    log('stdout closed; the download continues without progress');
  });

  const reject = (code, message) => {
    log(`rejected ${code}: ${message}`);
    send({ type: 'rejected', code, message });
    process.stdout.end();
    process.stdin.destroy();
    process.exitCode = 1;
  };

  if (args.origin !== ORIGIN) {
    // Chrome enforces allowed_origins already; this is defence in depth.
    log(`refused caller ${args.origin}`);
    process.exitCode = 1;
    return;
  }
  if (!args.mctl || !fs.existsSync(args.mctl)) {
    // Keep reading so Chrome gets the reply instead of a broken pipe.
    process.stdin.once('data', () =>
      reject(
        'MCTL_NOT_FOUND',
        `mctl not found at ${args.mctl}. Install mctl (scripts/install.ps1) or set tools.chrome-bridge.mctlPath, ` +
          'then run: mctl run chrome-bridge action=install'
      )
    );
    return;
  }

  const decoder = createDecoder();
  let child;
  process.stdin.on('data', (chunk) => {
    let messages;
    try {
      messages = decoder.push(chunk);
    } catch (err) {
      if (!child) reject(err.code || 'MESSAGE_INVALID', err.message);
      return;
    }
    for (const message of messages) {
      if (child) continue; // one action per connection; ignore anything after it
      let job;
      try {
        job = resolve(message);
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        reject(err.code, err.message);
        return;
      }
      // Same track twice at once would collide on one file; the lock lives
      // next to the log (the install's state directory).
      const release = args.log
        ? acquire(path.join(path.dirname(args.log), 'running'), job.url)
        : () => {};
      if (!release) {
        reject(
          'ALREADY_RUNNING',
          `Already saving this track (${job.url}); wait for it to finish.`
        );
        return;
      }
      child = run(job, args.mctl, send, log, () => {
        release();
        process.stdout.end();
        process.stdin.destroy();
      });
    }
  });
  process.stdin.on('end', () => {
    portOpen = false;
    log(
      child
        ? 'port closed; the download continues'
        : 'port closed before any message'
    );
  });
}

function run(job, mctl, send, log, finish) {
  const child = spawn(process.execPath, [mctl, ...job.args], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  log(`${job.action} ${job.url}: spawned mctl as pid ${child.pid}`);
  send({ type: 'accepted', action: job.action, url: job.url, pid: child.pid });

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return; // mctl's own non-NDJSON output (it goes to stderr, normally)
    }
    if (event && typeof event.type === 'string') {
      if (event.type === 'result' || event.type === 'error')
        log(`${event.type}: ${line.slice(0, 500)}`);
      send({ type: 'event', event });
    }
  });
  child.stderr.resume(); // drained; yt-dlp's own output isn't relayed
  child.on('error', (err) => {
    log(`spawn failed: ${err.message}`);
    send({
      type: 'done',
      exitCode: null,
      message: `Could not start mctl: ${err.message}`,
    });
    finish();
  });
  child.on('close', (code) => {
    log(`mctl exited with ${code}`);
    send({ type: 'done', exitCode: code });
    finish();
  });
  return child;
}

if (require.main === module) {
  main();
}

module.exports = { EXTENSION_ID, ORIGIN, parseArgs };
