import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

async function worker(fetch) {
  const listeners = new Map();
  const calls = { claim: 0, skipWaiting: 0 };
  const context = vm.createContext({
    URL,
    Response,
    fetch,
    self: {
      location: { origin: "https://desk.example" },
      addEventListener: (name, callback) => listeners.set(name, callback),
      skipWaiting: async () => {
        calls.skipWaiting += 1;
      },
      clients: {
        claim: async () => {
          calls.claim += 1;
        },
      },
    },
    // Any cache access is a privacy regression, including during install/update.
    caches: new Proxy(
      {},
      {
        get() {
          throw new Error("PWA must not cache application data");
        },
      },
    ),
  });
  vm.runInContext(await source("public/sw.js"), context);
  return {
    calls,
    lifecycle: async (name) => {
      let task;
      listeners.get(name)({
        waitUntil(value) {
          task = value;
        },
      });
      await task;
    },
    request: (request) => {
      let response;
      listeners.get("fetch")({
        request,
        respondWith(value) {
          response = value;
        },
      });
      return response;
    },
  };
}

const navigation = (path = "/", extra = {}) => ({
  url: new URL(path, "https://desk.example").href,
  method: "GET",
  mode: "navigate",
  ...extra,
});

test("manifest has stable standalone identity, linked metadata and real branded PNG sizes", async () => {
  const manifest = JSON.parse(await source("public/manifest.webmanifest"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "Agent Desk");
  assert.equal(manifest.prefer_related_applications ?? false, false);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(
      (item) => item.sizes === `${size}x${size}`,
    );
    assert.ok(icon, `missing ${size}px icon`);
    assert.equal(icon.type, "image/png");
    const bytes = await readFile(new URL(`public${icon.src}`, root));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.ok(bytes.length > 500, "real image rather than empty placeholder");
  }
  const html = await source("index.html");
  assert.match(html, /rel="manifest"[^>]*href="\/manifest\.webmanifest"/);
  assert.match(html, /name="theme-color"/);
});

test("online navigation always requests current HTML and preserves HTTP failures", async () => {
  const calls = [];
  let version = 0;
  const sw = await worker(async (request, options) => {
    calls.push({ request, options });
    return new Response(`runtime ${++version}`, {
      status: version === 3 ? 503 : 200,
    });
  });
  assert.equal(await (await sw.request(navigation())).text(), "runtime 1");
  assert.equal(await (await sw.request(navigation())).text(), "runtime 2");
  const failure = await sw.request(navigation());
  assert.equal(failure.status, 503);
  assert.equal(await failure.text(), "runtime 3");
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ options }) => options.cache === "no-store"));
});

test("worker never intercepts API, assets, external requests or mutations", async () => {
  const sw = await worker(() => {
    throw new Error("should pass through");
  });
  for (const request of [
    navigation("/api"),
    navigation("/api/tickets?token=private"),
    navigation("/api/attachments/private/download"),
    navigation("/assets/index-old.js", { mode: "cors" }),
    navigation("/", { method: "POST" }),
    navigation("https://external.example/"),
  ]) {
    assert.equal(sw.request(request), undefined, request.url);
  }
});

test("offline navigation returns only the static explanation with no request details", async () => {
  const sw = await worker(async () => {
    throw new Error("secret failed request");
  });
  const response = await sw.request(
    navigation("/tickets/private?token=secret"),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Type"), /^text\/html/);
  assert.match(
    response.headers.get("Content-Security-Policy"),
    /default-src 'none'/,
  );
  const html = await response.text();
  assert.equal(html.trim(), (await source("public/offline.html")).trim());
  assert.match(html, /offline|unavailable/i);
  assert.match(html, /local service/i);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /<script|secret|private|token|<form/i);
});

