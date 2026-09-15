// Agent Desk menu bar indicator.
//
// Replaces the retired SwiftBar `codex-status.5s.sh` plugin. It renders the
// glanceable robot count in the macOS menu bar and reads its data from Agent
// Desk's /api/activity, so the menu bar and the Machine view are always the
// same observation rather than two independent implementations that can drift.
//
// This process observes nothing itself: it is a display client. All detection,
// bounds, privacy filtering and degradation live in the server.

import AppKit
import Foundation

// MARK: - Contract

// Mirrors specs/011-agent-activity-tracking/contracts/activity-api.md.
// Decoding is lenient about unknown fields so a server that gains fields does
// not break the indicator.

struct SleepHolder: Decodable {
    let pid: Int
    let elapsedSeconds: Int
}

struct SleepPrevention: Decodable {
    let state: String
    let holders: [SleepHolder]
}

struct ActiveTask: Decodable {
    let id: String
    let origin: String
    let description: String
    let workspace: String
    let lifecycle: String
}

struct ActiveWorker: Decodable {
    let agentName: String
    let pid: Int
    let elapsedSeconds: Int
}

struct SourceObservability: Decodable {
    let id: String
    let label: String
    let status: String
    let reason: String?
}

struct ActivitySnapshot: Decodable {
    let activeCount: Int
    let state: String
    let tasks: [ActiveTask]
    let workers: [ActiveWorker]
    let sleepPrevention: SleepPrevention
    let sources: [SourceObservability]
    let stale: Bool
    let partial: Bool
}

// MARK: - Formatting

/// Mirrors the retired plugin's `running 10:38:02` style so the menu reads the
/// same way it always did.
func formatElapsed(_ seconds: Int) -> String {
    guard seconds >= 0 else { return "—" }
    let days = seconds / 86400
    let hours = (seconds % 86400) / 3600
    let minutes = (seconds % 3600) / 60
    let secs = seconds % 60
    if days > 0 {
        return String(format: "%dd %02d:%02d:%02d", days, hours, minutes, secs)
    }
    if hours > 0 {
        return String(format: "%02d:%02d:%02d", hours, minutes, secs)
    }
    return String(format: "%02d:%02d", minutes, secs)
}

// MARK: - Controller

final class MenuBarController: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private var snapshot: ActivitySnapshot?
    private var reachable = false

    private let endpoint = URL(string: "http://127.0.0.1:4310/api/activity")!
    private let appURL = URL(string: "http://127.0.0.1:4310/")!
    private let refreshInterval: TimeInterval = 5

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.menu = NSMenu()
        render()
        poll()
        let timer = Timer.scheduledTimer(withTimeInterval: refreshInterval, repeats: true) { [weak self] _ in
            self?.poll()
        }
        // Keep polling while a menu is open, matching the old plugin's cadence.
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func poll() {
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 4
        request.httpMethod = "GET"
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            var decoded: ActivitySnapshot?
            if let data,
               let http = response as? HTTPURLResponse,
               http.statusCode == 200 {
                decoded = try? JSONDecoder().decode(ActivitySnapshot.self, from: data)
            }
            DispatchQueue.main.async {
                if let decoded {
                    self.snapshot = decoded
                    self.reachable = true
                } else {
                    // Retain the last good snapshot; only the title degrades.
                    self.reachable = false
                }
                self.render()
            }
        }.resume()
    }

    // MARK: Title

    private func render() {
        guard let button = statusItem.button else { return }

        let title: String
        let color: NSColor

        if !reachable {
            title = "🤖 ?"
            color = .secondaryLabelColor
        } else if let snapshot {
            title = "🤖 \(snapshot.activeCount)"
            if snapshot.activeCount == 0 {
                color = .secondaryLabelColor
            } else if snapshot.sleepPrevention.state == "active" {
                // Green carried over from the plugin: work in flight and the
                // machine is being held awake for it.
                color = .systemGreen
            } else {
                color = .systemOrange
            }
        } else {
            title = "🤖 …"
            color = .secondaryLabelColor
        }

        button.attributedTitle = NSAttributedString(
            string: title,
            attributes: [.foregroundColor: color]
        )

        rebuildMenu()
    }

    // MARK: Menu

    private func rebuildMenu() {
        let menu = NSMenu()

        if !reachable {
            menu.addItem(disabled("Agent Desk is not reachable"))
            menu.addItem(disabled("Start it, or check http://127.0.0.1:4310"))
            if snapshot != nil {
                menu.addItem(.separator())
                menu.addItem(disabled("Last known values:"))
            }
        }

        if let snapshot {
            if reachable {
                switch snapshot.state {
                case "active":
                    menu.addItem(disabled("Active agent work: \(snapshot.activeCount)"))
                case "idle":
                    menu.addItem(disabled("No active agent work"))
                default:
                    menu.addItem(disabled("Activity cannot be observed"))
                }
            }

            if snapshot.partial {
                for source in snapshot.sources where source.status != "observed" {
                    menu.addItem(disabled("⚠ \(source.label): \(source.reason ?? "unavailable")"))
                }
            }
            if snapshot.stale {
                menu.addItem(disabled("⚠ Values are stale"))
            }

            if !snapshot.tasks.isEmpty {
                menu.addItem(.separator())
                for task in snapshot.tasks {
                    let suffix = task.lifecycle == "indeterminate" ? " · unconfirmed" : ""
                    menu.addItem(disabled("Codex · \(task.origin) · \(task.description)"))
                    menu.addItem(disabled("    \(task.workspace) · \(task.id)\(suffix)"))
                }
            }

            if !snapshot.workers.isEmpty {
                menu.addItem(.separator())
                for worker in snapshot.workers {
                    menu.addItem(
                        disabled("\(worker.agentName) · PID \(worker.pid) · running \(formatElapsed(worker.elapsedSeconds))")
                    )
                }
            }

            menu.addItem(.separator())
            switch snapshot.sleepPrevention.state {
            case "active":
                menu.addItem(disabled("Sleep prevention: active"))
                for holder in snapshot.sleepPrevention.holders {
                    menu.addItem(disabled("    PID \(holder.pid) · \(formatElapsed(holder.elapsedSeconds))"))
                }
            case "inactive":
                menu.addItem(disabled("Sleep prevention: inactive"))
            default:
                menu.addItem(disabled("Sleep prevention: cannot observe"))
            }
        }

        menu.addItem(.separator())
        menu.addItem(action("Open Agent Desk", #selector(openApp)))
        menu.addItem(action("Refresh", #selector(refreshNow)))
        menu.addItem(.separator())
        menu.addItem(action("Quit", #selector(quit)))

        statusItem.menu = menu
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private func action(_ title: String, _ selector: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func openApp() {
        NSWorkspace.shared.open(appURL)
    }

    @objc private func refreshNow() {
        poll()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

// MARK: - Entry point

let app = NSApplication.shared
let controller = MenuBarController()
app.delegate = controller
// Menu bar only: no Dock icon, no main window.
app.setActivationPolicy(.accessory)
app.run()
