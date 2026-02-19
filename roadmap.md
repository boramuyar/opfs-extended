# Roadmap

## ~~Metadata repair (fsck)~~ ✓

Implemented. `root.fsck()` recursively scans OPFS state and rebuilds
`.meta` entries. `createRoot(name, { autoRepair: true })` runs it
automatically on mount.

## usage() incremental tracking

`usage()` does a full recursive tree walk on every call.
Track file count and total size incrementally in root metadata,
updating on write/delete, so `usage()` becomes a constant-time read.