test("worker update takes over without caching or reloading open drafts", async () => {
  const sw = await worker(() => {
    throw new Error("install must not fetch user data");
  });
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  assert.deepEqual(sw.calls, { claim: 1, skipWaiting: 1 });
  assert.doesNotMatch(
    await source("public/sw.js"),
    /\.navigate\(|\.reload\(|importScripts\(/,
  );
});

async function controller(host) {
  const { outputText } = ts.transpileModule(await source("src/pwa.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const { createPwaController } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
  return createPwaController(host);
}

function browser({ standalone = false, serviceWorker } = {}) {
  const listeners = new Map();
  const mediaListeners = new Set();
  const media = {
    matches: standalone,
    addEventListener: (_, callback) => mediaListeners.add(callback),
    removeEventListener: (_, callback) => mediaListeners.delete(callback),
  };
  return {
    navigator: { serviceWorker },
    isSecureContext: true,
    matchMedia: () => media,
    addEventListener: (name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener: (name, callback) =>
      listeners.get(name)?.delete(callback),
    emit: (name, value = {}) =>
      listeners.get(name)?.forEach((callback) => callback(value)),
    changeDisplayMode: (matches) => {
      media.matches = matches;
      mediaListeners.forEach((callback) => callback());
    },
  };
}

test("install lifecycle captures prompt, consumes it once and does not equate acceptance with installed", async () => {
  const host = browser();
  const pwa = await controller(host);
  await pwa.start({ registerServiceWorker: false });
  let prevented = 0;
  let prompts = 0;
  host.emit("beforeinstallprompt", {
    preventDefault() {
      prevented += 1;
    },
    async prompt() {
      prompts += 1;
    },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  assert.equal(prevented, 1);
  assert.equal(pwa.getSnapshot().status, "available");
  await pwa.requestInstall();
  assert.equal(prompts, 1);
  assert.equal(pwa.getSnapshot().status, "requested");
  await pwa.requestInstall();
  assert.equal(prompts, 1);
  host.emit("appinstalled");
  assert.equal(pwa.getSnapshot().status, "installed");
  pwa.dispose();
});

test("dismissal, unsupported browsers and errors retain truthful install guidance", async () => {
  const host = browser();
  const pwa = await controller(host);
  await pwa.start({ registerServiceWorker: false });
  await pwa.requestInstall();
  assert.equal(pwa.getSnapshot().status, "unavailable");
  assert.match(pwa.getSnapshot().message, /browser menu|address bar/i);
  host.emit("beforeinstallprompt", {
    preventDefault() {},
    async prompt() {},
    userChoice: Promise.resolve({ outcome: "dismissed" }),
  });
  await pwa.requestInstall();
  assert.equal(pwa.getSnapshot().status, "unavailable");
  assert.match(pwa.getSnapshot().message, /dismissed/i);
  host.emit("beforeinstallprompt", {
    preventDefault() {},
    async prompt() {
      throw new Error("secret browser error");
    },
    userChoice: Promise.resolve({ outcome: "dismissed" }),
  });
  await pwa.requestInstall();
  assert.equal(pwa.getSnapshot().status, "unavailable");
  assert.doesNotMatch(pwa.getSnapshot().message, /secret/);
  assert.match(pwa.getSnapshot().message, /browser menu/i);
  pwa.dispose();
});

test("in-flight install cannot overwrite a confirmed appinstalled event or prompt twice", async () => {
  const host = browser();
  const pwa = await controller(host);
  await pwa.start({ registerServiceWorker: false });
  let choose;
  let prompts = 0;
  host.emit("beforeinstallprompt", {
    preventDefault() {},
    async prompt() {
      prompts += 1;
    },
    userChoice: new Promise((resolve) => {
      choose = resolve;
    }),
  });
  const install = pwa.requestInstall();
  await pwa.requestInstall();
  host.emit("appinstalled");
  choose({ outcome: "dismissed" });
  await install;
  assert.equal(prompts, 1);
  assert.equal(pwa.getSnapshot().status, "installed");
  pwa.dispose();
});

test("standalone detection and subscriptions clean up without persisting installed state", async () => {
  const host = browser({ standalone: true });
  const pwa = await controller(host);
  let changed = 0;
  const unsubscribe = pwa.subscribe(() => {
    changed += 1;
  });
  await pwa.start({ registerServiceWorker: false });
  assert.equal(pwa.getSnapshot().status, "installed");
  unsubscribe();
  pwa.dispose();
  const count = changed;
  host.emit("beforeinstallprompt", {
    preventDefault() {
      throw new Error("listener leaked");
    },
  });
  assert.equal(changed, count);
  const normal = await controller(browser());
  await normal.start({ registerServiceWorker: false });
  assert.equal(normal.getSnapshot().status, "unavailable");
  normal.dispose();
});

test("registration bypasses worker HTTP cache, updates once, and failures leave app usable", async () => {
  const calls = [];
  let updated = 0;
  const pwa = await controller(
    browser({
      serviceWorker: {
        async register(...args) {
          calls.push(args);
          return {
            async update() {
              updated += 1;
            },
          };
        },
      },
    }),
  );
  await pwa.start();
  await pwa.start();
  assert.deepEqual(calls, [["/sw.js", { scope: "/", updateViaCache: "none" }]]);
  assert.equal(updated, 1);
  pwa.dispose();
  const failed = await controller(
    browser({
      serviceWorker: {
        async register() {
          throw new Error("service unavailable");
        },
      },
    }),
  );
  await assert.doesNotReject(failed.start());
  await failed.requestInstall();
  assert.equal(failed.getSnapshot().status, "unavailable");
  assert.match(failed.getSnapshot().message, /browser menu/i);
  failed.dispose();
});
