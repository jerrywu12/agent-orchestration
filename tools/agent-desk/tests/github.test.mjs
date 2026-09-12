import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  GitHubClient,
  GitHubError,
  createGhRequest,
  issueSnapshot,
  reconcileIssue,
  discoverWorkflowStatus,
  projectStatusRole,
} from "../server/github.mjs";

const repo = "octo/work";
const raw = (number, extra = {}) => ({
  number,
  node_id: `I_${number}`,
  html_url: `https://github.com/${repo}/issues/${number}`,
  title: `Issue ${number}`,
  body: "Original description\n",
  labels: [{ name: "bug" }, { name: "owner:codex" }],
  state: "open",
  updated_at: "2026-09-12T00:00:00Z",
  ...extra,
});
const base = {
  title: "Title",
  description: "Body\n",
  labels: ["bug", "owner:codex"],
  state: "open",
};
const connection = (nodes, cursor = null) => ({
  nodes,
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
});

test("workflow discovery associates unique normalized exact names and refuses aliases or ambiguous identity", () => {
  const project = {
    statusFieldId: "FIELD",
    statusOptions: [
      { id: "B", name: " Backlog " },
      { id: "R", name: "READY" },
      { id: "A", name: "In   progress" },
      { id: "V", name: "In review" },
      { id: "D", name: "Done" },
      { id: "X", name: "Custom" },
    ],
  };
  assert.deepEqual(discoverWorkflowStatus(project), {
    backlog: "B",
    ready: "R",
    active: "A",
    review: "V",
    done: "D",
  });
  assert.equal(
    projectStatusRole(project, {
      fieldId: "FIELD",
      optionId: "A",
      name: "In progress",
    }),
    "active",
  );
  const rejects = (fn, code) =>
    assert.throws(
      fn,
      (error) =>
        error instanceof GitHubError && error.code === code && !error.retryable,
    );
  rejects(
    () => discoverWorkflowStatus({ ...project, statusFieldId: null }),
    "STATUS_FIELD_MISSING",
  );
  rejects(
    () =>
      discoverWorkflowStatus({
        ...project,
        statusOptions: project.statusOptions.map((o) =>
          o.id === "R" ? { ...o, name: "Planning" } : o,
        ),
      }),
    "STATUS_OPTIONS_MISSING",
  );
  rejects(
    () =>
      discoverWorkflowStatus({
        ...project,
        statusOptions: [
          ...project.statusOptions,
          { id: "B2", name: "BACKLOG" },
        ],
      }),
    "STATUS_OPTIONS_AMBIGUOUS",
  );
  rejects(
    () =>
      discoverWorkflowStatus({
        ...project,
        statusOptions: project.statusOptions.map((o) =>
          o.id === "R" ? { ...o, id: "B" } : o,
        ),
      }),
    "STATUS_OPTIONS_AMBIGUOUS",
  );
  for (const status of [
    null,
    { fieldId: "WRONG", optionId: "A" },
    { fieldId: "FIELD", optionId: "X", name: "Custom" },
    { fieldId: "FIELD", optionId: "MISSING", name: "Backlog" },
  ])
    rejects(() => projectStatusRole(project, status), "UNKNOWN_PROJECT_STATUS");
});

test("issue pagination counts raw pages, excludes PRs and retains repository identity", async () => {
  const calls = [];
  const client = new GitHubClient({
    request: async (method, endpoint) => {
      calls.push([method, endpoint]);
      if (
        new URL(endpoint, "https://api.github.com").searchParams.get("page") ===
        "1"
      )
        return Array.from({ length: 100 }, (_, n) =>
          raw(n + 1, n === 40 ? { pull_request: {} } : {}),
        );
      return [raw(101)];
    },
  });
  const issues = await client.listIssues(repo);
  assert.equal(issues.length, 100);
  assert.equal(
    issues.some((issue) => issue.number === 41),
    false,
  );
  assert.equal(issues.at(-1).repo, repo);
  assert.equal(issues.at(-1).nodeId, "I_101");
  assert.equal(issues[0].description, "Original description\n");
  assert.equal(calls.length, 2);
  assert.match(calls[0][1], /state=all/);
});

test("getIssue rejects pull requests and invalid repository paths", async () => {
  let calls = 0;
  const client = new GitHubClient({
    request: async () => {
      calls++;
      return raw(3, { pull_request: {} });
    },
  });
  await assert.rejects(client.getIssue(repo, 3), { code: "NOT_ISSUE" });
  await assert.rejects(client.getIssue("octo/work?bad=1", 3), {
    code: "INVALID_INPUT",
  });
  assert.equal(calls, 1);
});

