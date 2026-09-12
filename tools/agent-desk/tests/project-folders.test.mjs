import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectProjectFolder,
  listProjectFolders,
  pickProjectFolder,
  githubRepoFromRemote,
} from "../server/project-folders.mjs";
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "desk-folders-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test("inspection resolves Git root and safe remote preserving dirty checkout", async (t) => {
  const root = fixture(t),
    sub = join(root, "src");
  mkdirSync(sub);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init", "--initial-branch=main");
  git(
    "remote",
    "add",
    "origin",
    "https://user:password@github.com/owner/project.git",
  );
  writeFileSync(join(root, "pending.txt"), "user work");
  const before = git("status", "--porcelain");
  const result = await inspectProjectFolder(sub, [
    { id: "existing", path: root },
  ]);
  assert.equal(result.path, root);
  assert.equal(result.repo, "owner/project");
  assert.equal(result.git.hasHead, false);
  assert.equal(result.git.dirty, true);
  assert.equal(result.existingProjectId, "existing");
  assert.equal(git("status", "--porcelain"), before);
  assert.doesNotMatch(JSON.stringify(result), /password|user:/);
});
test("browse is bounded, skips hidden/symlink entries and handles non-Git", async (t) => {
  const root = fixture(t);
  for (const name of ["a", "b", ".hidden"]) mkdirSync(join(root, name));
  symlinkSync(join(root, "a"), join(root, "link"));
  const list = await listProjectFolders(root, { maxEntries: 1 });
  assert.equal(list.directories.length, 1);
  assert.equal(list.truncated, true);
  assert.equal(list.directories[0].name, "a");
  const inspection = await inspectProjectFolder(join(root, "b"));
  assert.equal(inspection.git.isRepository, false);
  assert.equal(inspection.repo, "");
  await assert.rejects(() => inspectProjectFolder("relative"), /absolute/i);
});
test("picker cancellation and safe remote parsing", async () => {
  assert.deepEqual(
    await pickProjectFolder({ platform: "darwin", choose: async () => null }),
    { cancelled: true },
  );
  await assert.rejects(
    () => pickProjectFolder({ platform: "linux" }),
    /picker/i,
  );
  assert.equal(
    githubRepoFromRemote("git@github.com:owner/repo.git"),
    "owner/repo",
  );
  assert.equal(
    githubRepoFromRemote("ssh://git@github.com/owner/repo.git"),
    "owner/repo",
  );
  assert.equal(githubRepoFromRemote("https://evil.test/owner/repo"), "");
  assert.equal(
    githubRepoFromRemote("https://github.com/owner/repo.git?token=secret"),
    "",
  );
});
test("legacy project registered at subdirectory reuses its canonical repository", async (t) => {
  const root = fixture(t),
    sub = join(root, "src");
  mkdirSync(sub);
  execFileSync("git", ["-C", root, "init", "--initial-branch=main"], {
    stdio: "pipe",
  });
  assert.equal(
    (await inspectProjectFolder(root, [{ id: "legacy", path: sub }]))
      .existingProjectId,
    "legacy",
  );
});
