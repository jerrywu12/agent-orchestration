import { spawn as spawnProcess } from 'node:child_process';

/**
 * GitHub.com connector; durable scheduling/retries belong to the caller's outbox.
 * request(method, endpoint, body?) is injectable and returns parsed GitHub JSON.
 * The default transport uses authenticated `gh api`, argument arrays and stdin JSON.
 * No credentials or provider stderr are returned, logged or stored by this module.
 *
 * Issues: {repo,number,nodeId,url,title,description,labels:string[],state,updatedAt,
 *          agentDeskId:string|null}. State is 'open'|'closed', never workflow/merge.
 * Description retains exact text, excluding our exact trailing hidden ID marker.
 * createIssue accepts {id,title,description?,labels?,ownerId?}. Only owner:* and
 * agent-desk / agent-desk:* labels are managed; ownerId is never an assignee login.
 * updateIssue accepts partial {title,description,labels,state,ownerId}. Omitted fields
 * are untouched. With a baseline, unchanged supplied fields are also untouched.
 * A conflicting update throws GitHubError(CONFLICT) with .conflict holding both sides.
 *
 * getProject => {id,number,title,url,statusFieldId:string|null,statusOptions:[{id,name}]}
 * listProjectItems => [{id,issue:{repo,number,nodeId,url,title,description,state,updatedAt},
 *                      status:{fieldId,optionId,name}|null}]; excludes non-Issue items.
 * setProjectStatus => {itemId}; never creates/renames fields or options.
 * getPullRequest => {repo,number,url,state,merged,mergedAt,headSha,mergeCommitSha}.
 * check => {available,login? ,error?}; identity check does not prove project scopes.
 *
 * issueSnapshot accepts normalized Issues, raw REST issues or local Tickets, returning
 * {title,description,labels,state}; state falls back to ticket.github.state, then open.
 * reconcileIssue => {kind,local,remote,baseline,localChanges,remoteChanges,conflicts,merged}.
 * Snapshots keep all labels but comparisons manage only our namespace. `merged` is null
 * for conflict; otherwise it preserves remote unrelated labels and combines disjoint
 * field edits. kind 'local' means merged needs publishing; 'remote' means import remote;
 * 'unchanged' includes converged edits. With no baseline, remote wins conservatively.
 *
 * Errors expose {code,status,retryable,retryAfterMs}. Raw error content never escapes.
 * Publish is serialized per repo/ticket within this client. Before each create/retry,
 * repository issues (including closed) are scanned for the stable marker, avoiding
 * search-index lag. Cross-process concurrent creates must be serialized by the outbox;
 * GitHub issue creation has no atomic idempotency key. Interrupted/uncertain POSTs get
 * a read-only marker recovery attempt, never a blind second POST in the same call.
 *
 * API references:
 * https://docs.github.com/en/rest/issues/issues
 * https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
 * https://cli.github.com/manual/gh_api
 */

const MAX_PAGES = 1000;
const SYNC_FIELDS = ['title', 'description', 'labels', 'state'];
const MARKER = /\n\n<!-- agent-desk:ticket:([^\s<>]+) -->$/;
const MESSAGES = {
  INVALID_INPUT: 'Invalid GitHub connector input.',
  INVALID_RESPONSE: 'GitHub returned an incomplete or invalid response.',
  NOT_ISSUE: 'The GitHub item is a pull request, not an issue.',
  NOT_FOUND: 'GitHub resource is unavailable or not visible to the current identity.',
  UNAUTHENTICATED: 'GitHub authentication is unavailable. Check the GitHub CLI identity.',
  FORBIDDEN: 'GitHub denied this operation. Check repository and project permissions.',
  RATE_LIMITED: 'GitHub rate limit reached. The pending operation can be retried later.',
  UNAVAILABLE: 'GitHub is temporarily unavailable.',
  NETWORK: 'GitHub could not be reached. The pending operation can be retried.',
  TIMEOUT: 'The GitHub request timed out. Its remote result may be uncertain.',
  OUTPUT_LIMIT: 'GitHub response exceeded the connector output limit.',
  CLI_UNAVAILABLE: 'GitHub CLI is not installed or could not be started.',
  GRAPHQL_ERROR: 'GitHub rejected the GraphQL operation. Check project access and configuration.',
  CONFLICT: 'Local and GitHub edits conflict. Both snapshots are retained for resolution.',
  WRITE_NOT_APPLIED: 'GitHub did not apply the requested update. Check permissions and sync again.',
  PAGINATION_LIMIT: 'GitHub pagination exceeded the connector limit; import remains incomplete.',
};