test("create preserves exact text, marks stable identity and never assigns an agent as a GitHub login", async () => {
  let posted;
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      if (method === "GET") return [];
      posted = body;
      return raw(9, { ...body, labels: body.labels.map((name) => ({ name })) });
    },
  });
  const issue = await client.createIssue(repo, {
    id: "local:9",
    title: "$(literal title)",
    description: "  Exact text\n\n",
    ownerId: "hermes",
    labels: ["local-only"],
  });
  assert.equal(issue.agentDeskId, "local:9");
  assert.equal(issue.description, "  Exact text\n\n");
  assert.equal(posted.title, "$(literal title)");
  assert.equal(
    posted.body,
    "  Exact text\n\n\n\n<!-- agent-desk:ticket:local%3A9 -->",
  );
  assert.deepEqual(posted.labels, ["agent-desk", "owner:hermes"]);
  assert.equal(Object.hasOwn(posted, "assignees"), false);
});

test("a lost create response is reconciled by the exact marker, including closed issues", async () => {
  let saved = null;
  let writes = 0;
  const request = async (method, endpoint, body) => {
    if (method === "GET") return saved ? [saved] : [];
    writes++;
    saved = raw(22, {
      ...body,
      state: "closed",
      labels: body.labels.map((name) => ({ name })),
    });
    throw Object.assign(
      new Error("network failure with ghp_secret_do_not_expose"),
      { code: "ECONNRESET" },
    );
  };
  const ticket = { id: "stable-22", title: "Retry test", description: "Text" };
  assert.equal(
    (await new GitHubClient({ request }).createIssue(repo, ticket)).number,
    22,
  );
  assert.equal(
    (await new GitHubClient({ request }).createIssue(repo, ticket)).number,
    22,
  );
  assert.equal(writes, 1);
});

test("concurrent publish requests on the same client share one create operation", async () => {
  let writes = 0;
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      if (method === "GET") return [];
      writes++;
      return raw(5, { ...body, labels: body.labels });
    },
  });
  const ticket = { id: "same", title: "Same" };
  const [first, second] = await Promise.all([
    client.createIssue(repo, ticket),
    client.createIssue(repo, ticket),
  ]);
  assert.equal(first.number, second.number);
  assert.equal(writes, 1);
});

test("updates preserve exact remote body and unrelated labels while changing ownership", async () => {
  let current = raw(7, {
    title: base.title,
    body: "Remote added text\n\n",
    labels: ["bug", "help wanted", "owner:codex"],
  });
  const mutations = [];
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      if (method === "GET") return current;
      mutations.push({ method, endpoint, body });
      if (method === "POST" && endpoint.endsWith("/labels")) {
        current.labels.push(...body.labels, "added-concurrently");
        return current.labels.map((name) => ({ name }));
      }
      if (method === "DELETE") {
        current.labels = current.labels.filter(
          (name) => name !== decodeURIComponent(endpoint.split("/").at(-1)),
        );
        return current.labels.map((name) => ({ name }));
      }
      Object.assign(current, body);
      return current;
    },
  });
  const result = await client.updateIssue(
    repo,
    7,
    {
      title: base.title,
      description: base.description,
      labels: ["owner:claude", "local-only"],
    },
    base,
  );
  assert.equal(result.description, "Remote added text\n\n");
  assert.deepEqual(result.labels, [
    "added-concurrently",
    "bug",
    "help wanted",
    "owner:claude",
  ]);
  assert.equal(
    mutations.some((call) => call.method === "PATCH"),
    false,
  );
  assert.equal(
    mutations.some((call) => call.endpoint.endsWith("/labels/bug")),
    false,
  );
  assert.equal(
    mutations.some((call) => call.body?.assignees),
    false,
  );
});

test("intentional description edit preserves the marker and does not patch other fields", async () => {
  let patch;
  let current = raw(3, { body: "Old\n\n<!-- agent-desk:ticket:local-3 -->" });
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      if (method === "PATCH") {
        patch = body;
        current = { ...current, ...body };
      }
      return current;
    },
  });
  const result = await client.updateIssue(
    repo,
    3,
    { description: "New\n" },
    { ...issueSnapshot(current), description: "Old" },
  );
  assert.deepEqual(patch, {
    body: "New\n\n\n<!-- agent-desk:ticket:local-3 -->",
  });
  assert.equal(result.description, "New\n");
});

