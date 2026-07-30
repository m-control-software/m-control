# Plugin Contract

This document defines how plugins work in m-control. All plugins (TypeScript internal or external polyglot) must adhere to this contract.

## 🎯 What is a Plugin?

A **plugin** is a self-contained tool that performs a specific task. Examples:
- Generate Azure DevOps PR review
- Inspect Kubernetes pods
- Launch Obsidian note
- Commit with smart message

## 📋 Plugin Types

### Type 1: Internal (TypeScript)
**Location:** `src/plugins/category/tool-name/`  
**Execution:** In-process (same Node.js runtime)  
**Communication:** Direct function call

**Pros:**
- Fast (no process spawn)
- Easy debugging
- Shared dependencies

**Cons:**
- Crash can affect orchestrator
- Limited to TypeScript/JavaScript

### Type 2: External (Polyglot)
**Location:** `tools/category/tool-name/` (or standalone binary)  
**Execution:** Child process (spawned)  
**Communication:** JSON via stdin/stdout or temp files

**Pros:**
- Any language (Python, .NET, Go, etc.)
- Process isolation (crash-safe)
- Can be pre-compiled binaries

**Cons:**
- Slower (process spawn overhead)
- More complex error handling

---

## 📦 Plugin Structure

### Internal Plugin (TypeScript)
```
src/plugins/
  category/              # e.g., "azdo", "k8s", "git"
    tool-name/           # e.g., "pr-review", "pod-inspector"
      manifest.json      # Metadata
      index.ts           # Entry point
      README.md          # Documentation
      lib/               # Optional: helper modules
      test.spec.ts       # Optional: tests
```

### External Plugin (Python example)
```
tools/
  category/
    tool-name/
      manifest.json
      main.py            # Entry point
      requirements.txt   # Dependencies
      README.md
```

---

## 📄 Manifest Format

Every plugin MUST have `manifest.json`:

```json
{
  "id": "azdo-pr-review",
  "name": "Azure DevOps PR Review",
  "version": "0.1.0",
  "description": "Generate AI-powered PR review for Azure DevOps",
  "category": "azdo",
  "type": "internal",
  "author": "Michał",
  "requiredConfig": ["azdo.token", "azdo.organization"],
  "platform": ["win32", "linux", "darwin"],
  "executable": "node",
  "entryPoint": "index.js"
}
```

### Manifest Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | Yes | string | Unique identifier (kebab-case) |
| `name` | Yes | string | Display name |
| `version` | Yes | string | Semantic version (x.y.z) |
| `description` | Yes | string | What this plugin does |
| `category` | Yes | string | Group name (for TUI) |
| `type` | Yes | enum | "internal" or "external" |
| `author` | No | string | Plugin author |
| `requiredConfig` | No | string[] | Dot-notation config keys needed |
| `platform` | No | string[] | Supported platforms (default: all) |
| `executable` | Conditional | string | For external: "python", "dotnet", etc. |
| `entryPoint` | Conditional | string | For external: script/binary path |

**Conditional fields:**
- `executable` + `entryPoint`: Required for `type: "external"`
- Not needed for `type: "internal"` (always Node.js)

---

## 🔌 Internal Plugin Contract

### Entry Point (index.ts)

Must export async function named `execute`:

```typescript
export async function execute(context?: PluginContext): Promise<void> {
  // Implementation
}
```

### PluginContext (Future)
```typescript
interface PluginContext {
  getConfig<T>(key: string): T;
  log(level: string, message: string, data?: any): void;
  // Future: getAuth(), trackEvent(), etc.
}
```

### Error Handling
```typescript
export async function execute(): Promise<void> {
  try {
    // Do work
  } catch (error) {
    throw new ToolError(
      'User-friendly message',
      'ERROR_CODE',
      isRecoverable
    );
  }
}
```

### Example: Hello World
```typescript
// src/plugins/misc/hello-world/index.ts
export async function execute(): Promise<void> {
  console.log('Hello World!');
}
```

---

## 🌐 External Plugin Contract

### Communication Protocol

**Option A: JSON via temp files** (recommended)
```bash
tool --input /tmp/input.json --output /tmp/output.json
```

**Input format:**
```json
{
  "toolId": "k8s-pod-inspector",
  "params": {
    "namespace": "production",
    "podPattern": "api-*"
  },
  "config": {
    "defaultContext": "prod-cluster"
  }
}
```

