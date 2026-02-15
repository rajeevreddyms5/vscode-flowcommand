import * as vscode from "vscode";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import express from "express";
import { Server as SocketIOServer, Socket } from "socket.io";

// Session info for registry
export interface SessionInfo {
  id: string;
  workspaceName: string;
  port: number;
  startTime: number;
  pin: string;
}

// Message types (mirrored from webviewProvider)
export type RemoteMessage = {
  type: string;
  [key: string]: unknown;
};

// State interface for initial sync
export interface RemoteState {
  queue: unknown[];
  queueEnabled: boolean;
  currentSession: unknown[];
  persistedHistory: unknown[];
  pendingRequest: {
    id: string;
    prompt: string;
    context?: string;
    isApprovalQuestion: boolean;
    choices?: unknown[];
  } | null;
  pendingMultiQuestion: { requestId: string; questions: unknown[] } | null;
  settings: {
    soundEnabled: boolean;
    interactiveApprovalEnabled: boolean;
    reusablePrompts: unknown[];
    mcpRunning?: boolean;
    mcpUrl?: string | null;
  };
}

/**
 * RemoteUiServer - Serves the FlowCommand UI to browsers/mobile devices
 * Provides identical functionality to the VS Code webview
 */
export class RemoteUiServer implements vscode.Disposable {
  private _app: express.Application;
  private _server: http.Server | null = null;
  private _io: SocketIOServer | null = null;
  private _port: number = 0;
  private _pin: string;
  private _sessionId: string;
  private _authenticatedSockets: Set<string> = new Set();

  // Callback to relay messages to/from webview provider
  private _onMessageCallback:
    | ((message: RemoteMessage, respond: (msg: RemoteMessage) => void) => void)
    | null = null;

  // Callback to get current state for new connections
  private _getStateCallback: (() => RemoteState) | null = null;

  // Callback to get terminal command history
  private _getTerminalHistoryCallback: (() => unknown[]) | null = null;

  // Callback to get problems/diagnostics
  private _getProblemsCallback: (() => unknown[]) | null = null;

  // Debug console output buffer (keeps last 500 entries)
  private _debugOutput: { type: string; message: string; timestamp: number }[] =
    [];
  private _debugTrackerDisposable: vscode.Disposable | null = null;

  // File and terminal watchers for real-time updates
  private _fileWatchers: vscode.Disposable[] = [];
  private _terminalWatchers: vscode.Disposable[] = [];