test("concurrent conflicting edit retains both snapshots and sends no mutation", async () => {
  const calls = [];
  const client = new GitHubClient({
    request: async (method) => {
      calls.push(method);
      return raw(3, { title: "Remote edit", body: base.description });
    },
  });
  await assert.rejects(
    client.updateIssue(repo, 3, { title: "Local edit" }, base),
    (error) => {
      assert.equal(error.code, "CONFLICT");
      assert.deepEqual(error.conflict.conflicts, ["title"]);
      assert.equal(error.conflict.local.title, "Local edit");
      assert.equal(error.conflict.remote.title, "Remote edit");
      return true;
    },
  );
  assert.deepEqual(calls, ["GET"]);
});

test("three-way reconciliation ignores unrelated labels and combines independent field edits", () => {
  assert.equal(
    reconcileIssue({
      local: base,
      remote: { ...base, labels: [...base.labels, "external"] },
      baseline: base,
    }).kind,
    "unchanged",
  );
  const result = reconcileIssue({
    local: { ...base, title: "Local title" },
    remote: {
      ...base,
      description: "Remote body",
      labels: [...base.labels, "external"],
    },
    baseline: base,
  });
  assert.equal(result.kind, "local");
  assert.equal(result.merged.title, "Local title");
  assert.equal(result.merged.description, "Remote body");
  assert.ok(result.merged.labels.includes("external"));
  assert.deepEqual(result.conflicts, []);
  assert.equal(
    reconcileIssue({
      local: base,
      remote: { ...base, state: "closed" },
      baseline: base,
    }).kind,
    "remote",
  );
});

test("converged edits, missing baselines, and owner normalization never infer merge from stage", () => {
  const changed = { ...base, title: "Same change" };
  assert.equal(
    reconcileIssue({ local: changed, remote: changed, baseline: base }).kind,
    "unchanged",
  );
  assert.equal(reconcileIssue({ local: changed, remote: base }).kind, "remote");
  assert.deepEqual(issueSnapshot({ ...base, ownerId: null }).labels, ["bug"]);
  assert.deepEqual(issueSnapshot({ ...base, ownerId: "hermes" }).labels, [
    "bug",
    "owner:hermes",
  ]);
  assert.equal(
    issueSnapshot({ stageId: "done", github: { state: "closed" } }).state,
    "closed",
  );
  assert.equal(issueSnapshot({ stageId: "done" }).state, "open");
});

test("Project lookup paginates fields and reads the existing single-select Status without modifying configuration", async () => {
  const calls = [];
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      calls.push(body);
      assert.equal(method, "POST");
      assert.equal(endpoint, "/graphql");
      return {
        data: {
          owner: {
            projectV2: {
              id: "P1",
              number: 1,
              title: "Board",
              url: "https://github.com/users/octo/projects/1",
              fields: body.variables.cursor
                ? connection([
                    {
                      __typename: "ProjectV2SingleSelectField",
                      id: "F1",
                      name: "Status",
                      options: [{ id: "S1", name: "In progress" }],
                    },
                  ])
                : connection([{ id: "T1", name: "Title" }], "fields2"),
            },
          },
        },
      };
    },
  });
  assert.deepEqual(await client.getProject("octo", 1), {
    id: "P1",
    number: 1,
    title: "Board",
    url: "https://github.com/users/octo/projects/1",
    statusFieldId: "F1",
    statusOptions: [{ id: "S1", name: "In progress" }],
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /on User/);
  assert.match(calls[0].query, /on Organization/);
});

test("Project item pages return issue identity and the single-select status, excluding drafts/PRs", async () => {
  const calls = [];
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      calls.push(body.variables);
      const item = (number) => ({
        id: `ITEM${number}`,
        content: {
          __typename: "Issue",
          id: `I_${number}`,
          number,
          title: "Issue",
          body: "Body",
          state: "CLOSED",
          repository: { nameWithOwner: repo },
        },
        status: { name: "In review", optionId: "REVIEW", field: { id: "F1" } },
      });
      return {
        data: {
          node: {
            items: body.variables.cursor
              ? connection([item(2)])
              : connection(
                  [
                    item(1),
                    { id: "pr", content: { __typename: "PullRequest" } },
                    { id: "draft", content: { __typename: "DraftIssue" } },
                    { id: "redacted", content: null },
                  ],
                  "page2",
                ),
          },
        },
      };
    },
  });
  const items = await client.listProjectItems("P1");
  assert.equal(items.length, 2);
  assert.deepEqual(items[1].status, {
    fieldId: "F1",
    optionId: "REVIEW",
    name: "In review",
  });
  assert.equal(items[1].issue.repo, repo);
  assert.equal(items[1].issue.state, "closed");
  assert.equal(calls[1].cursor, "page2");
});