export class GitHubError extends Error {
  constructor(code, { status = null, retryable = false, retryAfterMs = 0, conflict } = {}) {
    super(MESSAGES[code] ?? 'GitHub operation failed.');
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    if (conflict) this.conflict = conflict;
  }
}

function githubError(error = {}, { status, headers = {}, detail = '' } = {}) {
  if (error instanceof GitHubError) return error;
  status = Number(status ?? error.status ?? error.statusCode ?? error.response?.status) || null;
  headers = Object.fromEntries(Object.entries(error.headers ?? error.response?.headers ?? headers).map(([key, value]) => [key.toLowerCase(), value]));
  // Inspect only for classification; never attach the original error or message.
  const diagnostic = `${detail} ${error.code ?? ''} ${error.message ?? ''}`;
  if (!status) status = Number(diagnostic.match(/\bHTTP\s+(\d{3})\b/i)?.[1]) || null;
  const rateLimited = status === 429 || /RATE_LIMITED|rate limit|secondary rate|abuse detection/i.test(diagnostic)
    || (status === 403 && String(headers['x-ratelimit-remaining']) === '0');
  if (rateLimited) {
    let retryAfterMs = 60_000;
    if (headers['retry-after'] != null) {
      const seconds = Number(headers['retry-after']);
      const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(headers['retry-after']) - Date.now();
      if (Number.isFinite(duration)) retryAfterMs = Math.max(1000, duration);
    } else if (Number(headers['x-ratelimit-reset']) > 0) {
      retryAfterMs = Math.max(1000, Number(headers['x-ratelimit-reset']) * 1000 - Date.now());
    }
    return new GitHubError('RATE_LIMITED', { status, retryable: true, retryAfterMs });
  }
  if (status === 401 || /gh auth login|not logged into|requires authentication|bad credentials/i.test(diagnostic)) return new GitHubError('UNAUTHENTICATED', { status });
  if (status === 403 || /FORBIDDEN|INSUFFICIENT_SCOPES/.test(diagnostic)) return new GitHubError('FORBIDDEN', { status });
  if (status === 404 || /NOT_FOUND/.test(diagnostic)) return new GitHubError('NOT_FOUND', { status });
  if (status === 408 || error.code === 'ETIMEDOUT') return new GitHubError('TIMEOUT', { status, retryable: true, retryAfterMs: 5000 });
  if (status >= 500) return new GitHubError('UNAVAILABLE', { status, retryable: true, retryAfterMs: 5000 });
  if (error.code === 'ENOENT' || error.code === 'EACCES') return new GitHubError('CLI_UNAVAILABLE');
  if (status) return new GitHubError('GRAPHQL_ERROR', { status });
  return new GitHubError('NETWORK', { retryable: true, retryAfterMs: 5000 });
}

function parseResponse(output) {
  let status = null;
  const headers = {};
  let text = output;
  // --include supplies the status and retry headers without putting secrets in argv.
  while (/^HTTP\/\S+ \d{3}/.test(text)) {
    const boundary = /\r?\n\r?\n/.exec(text);
    if (!boundary) throw new GitHubError('INVALID_RESPONSE');
    const lines = text.slice(0, boundary.index).split(/\r?\n/);
    status = Number(lines.shift().match(/^HTTP\/\S+ (\d{3})/)?.[1]);
    for (const line of lines) {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
    }
    text = text.slice(boundary.index + boundary[0].length);
  }
  return { status, headers, text };
}