  // File change debounce to reduce broadcast load for remote clients
  private _fileChangeDebounceTimers: Map<
    string,
    ReturnType<typeof setTimeout>
  > = new Map();
  private _pendingFileChanges: Map<string, RemoteMessage> = new Map();
  private readonly _FILE_CHANGE_DEBOUNCE_MS = 250;
  private readonly _MAX_FILE_CHANGE_BYTES = 200 * 1024; // 200KB

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this._app = express();
    this._pin = this._getOrCreatePersistentPin();
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this._setupRoutes();
  }

  /**
   * Get or create a persistent PIN for this machine
   * The same PIN is used across VS Code restarts
   */
  private _getOrCreatePersistentPin(): string {
    const storedPin = this._context.globalState.get<string>(
      "flowcommand_remote_pin",
    );
    if (storedPin) {
      console.log("[FlowCommand Remote] Using stored PIN");
      return storedPin;
    }

    // Generate new PIN and store it
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    this._context.globalState.update("flowcommand_remote_pin", newPin);
    console.log("[FlowCommand Remote] Generated new persistent PIN");
    return newPin;
  }

  /**
   * Generate a 4-digit PIN for authentication (legacy method)
   */
  private _generatePin(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  /**
   * Get local network IP addresses (excludes VPN interfaces)
   */
  private _getLocalIPs(): string[] {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];

    // VPN adapter name patterns to exclude
    const vpnPatterns = [
      /nordlynx/i,
      /nordvpn/i,
      /openvpn/i,
      /wireguard/i,
      /tunnel/i,
      /vpn/i,
      /tap-/i,
      /tun\d/i,
      /wg\d/i,
      /proton/i,
      /mullvad/i,
      /express/i,
      /cyberghost/i,
    ];

    // Preferred interface patterns (prioritize these)
    const preferredPatterns = [
      /wifi/i,
      /wi-fi/i,
      /wlan/i,
      /ethernet/i,
      /eth\d/i,
    ];

    const preferredIps: string[] = [];
    const otherIps: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;

      // Skip VPN interfaces
      if (vpnPatterns.some((pattern) => pattern.test(name))) continue;

      const isPreferred = preferredPatterns.some((pattern) =>
        pattern.test(name),
      );

      for (const iface of netInterface) {
        // Skip internal and non-IPv4 addresses
        if (iface.internal || iface.family !== "IPv4") continue;
        // Skip link-local addresses (169.254.x.x)
        if (iface.address.startsWith("169.254.")) continue;
        // Skip VPN-like address ranges (10.x.x.x often used by VPNs)
        // But keep 10.0.0.x which is common for local networks
        if (
          iface.address.startsWith("10.") &&
          !iface.address.startsWith("10.0.0.") &&
          !iface.address.startsWith("10.0.1.")
        ) {
          // Likely a VPN, skip
          continue;
        }

        if (isPreferred) {
          preferredIps.push(iface.address);
        } else {
          otherIps.push(iface.address);
        }
      }
    }

    // Return preferred IPs first, then others
    return [...preferredIps, ...otherIps];
  }

  /**
   * Setup Express routes
   */
  private _setupRoutes(): void {
    // Serve static media files
    const mediaPath = path.join(this._extensionUri.fsPath, "media");
    this._app.use("/media", express.static(mediaPath));

    // Serve codicons (now bundled in media folder)
    // Note: codicons are already served via /media static route

    // Serve PWA manifest
    this._app.get("/manifest.json", (_req, res) => {
      res.json(this._getManifest());
    });

    // Serve service worker
    this._app.get("/sw.js", (_req, res) => {
      res.type("application/javascript");
      res.send(this._getServiceWorker());
    });

    // API: Get session info (for dashboard)
    this._app.get("/api/sessions", (_req, res) => {
      const sessions = this._getAllSessions();
      res.json(sessions);
    });

    // Landing page (PIN entry / session selector)
    this._app.get("/", (req, res) => {
      // If PIN is provided in URL, redirect to app
      const pin = req.query.pin as string;
      if (pin && pin === this._pin) {
        res.redirect("/app?pin=" + pin);
        return;
      }
      res.send(this._getLandingPageHtml());
    });

    // Main app (requires PIN authentication)
    this._app.get("/app", (req, res) => {
      const pin = req.query.pin as string;
      if (pin !== this._pin) {
        res.redirect("/?error=invalid_pin");
        return;
      }
      res.send(this._getAppHtml());
    });
  }

  /**
   * Start the server
   * @param preferredPort - Optional port to start on (defaults to config or 3000)
   * @returns The port the server is running on
   */
  public async start(preferredPort?: number): Promise<number> {
    // If already running, return current port
    if (this._server !== null) {
      console.log(
        "[FlowCommand Remote] Server already running on port",
        this._port,
      );
      return this._port;
    }

    const config = vscode.workspace.getConfiguration("flowcommand");
    const configPort = config.get<number>("remotePort", 3000);
    const startPort = preferredPort ?? configPort;

    // Find available port
    this._port = await this._findAvailablePort(startPort);

    return new Promise((resolve, reject) => {
      try {
        this._server = this._app.listen(this._port, "0.0.0.0", () => {
          try {
            this._setupSocketIO();
            this._setupFileWatchers();
            this._setupTerminalWatchers();
            this._setupDebugTracker();
            this._registerSession();

            const info = this.getConnectionInfo();
            console.log(
              `[FlowCommand Remote] Server started on port ${this._port}`,
            );
            console.log(`[FlowCommand Remote] PIN: ${this._pin}`);
            console.log(`[FlowCommand Remote] URLs: ${info.urls.join(", ")}`);

            resolve(this._port);
          } catch (setupErr) {
            console.error("[FlowCommand Remote] Setup error:", setupErr);
            // Clean up on setup failure
            this.stop();
            reject(setupErr);
          }
        });

        this._server.on("error", (err) => {
          console.error("[FlowCommand Remote] Server error:", err);
          this._server = null;
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Find an available port starting from the given port
   */
  private async _findAvailablePort(startPort: number): Promise<number> {
    const maxAttempts = 100;

    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      const isAvailable = await this._isPortAvailable(port);
      if (isAvailable) {
        return port;
      }
    }

    throw new Error(
      `Could not find available port after ${maxAttempts} attempts starting from ${startPort}`,
    );
  }

  /**
   * Check if a port is available (non-blocking with timeout)
   */
  private _isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const testServer = http.createServer();
      let resolved = false;

      // Timeout after 5 seconds to prevent hanging
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            testServer.close(() => {});
          } catch (e) {
            // Server may already be closing/closed
          }
          resolve(false); // Assume unavailable on timeout
        }
      }, 5000);

      testServer.once("error", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(false);
        }
      });

      testServer.once("listening", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          testServer.close(() => {
            resolve(true);
          });
        }
      });

      testServer.listen(port, "0.0.0.0");
    });
  }

  /**
   * Setup debug adapter tracker for capturing debug console output
   */
  private _setupDebugTracker(): void {
    // Avoid duplicate registration
    if (this._debugTrackerDisposable) {
      return;
    }

    try {
      // Register debug adapter tracker factory for all debug types
      this._debugTrackerDisposable =
        vscode.debug.registerDebugAdapterTrackerFactory("*", {
          createDebugAdapterTracker: (session) => {
            return {
              onWillReceiveMessage: (message: {
                type?: string;
                event?: string;
                body?: { category?: string; output?: string };
              }) => {
                try {
                  // Capture output events
                  if (message.type === "event" && message.event === "output") {
                    const body = message.body;
                    if (body?.output) {
                      const entry = {
                        type: body.category || "console",
                        message: body.output.replace(/\r?\n$/, ""), // Trim trailing newline
                        timestamp: Date.now(),
                        session: session.name,
                      };

                      // Add to buffer (keep last 500)
                      this._debugOutput.push(entry);
                      if (this._debugOutput.length > 500) {
                        this._debugOutput.shift();
                      }

                      // Broadcast to all connected clients (only if we have connections)
                      if (this._authenticatedSockets.size > 0) {
                        this.broadcast({
                          type: "debugOutput",
                          entry,
                        });
                      }
                    }
                  }
                } catch (err) {
                  // Don't let debug tracking errors crash the extension
                  console.error(
                    "[FlowCommand Remote] Debug tracker error:",
                    err,
                  );
                }
              },
            };
          },
        });
    } catch (err) {
      console.error("[FlowCommand Remote] Failed to setup debug tracker:", err);
    }
  }

  /**
   * Setup file system watchers for real-time updates
   */
  private _setupFileWatchers(): void {
    // Avoid duplicate registration
    if (this._fileWatchers.length > 0) {
      return;
    }

    try {
      // Watch for file changes
      const changeWatcher = vscode.workspace.onDidChangeTextDocument((e) => {
        try {
          if (this._authenticatedSockets.size === 0) return;

          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders?.length) return;

          const relativePath = vscode.workspace.asRelativePath(e.document.uri);
          // Skip if outside workspace or is settings file
          if (relativePath.startsWith("..") || relativePath.includes(".vscode"))
            return;

          const content = e.document.getText();
          const contentBytes = Buffer.byteLength(content, "utf8");
          const payload: RemoteMessage = {
            type: "fileChanged",
            path: relativePath,
            content: contentBytes <= this._MAX_FILE_CHANGE_BYTES ? content : "",
            contentBytes,
            truncated: contentBytes > this._MAX_FILE_CHANGE_BYTES,
          };

          this._queueFileChangeBroadcast(relativePath, payload);
        } catch (err) {
          console.error("[FlowCommand Remote] File change watcher error:", err);
        }
      });

      // Watch for file creation
      const createWatcher = vscode.workspace.onDidCreateFiles((e) => {
        try {
          if (this._authenticatedSockets.size === 0) return;

          for (const file of e.files) {
            const relativePath = vscode.workspace.asRelativePath(file);
            if (!relativePath.startsWith("..")) {
              this.broadcast({
                type: "fileCreated",
                path: relativePath,
              });
            }
          }
        } catch (err) {
          console.error("[FlowCommand Remote] File create watcher error:", err);
        }
      });

      // Watch for file deletion
      const deleteWatcher = vscode.workspace.onDidDeleteFiles((e) => {
        try {
          if (this._authenticatedSockets.size === 0) return;

          for (const file of e.files) {
            const relativePath = vscode.workspace.asRelativePath(file);
            if (!relativePath.startsWith("..")) {
              this.broadcast({
                type: "fileDeleted",
                path: relativePath,
              });
            }
          }
        } catch (err) {
          console.error("[FlowCommand Remote] File delete watcher error:", err);
        }
      });

      // Watch for file rename
      const renameWatcher = vscode.workspace.onDidRenameFiles((e) => {
        try {
          if (this._authenticatedSockets.size === 0) return;

          for (const file of e.files) {
            const oldPath = vscode.workspace.asRelativePath(file.oldUri);
            const newPath = vscode.workspace.asRelativePath(file.newUri);
            if (!newPath.startsWith("..")) {
              this.broadcast({
                type: "fileRenamed",
                oldPath,
                newPath,
              });
            }
          }
        } catch (err) {
          console.error("[FlowCommand Remote] File rename watcher error:", err);
        }
      });

      this._fileWatchers.push(
        changeWatcher,
        createWatcher,
        deleteWatcher,
        renameWatcher,
      );
    } catch (err) {
      console.error("[FlowCommand Remote] Failed to setup file watchers:", err);
    }
  }

  /**
   * Setup terminal watchers for real-time updates
   */
  private _setupTerminalWatchers(): void {
    // Avoid duplicate registration
    if (this._terminalWatchers.length > 0) {
      return;
    }

    try {
      // Watch terminal open
      const openWatcher = vscode.window.onDidOpenTerminal((terminal) => {
        try {
          if (this._authenticatedSockets.size === 0) return;
          this.broadcast({
            type: "terminalOpened",
            terminals: this._getTerminalList(),
          });
        } catch (err) {
          console.error(
            "[FlowCommand Remote] Terminal open watcher error:",
            err,
          );
        }
      });

      // Watch terminal close
      const closeWatcher = vscode.window.onDidCloseTerminal((terminal) => {
        try {
          if (this._authenticatedSockets.size === 0) return;
          this.broadcast({
            type: "terminalClosed",
            terminals: this._getTerminalList(),
          });
        } catch (err) {
          console.error(
            "[FlowCommand Remote] Terminal close watcher error:",
            err,
          );
        }
      });

      // Watch terminal active change
      const activeWatcher = vscode.window.onDidChangeActiveTerminal(
        (terminal) => {
          try {
            if (this._authenticatedSockets.size === 0) return;
            const index = terminal
              ? vscode.window.terminals.indexOf(terminal)
              : -1;
            this.broadcast({
              type: "terminalActiveChanged",
              activeTerminalId: index,
            });
          } catch (err) {
            console.error(
              "[FlowCommand Remote] Terminal active watcher error:",
              err,
            );
          }
        },
      );

      this._terminalWatchers.push(openWatcher, closeWatcher, activeWatcher);
    } catch (err) {
      console.error(
        "[FlowCommand Remote] Failed to setup terminal watchers:",
        err,
      );
    }
  }

  /**
   * Setup Socket.IO for real-time communication
   */
  private _setupSocketIO(): void {
    if (!this._server) return;

    // Create Socket.IO server - socket.io is now external, so use default transports
    this._io = new SocketIOServer(this._server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this._io.on("connection", (socket: Socket) => {
      console.log("[FlowCommand Remote] Client connected:", socket.id);

      // Handle authentication
      socket.on("authenticate", (data: { pin: string }) => {
        console.log(
          "[FlowCommand Remote] Auth attempt with PIN:",
          data.pin,
          "Expected:",
          this._pin,
        );
        if (data.pin === this._pin) {
          this._authenticatedSockets.add(socket.id);
          socket.emit("authenticated", { success: true });
          console.log("[FlowCommand Remote] Socket authenticated:", socket.id);

          // Send initial state
          if (this._getStateCallback) {
            const state = this._getStateCallback();
            console.log(
              "[FlowCommand Remote] Sending initial state:",
              JSON.stringify(state).substring(0, 200),
            );
            socket.emit("initialState", state);
          } else {
            console.log("[FlowCommand Remote] No getStateCallback registered!");
          }
        } else {
          socket.emit("authenticated", {
            success: false,
            message: "Invalid PIN",
          });
          console.log("[FlowCommand Remote] Auth failed for:", socket.id);
        }
      });

      // Handle messages from authenticated clients
      socket.on("message", (message: RemoteMessage) => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }

        if (this._onMessageCallback) {
          this._onMessageCallback(message, (response) => {
            socket.emit("message", response);
          });
        }
      });

      // Manual state refresh request
      socket.on("getState", () => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        if (this._getStateCallback) {
          const state = this._getStateCallback();
          socket.emit("initialState", state);
        }
      });

      socket.on("disconnect", () => {
        console.log("[FlowCommand Remote] Client disconnected:", socket.id);
        this._authenticatedSockets.delete(socket.id);
      });

      // File tree request
      socket.on("getFileTree", async (data: { path?: string }) => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        try {
          const tree = await this._getFileTree(data.path);
          socket.emit("fileTree", tree);
        } catch (err) {
          socket.emit("error", { message: "Failed to get file tree" });
        }
      });

      // File content request
      socket.on("getFileContent", async (data: { path: string }) => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        try {
          const content = await this._getFileContent(data.path);
          socket.emit("fileContent", { path: data.path, content });
        } catch (err) {
          socket.emit("error", { message: "Failed to read file" });
        }
      });

      // Terminal list request
      socket.on("getTerminals", () => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        const terminals = this._getTerminalList();
        socket.emit("terminalList", terminals);
      });

      // Terminal input (send command)
      socket.on(
        "terminalInput",
        (data: { terminalId: number; text: string }) => {
          if (!this._authenticatedSockets.has(socket.id)) {
            socket.emit("error", { message: "Not authenticated" });
            return;
          }
          this._sendTerminalInput(data.terminalId, data.text);
        },
      );

      // Terminal history request
      socket.on("getTerminalHistory", () => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        if (this._getTerminalHistoryCallback) {
          const history = this._getTerminalHistoryCallback();
          socket.emit("terminalHistory", history);
        }
      });

      // Problems/diagnostics request
      socket.on("getProblems", () => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        if (this._getProblemsCallback) {
          const problems = this._getProblemsCallback();
          socket.emit("problems", problems);
        }
      });

      // Debug console output request
      socket.on("getDebugOutput", () => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        socket.emit("debugOutput", this._debugOutput);
      });

      // Forwarded ports request
      socket.on("getPorts", async () => {
        if (!this._authenticatedSockets.has(socket.id)) {
          socket.emit("error", { message: "Not authenticated" });
          return;
        }
        const ports = await this._getForwardedPorts();
        socket.emit("ports", ports);
      });
    });
  }

  /**
   * Get forwarded ports from VS Code
   * Note: VS Code doesn't expose a public API for accessing forwarded ports
   * This will need to be implemented when VS Code adds such an API
   */
  private async _getForwardedPorts(): Promise<
    { port: number; label?: string; url?: string }[]
  > {
    // VS Code doesn't currently expose a public API for accessing forwarded ports
    // The UI is ready, but we can't get port data without the Remote Development extension
    // Return empty array for now
    return [];
  }

  /**
   * Get file tree for a directory
   */
  private async _getFileTree(
    relativePath?: string,
  ): Promise<
    { name: string; path: string; isDirectory: boolean; children?: unknown[] }[]
  > {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      return [];
    }

    const basePath = relativePath
      ? vscode.Uri.joinPath(workspaceFolders[0].uri, relativePath)
      : workspaceFolders[0].uri;

    try {
      const entries = await vscode.workspace.fs.readDirectory(basePath);
      const result: { name: string; path: string; isDirectory: boolean }[] = [];

      // Specific hidden folders to exclude (but allow .github, .gsd, etc.)
      const excludedHiddenFolders = [
        ".git",
        ".vscode",
        ".idea",
        ".venv",
        ".env",
        ".cache",
        ".npm",
        ".yarn",
      ];
      const excludedFolders = [
        "node_modules",
        "__pycache__",
        "venv",
        "dist",
        "build",
        "out",
        "coverage",
      ];

      for (const [name, fileType] of entries) {
        // Skip specific hidden folders and common excludes
        if (
          excludedHiddenFolders.includes(name) ||
          excludedFolders.includes(name)
        ) {
          continue;
        }

        const entryPath = relativePath ? `${relativePath}/${name}` : name;
        result.push({
          name,
          path: entryPath,
          isDirectory: fileType === vscode.FileType.Directory,
        });
      }

      // Sort: directories first, then alphabetically
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return result;
    } catch {
      return [];
    }
  }

  /**
   * Get file content
   */
  private async _getFileContent(relativePath: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      throw new Error("No workspace");
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, relativePath);
    const content = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(content).toString("utf8");
  }

  /**
   * Get list of active terminals with unique names
   */
  private _getTerminalList(): {
    id: number;
    name: string;
    isActive: boolean;
  }[] {
    const terminals = vscode.window.terminals;
    const activeTerminal = vscode.window.activeTerminal;

    // Count occurrences of each name for deduplication
    const nameCounts: Record<string, number> = {};
    const nameIndices: Record<string, number> = {};

    for (const t of terminals) {
      nameCounts[t.name] = (nameCounts[t.name] || 0) + 1;
    }

    return terminals.map((t, index) => {
      let displayName = t.name;

      // Add number suffix for duplicate names
      if (nameCounts[t.name] > 1) {
        nameIndices[t.name] = (nameIndices[t.name] || 0) + 1;
        displayName = `${t.name} (${nameIndices[t.name]})`;
      }

      return {
        id: index,
        name: displayName,
        isActive: t === activeTerminal,
      };
    });
  }

  /**
   * Send text to a terminal
   */
  private _sendTerminalInput(terminalId: number, text: string): void {
    const terminals = vscode.window.terminals;
    if (terminalId >= 0 && terminalId < terminals.length) {
      terminals[terminalId].sendText(text);
    }
  }

  /**
   * Broadcast a message to all authenticated clients
   */
  public broadcast(message: RemoteMessage): void {
    if (!this._io) {
      console.log("[FlowCommand Remote] broadcast: No io instance");
      return;
    }
    if (message.type !== "fileChanged") {
      console.log(
        "[FlowCommand Remote] Broadcasting to",
        this._authenticatedSockets.size,
        "clients:",
        message.type,
      );
    }
    for (const socketId of this._authenticatedSockets) {
      this._io.to(socketId).emit("message", message);
    }
  }

  /**
   * Set callback for handling incoming messages
   */
  public onMessage(
    callback: (
      message: RemoteMessage,
      respond: (msg: RemoteMessage) => void,
    ) => void,
  ): void {
    this._onMessageCallback = callback;
  }

  /**
   * Set callback for getting current state
   */
  public onGetState(callback: () => RemoteState): void {
    this._getStateCallback = callback;
  }

  /**
   * Set callback for getting terminal command history
   */
  public onGetTerminalHistory(callback: () => unknown[]): void {
    this._getTerminalHistoryCallback = callback;
  }

  /**
   * Set callback for getting problems/diagnostics
   */
  public onGetProblems(callback: () => unknown[]): void {
    this._getProblemsCallback = callback;
  }

  /**
   * Register this session in globalState
   */
  private _registerSession(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceName = workspaceFolders?.[0]?.name || "Untitled Workspace";

    const session: SessionInfo = {
      id: this._sessionId,
      workspaceName,
      port: this._port,
      startTime: Date.now(),
      pin: this._pin,
    };

    const sessions = this._context.globalState.get<SessionInfo[]>(
      "flowcommand.remoteSessions",
      [],
    );
    // Remove any stale sessions for this workspace/port
    const filtered = sessions.filter((s) => s.port !== this._port);
    filtered.push(session);
    this._context.globalState.update("flowcommand.remoteSessions", filtered);
  }

  /**
   * Unregister this session from globalState
   */
  private _unregisterSession(): void {
    const sessions = this._context.globalState.get<SessionInfo[]>(
      "flowcommand.remoteSessions",
      [],
    );
    const filtered = sessions.filter((s) => s.id !== this._sessionId);
    this._context.globalState.update("flowcommand.remoteSessions", filtered);
  }

  /**
   * Get all registered sessions
   */
  private _getAllSessions(): SessionInfo[] {
    return this._context.globalState.get<SessionInfo[]>(
      "flowcommand.remoteSessions",
      [],
    );
  }

  /**
   * Get connection info for display
   */
  public getConnectionInfo(): { urls: string[]; pin: string; port: number } {
    const ips = this._getLocalIPs();
    const urls = [
      `http://localhost:${this._port}`,
      ...ips.map((ip) => `http://${ip}:${this._port}`),
    ];
    return {
      urls,
      pin: this._pin,
      port: this._port,
    };
  }

  /**
   * Check if server is running
   */
  public isRunning(): boolean {
    return this._server !== null;
  }

  /**
   * Generate PWA manifest
   */
  private _getManifest(): object {
    return {
      name: "FlowCommand Remote",
      short_name: "FlowCommand",
      description: "Control your VS Code FlowCommand from anywhere",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#1e1e1e",
      theme_color: "#007acc",
      icons: [
        {
          src: "/media/FC-logo.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        },
        {
          src: "/media/FC-logo.svg",
          sizes: "192x192",
          type: "image/svg+xml",
        },
        {
          src: "/media/FC-logo.svg",
          sizes: "512x512",
          type: "image/svg+xml",
        },
      ],
    };
  }

  /**
   * Generate service worker
   */
  private _getServiceWorker(): string {
    return `
const CACHE_NAME = 'flowcommand-remote-v1';
const ASSETS = [
    '/app',
    '/manifest.json',
    '/media/codicon.css',
    '/media/main.css',
    '/media/webview.js',
    '/media/FC-logo.svg'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});
        `.trim();
  }

  /**
   * Helper to escape HTML
   */
  private _escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Generate landing page HTML
   */
  private _getLandingPageHtml(): string {
    const sessions = this._getAllSessions();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="theme-color" content="#1e1e1e" id="theme-color-meta">
    <link rel="manifest" href="/manifest.json">
    <title>FlowCommand Remote</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link href="/media/codicon.css" rel="stylesheet">
    <style>
        :root {
            --landing-bg: #1e1e1e;
            --landing-fg: #cccccc;
            --landing-fg-muted: #9d9d9d;
            --landing-card-bg: #252526;
            --landing-input-bg: #1e1e1e;
            --landing-input-border: #3c3c3c;
            --landing-accent: #007acc;
            --landing-accent-hover: #0587d4;
            --landing-error: #f48771;
            --landing-error-bg: rgba(244, 135, 113, 0.1);
            --landing-hover-bg: #2a2d2e;
            --landing-code-bg: #2a2d2e;
        }
        body.light-theme {
            --landing-bg: #f3f3f3;
            --landing-fg: #3c3c3c;
            --landing-fg-muted: #717171;
            --landing-card-bg: #ffffff;
            --landing-input-bg: #ffffff;
            --landing-input-border: #cecece;
            --landing-accent: #007acc;
            --landing-accent-hover: #005a9e;
            --landing-error: #cd3131;
            --landing-error-bg: rgba(205, 49, 49, 0.1);
            --landing-hover-bg: #e8e8e8;
            --landing-code-bg: #e8e8e8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--landing-bg);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: var(--landing-fg);
        }
        .container { max-width: 400px; width: 100%; }
        .logo { text-align: center; margin-bottom: 40px; }
        .logo img { width: 64px; height: 64px; margin-bottom: 16px; }
        .logo h1 { font-size: 24px; font-weight: 600; color: var(--landing-fg); }
        .logo p { color: var(--landing-fg-muted); margin-top: 8px; font-size: 14px; }
        .card {
            background: var(--landing-card-bg);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 16px;
        }
        .card h2 {
            font-size: 16px;
            font-weight: 500;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .pin-input {
            display: flex;
            gap: 12px;
            justify-content: center;
            margin-bottom: 20px;
        }
        .pin-digit {
            width: 56px;
            height: 64px;
            text-align: center;
            font-size: 24px;
            font-weight: 600;
            border: 2px solid var(--landing-input-border);
            border-radius: 8px;
            background: var(--landing-input-bg);
            color: var(--landing-fg);
            outline: none;
            transition: border-color 0.2s;
        }
        .pin-digit:focus { border-color: var(--landing-accent); }
        .btn {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: opacity 0.2s, background-color 0.2s;
        }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: var(--landing-accent); color: white; }
        .btn-primary:hover:not(:disabled) { background: var(--landing-accent-hover); }
        .error {
            color: var(--landing-error);
            text-align: center;
            padding: 12px;
            background: var(--landing-error-bg);
            border-radius: 8px;
            margin-top: 16px;
        }
        .session-list { display: flex; flex-direction: column; gap: 8px; }
        .session-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: var(--landing-input-bg);
            border-radius: 8px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .session-item:hover { background: var(--landing-hover-bg); }
        .session-item.current { border: 1px solid var(--landing-accent); }
        .session-icon {
            width: 40px;
            height: 40px;
            background: var(--landing-accent);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .session-info { flex: 1; }
        .session-name { font-weight: 500; }
        .session-port { font-size: 12px; color: var(--landing-fg-muted); }
        .session-badge {
            font-size: 10px;
            background: var(--landing-accent);
            color: white;
            padding: 2px 8px;
            border-radius: 10px;
        }
        .help-text {
            text-align: center;
            color: #6d6d6d;
            font-size: 12px;
            margin-top: 16px;
        }
        .help-text code {
            background: var(--landing-code-bg);
            padding: 2px 6px;
            border-radius: 4px;
        }
        /* Apply light theme based on system preference */
        @media (prefers-color-scheme: light) {
            :root {
                --landing-bg: #f3f3f3;
                --landing-fg: #3c3c3c;
                --landing-fg-muted: #717171;
                --landing-card-bg: #ffffff;
                --landing-input-bg: #ffffff;
                --landing-input-border: #cecece;
                --landing-accent: #007acc;
                --landing-accent-hover: #005a9e;
                --landing-error: #cd3131;
                --landing-error-bg: rgba(205, 49, 49, 0.1);
                --landing-hover-bg: #e8e8e8;
                --landing-code-bg: #e8e8e8;
            }
        }
    </style>
    <script>
        // Update theme-color meta for mobile browsers based on system preference
        (function() {
            var metaTheme = document.getElementById('theme-color-meta');
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                metaTheme.setAttribute('content', '#f3f3f3');
            }
            // Listen for system theme changes
            window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function(e) {
                metaTheme.setAttribute('content', e.matches ? '#f3f3f3' : '#1e1e1e');
            });
        })();
    </script>
</head>
<body>
    <div class="container">
        <div class="logo">
            <img src="/media/FC-logo.svg" alt="FlowCommand">
            <h1>FlowCommand Remote</h1>
            <p>Control your VS Code from anywhere</p>
        </div>
        
        <div class="card">
            <h2><span class="codicon codicon-key"></span> Enter PIN</h2>
            <form id="pin-form">
                <div class="pin-input">
                    <input type="tel" class="pin-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" autofocus>
                    <input type="tel" class="pin-digit" maxlength="1" inputmode="numeric" pattern="[0-9]">
                    <input type="tel" class="pin-digit" maxlength="1" inputmode="numeric" pattern="[0-9]">
                    <input type="tel" class="pin-digit" maxlength="1" inputmode="numeric" pattern="[0-9]">
                </div>
                <button type="submit" class="btn btn-primary" id="connect-btn" disabled>
                    <span class="codicon codicon-plug"></span> Connect
                </button>
            </form>
            <div class="error" id="error" style="display: none;"></div>
        </div>
        
        ${
          sessions.length > 0
            ? `
        <div class="card">
            <h2><span class="codicon codicon-server"></span> Active Sessions</h2>
            <div class="session-list">
                ${sessions
                  .map(
                    (s) => `
                    <div class="session-item ${s.id === this._sessionId ? "current" : ""}"
                         data-port="${s.port}"
                         onclick="selectSession(${s.port})">
                        <div class="session-icon">
                            <span class="codicon codicon-folder"></span>
                        </div>
                        <div class="session-info">
                            <div class="session-name">${this._escapeHtml(s.workspaceName)}</div>
                            <div class="session-port">Port ${s.port}</div>
                        </div>
                        ${s.id === this._sessionId ? '<span class="session-badge">Current</span>' : ""}
                    </div>
                `,
                  )
                  .join("")}
            </div>
        </div>
        `
            : ""
        }
        
        <p class="help-text">
            Find the PIN in VS Code's Output panel → <code>FlowCommand Remote</code>
        </p>
    </div>
    
    <script>
        const inputs = document.querySelectorAll('.pin-digit');
        const form = document.getElementById('pin-form');
        const connectBtn = document.getElementById('connect-btn');
        const errorDiv = document.getElementById('error');
        
        // Check URL for error
        const urlParams = new URLSearchParams(window.location.search);
        const hasError = urlParams.get('error') === 'invalid_pin';
        
        if (hasError) {
            // Clear saved PIN since it was invalid
            try {
                localStorage.removeItem('flowcommand_pin');
            } catch (e) {}
            errorDiv.textContent = 'Invalid PIN. Please try again.';
            errorDiv.style.display = 'block';
        } else {
            // Try to auto-redirect with saved PIN from PWA mode
            try {
                const savedPin = localStorage.getItem('flowcommand_pin');
                if (savedPin && savedPin.length === 4) {
                    // Redirect to app with saved PIN
                    window.location.href = '/app?pin=' + savedPin;
                }
            } catch (e) {}
        }
        
        // PIN input handling
        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                const value = e.target.value;
                if (value.length === 1) {
                    if (index < inputs.length - 1) {
                        inputs[index + 1].focus();
                    }
                }
                checkPin();
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && index > 0) {
                    inputs[index - 1].focus();
                }
            });
            
            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const paste = (e.clipboardData || window.clipboardData).getData('text');
                const digits = paste.replace(/\\D/g, '').slice(0, 4);
                digits.split('').forEach((digit, i) => {
                    if (inputs[i]) inputs[i].value = digit;
                });
                if (digits.length === 4) inputs[3].focus();
                checkPin();
            });
        });
        
        function checkPin() {
            const pin = Array.from(inputs).map(i => i.value).join('');
            connectBtn.disabled = pin.length !== 4;
        }
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const pin = Array.from(inputs).map(i => i.value).join('');
            window.location.href = '/app?pin=' + pin;
        });
        
        function selectSession(port) {
            if (port !== ${this._port}) {
                const currentUrl = new URL(window.location.href);
                currentUrl.port = port;
                window.location.href = currentUrl.origin + '/';
            }
        }
    </script>
