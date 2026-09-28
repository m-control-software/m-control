/**
 * m-control bridge: service worker (Manifest V3).
 *
 * The command (suggested Ctrl+Shift+Y, which the Actions Ring item sends) and
 * the toolbar button read the active tab's URL (the command grants activeTab),
 * check it against the same allowlist the host enforces, and hand it to the
 * native messaging host. Progress goes on the badge and a toast in the page;
 * the result or the error (message and code) goes in the toast and in one
 * notification per job.
 */

'use strict';

/* global chrome, importScripts, document -- a service worker; document only inside showToast, which runs in the page */
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

/**
 * The same news on the page itself, bottom right: Windows can silence Chrome's
 * notifications (Focus Assist, per-app settings) and the badge is only visible
 * when the extension is pinned. Runs in the tab the command or button was used
 * on, which activeTab allows; pages it can't script (chrome://) are skipped.
 */
function toast(tabId, text, kind) {
  if (tabId === undefined) return;
  chrome.scripting
    .executeScript({ target: { tabId }, func: showToast, args: [text, kind] })
    .catch(() => {});
}

function showToast(text, kind) {
  const id = 'm-control-bridge-toast';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    Object.assign(el.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      maxWidth: '380px',
      padding: '10px 14px',
      borderRadius: '8px',
      color: '#fff',
      font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,.45)',
      whiteSpace: 'pre-line',
      cursor: 'pointer',
    });
    el.title = 'Click to dismiss';
    el.addEventListener('click', () => el.remove());
    document.documentElement.appendChild(el);
  }
  el.style.background = { ok: '#188038', error: '#d93025' }[kind] || '#1a73e8';
  el.textContent = text;
  clearTimeout(Number(el.dataset.timer));
  if (kind !== 'busy') {
    el.dataset.timer = String(setTimeout(() => el.remove(), 7000));
  } else {
    // Nobody may be left to update it (the extension was reloaded, the service
    // worker restarted): after 5 minutes without news, say so and go away. A
    // long mix's silent mp3 conversion takes ~3-4 minutes.
    el.dataset.timer = String(
      setTimeout(() => {
        el.style.background = '#5f6368';
        el.textContent = `${text}\nNo news for 5 minutes. The download may still finish; check Downloads.`;
        el.dataset.timer = String(setTimeout(() => el.remove(), 15000));
      }, 300000)
    );
  }
}

/** One job's news: a notification (replaced in place by id) plus the page toast. */
function tell(job, title, message, context, kind) {
  notify(job.id, title, message, context);
  const code = context && kind === 'error' ? ` (${context})` : '';
  toast(job.tabId, `${title}\n${message}${code}`, kind);
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
  const current = await activeTab(tab);
  const url = current && current.url;
  const job = { id: `job-${Date.now()}`, tabId: current && current.id };
  try {
    resolve({ action, url }); // the host checks again; this only avoids a spawn
  } catch (err) {
    if (!(err instanceof Rejected)) throw err;
    tell(job, 'Not saved', err.message, err.code, 'error');
    return;
  }

  jobs += 1;
  badge('…', BADGE.busy);
  // The tab title is only a placeholder: YouTube updates it after the URL when
  // you move to another video, so it can name the previous one. yt-download's
  // own messages carry the real title and replace it as soon as they arrive.
  let title = (current.title || url)
    .replace(/^\(\d+\) /, '') // YouTube's unread-notification counter
    .replace(/ - YouTube( Music)?$/, '');
  tell(job, `${ACTIONS[action].title}…`, title, 'm-control: started', 'busy');
  let finished = false;
  let saved = [];
  let failure;

  const port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    if (msg.type === 'rejected') {
      finished = true;
      tell(job, 'Not saved', msg.message, msg.code, 'error');
      settle('!', BADGE.failed);
    } else if (msg.type === 'event') {
      const e = msg.event || {};
      const p = e.payload || {};
      if (e.type === 'log') {
        const text = p.message || '';
        const named = /^Downloading: (.+) \[[\w-]{11}\]$/.exec(text);
        const m = /^(.+): (\d{1,3})% of /.exec(text);
        if (named) title = named[1];
        if (m) {
          title = m[1];
          badge(`${m[2]}%`, BADGE.busy);
        }
        // After the download, ffmpeg converts without reporting progress; a long
        // mix can take minutes, so say so instead of freezing at the last %.
        const converting = /^Processing: /.test(text);
        if (named || m || converting) {
          const state = converting
            ? ' converting to mp3'
            : m
              ? ` ${m[2]}%`
              : '';
          toast(
            job.tabId,
            `${ACTIONS[action].title}…${state}\n${title}`,
            'busy'
          );
        }
        if (converting) badge('mp3', BADGE.busy);
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
        tell(job, 'Saved as mp3', names.join('\n'), saved[0], 'ok');
        settle('✓', BADGE.ok);
      } else {
        const f = failure || {
          message: msg.message || `mctl exited with ${msg.exitCode}`,
          code: 'MCTL_FAILED',
        };
        tell(job, 'Download failed', f.message, f.code, 'error');
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
    tell(
      job,
      'Download status lost',
      reason + hint,
      'HOST_DISCONNECTED',
      'error'
    );
    settle('!', BADGE.failed);
  });
  port.postMessage({ action, url });
}
