/**
 * m-control bridge: service worker (Manifest V3).
 *
 * The command (suggested Ctrl+Shift+Y, which the Actions Ring item sends) and
 * the toolbar button read the active tab's URL (the command grants activeTab),
 * check it against the same allowlist the host enforces, and hand it to the
 * native messaging host. Progress goes on the badge; the result or the error
 * (message and code) goes in one notification per job.
 */

'use strict';

/* global chrome, importScripts -- a Chrome extension service worker */
importScripts('actions.js');

const HOST = 'com.m_control.chrome_bridge';
const { ACTIONS, Rejected, resolve } = globalThis.chromeBridgeActions;
const BADGE = { busy: '#1a73e8', ok: '#188038', failed: '#d93025' };

let jobs = 0;

chrome.commands.onCommand.addListener((command, tab) => {
  if (command in ACTIONS) start(command, tab);
});
chrome.action.onClicked.addListener((tab) => start('yt-audio', tab));

async function activeTab(tab) {
  if (tab && tab.url) return tab;
  const [current] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return current;
}

function notify(id, title, message, context) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: message || ' ',
    contextMessage: context || 'm-control',
    priority: 0,
  });
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

function settle(text, color) {
  jobs = Math.max(0, jobs - 1);
  badge(text, color);
  setTimeout(() => {
    if (jobs === 0) badge('');
  }, 8000);
}

async function start(action, tab) {
  const id = `job-${Date.now()}`;
  const current = await activeTab(tab);
  const url = current && current.url;
  try {
    resolve({ action, url }); // the host checks again; this only avoids a spawn
  } catch (err) {
    if (!(err instanceof Rejected)) throw err;
    notify(id, 'Not saved', err.message, err.code);
    return;
  }

  jobs += 1;
  badge('…', BADGE.busy);
  notify(
    id,
    `${ACTIONS[action].title}…`,
    current.title || url,
    'm-control: started'
  );
  let finished = false;
  let saved = [];
  let failure;

  const port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    if (msg.type === 'rejected') {
      finished = true;
      notify(id, 'Not saved', msg.message, msg.code);
      settle('!', BADGE.failed);
    } else if (msg.type === 'event') {
      const e = msg.event || {};
      const p = e.payload || {};
      if (e.type === 'log') {
        const m = /: (\d{1,3})% of /.exec(p.message || '');
        if (m) badge(`${m[1]}%`, BADGE.busy);
      } else if (e.type === 'result') {
        saved = (p.items || []).map((i) => i.file).filter(Boolean);
        if (p.failed && p.failed.length)
          failure = { message: p.failed[0].message, code: p.failed[0].code };
      } else if (e.type === 'error') {
        failure = { message: p.message, code: p.code };
      }
    } else if (msg.type === 'done') {
      finished = true;
      port.disconnect();
      if (msg.exitCode === 0 && saved.length) {
        const names = saved.map((f) => f.split(/[\\/]/).pop());
        notify(id, 'Saved as mp3', names.join('\n'), saved[0]);
        settle('✓', BADGE.ok);
      } else {
        const f = failure || {
          message: msg.message || `mctl exited with ${msg.exitCode}`,
          code: 'MCTL_FAILED',
        };
        notify(id, 'Download failed', f.message, f.code);
        settle('!', BADGE.failed);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    if (finished) return;
    const reason =
      (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
      'the host disconnected';
    const hint = /not found/i.test(reason)
      ? ' Run: mctl run chrome-bridge action=install'
      : '';
    notify(id, 'Download status lost', reason + hint, 'HOST_DISCONNECTED');
    settle('!', BADGE.failed);
  });
  port.postMessage({ action, url });
}