// Exposed to test the process boundary offline. Production callers use GitHubClient.
export function createGhRequest({ spawn = spawnProcess, timeoutMs = 20_000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return async (method, endpoint, body) => {
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method) || !/^\/(?:repos\/|graphql$|user$)/.test(endpoint)) throw new GitHubError('INVALID_INPUT');
    const args = ['api', '--hostname', 'github.com', '--method', method, '--include', '--header', 'Accept: application/vnd.github+json', '--header', 'X-GitHub-Api-Version: 2022-11-28', endpoint === '/graphql' ? 'graphql' : endpoint];
    if (body !== undefined) args.push('--input', '-');
    return new Promise((resolve, reject) => {
      let child;
      let timer;
      let settled = false;
      let byteCount = 0;
      let stdout = '';
      let stderr = '';
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      try {
        child = spawn('gh', args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GH_DEBUG: '', GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GH_PAGER: 'cat' } });
      } catch (error) { finish(githubError(error)); return; }
      const stop = error => { finish(error); child.kill('SIGKILL'); };
      timer = setTimeout(() => stop(new GitHubError('TIMEOUT', { retryable: true, retryAfterMs: 5000 })), timeoutMs);
      const collect = stream => chunk => {
        if (settled) return;
        byteCount += Buffer.byteLength(chunk);
        if (byteCount > maxBytes) { stop(new GitHubError('OUTPUT_LIMIT')); return; }
        if (stream === 'stdout') stdout += chunk; else stderr += chunk;
      };
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
      child.on('error', error => finish(githubError(error)));
      // EPIPE during early CLI termination must not crash the server process.
      child.stdin.on('error', error => finish(githubError(error)));
      child.on('close', code => {
        if (settled) return;
        try {
          const response = parseResponse(stdout);
          if (code !== 0 || response.status >= 400) {
            finish(githubError({}, { ...response, detail: `${stderr} ${response.text}` })); return;
          }
          const parsed = response.text.trim() ? JSON.parse(response.text) : null;
          finish(null, parsed);
        } catch { finish(new GitHubError('INVALID_RESPONSE')); }
      });
      try { child.stdin.end(body === undefined ? undefined : JSON.stringify(body)); }
      catch { stop(new GitHubError('INVALID_INPUT')); }
    });
  };
}

const managed = label => label === 'agent-desk' || label.startsWith('agent-desk:') || label.startsWith('owner:');
const unique = values => [...new Set(values)].sort();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const own = (object, key) => Object.hasOwn(object ?? {}, key);
const string = value => typeof value === 'string' ? value : '';

function marker(id) { return `\n\n<!-- agent-desk:ticket:${encodeURIComponent(id)} -->`; }

function readBody(body) {
  body = string(body);
  const match = MARKER.exec(body);
  if (!match) return { description: body, agentDeskId: null };
  try { return { description: body.slice(0, match.index), agentDeskId: decodeURIComponent(match[1]) }; }
  catch { return { description: body, agentDeskId: null }; }
}

export function issueSnapshot(source = {}) {
  let labels = unique((Array.isArray(source.labels) ? source.labels : source.labels?.nodes ?? []).map(label => typeof label === 'string' ? label : label?.name).filter(label => typeof label === 'string'));
  if (own(source, 'ownerId')) {
    labels = labels.filter(label => !label.startsWith('owner:'));
    if (typeof source.ownerId === 'string' && source.ownerId && source.ownerId !== 'unassigned') labels.push(`owner:${source.ownerId}`);
  }
  return {
    title: string(source.title),
    description: own(source, 'description') ? string(source.description) : readBody(source.body).description,
    labels: unique(labels),
    state: String(source.state ?? source.github?.state ?? 'open').toLowerCase() === 'closed' ? 'closed' : 'open',
  };
}

function comparison(snapshot) { return { ...snapshot, labels: snapshot.labels.filter(managed) }; }

