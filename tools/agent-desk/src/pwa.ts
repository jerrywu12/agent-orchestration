export type InstallStatus =
  "unavailable" | "available" | "prompting" | "requested" | "installed";

export type InstallState = Readonly<{
  status: InstallStatus;
  message: string | null;
}>;

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const FALLBACK =
  "If available, use the install icon in Chrome’s address bar or its browser menu. The prompt may appear after a short visit; some browsers do not support app installation. Agent Desk still needs its local service running.";

/** Live browser state only: acceptance is a request, appinstalled is completion.
 * The controller is injectable for tests and starts before React mounts so an
 * available browser prompt is retained until the user clicks Install app.
 */
export function createPwaController(host: Window | undefined) {
  let state: InstallState = { status: "unavailable", message: null };
  let deferred: InstallPromptEvent | null = null;
  let started = false;
  let installationObserved = false;
  let generation = 0;
  let displayMode: MediaQueryList | undefined;
  const listeners = new Set<() => void>();

  const update = (status: InstallStatus, message: string | null = null) => {
    state = { status, message };
    listeners.forEach((listener) => listener());
  };
  const isInstalled = () =>
    installationObserved ||
    displayMode?.matches ||
    (host?.navigator as Navigator & { standalone?: boolean })?.standalone ===
      true;

  const onDisplayMode = () => {
    if (isInstalled()) {
      deferred = null;
      generation += 1;
      update("installed");
    } else if (state.status === "installed") {
      update("unavailable");
    }
  };
  const onPrompt = (event: Event) => {
    if (isInstalled()) return;
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    generation += 1;
    update("available");
  };
  const onInstalled = () => {
    installationObserved = true;
    onDisplayMode();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start({ registerServiceWorker = true } = {}) {
      if (!host || started) return;
      started = true;
      displayMode = host.matchMedia("(display-mode: standalone)");
      displayMode.addEventListener("change", onDisplayMode);
      host.addEventListener("beforeinstallprompt", onPrompt);
      host.addEventListener("appinstalled", onInstalled);
      onDisplayMode();

      if (
        registerServiceWorker &&
        host.isSecureContext &&
        host.navigator.serviceWorker
      ) {
        try {
          const registration = await host.navigator.serviceWorker.register(
            "/sw.js",
            { scope: "/", updateViaCache: "none" },
          );
          await registration.update();
        } catch {
          // Registration/update failure must not block the online workspace.
          // No offline availability or successful installation is claimed.
        }
      }
    },
    async requestInstall() {
      if (state.status === "installed" || state.status === "prompting") return;
      if (!deferred) {
        update(state.status, FALLBACK);
        return;
      }
      const prompt = deferred;
      deferred = null; // A browser prompt is single use, even after dismissal.
      const attempt = ++generation;
      update("prompting");
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (attempt !== generation || !started) return;
        if (choice.outcome === "accepted") {
          update(
            "requested",
            "Installation requested. Waiting for the browser to finish.",
          );
        } else {
          update("unavailable", `Installation dismissed. ${FALLBACK}`);
        }
      } catch {
        if (attempt !== generation || !started) return;
        update("unavailable", `The install prompt could not open. ${FALLBACK}`);
      }
    },
    dispose() {
      host?.removeEventListener("beforeinstallprompt", onPrompt);
      host?.removeEventListener("appinstalled", onInstalled);
      displayMode?.removeEventListener("change", onDisplayMode);
      deferred = null;
      generation += 1;
      started = false;
      listeners.clear();
    },
  };
}

export const pwa = createPwaController(
  typeof window === "undefined" ? undefined : window,
);