</body>
</html>`;
  }

  /**
   * Generate main app HTML
   */
  private _getAppHtml(): string {
    // Load webview.js and main.css from media folder
    const webviewJsPath = path.join(
      this._extensionUri.fsPath,
      "media",
      "webview.js",
    );
    const mainCssPath = path.join(
      this._extensionUri.fsPath,
      "media",
      "main.css",
    );

    let webviewJs = "";
    let mainCss = "";

    try {
      webviewJs = fs.readFileSync(webviewJsPath, "utf8");
      mainCss = fs.readFileSync(mainCssPath, "utf8");
    } catch (err) {
      console.error("[FlowCommand Remote] Failed to read media files:", err);
    }

    // CSS variable fallbacks for browser (VS Code provides these in webview)
    const cssVariableFallbacks = `
        :root {
            --vscode-font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            --vscode-font-size: 14px;
            --vscode-font-weight: 400;
            --vscode-foreground: #cccccc;
            --vscode-descriptionForeground: #9d9d9d;
            --vscode-errorForeground: #f48771;
            --vscode-editorWarning-foreground: #cca700;
            --vscode-focusBorder: #007fd4;
            --vscode-sideBar-background: #1e1e1e;
            --vscode-editor-background: #1e1e1e;
            --vscode-input-background: #3c3c3c;
            --vscode-input-foreground: #cccccc;
            --vscode-input-border: #3c3c3c;
            --vscode-input-placeholderForeground: #8c8c8c;
            --vscode-dropdown-background: #3c3c3c;
            --vscode-dropdown-border: #3c3c3c;
            --vscode-button-background: #0e639c;
            --vscode-button-foreground: #ffffff;
            --vscode-button-hoverBackground: #1177bb;
            --vscode-button-secondaryBackground: #3a3d41;
            --vscode-button-secondaryForeground: #ffffff;
            --vscode-button-secondaryHoverBackground: #45494e;
            --vscode-badge-background: #4d4d4d;
            --vscode-badge-foreground: #ffffff;
            --vscode-list-hoverBackground: #2a2d2e;
            --vscode-list-activeSelectionBackground: #094771;
            --vscode-list-activeSelectionForeground: #ffffff;
            --vscode-panel-border: #2b2b2b;
            --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);
            --vscode-scrollbarSlider-background: rgba(121, 121, 121, 0.4);
            --vscode-scrollbarSlider-hoverBackground: rgba(100, 100, 100, 0.7);
            --vscode-scrollbarSlider-activeBackground: rgba(191, 191, 191, 0.4);
        }
        
        /* Light theme variables */
        body.light-theme {
            --vscode-foreground: #3c3c3c;
            --vscode-descriptionForeground: #717171;
            --vscode-errorForeground: #cd3131;
            --vscode-editorWarning-foreground: #bf8803;
            --vscode-focusBorder: #0090f1;
            --vscode-sideBar-background: #f3f3f3;
            --vscode-editor-background: #ffffff;
            --vscode-input-background: #ffffff;
            --vscode-input-foreground: #3c3c3c;
            --vscode-input-border: #cecece;
            --vscode-input-placeholderForeground: #767676;
            --vscode-dropdown-background: #ffffff;
            --vscode-dropdown-border: #cecece;
            --vscode-button-background: #007acc;
            --vscode-button-foreground: #ffffff;
            --vscode-button-hoverBackground: #005a9e;
            --vscode-button-secondaryBackground: #e8e8e8;
            --vscode-button-secondaryForeground: #3c3c3c;
            --vscode-button-secondaryHoverBackground: #d9d9d9;
            --vscode-badge-background: #c4c4c4;
            --vscode-badge-foreground: #3c3c3c;
            --vscode-list-hoverBackground: #e8e8e8;
            --vscode-list-activeSelectionBackground: #0060c0;
            --vscode-list-activeSelectionForeground: #ffffff;
            --vscode-panel-border: #e0e0e0;
            --vscode-toolbar-hoverBackground: rgba(184, 184, 184, 0.31);
            --vscode-scrollbarSlider-background: rgba(100, 100, 100, 0.4);
            --vscode-scrollbarSlider-hoverBackground: rgba(100, 100, 100, 0.7);
            --vscode-scrollbarSlider-activeBackground: rgba(0, 0, 0, 0.6);
        }`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="FlowCommand">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="theme-color" content="#1e1e1e">
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/media/FC-logo.svg">
    <title>FlowCommand Remote</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link href="/media/codicon.css" rel="stylesheet">
    <style>
        ${cssVariableFallbacks}
        ${mainCss}
        
        body {
            height: 100vh;
            height: 100dvh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            margin: 0;
            padding: 0;
            background-color: var(--vscode-editor-background);
        }
        
        .main-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            height: 100%;
            position: relative;
        }
        
        .chat-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding-bottom: 20px;
        }
        
        .input-area-container {
            position: relative;
            flex-shrink: 0;
            padding: 8px;
            overflow: visible;
            z-index: 100;
        }
        
        /* ── File Autocomplete (#) dropdown ── */
        .autocomplete-dropdown {
            position: absolute;
            bottom: calc(100% + 4px);
            left: 0;
            right: 0;
            max-height: 200px;
            background: #252526;
            border: 1px solid #454545;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            overflow: hidden;
            z-index: 1000;
        }
        .autocomplete-list {
            max-height: 180px;
            overflow-y: auto;
        }
        .autocomplete-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            color: #cccccc;
            transition: background-color 0.1s ease;
        }
        .autocomplete-item:hover,
        .autocomplete-item.selected {
            background: #094771;
        }
        .autocomplete-item-icon {
            display: flex;
            align-items: center;
            color: #9d9d9d;
        }
        .autocomplete-item-content {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }
        .autocomplete-item-name {
            font-size: 13px;
            color: #cccccc;
        }
        .autocomplete-item-path {
            font-size: 11px;
            color: #9d9d9d;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .autocomplete-empty {
            padding: 12px;
            text-align: center;
            font-size: 12px;
            color: #9d9d9d;
        }

        /* ── Slash Command (/) dropdown ── */
        .slash-dropdown {
            position: absolute;
            bottom: calc(100% + 4px);
            left: 0;
            right: 0;
            max-height: 200px;
            background: #252526;
            border: 1px solid #454545;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            overflow: hidden;
            z-index: 1001;
        }
        .slash-dropdown.hidden {
            display: none;
        }
        .slash-list {
            max-height: 180px;
            overflow-y: auto;
        }
        .slash-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 12px;
            cursor: pointer;
            transition: background-color 0.1s ease;
            border-bottom: 1px solid #333333;
            color: #cccccc;
        }
        .slash-item:last-child {
            border-bottom: none;
        }
        .slash-item:hover,
        .slash-item.selected {
            background: #094771;
        }
        .slash-item-icon {
            display: flex;
            align-items: center;
            color: #3794ff;
            padding-top: 2px;
        }
        .slash-item-content {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .slash-item-name {
            font-size: 13px;
            font-weight: 500;
            color: #3794ff;
        }
        .slash-item-preview {
            font-size: 11px;
            color: #9d9d9d;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 250px;
        }
        .slash-empty {
            padding: 12px;
            text-align: center;
            font-size: 12px;
            color: #9d9d9d;
        }
        
        /* Connection status indicator */
        .connection-status {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            padding: 8px 16px;
            text-align: center;
            font-size: 12px;
            font-weight: 500;
            z-index: 9999;
            transition: transform 0.3s ease;
        }
        
        .connection-status.connected {
            background: linear-gradient(135deg, #22c55e, #16a34a);
            color: white;
            transform: translateY(-100%);
        }
        
        .connection-status.connecting {
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: white;
        }
        
        .connection-status.disconnected {
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: white;
        }
        
        .connection-status.show {
            transform: translateY(0);
        }
        
        /* Remote header */
        .remote-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
        }
        
        .remote-header-left {
            flex-shrink: 1;
            min-width: 0;
        }
        
        .remote-header-actions {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            gap: 2px;
        }
        
        .remote-header-title {
            font-size: 16px;
            font-weight: 600;
        }
        
        .remote-header-btn {
            background: transparent;
            border: none;
            color: #cccccc;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
        }
        
        .remote-header-btn:hover {
            background: #3c3c3c;
        }
        
        /* Tab Navigation */
        .remote-tabs {
            display: flex;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
            padding: 0 8px;
        }
        
        .remote-tab {
            flex: 1;
            padding: 10px 12px;
            background: transparent;
            border: none;
            color: #9d9d9d;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
            border-bottom: 2px solid transparent;
        }
        
        .remote-tab:hover {
            color: #cccccc;
            background: rgba(255,255,255,0.05);
        }
        
        .remote-tab.active {
            color: #cccccc;
            border-bottom-color: #007acc;
        }
        
        /* Tab Content */
        .tab-content {
            display: none;
            flex: 1;
            overflow: hidden;
        }
        
        .tab-content.active {
            display: flex;
            flex-direction: column;
        }
        
        /* File Browser */
        .file-browser {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }
        
        .file-browser-header {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
            gap: 8px;
        }
        
        .file-nav-btn {
            background: transparent;
            border: none;
            color: #cccccc;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
        }
        
        .file-nav-btn:hover {
            background: #3c3c3c;
        }
        
        .file-path {
            flex: 1;
            font-size: 12px;
            color: #9d9d9d;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .file-tree {
            flex: 1;
            overflow-y: auto;
            padding: 8px 0;
        }
        
        .file-item {
            display: flex;
            align-items: center;
            padding: 6px 16px;
            cursor: pointer;
            gap: 8px;
            color: #cccccc;
            font-size: 13px;
        }
        
        .file-item:hover {
            background: rgba(255,255,255,0.05);
        }
        
        .file-item.directory {
            color: #dcb67a;
        }
        
        .file-loading {
            padding: 20px;
            text-align: center;
            color: #9d9d9d;
        }
        
        /* File Viewer */
        .file-viewer {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            z-index: 100;
        }
        
        .file-viewer.hidden {
            display: none;
        }
        
        .file-viewer-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
        }
        
        .file-viewer-name {
            font-size: 13px;
            font-weight: 500;
        }
        
        .file-viewer-close {
            background: transparent;
            border: none;
            color: #cccccc;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
        }
        
        .file-viewer-close:hover {
            background: #3c3c3c;
        }
        
        .file-viewer-content {
            flex: 1;
            overflow: auto;
            padding: 12px 16px;
            margin: 0;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        /* Terminal Panel */
        .terminal-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }
        
        .terminal-selector {
            padding: 8px 12px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
        }
        
        .terminal-selector select {
            width: 100%;
            padding: 6px 10px;
            background: #3c3c3c;
            border: 1px solid #555;
            color: #cccccc;
            border-radius: 4px;
            font-size: 13px;
        }
        
        .terminal-output {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            font-family: 'Consolas', 'Monaco', 'Menlo', monospace;
            font-size: 13px;
            line-height: 1.4;
            white-space: pre-wrap;
            word-wrap: break-word;
            background: #0c0c0c;
        }
        
        .terminal-placeholder {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #6a6a6a;
            gap: 8px;
        }
        
        .terminal-placeholder .codicon {
            font-size: 24px;
        }
        
        .terminal-input-area {
            display: flex;
            padding: 8px 12px;
            background: #252526;
            border-top: 1px solid #3c3c3c;
            gap: 8px;
        }
        
        .terminal-input-area input {
            flex: 1;
            padding: 8px 12px;
            background: #3c3c3c;
            border: 1px solid #555;
            color: #cccccc;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
        }
        
        .terminal-input-area button {
            padding: 8px 12px;
            background: #0e639c;
            border: none;
            color: white;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .terminal-input-area button:hover {
            background: #1177bb;
        }
        
        /* Terminal command entries - more compact, terminal-like */
        .terminal-cmd-entry {
            padding: 4px 0;
            border-bottom: none;
        }
        
        .terminal-cmd-entry.new-entry {
            animation: flash 0.5s;
        }
        
        @keyframes flash {
            0% { background: rgba(78, 201, 176, 0.2); }
            100% { background: transparent; }
        }
        
        .terminal-cmd-header {
            display: none;  /* Hide header for cleaner terminal look */
        }
        
        .terminal-cmd-name {
            color: #569cd6;
            font-weight: 500;
        }
        
        .terminal-copy-btn {
            position: absolute;
            right: 8px;
            top: 4px;
            background: transparent;
            border: none;
            color: #666;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            opacity: 0;
            transition: all 0.2s;
        }
        
        .terminal-cmd-entry:hover .terminal-copy-btn {
            opacity: 1;
        }
        
        .terminal-copy-btn:hover {
            background: #333;
            color: #ccc;
        }
        
        .terminal-cwd {
            color: #569cd6;
            font-size: 12px;
            margin-bottom: 2px;
        }
        
        .terminal-cmd-line {
            margin-bottom: 2px;
            line-height: 1.5;
            position: relative;
        }
        
        .terminal-prompt {
            color: #4ec9b0;
            font-weight: 600;
        }
        
        .terminal-command {
            color: #e5e5e5;
        }
        
        .terminal-cmd-output {
            color: #cccccc;
            background: transparent;
            border-left: none;
            padding: 0;
            margin: 0 0 4px 0;
            border-radius: 0;
            white-space: pre-wrap;
            max-height: none;
            overflow-y: visible;
            font-size: 13px;
            line-height: 1.4;
        }
        
        .terminal-cmd-exit {
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 3px;
            display: inline-block;
            margin-top: 2px;
            margin-bottom: 8px;
        }
        
        .terminal-cmd-exit.success {
            background: rgba(78, 201, 176, 0.15);
            color: #4ec9b0;
            border: 1px solid #4ec9b033;
        }
        
        .terminal-cmd-exit.error {
            background: rgba(244, 135, 113, 0.15);
            color: #f48771;
            border: 1px solid #f4877133;
        }
        
        /* Problems Panel */
        .problems-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }
        
        .problems-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
        }
        
        .problems-title {
            font-weight: 500;
        }
        
        .problems-refresh {
            background: transparent;
            border: none;
            color: #cccccc;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
        }
        
        .problems-refresh:hover {
            background: #3c3c3c;
        }
        
        .problems-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px 0;
        }
        
        .problems-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #4ec9b0;
            gap: 12px;
        }
        
        .problems-empty .codicon {
            font-size: 32px;
        }
        
        .problems-file {
            margin-bottom: 8px;
        }
        
        .problems-file-header {
            display: flex;
            align-items: center;
            padding: 6px 16px;
            background: rgba(255,255,255,0.03);
            gap: 8px;
            font-size: 13px;
        }
        
        .problems-count {
            margin-left: auto;
            background: #4d4d4d;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 11px;
        }
        
        .problems-file-items {
            padding-left: 16px;
        }
        
        .problem-item {
            display: flex;
            align-items: flex-start;
            padding: 4px 16px;
            gap: 8px;
            font-size: 12px;
        }
        
        .problem-item.error .codicon { color: #f48771; }
        .problem-item.warning .codicon { color: #cca700; }
        .problem-item.info .codicon { color: #75beff; }
        
        .problem-message {
            flex: 1;
            word-break: break-word;
        }
        
        .problem-location {
            color: #888;
            white-space: nowrap;
        }
        
        /* Output Panel (combined Terminal, Problems, Debug, Ports) */
        .output-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }
        
        .output-header {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
            gap: 8px;
        }
        
        .output-header select {
            flex: 1;
            padding: 6px 10px;
            background: #3c3c3c;
            border: 1px solid #555;
            color: #cccccc;
            border-radius: 4px;
            font-size: 13px;
        }
        
        .output-header select optgroup {
            background: #2d2d2d;
            color: #888;
        }
        
        .output-header select option {
            background: #3c3c3c;
            color: #cccccc;
            padding: 4px;
        }
        
        .output-refresh-btn {
            padding: 6px 10px;
            background: transparent;
            border: 1px solid #555;
            color: #cccccc;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .output-refresh-btn:hover {
            background: #3c3c3c;
        }
        
        .output-view {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        /* Debug console output */
        .debug-output {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            line-height: 1.4;
            background: #1a1a1a;
        }
        
        /* Ports list */
        .ports-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }
        
        .port-item {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background: #2d2d2d;
            border-radius: 4px;
            margin-bottom: 8px;
            gap: 12px;
        }
        
        .port-number {
            font-weight: 600;
            color: #4ec9b0;
            min-width: 60px;
        }
        
        .port-label {
            flex: 1;
            color: #cccccc;
        }
        
        .port-action {
            padding: 4px 8px;
            background: #0e639c;
            border: none;
            border-radius: 4px;
            color: white;
            font-size: 11px;
            cursor: pointer;
        }
        
        .port-action:hover {
            background: #1177bb;
        }
        
        /* Debug console entries */
        .debug-entry {
            display: flex;
            padding: 4px 12px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            gap: 12px;
        }
        
        .debug-entry.error { color: #f48771; }
        .debug-entry.warning { color: #cca700; }
        .debug-entry.info { color: #75beff; }
        
        .debug-time {
            color: #888;
            white-space: nowrap;
        }
        
        .debug-message {
            flex: 1;
            word-break: break-word;
        }
        
        /* Mobile optimizations */
        @media (max-width: 480px) {
            .chat-container { padding-bottom: 10px; }
            .queue-section { margin: 0 8px; }
            .input-container { margin: 0 8px; }
        }
        
        /* Light theme overrides for remote tabs */
        body.light-theme .remote-header {
            background: #f3f3f3;
            border-color: #e0e0e0;
        }
        body.light-theme .remote-header-btn {
            color: #3c3c3c;
        }
        body.light-theme .remote-header-btn:hover {
            background: #e0e0e0;
        }
        body.light-theme .remote-tabs {
            background: #f3f3f3;
            border-color: #e0e0e0;
        }
        body.light-theme .remote-tab {
            color: #717171;
        }
        body.light-theme .remote-tab:hover {
            color: #3c3c3c;
            background: rgba(0,0,0,0.05);
        }
        body.light-theme .remote-tab.active {
            color: #3c3c3c;
        }
        body.light-theme .file-browser,
        body.light-theme .file-header,
        body.light-theme .output-wrapper,
        body.light-theme .output-header {
            background: #f3f3f3;
            border-color: #e0e0e0;
        }
        body.light-theme .file-item,
        body.light-theme .terminal-placeholder {
            color: #3c3c3c;
        }
        body.light-theme .file-item:hover {
            background: #e8e8e8;
        }
        body.light-theme .terminal-output {
            background: #f8f8f8;
            color: #1e1e1e;
        }
        body.light-theme .terminal-cwd {
            color: #0066b8;
        }
        body.light-theme .terminal-prompt {
            color: #0d7377;
        }
        body.light-theme .terminal-command {
            color: #1e1e1e;
        }
        body.light-theme .terminal-cmd-output {
            color: #1e1e1e;
        }
        body.light-theme .terminal-cmd-header {
            background: #f3f3f3;
            border-color: #e0e0e0;
        }
        body.light-theme .terminal-cmd-name,
        body.light-theme .terminal-command {
            color: #3c3c3c;
        }
        body.light-theme .terminal-input-area {
            background: #ffffff;
            border-color: #e0e0e0;
        }
        body.light-theme .terminal-input-area input {
            background: #ffffff;
            color: #3c3c3c;
        }
        body.light-theme .problems-file-header {
            color: #3c3c3c;
        }
        body.light-theme .debug-output {
            background: #f8f8f8;
        }
        body.light-theme .debug-entry {
            color: #3c3c3c;
        }
        body.light-theme .debug-time {
            color: #717171;
        }
        body.light-theme .ports-list {
            background: #ffffff;
        }
        body.light-theme .port-item {
            background: #f3f3f3;
            border: 1px solid #e0e0e0;
        }
        body.light-theme .port-label {
            color: #3c3c3c;
        }
        body.light-theme .file-viewer,
        body.light-theme .file-viewer-header {
            background: #ffffff;
            border-color: #e0e0e0;
        }
        body.light-theme .file-viewer-content {
            background: #f8f8f8;
            color: #3c3c3c;
        }
        /* Light theme: Output dropdown and controls */
        body.light-theme .output-header select {
            background: #ffffff;
            border-color: #c8c8c8;
            color: #3c3c3c;
        }
        body.light-theme .output-header select optgroup {
            background: #f3f3f3;
            color: #717171;
        }
        body.light-theme .output-header select option {
            background: #ffffff;
            color: #3c3c3c;
        }
        body.light-theme .output-refresh-btn {
            background: #ffffff;
            border-color: #c8c8c8;
            color: #3c3c3c;
        }
        body.light-theme .output-refresh-btn:hover {
            background: #e8e8e8;
        }
        /* Light theme: File browser path and list */
        body.light-theme .file-path {
            color: #3c3c3c;
        }
        body.light-theme .file-list {
            background: #ffffff;
        }
        body.light-theme .file-browser-header {
            background: #f3f3f3;
            border-color: #e0e0e0;
        }
        body.light-theme .file-nav-btn {
            color: #3c3c3c;
        }
        body.light-theme .file-nav-btn:hover {
            background: #e0e0e0;
        }
        /* Light theme: Terminal text elements */
        body.light-theme .terminal-cmd-output {
            color: #3c3c3c;
        }
        body.light-theme .terminal-cmd-output pre {
            color: #3c3c3c;
        }
        body.light-theme #terminal-input {
            background: #ffffff;
            color: #3c3c3c;
            border-color: #c8c8c8;
        }
        body.light-theme #terminal-send-btn {
            background: #0078d4;
            color: #ffffff;
        }
        /* Light theme: Problems panel */
        body.light-theme .problem-item {
            background: #ffffff;
            border-color: #e0e0e0;
        }
        body.light-theme .problem-message {
            color: #3c3c3c;
        }
        body.light-theme .problem-source {
            color: #717171;
        }
        /* Light theme: File Autocomplete (#) dropdown */
        body.light-theme .autocomplete-dropdown {
            background: #ffffff;
            border-color: #c8c8c8;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        body.light-theme .autocomplete-item {
            color: #3c3c3c;
        }
        body.light-theme .autocomplete-item:hover,
        body.light-theme .autocomplete-item.selected {
            background: #0060c0;
            color: #ffffff;
        }
        body.light-theme .autocomplete-item:hover .autocomplete-item-icon,
        body.light-theme .autocomplete-item.selected .autocomplete-item-icon,
        body.light-theme .autocomplete-item:hover .autocomplete-item-name,
        body.light-theme .autocomplete-item.selected .autocomplete-item-name,
        body.light-theme .autocomplete-item:hover .autocomplete-item-path,
        body.light-theme .autocomplete-item.selected .autocomplete-item-path {
            color: #ffffff;
        }
        body.light-theme .autocomplete-item-icon {
            color: #717171;
        }
        body.light-theme .autocomplete-item-name {
            color: #3c3c3c;
        }
        body.light-theme .autocomplete-item-path {
            color: #717171;
        }
        body.light-theme .autocomplete-empty {
            color: #717171;
        }
        /* Light theme: Slash Command (/) dropdown */
        body.light-theme .slash-dropdown {
            background: #ffffff;
            border-color: #c8c8c8;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        body.light-theme .slash-item {
            color: #3c3c3c;
            border-bottom-color: #e0e0e0;
        }
        body.light-theme .slash-item:hover,
        body.light-theme .slash-item.selected {
            background: #0060c0;
            color: #ffffff;
        }
        body.light-theme .slash-item:hover .slash-item-icon,
        body.light-theme .slash-item.selected .slash-item-icon,
        body.light-theme .slash-item:hover .slash-item-name,
        body.light-theme .slash-item.selected .slash-item-name,
        body.light-theme .slash-item:hover .slash-item-preview,
        body.light-theme .slash-item.selected .slash-item-preview {
            color: #ffffff;
        }
        body.light-theme .slash-item-icon {
            color: #0066b8;
        }
        body.light-theme .slash-item-name {
            color: #0066b8;
        }
        body.light-theme .slash-item-preview {
            color: #717171;
        }
        body.light-theme .slash-empty {
            color: #717171;
        }
        /* Remote UI: plan review landscape fix — ensure footer stays visible */
        @media (max-height: 500px) and (orientation: landscape) {
            .plan-review-overlay {
                padding: 0;
            }
            .plan-review-modal {
                width: 100%;
                height: 100%;
                max-height: 100dvh;
                border-radius: 0;
                border: none;
            }
            .plan-review-content {
                flex: 1;
                min-height: 0;
                flex-direction: row;
            }
            .plan-review-body {
                min-height: unset;
                flex: 1;
                overflow-y: auto;
            }
            .plan-review-sidebar {
                max-height: none;
                flex: 0 0 160px;
                min-width: 160px;
                overflow-y: auto;
            }
            .plan-review-footer {
                flex-shrink: 0;
                padding: 6px 12px;
            }
        }
    </style>
    <audio id="notification-sound" preload="auto" src="/media/notification.wav"></audio>
</head>
<body>
    <!-- Connection Status -->
    <div class="connection-status connecting show" id="connection-status">
        <span class="codicon codicon-loading codicon-modifier-spin"></span> Connecting...
    </div>
    
    <!--Remote Header -->
    <div class="remote-header">
        <div class="remote-header-left">
            <span class="remote-header-title">FlowCommand</span>
        </div>
        <div class="remote-header-actions">
            <button class="remote-header-btn" id="remote-refresh-btn" title="Refresh">
                <span class="codicon codicon-refresh"></span>
            </button>
            <button class="remote-header-btn" id="prompts-modal-btn" title="Reusable Prompts">
                <span class="codicon codicon-symbol-keyword"></span>
            </button>
            <button class="remote-header-btn" id="settings-modal-btn" title="Settings">
                <span class="codicon codicon-gear"></span>
            </button>
            <button class="remote-header-btn" id="theme-toggle-btn" title="Toggle Theme">
                <span class="codicon codicon-symbol-color"></span>
            </button>
            <button class="remote-header-btn" id="remote-logout-btn" title="Logout">
                <span class="codicon codicon-sign-out"></span>
            </button>
        </div>
    </div>
    
    <!-- Tab Navigation -->
    <div class="remote-tabs">
        <button class="remote-tab active" data-tab="chat">
            <span class="codicon codicon-comment"></span> Chat
        </button>
        <button class="remote-tab" data-tab="files">
            <span class="codicon codicon-folder"></span> Files
        </button>
        <button class="remote-tab" data-tab="output">
            <span class="codicon codicon-output"></span> Output
        </button>
    </div>
    
    <!-- Tab Content: Chat -->
    <div class="tab-content active" id="tab-chat">
    <div class="main-container">
        <!-- Chat Container -->
        <div class="chat-container" id="chat-container">
            <!-- Welcome Section -->
            <div class="welcome-section" id="welcome-section">
                <div class="welcome-icon">
                    <img src="/media/FC-logo.svg" alt="FlowCommand Logo" width="48" height="48" class="welcome-logo">
                </div>
                <h1 class="welcome-title">Let's build</h1>
                <p class="welcome-subtitle">Sync your tasks, automate your workflow</p>
                
                <div class="welcome-cards">
                    <div class="welcome-card welcome-card-vibe" id="card-vibe">
                        <div class="welcome-card-header">
                            <span class="codicon codicon-comment-discussion"></span>
                            <span class="welcome-card-title">Normal</span>
                        </div>
                        <p class="welcome-card-desc">Respond to each AI request directly. Full control over every interaction.</p>
                    </div>
                    <div class="welcome-card welcome-card-spec" id="card-spec">
                        <div class="welcome-card-header">
                            <span class="codicon codicon-layers"></span>
                            <span class="welcome-card-title">Queue</span>
                        </div>
                        <p class="welcome-card-desc">Batch your responses. AI consumes from queue automatically, one by one.</p>
                    </div>
                </div>
            </div>
            
            <!-- Tool Call History Area -->
            <div class="tool-history-area" id="tool-history-area"></div>
            
            <!-- Pending Tool Call Message -->
            <div class="pending-message hidden" id="pending-message"></div>
        </div>
        
        <!-- Input Area Container -->
        <div class="input-area-container" id="input-area-container">
            <!-- File Autocomplete Dropdown -->
            <div class="autocomplete-dropdown hidden" id="autocomplete-dropdown">
                <div class="autocomplete-list" id="autocomplete-list"></div>
                <div class="autocomplete-empty hidden" id="autocomplete-empty">No files found</div>
            </div>
            
            <!-- Slash Command Autocomplete Dropdown -->
            <div class="slash-dropdown hidden" id="slash-dropdown">
                <div class="slash-list" id="slash-list"></div>
                <div class="slash-empty hidden" id="slash-empty">No prompts found. Add prompts in Settings.</div>
            </div>
            
            <div class="input-wrapper" id="input-wrapper">
                <!-- Prompt Queue Section -->
                <div class="queue-section" id="queue-section" role="region" aria-label="Prompt queue">
                    <div class="queue-header" id="queue-header" role="button" tabindex="0" aria-expanded="true" aria-controls="queue-list">
                        <div class="accordion-icon" aria-hidden="true">
                            <span class="codicon codicon-chevron-down"></span>
                        </div>
                        <span class="queue-header-title">Prompt Queue</span>
                        <span class="queue-count" id="queue-count" aria-live="polite">0</span>
                        <button class="queue-clear-btn" id="queue-clear-btn" title="Clear all queue items" aria-label="Clear queue">
                            <span class="codicon codicon-trash" aria-hidden="true"></span>
                        </button>
                    </div>
                    <div class="queue-list" id="queue-list" role="list" aria-label="Queued prompts">
                        <div class="queue-empty" role="status">No prompts in queue</div>
                    </div>
                </div>
                
                <!-- Input Area -->
                <div class="input-container" id="input-container">
                    <div class="chips-container hidden" id="chips-container"></div>
                    <div class="input-row">
                        <div class="input-highlighter-wrapper">
                            <div class="input-highlighter" id="input-highlighter" aria-hidden="true"></div>
                            <textarea id="chat-input" placeholder="Reply to tool call. (use # for files, / for prompts)" rows="1" aria-label="Message input"></textarea>
                        </div>
                    </div>
                    <div class="actions-bar">
                        <div class="actions-left">
                            <div class="mode-selector" id="mode-selector">
                                <button id="mode-btn" class="mode-btn" title="Select mode" aria-label="Select mode">
                                    <span id="mode-label">Queue</span>
                                    <span class="codicon codicon-chevron-down"></span>
                                </button>
                            </div>
                            <button class="queue-pause-btn hidden" id="queue-pause-btn" title="Pause/Resume queue processing" aria-label="Pause queue">
                                <span class="codicon codicon-debug-pause" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="actions-right">
                            <button id="end-session-btn" class="icon-btn end-session-btn" title="End session" aria-label="End session">
                                <span class="codicon codicon-debug-stop"></span>
                            </button>
                            <button id="send-btn" title="Send message" aria-label="Send message">
                                <span class="codicon codicon-arrow-up"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    </div> <!-- End tab-chat -->
    
    <!-- Tab Content: Files -->
    <div class="tab-content" id="tab-files">
        <div class="file-browser">
            <div class="file-browser-header">
                <button class="file-nav-btn" id="file-nav-back" title="Go back">
                    <span class="codicon codicon-arrow-left"></span>
                </button>
                <span class="file-path" id="file-current-path">/</span>
                <button class="file-nav-btn" id="file-nav-refresh" title="Refresh">
                    <span class="codicon codicon-refresh"></span>
                </button>
            </div>
            <div class="file-tree" id="file-tree">
                <div class="file-loading">
                    <span class="codicon codicon-loading codicon-modifier-spin"></span> Loading...
                </div>
            </div>
            <div class="file-viewer hidden" id="file-viewer">
                <div class="file-viewer-header">
                    <span class="file-viewer-name" id="file-viewer-name"></span>
                    <button class="file-viewer-close" id="file-viewer-close">
                        <span class="codicon codicon-close"></span>
                    </button>
                </div>
                <pre class="file-viewer-content" id="file-viewer-content"></pre>
            </div>
        </div>
    </div>
    
    <!-- Tab Content: Output (combined Terminal, Problems, Debug, Ports) -->
    <div class="tab-content" id="tab-output">
        <div class="output-panel">
            <div class="output-header">
                <select id="output-type-select">
                    <optgroup label="Terminals">
                        <!-- Terminal options populated dynamically -->
                    </optgroup>
                    <optgroup label="Other">
                        <option value="problems">Problems</option>
                        <option value="debug">Debug Console</option>
                        <option value="ports">Ports</option>
                    </optgroup>
                </select>
                <button class="output-refresh-btn" id="output-refresh-btn">
                    <span class="codicon codicon-refresh"></span>
                </button>
            </div>
            
            <!-- Terminal View -->
            <div class="output-view" id="output-terminal" style="display: flex;">
                <div class="terminal-output" id="terminal-output">
                    <div class="terminal-placeholder">
                        <span class="codicon codicon-terminal"></span>
                        <p>Select a terminal from dropdown</p>
                    </div>
                </div>
                <div class="terminal-input-area">
                    <input type="text" id="terminal-input" placeholder="Enter command..." />
                    <button id="terminal-send-btn">
                        <span class="codicon codicon-play"></span>
                    </button>
                </div>
            </div>
            
            <!-- Problems View -->
            <div class="output-view" id="output-problems" style="display: none;">
                <div class="problems-list" id="problems-list">
                    <div class="problems-empty">
                        <span class="codicon codicon-check"></span>
                        <p>No problems detected</p>
                    </div>
                </div>
            </div>
            
            <!-- Debug Console View -->
            <div class="output-view" id="output-debug" style="display: none;">
                <div class="debug-output" id="debug-output">
                    <div class="terminal-placeholder">
                        <span class="codicon codicon-debug-console"></span>
                        <p>Debug console output appears here during debugging</p>
                    </div>
                </div>
            </div>
            
            <!-- Ports View -->
            <div class="output-view" id="output-ports" style="display: none;">
                <div class="ports-list" id="ports-list">
                    <div class="terminal-placeholder">
                        <span class="codicon codicon-plug"></span>
                        <p>No forwarded ports</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Mode Selection Dropdown -->
    <div class="mode-dropdown hidden" id="mode-dropdown">
        <div class="mode-option" data-mode="queue">
            <span class="codicon codicon-layers"></span>
            <div class="mode-option-info">
                <span class="mode-option-title">Queue Mode</span>
                <span class="mode-option-desc">Add to queue for batch processing</span>
            </div>
        </div>
        <div class="mode-option" data-mode="normal">
            <span class="codicon codicon-comment-discussion"></span>
            <div class="mode-option-info">
                <span class="mode-option-title">Normal Mode</span>
                <span class="mode-option-desc">Respond directly to current request</span>
            </div>
        </div>
    </div>
    
    <!-- Shim for VS Code API -->
    <script>
        // Get PIN from URL or localStorage (for PWA)
        let PIN = new URLSearchParams(window.location.search).get('pin') || '';
        if (!PIN) {
            try {
                PIN = localStorage.getItem('flowcommand_pin') || '';
            } catch (e) {}
        }
        
        let socket = null;
        let isConnected = false;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 10;
        let currentFilePath = '';  // Track current file path for reconnection refresh
        let lastSuccessTime = Date.now();
        let reconnectTimer = null;
        const STALE_CONNECTION_TIMEOUT = 30000;  // 30 seconds
        
        // Reconnect timer functions (must be defined before initSocket uses them)
        function startReconnectTimer() {
            clearReconnectTimer();
            reconnectTimer = setTimeout(() => {
                if (!isConnected) {
                    updateConnectionStatus('disconnected', '<span class="codicon codicon-error"></span> Connection lost. <a href="javascript:location.reload()">Reload</a>');
                }
            }, 10000);
        }
        
        function clearReconnectTimer() {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        }
        
        // Mock VS Code API state
        let vscodeState = {};
        
        // Message queue for when socket is not ready
        const messageQueue = [];
        
        // VS Code API Mock - MUST be defined before webview.js loads
        window.acquireVsCodeApi = function() {
            return {
                postMessage: function(message) {
                    console.log('[FlowCommand Remote] postMessage:', message.type);
                    if (isConnected && socket) {
                        socket.emit('message', message);
                    } else {
                        messageQueue.push(message);
                    }
                },
                getState: function() {
                    return vscodeState;
                },
                setState: function(state) {
                    vscodeState = state;
                    try {
                        localStorage.setItem('flowcommand_state', JSON.stringify(state));
                    } catch (e) {}
                }
            };
        };
        
        // Restore state from localStorage
        try {
            const saved = localStorage.getItem('flowcommand_state');
            if (saved) vscodeState = JSON.parse(saved);
        } catch (e) {}
        
        // Mobile notification support - default to TRUE for remote clients
        // Remote users explicitly want notifications since they're using the web interface
        window.mobileNotificationEnabled = true;
        
        // Visual notification toast (used when mobile notifications are enabled)
        function showVisualNotification(prompt, color) {
            var bgColor = color || '#0078d4';
            // Truncate long messages for the visual toast
            var displayText = prompt.length > 200 ? prompt.substring(0, 197) + '...' : prompt;
            // Create toast notification
            let toast = document.getElementById('notification-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'notification-toast';
                document.body.appendChild(toast);
            }
            toast.style.cssText = 'position:fixed;top:0;left:0;right:0;background:' + bgColor + ';color:white;padding:12px 16px;z-index:10000;box-shadow:0 2px 12px rgba(0,0,0,0.3);font-size:14px;line-height:1.4;display:block;animation:slideIn 0.3s ease;cursor:pointer;max-height:120px;overflow:hidden;text-overflow:ellipsis;';
            toast.textContent = displayText;
            // Auto-hide after 5 seconds
            clearTimeout(toast._hideTimer);
            toast._hideTimer = setTimeout(function() { toast.style.display = 'none'; }, 5000);
            // Tap to dismiss
            toast.onclick = function() { toast.style.display = 'none'; clearTimeout(toast._hideTimer); };
        }
        
        function showMobileNotification(prompt) {
            console.log('[FlowCommand] showMobileNotification called with:', prompt.substring(0, 50));
            showVisualNotification(prompt);
        }
        
        // Make showMobileNotification globally accessible
        window.showMobileNotification = showMobileNotification;
        
        // Apply theme (light or dark) from VS Code
        function applyTheme(theme) {
            if (theme === 'light') {
                document.body.classList.add('light-theme');
                // Update theme-color meta tag for mobile browsers
                var metaTheme = document.querySelector('meta[name="theme-color"]');
                if (metaTheme) metaTheme.setAttribute('content', '#f3f3f3');
            } else {
                document.body.classList.remove('light-theme');
                var metaTheme = document.querySelector('meta[name="theme-color"]');
                if (metaTheme) metaTheme.setAttribute('content', '#1e1e1e');
            }
            console.log('[FlowCommand] Theme applied:', theme);
        }
        
        // Connection status UI
        const statusEl = document.getElementById('connection-status');
        
        function updateConnectionStatus(status, message) {
            statusEl.className = 'connection-status ' + status;
            statusEl.innerHTML = message;
            
            if (status === 'connected') {
                setTimeout(() => statusEl.classList.remove('show'), 2000);
            } else {
                statusEl.classList.add('show');
            }
        }
        
        // Socket.io connection - use server-served client (guaranteed version match)
        function connectSocket() {
            if (typeof io === 'undefined') {
                const script = document.createElement('script');
                // Socket.IO server automatically serves its client at /socket.io/socket.io.js
                script.src = '/socket.io/socket.io.js';
                script.onload = () => {
                    console.log('[FlowCommand] Socket.io loaded from server');
                    initSocket();
                };
                script.onerror = () => {
                    console.error('[FlowCommand Remote] Failed to load Socket.io from server');
                    updateConnectionStatus('disconnected', '<span class="codicon codicon-error"></span> Failed to load Socket.io');
                };
                document.head.appendChild(script);
            } else {
                console.log('[FlowCommand] Socket.io already loaded');
                initSocket();
            }
        }
        
        function initSocket() {
            console.log('[FlowCommand] initSocket called, PIN:', PIN);
            
            // Check if io is defined
            if (typeof io === 'undefined') {
                console.error('[FlowCommand] Socket.io not loaded!');
                updateConnectionStatus('disconnected', '<span class="codicon codicon-error"></span> Socket.io failed to load');
                return;
            }
            
            // Connect with polling first for better mobile compatibility
            socket = io({
                transports: ['polling', 'websocket'],
                reconnection: true,
                reconnectionAttempts: maxReconnectAttempts,
                reconnectionDelay: 1000,
                timeout: 20000,
                forceNew: true
            });
            
            console.log('[FlowCommand] Socket created, waiting for connect event...');
            
            // Add connection timeout for better mobile feedback
            var connectTimeout = setTimeout(function() {
                if (!socket.connected) {
                    console.error('[FlowCommand] Connection timeout');
                    updateConnectionStatus('disconnected', '<span class="codicon codicon-error"></span> Connection timeout. Check network.');
                }
            }, 15000);
            
            socket.on('connect', () => {
                console.log('[FlowCommand] Socket connected, sending authenticate...');
                clearTimeout(connectTimeout);
                reconnectAttempts = 0;  // Reset on successful connection
                clearReconnectTimer();  // Clear any reconnect timer
                updateConnectionStatus('connecting', '<span class="codicon codicon-key"></span> Authenticating...');
                socket.emit('authenticate', { pin: PIN });
            });
            
            socket.on('connect_error', (err) => {
                console.error('[FlowCommand] Socket connect_error:', err.message);
                reconnectAttempts++;
                updateConnectionStatus('disconnected', '<span class="codicon codicon-loading codicon-modifier-spin"></span> Reconnecting... (' + reconnectAttempts + ')');
                startReconnectTimer();  // Start timer for reload option
            });
            
            socket.on('authenticated', (data) => {
                console.log('[FlowCommand] Authenticated response:', data);
                lastSuccessTime = Date.now();  // Track successful connection
                if (data.success) {
                    isConnected = true;
                    reconnectAttempts = 0;
                    updateConnectionStatus('connected', '<span class="codicon codicon-check"></span> Connected');
                    
                    // Save PIN for PWA (Add to Home Screen)
                    try {
                        localStorage.setItem('flowcommand_pin', PIN);
                    } catch (e) {}
                    
                    // Remove stale planReviewResponse messages from queue before flushing.
                    // If user responded to a plan review while disconnected, the IDE may have
                    // already resolved it. Sending the stale response would be harmless (server
                    // ignores unmatched reviewIds) but we clean up for clarity.
                    // The fresh state from getState will sync the correct plan review status.
                    messageQueue = messageQueue.filter(function(msg) {
                        return msg.type !== 'planReviewResponse';
                    });

                    // Flush remaining message queue
                    while (messageQueue.length > 0) {
                        socket.emit('message', messageQueue.shift());
                    }
                    
                    // Request fresh state on every reconnect to ensure plan reviews, 
                    // pending requests, and queue state are always up to date
                    socket.emit('getState');
                    
                    // Refresh current tab data after reconnection
                    const activeTab = document.querySelector('.remote-tab.active');
                    if (activeTab) {
                        const tabId = activeTab.dataset.tab;
                        if (tabId === 'files') {
                            socket.emit('getFileTree', { path: currentFilePath || '' });
                        } else if (tabId === 'output') {
                            loadOutputData();
                        }
                    }
                } else {
                    updateConnectionStatus('disconnected', '<span class="codicon codicon-error"></span> Invalid PIN');
                    // Clear saved PIN since it's invalid
                    try {
                        localStorage.removeItem('flowcommand_pin');
                    } catch (e) {}
                    setTimeout(() => {
                        window.location.href = '/?error=invalid_pin';
                    }, 2000);
                }
            });

            function applyInitialState(state) {
                console.log('[FlowCommand] Applying initial state');
                lastSuccessTime = Date.now();  // Track successful message

                // Show green success toast if this was a manual refresh
                if (window.__pendingRefresh) {
                    window.__pendingRefresh = false;
                    showVisualNotification('✓ Refreshed', '#2ea043');
                }

                // Apply theme from VS Code
                if (state.theme) {
                    applyTheme(state.theme);
                }

                if (window.dispatchVSCodeMessage) {
                    // Each section wrapped in try-catch to prevent errors in one section
                    // from blocking subsequent sections (especially plan review at the end)
                    try {
                        if (state.queue !== undefined) {
                            window.dispatchVSCodeMessage({ type: 'updateQueue', queue: state.queue, enabled: state.queueEnabled, paused: state.queuePaused });
                        }
                    } catch (e) { console.error('[FlowCommand] applyInitialState queue error:', e); }

                    try {
                        if (state.currentSession) {
                            window.dispatchVSCodeMessage({ type: 'updateCurrentSession', history: state.currentSession });
                        }
                    } catch (e) { console.error('[FlowCommand] applyInitialState session error:', e); }

                    try {
                        if (state.persistedHistory) {
                            window.dispatchVSCodeMessage({ type: 'updatePersistedHistory', history: state.persistedHistory });
                        }
                    } catch (e) { console.error('[FlowCommand] applyInitialState history error:', e); }

                    try {
                        if (state.settings) {
                            window.dispatchVSCodeMessage({ type: 'updateSettings', ...state.settings });
                            if (state.settings.mobileNotificationEnabled === false) {
                                window.mobileNotificationEnabled = false;
                            }
                        }
                    } catch (e) { console.error('[FlowCommand] applyInitialState settings error:', e); }

                    try {
                        if (state.pendingRequest) {
                            window.dispatchVSCodeMessage({
                                type: 'toolCallPending',
                                id: state.pendingRequest.id,
                                prompt: state.pendingRequest.prompt,
                                context: state.pendingRequest.context,
                                isApprovalQuestion: state.pendingRequest.isApprovalQuestion,
                                choices: state.pendingRequest.choices
                            });
                        } else if (state.pendingMultiQuestion) {
                            window.dispatchVSCodeMessage({
                                type: 'multiQuestionPending',
                                requestId: state.pendingMultiQuestion.requestId,
                                questions: state.pendingMultiQuestion.questions
                            });
                        } else {
                            window.dispatchVSCodeMessage({ type: 'toolCallCancelled', id: '__stale__' });
                        }
                    } catch (e) { console.error('[FlowCommand] applyInitialState pending error:', e); }

                    try {
                        if (state.queuedAgentRequestCount !== undefined) {
                            window.dispatchVSCodeMessage({ type: 'queuedAgentRequestCount', count: state.queuedAgentRequestCount });
                        }
                    } catch (e) { console.error('[FlowCommand] applyInitialState agent count error:', e); }

                    // Plan review sync - runs independently of all above sections
                    try {
                        if (state.pendingPlanReview) {
                            console.log('[FlowCommand] applyInitialState: restoring plan review', state.pendingPlanReview.reviewId);
                            window.dispatchVSCodeMessage({
                                type: 'planReviewPending',
                                reviewId: state.pendingPlanReview.reviewId,
                                title: state.pendingPlanReview.title,
                                plan: state.pendingPlanReview.plan
                            });
                        } else {
                            console.log('[FlowCommand] applyInitialState: clearing stale plan review');
                            window.dispatchVSCodeMessage({
                                type: 'planReviewCompleted',
                                reviewId: '__stale__',
                                status: 'cancelled'
                            });
                        }
                    } catch (e) { console.error('[FlowCommand] applyInitialState plan review error:', e); }
                }
            }

            window.__applyFlowCommandInitialState = applyInitialState;
            
            socket.on('initialState', (state) => {
                console.log('[FlowCommand] Received initial state');
                if (window.dispatchVSCodeMessage) {
                    applyInitialState(state);
                } else {
                    window.__flowcommandInitialState = state;
                }
            });
            
            socket.on('message', (message) => {
                console.log('[FlowCommand] Socket received message:', message.type, message.reviewId ? 'reviewId:' + message.reviewId : '');
                
                // Handle theme updates
                if (message.type === 'updateTheme' && message.theme) {
                    applyTheme(message.theme);
                    return;
                }
                
                if (window.dispatchVSCodeMessage) {
                    console.log('[FlowCommand] Dispatching to webview:', message.type);
                    window.dispatchVSCodeMessage(message);
                } else {
                    console.log('[FlowCommand] WARNING: dispatchVSCodeMessage not available');
                }
                // Trigger mobile browser notification for toolCallPending, planReviewPending, or multiQuestionPending
                if ((message.type === 'toolCallPending' || message.type === 'planReviewPending' || message.type === 'multiQuestionPending') && window.mobileNotificationEnabled) {
                    let notificationText;
                    if (message.type === 'planReviewPending') {
                        notificationText = 'Plan Review: ' + (message.title || 'Review required');
                    } else if (message.type === 'multiQuestionPending') {
                        notificationText = 'AI has questions for you';
                    } else {
                        notificationText = 'AI needs your input: ' + (message.prompt || 'Question pending');
                    }
                    showMobileNotification(notificationText);
                }
                // Sync mobile notification flag when settings change
                if (message.type === 'updateSettings') {
                    window.mobileNotificationEnabled = message.mobileNotificationEnabled === true;
                }
            });
            
            socket.on('disconnect', (reason) => {
                isConnected = false;
                console.log('[FlowCommand] Disconnected:', reason);
                updateConnectionStatus('disconnected', '<span class="codicon codicon-loading codicon-modifier-spin"></span> Disconnected. Reconnecting...');
            });
            
            // File tree response
            socket.on('fileTree', (tree) => {
                renderFileTree(tree);
            });
            
            // File content response
            socket.on('fileContent', (data) => {
                showFileContent(data.path, data.content);
            });
            
            // Terminal list response
            socket.on('terminalList', (terminals) => {
                updateTerminalList(terminals);
            });
            
            // Terminal history response
            socket.on('terminalHistory', (history) => {
                renderTerminalHistory(history);
            });
            
            // Problems response
            socket.on('problems', (problems) => {
                renderProblems(problems);
            });
            
            // Debug console response (placeholder for future implementation)
            socket.on('debugOutput', (output) => {
                renderDebugOutput(output);
            });
            
            // Ports response (placeholder for future implementation)
            socket.on('ports', (ports) => {
                renderPorts(ports);
            });
            
            // File change events and real-time updates
            socket.on('message', (msg) => {
                if (msg.type === 'fileChanged') {
                    handleFileChanged(msg.path, msg.content);
                } else if (msg.type === 'fileCreated' || msg.type === 'fileDeleted' || msg.type === 'fileRenamed') {
                    refreshFileTree();
                } else if (msg.type === 'terminalOpened' || msg.type === 'terminalClosed') {
                    updateTerminalList(msg.terminals);
                } else if (msg.type === 'terminalCommand') {
                    appendTerminalCommand(msg.command);
                } else if (msg.type === 'debugOutput') {
                    appendDebugEntry(msg.entry);
                }
            });
        }
        
        // Append debug entry in real-time
        function appendDebugEntry(entry) {
            if (!entry) return;
            const container = document.getElementById('debug-output');
            if (!container) return;
            
            // Remove placeholder if present
            const placeholder = container.querySelector('.terminal-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
            
            const div = document.createElement('div');
            div.className = 'debug-entry ' + (entry.type || '');
            div.innerHTML = \`
                <span class="debug-time">\${entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</span>
                <span class="debug-message">\${escapeHtml(entry.message || '')}</span>
            \`;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }
        
        // Tab switching
        const pathHistory = [];
        let currentOutputType = 'terminal';  // terminal, problems, debug, ports
        let selectedTerminalId = null;

        document.querySelectorAll('.remote-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;
                
                // Update tab active state
                document.querySelectorAll('.remote-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Update content visibility
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById('tab-' + tabId)?.classList.add('active');
                
                // Load data for the tab
                if (tabId === 'files' && socket && isConnected) {
                    socket.emit('getFileTree', { path: currentFilePath });
                } else if (tabId === 'output' && socket && isConnected) {
                    loadOutputData();
                }
            });
        });
        
        // Output type switching
        function loadOutputData() {
            if (!socket || !isConnected) return;
            
            // Always refresh terminal list for dropdown
            socket.emit('getTerminals');
            
            const select = document.getElementById('output-type-select');
            const value = select?.value || '';
            
            if (value.startsWith('terminal-')) {
                currentOutputType = 'terminal';
                selectedTerminalId = value.replace('terminal-', '');
                socket.emit('getTerminalHistory');
            } else if (value === 'problems') {
                currentOutputType = 'problems';
                socket.emit('getProblems');
            } else if (value === 'debug') {
                currentOutputType = 'debug';
                socket.emit('getDebugOutput');
            } else if (value === 'ports') {
                currentOutputType = 'ports';
                socket.emit('getPorts');
            } else {
                // No selection - stay on terminal view, will auto-select when terminal list arrives
                currentOutputType = 'terminal';
            }
            
            updateOutputView();
        }
        
        function updateOutputView() {
            // Hide all views first
            document.querySelectorAll('.output-view').forEach(v => v.style.display = 'none');
            
            // Show appropriate view
            if (currentOutputType === 'terminal') {
                document.getElementById('output-terminal').style.display = 'flex';
            } else if (currentOutputType === 'problems') {
                document.getElementById('output-problems').style.display = 'flex';
            } else if (currentOutputType === 'debug') {
                document.getElementById('output-debug').style.display = 'flex';
            } else if (currentOutputType === 'ports') {
                document.getElementById('output-ports').style.display = 'flex';
            }
        }
        
        document.getElementById('output-type-select')?.addEventListener('change', (e) => {
            const value = e.target.value;
            
            if (value.startsWith('terminal-')) {
                currentOutputType = 'terminal';
                selectedTerminalId = value.replace('terminal-', '');
            } else if (value === 'problems') {
                currentOutputType = 'problems';
            } else if (value === 'debug') {
                currentOutputType = 'debug';
            } else if (value === 'ports') {
                currentOutputType = 'ports';
            }
            
            loadOutputData();
        });
        
        document.getElementById('output-refresh-btn')?.addEventListener('click', loadOutputData);
        
        // File browser functions
        function renderFileTree(items) {
            const treeEl = document.getElementById('file-tree');
            if (!treeEl) return;
            
            if (!items || items.length === 0) {
                treeEl.innerHTML = '<div class="file-loading">No files found</div>';
                return;
            }
            
            treeEl.innerHTML = items.map(item => \`
                <div class="file-item \${item.isDirectory ? 'directory' : ''}" data-path="\${item.path}" data-is-dir="\${item.isDirectory}">
                    <span class="codicon codicon-\${item.isDirectory ? 'folder' : 'file'}"></span>
                    <span>\${item.name}</span>
                </div>
            \`).join('');
            
            // Add click handlers
            treeEl.querySelectorAll('.file-item').forEach(el => {
                el.addEventListener('click', () => {
                    const path = el.dataset.path;
                    const isDir = el.dataset.isDir === 'true';
                    
                    if (isDir) {
                        pathHistory.push(currentFilePath);
                        currentFilePath = path;
                        document.getElementById('file-current-path').textContent = '/' + path;
                        socket.emit('getFileTree', { path: path });
                    } else {
                        socket.emit('getFileContent', { path: path });
                    }
                });
            });
        }
        
        function showFileContent(path, content) {
            const viewer = document.getElementById('file-viewer');
            const nameEl = document.getElementById('file-viewer-name');
            const contentEl = document.getElementById('file-viewer-content');
            
            if (!viewer || !nameEl || !contentEl) return;
            
            nameEl.textContent = path.split('/').pop() || path;
            contentEl.textContent = content;
            viewer.classList.remove('hidden');
        }
        
        function refreshFileTree() {
            if (socket && isConnected) {
                socket.emit('getFileTree', { path: currentFilePath });
            }
        }
        
        function handleFileChanged(path, content) {
            // If this file is currently being viewed, update it
            const viewer = document.getElementById('file-viewer');
            const nameEl = document.getElementById('file-viewer-name');
            const contentEl = document.getElementById('file-viewer-content');
            
            if (viewer && !viewer.classList.contains('hidden') && nameEl) {
                const viewingFile = path.split('/').pop();
                if (nameEl.textContent === viewingFile) {
                    contentEl.textContent = content;
                }
            }
        }
        
        // File browser navigation
        document.getElementById('file-nav-back')?.addEventListener('click', () => {
            if (pathHistory.length > 0) {
                currentFilePath = pathHistory.pop() || '';
                document.getElementById('file-current-path').textContent = '/' + (currentFilePath || '');
                socket?.emit('getFileTree', { path: currentFilePath });
            }
        });
        
        document.getElementById('file-nav-refresh')?.addEventListener('click', refreshFileTree);
        
        document.getElementById('file-viewer-close')?.addEventListener('click', () => {
            document.getElementById('file-viewer')?.classList.add('hidden');
        });
        
        // Terminal functions
        let initialTerminalSelect = true; // Flag to auto-select terminal on first load
        
        function updateTerminalList(terminals) {
            const select = document.getElementById('output-type-select');
            if (!select) return;
            
            // Find or create terminals optgroup
            let termGroup = select.querySelector('optgroup[label="Terminals"]');
            if (!termGroup) {
                termGroup = document.createElement('optgroup');
                termGroup.label = 'Terminals';
                select.insertBefore(termGroup, select.firstChild);
            }
            
            termGroup.innerHTML = terminals.length > 0 
                ? terminals.map(t => {
                    const activeMarker = t.isActive ? '★ ' : '';
                    return \`<option value="terminal-\${t.id}">\${activeMarker}\${t.name}</option>\`;
                }).join('')
                : '<option value="" disabled>No terminals</option>';
            
            // Always select a terminal on first load if terminals are available
            if (initialTerminalSelect && terminals.length > 0) {
                initialTerminalSelect = false; // Only auto-select once
                
                const activeTerminal = terminals.find(t => t.isActive);
                const terminalToSelect = activeTerminal || terminals[0];
                
                select.value = 'terminal-' + terminalToSelect.id.toString();
                currentOutputType = 'terminal';
                selectedTerminalId = terminalToSelect.id.toString();
                updateOutputView();
                // Fetch history for the auto-selected terminal
                if (socket && isConnected) {
                    socket.emit('getTerminalHistory');
                }
            }
        }
        
        document.getElementById('terminal-send-btn')?.addEventListener('click', sendTerminalCommand);
        document.getElementById('terminal-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendTerminalCommand();
        });
        
        function sendTerminalCommand() {
            const input = document.getElementById('terminal-input');
            const output = document.getElementById('terminal-output');
            
            if (!input || !socket || !isConnected) return;
            
            const terminalId = parseInt(selectedTerminalId);
            const text = input.value.trim();
            
            if (isNaN(terminalId) || !text) {
                if (!selectedTerminalId) {
                    alert('Please select a terminal first');
                }
                return;
            }
            
            socket.emit('terminalInput', { terminalId, text });
            
            // Show command in output
            if (output) {
                output.innerHTML += '<div style="color:#4ec9b0">$ ' + text + '</div>';
            }
            
            input.value = '';
        }
        
        // Terminal history rendering with better formatting
        function renderTerminalHistory(history) {
            const output = document.getElementById('terminal-output');
            if (!output || !history || history.length === 0) return;
            
            output.innerHTML = history.map((cmd, index) => {
                const header = \`<div class="terminal-cmd-header"><span class="terminal-cmd-name">\${cmd.terminalName || 'Terminal'}</span><span class="terminal-cmd-time">\${new Date(cmd.timestamp).toLocaleTimeString()}</span><button class="terminal-copy-btn" onclick="copyTerminalCmd(\${index})" title="Copy command"><span class="codicon codicon-copy"></span></button></div>\`;
                const cwd = cmd.cwd ? \`<div class="terminal-cwd">PS \${escapeHtml(cmd.cwd)}></div>\` : '';
                const cmdLine = \`<div class="terminal-cmd-line"><span class="terminal-prompt">$ </span><span class="terminal-command">\${escapeHtml(cmd.command)}</span></div>\`;
                const cmdOutput = cmd.output ? \`<pre class="terminal-cmd-output">\${escapeHtml(cleanTerminalOutput(cmd.output))}</pre>\` : '';
                const exitCode = cmd.exitCode !== undefined ? \`<div class="terminal-cmd-exit \${cmd.exitCode === 0 ? 'success' : 'error'}">Exit code: \${cmd.exitCode}</div>\` : '';
                return \`<div class="terminal-cmd-entry">\${header}\${cwd}\${cmdLine}\${cmdOutput}\${exitCode}</div>\`;
            }).join('');
            
            // Store commands for copy function
            window.terminalCommands = history.map(cmd => cmd.command);
            
            // Scroll to bottom
            output.scrollTop = output.scrollHeight;
        }
        
        // Copy terminal command function (global scope for onclick)
        window.copyTerminalCmd = function(index) {
            const cmd = window.terminalCommands?.[index];
            if (!cmd) return;
            
            navigator.clipboard.writeText(cmd).then(() => {
                console.log('[FlowCommand] Command copied to clipboard');
            }).catch(err => {
                console.error('[FlowCommand] Failed to copy:', err);
            });
        };
        
        // Append new terminal command to output with better formatting
        function appendTerminalCommand(cmd) {
            const output = document.getElementById('terminal-output');
            if (!output || !cmd) return;
            
            const header = \`<div class="terminal-cmd-header"><span class="terminal-cmd-name">\${cmd.terminalName || 'Terminal'}</span><span class="terminal-cmd-time">\${new Date(cmd.timestamp).toLocaleTimeString()}</span><button class="terminal-copy-btn" onclick="copyTerminalCmd(window.terminalCommands.length)" title="Copy command"><span class="codicon codicon-copy"></span></button></div>\`;
            const cwd = cmd.cwd ? \`<div class="terminal-cwd">PS \${escapeHtml(cmd.cwd)}></div>\` : '';
            const cmdLine = \`<div class="terminal-cmd-line"><span class="terminal-prompt">$ </span><span class="terminal-command">\${escapeHtml(cmd.command)}</span></div>\`;
            const cmdOutput = cmd.output ? \`<pre class="terminal-cmd-output">\${escapeHtml(cleanTerminalOutput(cmd.output))}</pre>\` : '';
            const exitCode = cmd.exitCode !== undefined ? \`<div class="terminal-cmd-exit \${cmd.exitCode === 0 ? 'success' : 'error'}">Exit code: \${cmd.exitCode}</div>\` : '';
            
            const entry = document.createElement('div');
            entry.className = 'terminal-cmd-entry new-entry';
            entry.innerHTML = header + cwd + cmdLine + cmdOutput + exitCode;
            
            window.terminalCommands = window.terminalCommands || [];
            window.terminalCommands.push(cmd.command);
            
            output.appendChild(entry);
            output.scrollTop = output.scrollHeight;
        }
        
        // Problems rendering
        function renderProblems(problems) {
            const container = document.getElementById('problems-list');
            if (!container) return;
            
            if (!problems || problems.length === 0) {
                container.innerHTML = '<div class="problems-empty"><span class="codicon codicon-check"></span><p>No problems detected</p></div>';
                return;
            }
            
            // Group by file
            const byFile = {};
            for (const p of problems) {
                if (!byFile[p.relativePath]) byFile[p.relativePath] = [];
                byFile[p.relativePath].push(p);
            }
            
            container.innerHTML = Object.entries(byFile).map(([file, fileProblems]) => \`
                <div class="problems-file">
                    <div class="problems-file-header">
                        <span class="codicon codicon-file"></span>
                        <span>\${file}</span>
                        <span class="problems-count">\${fileProblems.length}</span>
                    </div>
                    <div class="problems-file-items">
                        \${fileProblems.map(p => \`
                            <div class="problem-item \${p.severity}">
                                <span class="codicon codicon-\${p.severity === 'error' ? 'error' : p.severity === 'warning' ? 'warning' : 'info'}"></span>
                                <span class="problem-message">\${escapeHtml(p.message)}</span>
                                <span class="problem-location">:\${p.line}:\${p.column}</span>
                            </div>
                        \`).join('')}
                    </div>
                </div>
            \`).join('');
        }
        
        // Debug console rendering (placeholder)
        function renderDebugOutput(output) {
            const container = document.getElementById('debug-output');
            if (!container) return;
            
            if (!output || output.length === 0) {
                container.innerHTML = '<div class="terminal-placeholder"><span class="codicon codicon-debug-console"></span><p>Debug console output appears here during debugging</p></div>';
                return;
            }
            
            container.innerHTML = output.map(entry => \`
                <div class="debug-entry \${entry.type || ''}">
                    <span class="debug-time">\${entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</span>
                    <span class="debug-message">\${escapeHtml(entry.message || '')}</span>
                </div>
            \`).join('');
            
            container.scrollTop = container.scrollHeight;
        }
        
        // Ports rendering (placeholder)
        function renderPorts(ports) {
            const container = document.getElementById('ports-list');
            if (!container) return;
            
            if (!ports || ports.length === 0) {
                container.innerHTML = '<div class="terminal-placeholder"><span class="codicon codicon-plug"></span><p>No forwarded ports</p></div>';
                return;
            }
            
            container.innerHTML = ports.map(port => \`
                <div class="port-item">
                    <span class="port-number">\${port.port}</span>
                    <span class="port-label">\${port.label || 'Forwarded port'}</span>
                    <button class="port-action" onclick="window.open('\${port.url || ('http://localhost:' + port.port)}', '_blank')">
                        <span class="codicon codicon-link-external"></span> Open
                    </button>
                </div>
            \`).join('');
        }
        
        // Clean terminal output - minimal cleanup for any remaining issues
        function cleanTerminalOutput(text) {
            if (!text) return '';
            return text
                // Remove any remaining ]633; sequences
                .replace(/\\]633;[^\\n]*/g, '')
                // Remove any remaining escape sequences
                .replace(/\\x1b[^m]*m/g, '')
                // Trim leading/trailing whitespace per line while preserving content
                .split('\\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\\n');
        }
        
        // HTML escaping helper
        function escapeHtml(text) {
            if (!text) return '';
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }
        
        // Logout handler
        document.getElementById('remote-logout-btn')?.addEventListener('click', () => {
            // Clear saved PIN on logout
            try {
                localStorage.removeItem('flowcommand_pin');
            } catch (e) {}
            if (socket) socket.disconnect();
            window.location.href = '/';
        });

        // Refresh handler - re-request server state
        document.getElementById('remote-refresh-btn')?.addEventListener('click', () => {
            if (socket && isConnected) {
                socket.emit('getState');
                window.__pendingRefresh = true;
                showVisualNotification('Refreshing state...');
            } else {
                showVisualNotification('Not connected. Please reconnect.');
            }
        });
        
        // Settings modal button handler
        document.getElementById('settings-modal-btn')?.addEventListener('click', () => {
            if (window.dispatchVSCodeMessage) {
                window.dispatchVSCodeMessage({ type: 'openSettingsModal' });
            }
        });
        
        // Prompts modal button handler  
        document.getElementById('prompts-modal-btn')?.addEventListener('click', () => {
            if (window.dispatchVSCodeMessage) {
                window.dispatchVSCodeMessage({ type: 'openPromptsModal' });
            }
        });
        
        // Theme toggle handler
        document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
            const body = document.body;
            const isLight = body.classList.toggle('light-theme');
            
            // Save theme preference
            try {
                localStorage.setItem('flowcommand_theme', isLight ? 'light' : 'dark');
            } catch (e) {}
            
            // Update meta theme-color
            const metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme) {
                metaTheme.setAttribute('content', isLight ? '#ffffff' : '#1e1e1e');
            }
        });
        
        // Restore saved theme
        try {
            const savedTheme = localStorage.getItem('flowcommand_theme');
            if (savedTheme === 'light') {
                document.body.classList.add('light-theme');
                const metaTheme = document.querySelector('meta[name="theme-color"]');
                if (metaTheme) {
                    metaTheme.setAttribute('content', '#ffffff');
                }
            }
        } catch (e) {}
        
        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(err => {
                console.log('[FlowCommand] SW registration failed:', err);
            });
        }
        
        // Handle page visibility changes (for mobile browser/PWA wake-up)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('[FlowCommand] Page became visible, checking connection...');
                
                // Only reconnect if actually disconnected
                if (socket && !socket.connected) {
                    console.log('[FlowCommand] Socket disconnected, reconnecting...');
                    updateConnectionStatus('connecting', '<span class="codicon codicon-loading codicon-modifier-spin"></span> Reconnecting...');
                    socket.connect();
                }
            }
        });
        
        // Also handle online/offline events
        window.addEventListener('online', () => {
            console.log('[FlowCommand] Network online, reconnecting...');
            if (socket) {
                socket.disconnect();
                setTimeout(() => socket.connect(), 500);
            }
        });
        
        // Start connection
        connectSocket();

        // Early plan review restoration from localStorage (shows modal before socket connects)
        // This handles page-reload scenarios where the server hasn't sent state yet
        // Server state will override this via applyInitialState (server is source of truth)
        try {
            var savedPlanReview = localStorage.getItem('flowcommand_pendingPlanReview');
            if (savedPlanReview) {
                var prData = JSON.parse(savedPlanReview);
                if (prData && prData.reviewId && prData.plan) {
                    console.log('[FlowCommand] Restoring plan review from localStorage:', prData.reviewId);
                    window.__pendingLocalStoragePlanReview = prData;
                }
            }
        } catch (e) { /* localStorage not available */ }
    </script>
    
    <!-- Main webview.js -->
    <script>
        ${webviewJs}
    </script>
</body>
</html>`;
  }

  /**
   * Stop the server
   */
  public stop(): void {
    this._unregisterSession();

    // Clear pending file change broadcasts
    for (const timer of this._fileChangeDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this._fileChangeDebounceTimers.clear();
    this._pendingFileChanges.clear();

    // Dispose file watchers
    for (const watcher of this._fileWatchers) {
      watcher.dispose();
    }
    this._fileWatchers = [];

    // Dispose terminal watchers
    for (const watcher of this._terminalWatchers) {
      watcher.dispose();
    }
    this._terminalWatchers = [];

    // Dispose debug tracker
    if (this._debugTrackerDisposable) {
      this._debugTrackerDisposable.dispose();
      this._debugTrackerDisposable = null;
    }
    this._debugOutput = [];

    if (this._io) {
      try {
        this._io.close();
      } catch (e) {
        console.error("[FlowCommand] Error closing Socket.IO:", e);
      }
      this._io = null;
    }
    if (this._server) {
      try {
        this._server.close();
      } catch (e) {
        console.error("[FlowCommand] Error closing HTTP server:", e);
      }
      this._server = null;
    }
    this._authenticatedSockets.clear();
  }

  /**
   * Debounce and coalesce file change broadcasts per file path.
   */
  private _queueFileChangeBroadcast(
    relativePath: string,
    payload: RemoteMessage,
  ): void {
    this._pendingFileChanges.set(relativePath, payload);

    const existingTimer = this._fileChangeDebounceTimers.get(relativePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const pending = this._pendingFileChanges.get(relativePath);
      this._pendingFileChanges.delete(relativePath);
      this._fileChangeDebounceTimers.delete(relativePath);
      if (pending) {
        this.broadcast(pending);
      }
    }, this._FILE_CHANGE_DEBOUNCE_MS);

    this._fileChangeDebounceTimers.set(relativePath, timer);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.stop();
  }
}
