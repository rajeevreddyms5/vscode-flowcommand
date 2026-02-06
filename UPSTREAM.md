# Upstream Tracking

This fork is based on [4regab/TaskSync](https://github.com/4regab/TaskSync).

## Current Fork Status

| Property | Value |
|----------|-------|
| **Upstream Repository** | https://github.com/4regab/TaskSync |
| **Upstream Latest Commit** | `b6bacf86c0d27ab978788a521c3174e2184cbea3` (2026-01-06) |
| **Last Sync Check** | 2026-01-06 |
| **Fork Version** | 2.0.12 |

## Custom Features (This Fork)

These features are additions to the original TaskSync:

1. **Remote Server Improvements**
   - Enhanced theme toggle (light/dark) for remote UI
   - Stable connection handling (removed aggressive reconnection)
   - Terminal auto-select on initial load
   - Comprehensive CSS theming for remote tabs/file browser/output

2. **Bug Fixes Applied**
   - Fixed esbuild externals for socket.io/engine.io/ws
   - Fixed syntax errors in remote UI JavaScript
   - Added missing `maxReconnectAttempts` variable
   - Removed connection health check causing reconnection loop

## Custom Files/Changes

Files with significant modifications:
- `src/server/remoteUiServer.ts` - Remote UI theming, connection stability
- `esbuild.js` - Added socket.io to externals

## How to Sync with Upstream

### 1. Check for Updates

```bash
# Add upstream remote (one-time)
git remote add upstream https://github.com/4regab/TaskSync.git

# Fetch latest from upstream
git fetch upstream

# Compare with upstream
git log --oneline HEAD..upstream/main
```

### 2. Review Changes

Before merging, review what changed in upstream:
```bash
# See files changed
git diff HEAD...upstream/main --name-only

# See detailed diff for specific file
git diff HEAD...upstream/main -- src/server/remoteUiServer.ts
```

### 3. Safe Merge Strategy

```bash
# Create a sync branch
git checkout -b sync-upstream-$(date +%Y%m%d)

# Merge upstream (will likely have conflicts in our custom files)
git merge upstream/main

# Resolve conflicts - keep our custom additions while incorporating upstream changes
# Edit conflicted files, then:
git add .
git commit -m "sync: merge upstream changes (commit XXXXX)"
```

### 4. Test After Sync

After merging:
1. Run `npm run build` - ensure no compilation errors
2. Test remote server connection
3. Test theme toggle (light/dark mode)
4. Test terminal auto-select
5. Verify our custom features still work

### 5. Update This File

After successful sync, update:
- **Forked From Commit**: new upstream commit hash
- **Last Sync Check**: today's date

## Conflict Resolution Guide

When conflicts occur in our custom files:

### `remoteUiServer.ts`
- **Keep**: All `body.light-theme` CSS blocks we added
- **Keep**: Simplified `visibilitychange` handler
- **Keep**: Removed health check interval
- **Merge**: Any new upstream functionality

### `esbuild.js`
- **Keep**: Our externals array: `['vscode', 'socket.io', 'engine.io', 'ws', 'bufferutil', 'utf-8-validate']`
- **Merge**: Any new build configuration from upstream

## Automated Check (Optional)

Add this to your CI or run manually:

```bash
#!/bin/bash
# check-upstream.sh

git fetch upstream 2>/dev/null

LOCAL=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse upstream/main)
BASE=$(git merge-base HEAD upstream/main)

if [ "$UPSTREAM" = "$BASE" ]; then
    echo "✅ Fork is up-to-date with upstream"
elif [ "$LOCAL" = "$BASE" ]; then
    echo "⚠️  Upstream has new changes - consider syncing"
    echo "   Run: git log --oneline HEAD..upstream/main"
else
    echo "🔀 Fork has diverged from upstream - manual merge needed"
fi
```
