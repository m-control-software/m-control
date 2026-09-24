"""Structural diff of two settings documents, readable by a human.

Arrays of records are matched by a natural key (slotId, applicationId, ...)
so a moved element is not reported as a rewrite; arrays of plain strings
(profile_keys) are compared as sets.
"""
from __future__ import annotations

import json

ARRAY_KEYS = ("slotId", "applicationId", "udid", "id", "presetName", "slotPrefix")
# Paths the agent rewrites on its own: token refresh, app run times, firmware
# checks, icon cache (observed in idle and restart control diffs).
NOISY_PREFIXES = ("iconsLocalPathCache", "applications.applications[", "analytics", "offer_redemption",
                  "next_star_rating_check", "macro_usage_last_log_time", "dfu/", "battery",
                  "accounts_refresh_token_expiration")


def _keyed(arr: list):
    if not arr or not all(isinstance(x, dict) for x in arr):
        return None
    for k in ARRAY_KEYS:
        vals = [x.get(k) for x in arr]
        if all(v is not None for v in vals) and len(set(map(str, vals))) == len(vals):
            return k, {str(x[k]): x for x in arr}
    return None


def walk(a, b, path: str, out: list) -> None:
    """Append (op, path, before, after) tuples; op is '+', '-' or '~'."""
    if type(a) is not type(b):
        out.append(("~", path, a, b))
        return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            p = f"{path}.{k}" if path else k
            if k not in a:
                out.append(("+", p, None, b[k]))
            elif k not in b:
                out.append(("-", p, a[k], None))
            else:
                walk(a[k], b[k], p, out)
        return
    if isinstance(a, list):
        if all(isinstance(x, str) for x in a + b):
            out += [("-", f"{path}[{x!r}]", x, None) for x in a if x not in b]
            out += [("+", f"{path}[{x!r}]", None, x) for x in b if x not in a]
            return
        ka, kb = _keyed(a), _keyed(b)
        if ka and kb and ka[0] == kb[0]:
            name, ma, mb = ka[0], ka[1], kb[1]
            for k in list(ma) + [k for k in mb if k not in ma]:
                p = f"{path}[{name}={k}]"
                if k not in mb:
                    out.append(("-", p, ma[k], None))
                elif k not in ma:
                    out.append(("+", p, None, mb[k]))
                else:
                    walk(ma[k], mb[k], p, out)
            return
        for i in range(max(len(a), len(b))):
            p = f"{path}[{i}]"
            if i >= len(a):
                out.append(("+", p, None, b[i]))
            elif i >= len(b):
                out.append(("-", p, a[i], None))
            else:
                walk(a[i], b[i], p, out)
        return
    if a != b:
        out.append(("~", path, a, b))


def fmt(v, n: int = 160) -> str:
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + f"... ({len(s)} chars)"


def describe(before: dict, after: dict, include_noise: bool = False, limit: int = 80) -> list[str]:
    out: list = []
    walk(before, after, "", out)
    if not include_noise:
        out = [d for d in out if not d[1].startswith(NOISY_PREFIXES)]
    lines = [f"{op} {path}: {fmt(vb if op != '-' else va)}" for op, path, va, vb in out[:limit]]
    if len(out) > limit:
        lines.append(f"... {len(out) - limit} more")
    return lines
