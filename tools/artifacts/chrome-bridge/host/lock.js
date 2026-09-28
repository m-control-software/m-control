/**
 * One job per URL at a time. Two runs of the same track write the same file
 * and collide (yt-dlp renames its .temp.mp3 in place), so the host takes a
 * lock file per URL in its state directory before spawning mctl.
 *
 * The lock holds the host's pid; a lock whose pid is no longer running is
 * stale (the host was killed) and is taken over.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, owned by someone else
  }
}

/** Returns release() when taken, or null when a live process holds it. */
function acquire(dir, key) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) + '.lock'
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = Number(fs.readFileSync(file, 'utf-8'));
      if (holder && holder !== process.pid && alive(holder)) return null;
      fs.rmSync(file, { force: true }); // stale: its host is gone
    }
  }
  return null;
}

module.exports = { acquire };