**Output format:**
```json
{
  "success": true,
  "data": {
    "pods": [...]
  },
  "error": null,
  "executionTime": 1234
}
```

**Exit codes:**
- `0`: Success
- `1`: User error (bad input, missing config)
- `2`: System error (network, API failure)

### Example: Python Plugin
```python
# tools/k8s/pod-inspector/main.py
import json
import sys
import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    # Read input
    with open(args.input) as f:
        data = json.load(f)
    
    # Execute
    try:
        result = inspect_pods(data['params'])
        output = {
            'success': True,
            'data': result,
            'error': None
        }
    except Exception as e:
        output = {
            'success': False,
            'data': None,
            'error': str(e)
        }
    
    # Write output
    with open(args.output, 'w') as f:
        json.dump(output, f)
    
    sys.exit(0 if output['success'] else 1)

if __name__ == '__main__':
    main()
```

---

## 🎨 Plugin Lifecycle

### 1. Discovery
- Internal: Load from registry (`src/commands/index.ts`)
- External: Scan directory or registry (future)

### 2. Validation
- Check manifest exists
- Verify required config present
- Check platform compatibility

### 3. Execution
- Internal: Direct function call
- External: Spawn child process

### 4. Cleanup
- Internal: N/A (same process)
- External: Terminate process, delete temp files

---

## ✅ Plugin Best Practices

### DO:
- ✅ Validate inputs early
- ✅ Provide clear error messages
- ✅ Handle partial failures gracefully
- ✅ Log important events
- ✅ Make idempotent when possible
- ✅ Document required config

### DON'T:
- ❌ Crash on missing optional config
- ❌ Access orchestrator internals (internal plugins)
- ❌ Assume specific OS/environment
- ❌ Leave temp files behind (external plugins)
- ❌ Block indefinitely without timeout
- ❌ Log sensitive data (tokens, passwords)

---

## 🔐 Security Considerations

### Config Access
- Plugins receive ONLY their required config
- Never pass full config object
- Orchestrator filters by `requiredConfig` field

### Network Access
- Internal plugins: Can make HTTP calls directly
- External plugins: Should receive pre-authenticated clients (future)

### File System
- Plugins should work in temp directories
- Use context.getTempDir() for working files (future)
- Clean up after execution

---

## 🧪 Testing Plugins

### Internal Plugin Test
```typescript
import { execute } from './index';

describe('hello-world', () => {
  it('should print hello world', async () => {
    const spy = jest.spyOn(console, 'log');
    await execute();
    expect(spy).toHaveBeenCalledWith('Hello World!');
  });
});
```

### External Plugin Test
```bash
# Create test input
echo '{"toolId":"test","params":{},"config":{}}' > input.json

# Run plugin
python main.py --input input.json --output output.json

# Verify output
cat output.json | jq '.success' # Should be true
```

---

## 🚀 Plugin Development Workflow

### 1. Create from Template
```bash
cp -r templates/node-tool tools/<category>/<tool-id>
```

### 2. Edit Manifest
Update `manifest.json` with plugin details.

### 3. Implement Logic
Write code in `index.ts` (or main.py, etc.)

### 4. Test Locally
```bash
npm run dev new-tool
```

### 5. Register (Internal)
Add to `src/commands/index.ts`:
```typescript
import { execute as newTool } from '../plugins/category/new-tool';

export const commandGroups = [
  {
    name: 'Category',
    commands: [
      {
        id: 'new-tool',
        name: 'New Tool',
        description: 'Does something cool',
        handler: newTool
      }
    ]
  }
];
```

### 6. Build & Deploy
```bash
npm run build
```

---

## 🔄 Plugin Versioning

### Semantic Versioning
- **Major (1.0.0):** Breaking changes (API change, remove feature)
- **Minor (0.1.0):** New features (backward compatible)
- **Patch (0.0.1):** Bug fixes

### Compatibility
- Orchestrator checks `manifest.version`
- Warns if plugin version incompatible (future)
- Migration tools for config changes (future)

---

## 📚 Related Docs

- [Execution Model](execution-model.md) - How plugins are executed
- [Context Model](context-model.md) - How context flows
- [Constraints](constraints.md) - What plugins must NOT do

---

**Last updated:** 2025-02-18  
**Next review:** After plugin architecture implementation
