# Roadmap

## Metadata repair (fsck)

If `.meta` files are lost or corrupted, there's no way to recover.
Add a repair command that rebuilds metadata from OPFS state — scanning
actual files/directories and reconstructing `.meta` entries with
sensible defaults.

## usage() incremental tracking

`usage()` does a full recursive tree walk on every call.
Track file count and total size incrementally in root metadata,
updating on write/delete, so `usage()` becomes a constant-time read.