export function reconcileIssue({ local, remote, baseline }) {
  local = issueSnapshot(local); remote = issueSnapshot(remote); baseline = baseline ? issueSnapshot(baseline) : null;
  const left = comparison(local); const right = comparison(remote); const previous = baseline && comparison(baseline);
  const localChanges = previous ? SYNC_FIELDS.filter(field => !same(left[field], previous[field])) : [];
  const remoteChanges = previous ? SYNC_FIELDS.filter(field => !same(right[field], previous[field])) : [];
  const conflicts = localChanges.filter(field => remoteChanges.includes(field) && !same(left[field], right[field]));
  const result = { kind: 'unchanged', local, remote, baseline, localChanges, remoteChanges, conflicts, merged: remote };
  if (same(left, right)) return result;
  if (!baseline) return { ...result, kind: 'remote' };
  if (conflicts.length) return { ...result, kind: 'conflict', merged: null };
  const merged = { ...remote };
  for (const field of localChanges) {
    merged[field] = field === 'labels' ? unique([...remote.labels.filter(label => !managed(label)), ...left.labels]) : local[field];
  }
  return { ...result, kind: same(comparison(merged), right) ? 'remote' : 'local', merged };
}

function validateRepo(repo) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || ['.', '..'].includes(repo.split('/')[1])) throw new GitHubError('INVALID_INPUT');
  return repo;
}
function validateNumber(number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new GitHubError('INVALID_INPUT');
  return number;
}
function validateId(id) {
  if (typeof id !== 'string' || !id || id.length > 256) throw new GitHubError('INVALID_INPUT');
  return id;
}
function validateEdits(edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw new GitHubError('INVALID_INPUT');
  if (own(edits, 'title') && (typeof edits.title !== 'string' || !edits.title.trim() || edits.title.length > 256)) throw new GitHubError('INVALID_INPUT');
  if (own(edits, 'description') && (typeof edits.description !== 'string' || edits.description.length > 65536)) throw new GitHubError('INVALID_INPUT');
  if (own(edits, 'labels') && (!Array.isArray(edits.labels) || edits.labels.length > 100 || edits.labels.some(label => typeof label !== 'string' || label.length > 50))) throw new GitHubError('INVALID_INPUT');
  if (own(edits, 'ownerId') && edits.ownerId !== null && (typeof edits.ownerId !== 'string' || edits.ownerId.length > 44)) throw new GitHubError('INVALID_INPUT');
  if (own(edits, 'state') && !['open', 'closed'].includes(edits.state)) throw new GitHubError('INVALID_INPUT');
}

function normalizeIssue(repo, value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.number)) throw new GitHubError('INVALID_RESPONSE');
  if (own(value, 'pull_request')) throw new GitHubError('NOT_ISSUE');
  return { repo, number: value.number, nodeId: value.node_id ?? value.nodeId ?? value.id, url: value.html_url ?? value.url ?? null, ...issueSnapshot(value), updatedAt: value.updated_at ?? value.updatedAt ?? null, agentDeskId: value.agentDeskId ?? readBody(value.body).agentDeskId };
}

function nextCursor(connection, seen) {
  if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw new GitHubError('INVALID_RESPONSE');
  if (!connection.pageInfo.hasNextPage) return null;
  const cursor = connection.pageInfo.endCursor;
  if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new GitHubError('INVALID_RESPONSE');
  seen.add(cursor);
  return cursor;
}

const PROJECT_FIELDS = `id number title url fields(first:100, after:$cursor) {
  nodes { __typename ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { options { id name } } }
  pageInfo { hasNextPage endCursor }
}`;

export class GitHubClient {
  constructor({ request = createGhRequest() } = {}) {
    if (typeof request !== 'function') throw new GitHubError('INVALID_INPUT');
    this.request = request;
    this.creates = new Map();
  }

  async call(method, endpoint, body) {
    try {
      const result = await this.request(method, endpoint, body);
      if (endpoint === '/graphql' && Array.isArray(result?.errors) && result.errors.length) {
        const detail = result.errors.map(error => `${error.type ?? error.extensions?.code ?? ''} ${error.message ?? ''}`).join(' ');
        const error = githubError({}, { status: 200, detail });
        throw error;
      }
      return result;
    } catch (error) { throw githubError(error); }
  }

  async graphql(query, variables) {
    const result = await this.call('POST', '/graphql', { query, variables });
    if (!result?.data) throw new GitHubError('INVALID_RESPONSE');
    return result.data;
  }

