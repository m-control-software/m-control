/**
 * chrome-bridge actions: the hard-coded allowlist and its URL rules (ADR-0014).
 *
 * One file, two users: the extension's service worker (importScripts) refuses a
 * tab early so nothing is spawned, and the native messaging host (require),
 * which is the security boundary, re-checks every message with the same rules.
 * There is no generic "run any tool" action: each entry maps to exactly one
 * `mctl run` argument list, built from a URL the host has rebuilt itself.
 */

'use strict';

(function (root) {
  /** Hosts the yt-audio action accepts, exactly (no subdomain wildcards). */
  const YOUTUBE_HOSTS = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
  ];
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

  class Rejected extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  /**
   * A YouTube / YouTube Music video URL -> its canonical form with only the
   * video id (`&list=`, `&t=`, `&si=` … dropped, so a playlist URL saves only
   * that track). Throws Rejected for anything else.
   */
  function youtubeVideo(raw) {
    let url;
    try {
      url = new URL(String(raw));
    } catch {
      throw new Rejected(
        `Not a URL: ${String(raw).slice(0, 200)}`,
        'URL_INVALID'
      );
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Rejected(
        `Only http(s) YouTube pages, not ${url.protocol} URLs.`,
        'URL_NOT_ALLOWED'
      );
    }
    const host = url.hostname.toLowerCase();
    if (
      !YOUTUBE_HOSTS.includes(host) ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new Rejected(
        `${host || 'This page'} is not YouTube or YouTube Music (${YOUTUBE_HOSTS.join(', ')}).`,
        'URL_NOT_ALLOWED'
      );
    }
    let id;
    if (host === 'youtu.be') {
      id = url.pathname.slice(1);
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v') || '';
    } else {
      const m = /^\/(?:shorts|live)\/([^/]+)\/?$/.exec(url.pathname);
      id = m ? m[1] : '';
    }
    if (!VIDEO_ID.test(id)) {
      throw new Rejected(
        'This YouTube page is not a single video or track (open the video itself, not a playlist or channel).',
        'NOT_A_VIDEO'
      );
    }
    const base =
      host === 'music.youtube.com'
        ? 'https://music.youtube.com'
        : 'https://www.youtube.com';
    return `${base}/watch?v=${id}`;
  }

  /**
   * The allowlist. `validate(url)` returns the URL the host passes on;
   * `args(url)` is the complete `mctl` argument list for it (no shell).
   */
  const ACTIONS = {
    'yt-audio': {
      title: 'Save as mp3',
      validate: youtubeVideo,
      args: (url) => [
        'run',
        'yt-download',
        `url=${url}`,
        'format=audio',
        '--json',
      ],
    },
  };

  /** {action, url} -> {action, url, args}; throws Rejected. */
  function resolve(message) {
    if (!message || typeof message !== 'object') {
      throw new Rejected(
        'Expected a message {action, url}.',
        'MESSAGE_INVALID'
      );
    }
    const action = Object.prototype.hasOwnProperty.call(ACTIONS, message.action)
      ? ACTIONS[message.action]
      : undefined;
    if (!action) {
      throw new Rejected(
        `Unknown action ${JSON.stringify(message.action)}. Allowed: ${Object.keys(ACTIONS).join(', ')}.`,
        'ACTION_NOT_ALLOWED'
      );
    }
    const url = action.validate(message.url);
    return { action: message.action, url, args: action.args(url) };
  }

  const api = { ACTIONS, Rejected, YOUTUBE_HOSTS, resolve, youtubeVideo };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.chromeBridgeActions = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