test("Project status mutation adds idempotently then edits only one configured field", async () => {
  const calls = [];
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      calls.push(body);
      if (body.query.includes("addProjectV2ItemById"))
        return { data: { addProjectV2ItemById: { item: { id: "ITEM1" } } } };
      return {
        data: {
          updateProjectV2ItemFieldValue: { projectV2Item: { id: "ITEM1" } },
        },
      };
    },
  });
  assert.deepEqual(await client.setProjectStatus("P1", "I_1", "F1", "REVIEW"), {
    itemId: "ITEM1",
  });
  assert.deepEqual(calls[1].variables.input, {
    projectId: "P1",
    itemId: "ITEM1",
    fieldId: "F1",
    value: { singleSelectOptionId: "REVIEW" },
  });
  await client.setProjectStatus("P1", "I_1", "F1", "DONE", "ITEM1");
  assert.equal(calls.length, 3);
});

test("GraphQL HTTP-200 errors are typed, retryable when rate-limited, and redact provider text", async () => {
  const client = new GitHubClient({
    request: async () => ({
      data: null,
      errors: [
        {
          type: "RATE_LIMITED",
          message: "API rate limit reached ghp_do_not_reveal",
        },
      ],
    }),
  });
  await assert.rejects(client.getProject("octo", 1), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.retryable, true);
    assert.ok(error.retryAfterMs >= 60_000);
    assert.doesNotMatch(error.message, /ghp_/);
    return true;
  });
});

test("REST permission and transient failures expose safe status and retry metadata", async () => {
  const denied = new GitHubClient({
    request: async () => {
      throw Object.assign(new Error("token=secret"), { status: 403 });
    },
  });
  await assert.rejects(denied.getIssue(repo, 1), {
    code: "FORBIDDEN",
    status: 403,
    retryable: false,
  });
  const limited = new GitHubClient({
    request: async () => {
      throw Object.assign(new Error("rate limit"), {
        status: 429,
        headers: { "retry-after": "120" },
      });
    },
  });
  await assert.rejects(limited.getIssue(repo, 1), {
    code: "RATE_LIMITED",
    retryable: true,
    retryAfterMs: 120_000,
  });
  const failed = new GitHubClient({
    request: async () => {
      throw Object.assign(new Error("private stderr"), { status: 503 });
    },
  });
  await assert.rejects(failed.getIssue(repo, 1), {
    code: "UNAVAILABLE",
    retryable: true,
  });
});

test("integration availability returns login or a safe error without throwing", async () => {
  assert.deepEqual(
    await new GitHubClient({
      request: async (method, endpoint) => {
        assert.equal(endpoint, "/user");
        return { login: "real-user" };
      },
    }).check(),
    { available: true, login: "real-user" },
  );
  const missing = new GitHubClient({
    request: async () => {
      throw Object.assign(new Error("private path/token"), { code: "ENOENT" });
    },
  });
  const result = await missing.check();
  assert.equal(result.available, false);
  assert.match(result.error, /GitHub CLI/);
  assert.doesNotMatch(result.error, /private/);
});

test("pull request merge evidence requires the actual merged flag and timestamp", async () => {
  const response = {
    number: 9,
    state: "closed",
    merged: false,
    merged_at: null,
    head: { sha: "head" },
    merge_commit_sha: "synthetic-unmerged-sha",
    html_url: "https://github.com/octo/work/pull/9",
  };
  const client = new GitHubClient({
    request: async (method, endpoint) => {
      assert.equal(endpoint, "/repos/octo/work/pulls/9");
      return response;
    },
  });
  assert.deepEqual(await client.getPullRequest(repo, 9), {
    repo,
    number: 9,
    url: response.html_url,
    state: "closed",
    merged: false,
    mergedAt: null,
    headSha: "head",
    mergeCommitSha: null,
  });
  Object.assign(response, {
    merged: true,
    merged_at: "2026-09-12T01:00:00Z",
    merge_commit_sha: "real-merge",
  });
  assert.equal(
    (await client.getPullRequest(repo, 9)).mergeCommitSha,
    "real-merge",
  );
});

