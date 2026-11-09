import { storage } from "@vendetta/plugin";
import { findByProps } from "@vendetta/metro";
import Settings from "./Settings";

const socketModule = findByProps("getSocket", "isConnected");
const buildInfo = findByProps("getBuildInfo")?.getBuildInfo?.();

const IDENTIFY = 2;

// Full client properties per platform (matching Discord's expected super properties)
const SPOOF_PROPERTIES: Record<string, Record<string, any>> = {
    desktop: {
        os: "Windows",
        browser: "Discord Client",
        device: "",
        system_locale: "en-US",
        browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9003 Chrome/108.0.5359.215 Electron/22.3.12 Safari/537.36",
        browser_version: "1.0.9003",
        os_version: "10.0.22631",
        referrer: "",
        referring_domain: "",
        client_build_number: buildInfo?.buildNumber || 239527,
        client_event_source: null,
    },
    web: {
        os: "Windows",
        browser: "Chrome",
        device: "",
        system_locale: "en-US",
        browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        browser_version: "120.0.0.0",
        os_version: "10.0.22631",
        referrer: "",
        referring_domain: "",
        client_build_number: buildInfo?.buildNumber || 239527,
        client_event_source: null,
    },
    meta: {
        os: "Android",
        browser: "Discord VR",
        device: "Quest 2",
        system_locale: "en-US",
        browser_user_agent: "Mozilla/5.0 (Linux; Android 10; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.215 Mobile Safari/537.36",
        browser_version: "1.0.9003",
        os_version: "10",
        referrer: "",
        referring_domain: "",
        client_build_number: buildInfo?.buildNumber || 239527,
        client_event_source: null,
    },
    console: {
        os: "PlayStation",
        browser: "Discord Embedded",
        device: "PlayStation 5",
        system_locale: "en-US",
        browser_user_agent: "Mozilla/5.0 (PlayStation 5) AppleWebKit/537.36 (KHTML, like Gecko) Discord/1.0.0 Chrome/108.0.5359.215 Safari/537.36",
        browser_version: "1.0.0",
        os_version: "5.0",
        referrer: "",
        referring_domain: "",
        client_build_number: buildInfo?.buildNumber || 239527,
        client_event_source: null,
    },
};

let activeIntervals: Array<ReturnType<typeof setInterval>> = [];
let patchedSocket: any = null;
let origSend: any = null;
let origHandleIdentify: any = null;
const patchedTransports = new WeakMap<object, any>();

function getPlatform() {
    return storage.platform || "off";
}

function applySpoof(data: any) {
    const currentPlatform = getPlatform();
    if (currentPlatform === "off" || !SPOOF_PROPERTIES[currentPlatform]) return;

    if (data && data.properties) {
        Object.assign(data.properties, SPOOF_PROPERTIES[currentPlatform]);
    }
}

// Low-level patch for the raw WebSocket frame send
function patchTransport(socket: any) {
    const ws = socket?.webSocket;
    if (!ws || typeof ws.send !== "function" || patchedTransports.has(ws)) return;

    const origWsSend = ws.send.bind(ws);
    patchedTransports.set(ws, origWsSend);

    ws.send = function (data: any) {
        try {
            if (typeof data === "string") {
                const parsed = JSON.parse(data);
                if (parsed?.op === IDENTIFY && parsed.d?.properties) {
                    applySpoof(parsed.d);
                    data = JSON.stringify(parsed);
                }
            }
        } catch (e) {
            // Ignore non-JSON payload parsing errors
        }
        return origWsSend(data);
    };
}

function unpatchTransport(socket: any) {
    const ws = socket?.webSocket;
    if (ws && patchedTransports.has(ws)) {
        ws.send = patchedTransports.get(ws);
        patchedTransports.delete(ws);
    }
}

// Main patch for the higher-level Discord Gateway Socket instance
function patchSocket(socket: any) {
    if (!socket) return;
    
    patchTransport(socket);
    if (socket.__psPatched) return;

    origSend = socket.send.bind(socket);
    socket.send = function (op: number, data: any, flag: any) {
        if (op === IDENTIFY && data) {
            applySpoof(data);
        }
        return origSend.call(this, op, data, flag);
    };

    socket.__psPatched = true;
    patchedSocket = socket;

    // Discord periodically handles re-identifies; re-ensure transport patch here
    if (typeof socket.handleIdentify === "function") {
        origHandleIdentify = socket.handleIdentify.bind(socket);
        socket.handleIdentify = function (...args: any[]) {
            const result = origHandleIdentify.apply(this, args);
            patchTransport(socket);
            return result;
        };
    }
}

// Watcher loop that catches cold-boot delays & mid-session socket swaps
function startSocketWatcher() {
    let lastSocket: any = null;
    let attempts = 0;

    const id = setInterval(() => {
        attempts++;
        const liveSocket = socketModule?.getSocket();

        if (liveSocket) {
            if (liveSocket !== lastSocket || !liveSocket.__psPatched) {
                lastSocket = liveSocket;
                patchSocket(liveSocket);

                // Force reconnect if plugin just loaded mid-boot and platform spoofing is enabled
                if (getPlatform() !== "off" && attempts <= 5) {
                    reconnectGateway();
                }
            } else {
                // Ensure the underlying WebSocket transport stays patched across disconnects
                patchTransport(liveSocket);
            }
        }

        // Keep running periodically to survive background reconnects
    }, 250);

    activeIntervals.push(id);
}

export function reconnectGateway() {
    const socket = socketModule?.getSocket();
    if (!socket) return;

    socket.sessionId = null;
    socket.seq = 0;

    if (socket.webSocket) {
        socket.webSocket.close();
    } else if (typeof socket.close === "function") {
        socket.close();
    }
}

function teardown() {
    activeIntervals.forEach(clearInterval);
    activeIntervals = [];

    if (patchedSocket) {
        unpatchTransport(patchedSocket);
        if (origSend) patchedSocket.send = origSend;
        if (origHandleIdentify) patchedSocket.handleIdentify = origHandleIdentify;
        delete patchedSocket.__psPatched;
    }

    patchedSocket = null;
    origSend = null;
    origHandleIdentify = null;
}

export default {
    onLoad: () => {
        if (!storage.platform) {
            storage.platform = "off";
        }

        // Immediately start continuous polling to attach as early as possible
        startSocketWatcher();
    },

    onUnload: () => {
        teardown();
    },

    settings: Settings,
};