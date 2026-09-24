# Anti-Patterns

**Things we tried that didn't work.** Learn from these mistakes so we don't repeat them.

## 🎯 Purpose

This document captures:
- Failed approaches and why they failed
- Common pitfalls to avoid
- Lessons learned the hard way

**Format:** Each entry explains the mistake, why it's bad, and what to do instead.

---

## ❌ Don't Use console.log for Logging

### What We Did
Used `console.log()` and `console.error()` throughout the codebase for logging events and errors.

### Why It Failed
1. **No structure** - Impossible to search logs effectively
2. **No context** - Missing crucial info (user ID, timestamp, etc.)
3. **No filtering** - Can't separate debug from error logs
4. **Production debugging nightmare** - No way to aggregate or analyze

### What to Do Instead
Use structured logger with log levels:

```typescript
// ❌ BAD
console.log('User authenticated');
console.error('Auth failed:', error);

// ✅ GOOD
logger.info('User authenticated', { userId: 'abc', method: 'token' });
logger.error('Authentication failed', { 
  userId: 'abc', 
  error: error.message, 
  code: error.code 
});
```

**Status:** Partially fixed (logger abstraction planned for v0.2.0)

---

## ❌ Don't Hardcode Config Paths

### What We Did
Initially hardcoded config path as `C:\Users\Michal\.m-control\config.json`.

### Why It Failed
1. **Not cross-platform** - Breaks on Linux/Mac
2. **Not multi-user** - Assumes specific username
3. **Not testable** - Can't mock config location

### What to Do Instead
Use platform-specific logic with env vars:

```typescript
// ❌ BAD
const CONFIG_PATH = 'C:\\Users\\Michal\\.m-control\\config.json';

// ✅ GOOD
const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.USERPROFILE || os.homedir(), '.m-control')
  : path.join(os.homedir(), '.m-control');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
```

**Status:** Fixed in v0.1.0

---

## ❌ Don't Store Config Template as External File

### What We Did
Initially stored `config.template.json` as a separate file and tried to read it at runtime.

### Why It Failed
1. **Build complexity** - Had to ensure file copied to dist/
2. **Path issues** - Relative paths broke after bundling
3. **Distribution** - Extra file to manage

### What to Do Instead
Embed template as JavaScript constant:

```typescript
// ❌ BAD
const template = fs.readFileSync('config/template.json', 'utf-8');

// ✅ GOOD
const CONFIG_TEMPLATE = {
  version: '0.1.0',
  tools: {}
};
```

**Status:** Fixed in v0.1.0. The unused `config/config.template.json` lingered
(copied by the installers, read by nothing) until 2026-09-24, when it was
removed and the embedded template lost its tool sections: `tools` is an open
schema, so core ships no tool keys.

---

## ❌ Don't Use Shebang in TypeScript Source

### What We Did
Added `#!/usr/bin/env node` at the top of `src/index.ts`.

### Why It Failed
1. **Double shebang** - Compiled JS had shebang, then bundler added another
2. **Syntax error** - Node couldn't parse the file

### What to Do Instead
Add shebang only during bundling:

```javascript
// scripts/bundle.js
const content = fs.readFileSync(bundlePath, 'utf-8');
const withShebang = `#!/usr/bin/env node\n${content}`;
fs.writeFileSync(bundlePath, withShebang);
```

**Status:** Fixed in v0.1.0

---

## ❌ Don't Hardcode Command Lists

### What We Almost Did
Considered hardcoding command list in `index.ts` without registry pattern.

### Why It Would Fail
1. **Scaling issue** - Every new command = modify core
2. **No plugin system** - Can't add commands dynamically
3. **Testing difficulty** - Hard to test individual commands
4. **Tight coupling** - Commands coupled to orchestrator

### What to Do Instead
Use command registry pattern:

```typescript
// ❌ BAD (hypothetical)
if (command === 'hello-world') {
  await helloWorld();
} else if (command === 'azdo-review') {
  await azdoReview();
}

// ✅ GOOD
const command = findCommand(commandId);
await command.handler();
```

**Status:** Implemented correctly from start (learned from other projects)

---

## ❌ Don't Ignore TypeScript Lib Config

### What We Did
Initially set `"lib": ["ES2022"]` in tsconfig which broke `console` type.

### Why It Failed
1. **Missing Node.js types** - `console` not recognized
2. **IDE errors** - Red squiggles everywhere
3. **Confusion** - Works at runtime but IDE complains

### What to Do Instead
Either remove `lib` (use defaults) or include proper libs:

```json
// ❌ BAD
{
  "lib": ["ES2022"]  // Too restrictive for Node.js
}

