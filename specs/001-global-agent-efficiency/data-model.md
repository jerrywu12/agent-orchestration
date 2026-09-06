# Data model
Run record: unique directory; raw combined output; metadata containing executable basename, cwd, exit status, elapsed seconds, raw/display byte counts (not billing tokens). Private permissions, no argv/credentials in metadata.
Install record: per-target path, before backup/mode, after hash, generation; no secrets in tracked source. Validate all targets before applying; unchanged rerun has no writes; rollback refuses drift.
Provider result: bounded prompt + explicit provider/model; text and usage if provider returns it; failures never interpreted as advice. No repo edits or execution of generated calls.