function fakeSpawn(onInput) {
  const calls = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    };
    let input = "";
    child.stdin.on("data", (chunk) => {
      input += chunk;
    });
    child.stdin.on("finish", () => onInput(child, input));
    calls.push({ command, args, options, child });
    return child;
  };
  return { spawn, calls };
}

test("gh transport uses argument arrays and stdin JSON, parses headers and never emits stderr", async () => {
  const fixture = fakeSpawn((child, input) => {
    assert.deepEqual(JSON.parse(input), {
      title: "$(touch /tmp/never)",
      body: "`secret`",
    });
    child.stdout.end(
      'HTTP/2 200 OK\r\nContent-Type: application/json\r\n\r\n{"ok":true}',
    );
    child.stderr.end("token=must-stay-private");
    child.emit("close", 0);
  });
  const request = createGhRequest({ spawn: fixture.spawn });
  assert.deepEqual(
    await request("POST", "/repos/octo/work/issues", {
      title: "$(touch /tmp/never)",
      body: "`secret`",
    }),
    { ok: true },
  );
  assert.equal(fixture.calls[0].command, "gh");
  assert.equal(fixture.calls[0].options.shell, false);
  assert.ok(fixture.calls[0].args.includes("--input"));
  assert.equal(
    fixture.calls[0].args.some((arg) => arg.includes("touch")),
    false,
  );
});

test("gh transport bounds output, times out and sanitizes authentication errors", async () => {
  const huge = fakeSpawn((child) => child.stdout.write("x".repeat(100)));
  await assert.rejects(
    createGhRequest({ spawn: huge.spawn, maxBytes: 50 })("GET", "/user"),
    { code: "OUTPUT_LIMIT" },
  );
  assert.equal(huge.calls[0].child.killed, true);
  const hung = fakeSpawn(() => {});
  await assert.rejects(
    createGhRequest({ spawn: hung.spawn, timeoutMs: 10 })("GET", "/user"),
    { code: "TIMEOUT", retryable: true },
  );
  const denied = fakeSpawn((child) => {
    child.stdout.end('HTTP/2 401 Unauthorized\r\n\r\n{"message":"ghp_secret"}');
    child.stderr.end("Authorization: bearer private");
    child.emit("close", 1);
  });
  await assert.rejects(
    createGhRequest({ spawn: denied.spawn })("GET", "/user"),
    (error) => {
      assert.equal(error.code, "UNAUTHENTICATED");
      assert.doesNotMatch(error.message, /ghp_secret|bearer|private/);
      return true;
    },
  );
});

test("malformed pagination cannot silently truncate a Project import or loop forever", async () => {
  const client = new GitHubClient({
    request: async () => ({
      data: { node: { items: connection([], "repeated") } },
    }),
  });
  await assert.rejects(client.listProjectItems("P1"), {
    code: "INVALID_RESPONSE",
  });
});

test("silent GitHub update rejection remains an explicit permission/sync error", async () => {
  const client = new GitHubClient({ request: async () => raw(1) });
  await assert.rejects(
    client.updateIssue(repo, 1, { title: "Requested but dropped" }),
    { code: "WRITE_NOT_APPLIED", retryable: false },
  );
});

test("gh CLI login failure has authentication classification even without an HTTP response", async () => {
  const missingAuth = fakeSpawn((child) => {
    child.stderr.end(
      "To get started with GitHub CLI, please run: gh auth login\nPRIVATE",
    );
    child.emit("close", 1);
  });
  await assert.rejects(
    createGhRequest({ spawn: missingAuth.spawn })("GET", "/user"),
    { code: "UNAUTHENTICATED", retryable: false },
  );
});

test("malformed issue pages fail with a typed error instead of returning partial imports", async () => {
  const client = new GitHubClient({ request: async () => [raw(1), null] });
  await assert.rejects(client.listIssues(repo), { code: "INVALID_RESPONSE" });
});

test("ambiguous malformed create response recovers identity without another write", async () => {
  let saved;
  let writes = 0;
  const client = new GitHubClient({
    request: async (method, endpoint, body) => {
      if (method === "GET") return saved ? [saved] : [];
      writes++;
      saved = raw(1, { ...body, labels: body.labels });
      return null;
    },
  });
  assert.equal(
    (
      await client.createIssue(repo, {
        id: "recover-malformed",
        title: "Title",
      })
    ).number,
    1,
  );
  assert.equal(writes, 1);
});