  async listIssues(repo) {
    validateRepo(repo);
    const issues = new Map();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await this.call('GET', `/repos/${repo}/issues?state=all&sort=created&direction=asc&per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new GitHubError('INVALID_RESPONSE');
      for (const row of rows) {
        if (!own(row, 'pull_request')) {
          const issue = normalizeIssue(repo, row);
          issues.set(issue.number, issue);
        }
      }
      if (rows.length < 100) return [...issues.values()];
    }
    throw new GitHubError('PAGINATION_LIMIT');
  }

  async getIssue(repo, number) {
    return normalizeIssue(validateRepo(repo), await this.call('GET', `/repos/${repo}/issues/${validateNumber(number)}`));
  }

  async createIssue(repo, ticket) {
    validateRepo(repo); validateId(ticket?.id); validateEdits(ticket);
    if (!ticket.title) throw new GitHubError('INVALID_INPUT');
    const key = `${repo.toLowerCase()}:${ticket.id}`;
    if (this.creates.has(key)) return this.creates.get(key);
    const operation = this.createMarkedIssue(repo, ticket);
    this.creates.set(key, operation);
    try { return await operation; } finally { this.creates.delete(key); }
  }

  async createMarkedIssue(repo, ticket) {
    const findExisting = async () => (await this.listIssues(repo)).find(issue => issue.agentDeskId === ticket.id);
    const existing = await findExisting();
    if (existing) return existing;
    const desired = issueSnapshot(ticket);
    const body = { title: desired.title, body: desired.description + marker(ticket.id), labels: unique(['agent-desk', ...desired.labels.filter(managed)]) };
    try {
      return normalizeIssue(repo, await this.call('POST', `/repos/${repo}/issues`, body));
    } catch (error) {
      if (error.retryable || ['INVALID_RESPONSE', 'OUTPUT_LIMIT'].includes(error.code)) {
        try { const recovered = await findExisting(); if (recovered) return recovered; }
        catch { /* Preserve the original classified failure for durable retry. */ }
      }
      throw error;
    }
  }

  async updateIssue(repo, number, edits, baseline) {
    validateRepo(repo); validateNumber(number); validateEdits(edits);
    const remote = await this.getIssue(repo, number);
    const local = { ...issueSnapshot(baseline ?? remote), ...Object.fromEntries(Object.entries(edits).filter(([key]) => [...SYNC_FIELDS, 'ownerId'].includes(key))) };
    const reconciliation = reconcileIssue({ local, remote, baseline: baseline ?? remote });
    if (reconciliation.kind === 'conflict') throw new GitHubError('CONFLICT', { conflict: reconciliation });
    const desired = reconciliation.merged;
    const patch = {};
    for (const field of ['title', 'description', 'state']) {
      if (desired[field] !== remote[field]) patch[field === 'description' ? 'body' : field] = field === 'description' ? desired.description + (remote.agentDeskId ? marker(remote.agentDeskId) : '') : desired[field];
    }
    const endpoint = `/repos/${repo}/issues/${number}`;
    if (Object.keys(patch).length) await this.call('PATCH', endpoint, patch);
    const added = desired.labels.filter(label => managed(label) && !remote.labels.includes(label));
    const removed = remote.labels.filter(label => managed(label) && !desired.labels.includes(label));
    // Individual label operations never replace unrelated labels, including races.
    if (added.length) await this.call('POST', `${endpoint}/labels`, { labels: added });
    for (const label of removed) {
      try { await this.call('DELETE', `${endpoint}/labels/${encodeURIComponent(label)}`); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    if (!Object.keys(patch).length && !added.length && !removed.length) return remote;
    const updated = await this.getIssue(repo, number);
    // GitHub can silently ignore fields for identities lacking write permission.
    if (!same(comparison(issueSnapshot(updated)), comparison(desired))) throw new GitHubError('WRITE_NOT_APPLIED');
    return updated;
  }

  async getProject(owner, number) {
    validateId(owner); validateNumber(number);
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner)) throw new GitHubError('INVALID_INPUT');
    const query = `query AgentDeskProject($owner:String!, $number:Int!, $cursor:String) {
      owner:repositoryOwner(login:$owner) {
        ... on User { projectV2(number:$number) { ${PROJECT_FIELDS} } }
        ... on Organization { projectV2(number:$number) { ${PROJECT_FIELDS} } }
      }
    }`;
    let cursor = null;
    const seen = new Set();
    let result;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.graphql(query, { owner, number, cursor });
      const project = data.owner?.projectV2;
      if (!project) throw new GitHubError('NOT_FOUND');
      if (!project.id) throw new GitHubError('INVALID_RESPONSE');
      cursor = nextCursor(project.fields, seen);
      result ??= { id: project.id, number: project.number, title: project.title, url: project.url, statusFieldId: null, statusOptions: [] };
      for (const field of project.fields.nodes) {
        if (field?.name === 'Status' && Array.isArray(field.options)) {
          result.statusFieldId = field.id;
          result.statusOptions = field.options.map(({ id, name }) => ({ id, name }));
        }
      }
      if (!cursor) return result;
    }
    throw new GitHubError('PAGINATION_LIMIT');
  }

  async listProjectItems(projectId) {
    validateId(projectId);
    const query = `query AgentDeskItems($projectId:ID!, $cursor:String) {
      node(id:$projectId) { ... on ProjectV2 { items(first:100, after:$cursor) {
        nodes { id content { __typename ... on Issue { id number title body state url updatedAt repository { nameWithOwner } } }
          status:fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2FieldCommon { id } } } }
        } pageInfo { hasNextPage endCursor }
      } } }
    }`;
    const items = new Map();
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.graphql(query, { projectId, cursor });
      if (!data.node) throw new GitHubError('NOT_FOUND');
      cursor = nextCursor(data.node.items, seen);
      for (const item of data.node.items.nodes) {
        if (item?.content?.__typename !== 'Issue') continue;
        const { labels: _labels, agentDeskId: _marker, ...issue } = normalizeIssue(item.content.repository?.nameWithOwner, item.content);
        items.set(item.id, { id: item.id, issue, status: item.status?.optionId ? { fieldId: item.status.field.id, optionId: item.status.optionId, name: item.status.name } : null });
      }
      if (!cursor) return [...items.values()];
    }
    throw new GitHubError('PAGINATION_LIMIT');
  }

  async setProjectStatus(projectId, issueNodeId, statusFieldId, optionId, existingItemId) {
    [projectId, issueNodeId, statusFieldId, optionId].forEach(validateId);
    let itemId = existingItemId;
    if (itemId) validateId(itemId);
    else {
      // GitHub returns the existing ID when content is already in the project.
      const data = await this.graphql(`mutation AgentDeskAddItem($input:AddProjectV2ItemByIdInput!) { addProjectV2ItemById(input:$input) { item { id } } }`, { input: { projectId, contentId: issueNodeId } });
      itemId = data.addProjectV2ItemById?.item?.id;
      if (!itemId) throw new GitHubError('INVALID_RESPONSE');
    }
    const data = await this.graphql(`mutation AgentDeskStatus($input:UpdateProjectV2ItemFieldValueInput!) { updateProjectV2ItemFieldValue(input:$input) { projectV2Item { id } } }`, { input: { projectId, itemId, fieldId: statusFieldId, value: { singleSelectOptionId: optionId } } });
    if (data.updateProjectV2ItemFieldValue?.projectV2Item?.id !== itemId) throw new GitHubError('INVALID_RESPONSE');
    return { itemId };
  }

  async getPullRequest(repo, number) {
    validateRepo(repo); validateNumber(number);
    const value = await this.call('GET', `/repos/${repo}/pulls/${number}`);
    if (!value || value.number !== number || typeof value.merged !== 'boolean') throw new GitHubError('INVALID_RESPONSE');
    const merged = value.merged === true && typeof value.merged_at === 'string' && Number.isFinite(Date.parse(value.merged_at));
    return { repo, number, url: value.html_url ?? null, state: value.state, merged, mergedAt: merged ? value.merged_at : null, headSha: value.head?.sha ?? null, mergeCommitSha: merged ? value.merge_commit_sha ?? null : null };
  }

  async check() {
    try {
      const user = await this.call('GET', '/user');
      if (typeof user?.login !== 'string' || !user.login) throw new GitHubError('INVALID_RESPONSE');
      return { available: true, login: user.login };
    } catch (error) { return { available: false, error: githubError(error).message }; }
  }
}