// ✅ GOOD
{
  // Omit lib - TypeScript will use defaults for target + @types/node
}
```

**Status:** Fixed in v0.1.0

---

## ❌ Don't Put All Commands in One Category

### What We Might Do
Put every command in "Misc" or "Tools" category.

### Why It Would Fail
1. **Poor UX** - Long list of unrelated commands
2. **No organization** - Hard to find what you need
3. **Cognitive overload** - Too many choices

### What to Do Instead
Group commands by domain/purpose:

```typescript
// ❌ BAD
{
  name: 'Tools',
  commands: [
    'hello-world',
    'azdo-review',
    'k8s-logs',
    'obsidian-open',
    'git-commit',
    // ... 50 more
  ]
}

// ✅ GOOD
[
  { name: 'AZDO', commands: ['pr-review', 'work-items'] },
  { name: 'K8s', commands: ['logs', 'pods', 'describe'] },
  { name: 'Git', commands: ['smart-commit', 'pr-template'] },
  { name: 'Misc', commands: ['hello-world'] }
]
```

**Status:** Best practice established, not yet enforced (only 1 command so far)

---

## ❌ Don't Assume Users Have Knowledge of Internal Structure

### What We Might Do
Show error: "Plugin not found in registry"

### Why It Would Fail
1. **User confusion** - What's a registry? What's a plugin?
2. **Not actionable** - User doesn't know how to fix
3. **Poor UX** - Technical jargon in user-facing message

### What to Do Instead
User-friendly error messages:

```typescript
// ❌ BAD
throw new Error('Plugin "azdo-review" not found in registry');

// ✅ GOOD
throw new Error(
  'Unknown command: azdo-review\n' +
  'Run "mctl --help" to see available commands.'
);
```

**Status:** Best practice established, to be enforced in all error messages

---

## ❌ Don't Skip Input Validation

### What We Might Do
Assume input is always valid.

### Why It Would Fail
1. **Runtime errors** - Crashes on invalid input
2. **Security issues** - Injection vulnerabilities
3. **Poor UX** - Cryptic error messages from deep in call stack

### What to Do Instead
Validate at boundaries (early):

```typescript
// ❌ BAD
function processPR(prId) {
  // Assumes prId is valid number
  return api.fetch(`/pullrequests/${prId}`);
}

// ✅ GOOD
function processPR(prId: unknown): Promise<PR> {
  if (typeof prId !== 'number' || prId <= 0) {
    throw new Error('PR ID must be a positive number');
  }
  return api.fetch(`/pullrequests/${prId}`);
}
```

**Status:** Best practice established, to be consistently applied

---

## ❌ Don't Make Breaking Config Changes Without Migration

### What We Must Not Do
Change config schema and expect users to manually fix their config.

### Why It Would Fail
1. **Lost data** - Users lose their configuration
2. **Frustration** - Manual fixes are annoying
3. **Support burden** - Users open issues about "broken config"

### What to Do Instead
Config migrations:

```typescript
function loadConfig(): Config {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  // Migrate if needed
  if (raw.version === '1.0.0') {
    return migrateV1ToV2(raw);
  }
  
  return raw;
}

function migrateV1ToV2(old: ConfigV1): ConfigV2 {
  return {
    version: '2.0.0',
    tools: {
      azdo: old.azdo, // Preserve
      k8s: { defaultContext: '' } // Add new field with default
    }
  };
}
```

**Status:** No migrations yet (only v0.1.0), but pattern established for future

---

## 📝 Template for New Entries

When adding new anti-pattern:

```markdown
## ❌ Don't [Anti-Pattern Title]

### What We Did
Description of the mistake.

### Why It Failed
1. Reason 1
2. Reason 2

### What to Do Instead
Correct approach with code example.

**Status:** [Fixed in vX.Y.Z | Ongoing | Best practice established]
```

---

## 🔄 Maintaining This Document

**Add entry when:**
- Something failed in practice (not hypothetical)
- Mistake was made and fixed
- Pattern found to be problematic

**Don't add:**
- Hypothetical issues
- Subjective style preferences
- Things that didn't actually happen

---

**Last updated:** 2025-02-18  
**Next review:** When major mistakes occur (hopefully never!)
