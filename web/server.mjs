import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const SAVE_DIR = path.join(ROOT_DIR, "lib", "save");
const HELP_HTML_DIR = path.join(ROOT_DIR, "lib", "help", "html");
const ENGINE_EXE = path.join(
  ROOT_DIR,
  process.platform === "win32" ? "frogcomposband-web.exe" : "frogcomposband-web"
);

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function sanitizeSaveName(raw) {
  const cleaned = String(raw || "PLAYER").replace(/[^a-zA-Z0-9_\-. ]+/g, "").trim();
  return cleaned.slice(0, 15) || "PLAYER";
}

function listSaves() {
  if (!fs.existsSync(SAVE_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(SAVE_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".") || entry.name === "Makefile" || entry.name === "delete.me") {
      continue;
    }
    if (/\.(F\d+|bak|tmp)$/i.test(entry.name)) {
      continue;
    }
    const full = path.join(SAVE_DIR, entry.name);
    const st = fs.statSync(full);
    if (st.size <= 0) continue;
    out.push({
      name: entry.name,
      size: st.size,
      mtime: st.mtimeMs,
    });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/* ---------------- Minimal Zero-Dep RFC 6455 WebSocket Helpers ---------------- */

function wsEncodeFrame(opcode, payloadBuf) {
  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuf]);
}

function wsSendText(socket, text) {
  if (socket.destroyed || !socket.writable) return;
  socket.write(wsEncodeFrame(0x1, Buffer.from(text, "utf8")));
}

function attachWebSocketClient(socket) {
  let recvBuf = Buffer.alloc(0);
  let fragChunks = [];
  let fragOpcode = 0;
  let child = null;
  let stdoutRemainder = "";

  const killChild = () => {
    if (!child) return;
    const proc = child;
    child = null;
    try {
      if (proc.stdin.writable) {
        proc.stdin.write('{"type":"quit"}\n');
        proc.stdin.end();
      }
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill();
      } catch {
        /* ignore */
      }
    }, 350);
  };

  const startGame = (msg) => {
    killChild();
    if (!fs.existsSync(ENGINE_EXE)) {
      wsSendText(
        socket,
        JSON.stringify({
          type: "error",
          msg: `Engine binary missing: ${ENGINE_EXE}. Run build-web.cmd first.`,
        })
      );
      return;
    }

    const args = [];
    const name = sanitizeSaveName(msg.name || "PLAYER");
    args.push(`-u${name}`);
    if (msg.mode === "new") args.push("-n");
    if (msg.cols) args.push(`--cols=${Math.max(80, Math.min(180, Number(msg.cols) || 108))}`);
    if (msg.rows) args.push(`--rows=${Math.max(24, Math.min(80, Number(msg.rows) || 36))}`);
    if (msg.graf) args.push(`--graf=${String(msg.graf)}`);

    stdoutRemainder = "";
    const proc = spawn(ENGINE_EXE, args, {
      cwd: ROOT_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child = proc;

    proc.stdout.on("data", (chunk) => {
      stdoutRemainder += chunk.toString("utf8");
      let nlIdx;
      while ((nlIdx = stdoutRemainder.indexOf("\n")) !== -1) {
        const line = stdoutRemainder.slice(0, nlIdx).trim();
        stdoutRemainder = stdoutRemainder.slice(nlIdx + 1);
        if (line) wsSendText(socket, line);
      }
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) console.error("[engine stderr]", text);
    });

    proc.on("exit", (code, signal) => {
      if (child === proc) child = null;
      wsSendText(socket, JSON.stringify({ type: "exit", code, signal }));
    });
  };

  const handleClientText = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "start") {
      startGame(msg);
      return;
    }
    if (msg.type === "stop") {
      killChild();
      return;
    }
    if (child && child.stdin.writable) {
      child.stdin.write(JSON.stringify(msg) + "\n");
    }
  };

  socket.on("data", (chunk) => {
    recvBuf = Buffer.concat([recvBuf, chunk]);
    while (recvBuf.length >= 2) {
      const b0 = recvBuf[0];
      const b1 = recvBuf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (recvBuf.length < 4) return;
        payloadLen = recvBuf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (recvBuf.length < 10) return;
        payloadLen = Number(recvBuf.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (recvBuf.length < offset + maskLen + payloadLen) return;

      let payload = recvBuf.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (masked) {
        const mask = recvBuf.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ mask[i & 3];
        }
        payload = unmasked;
      }

      recvBuf = recvBuf.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x8) {
        socket.write(wsEncodeFrame(0x8, Buffer.alloc(0)));
        socket.end();
        killChild();
        return;
      }
      if (opcode === 0x9) {
        socket.write(wsEncodeFrame(0xA, payload));
        continue;
      }
      if (opcode === 0xA) continue;

      if (opcode !== 0x0) {
        fragOpcode = opcode;
        fragChunks = [payload];
      } else {
        fragChunks.push(payload);
      }

      if (fin) {
        const fullPayload = Buffer.concat(fragChunks);
        fragChunks = [];
        if (fragOpcode === 0x1) {
          handleClientText(fullPayload.toString("utf8"));
        }
      }
    }
  });

  socket.on("close", killChild);
  socket.on("error", killChild);
}

/* ---------------- HTTP Static & API Server ---------------- */

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/saves") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ saves: listSaves(), hasEngine: fs.existsSync(ENGINE_EXE) }));
    return;
  }

  if (url.pathname.startsWith("/help/")) {
    const rel = decodeURIComponent(url.pathname.slice("/help/".length));
    const target = path.resolve(HELP_HTML_DIR, rel);
    if (!target.startsWith(HELP_HTML_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    serveFile(res, target);
    return;
  }

  const reqPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = path.resolve(PUBLIC_DIR, "." + reqPath);
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  serveFile(res, safePath);
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );
  attachWebSocketClient(socket);
});

server.listen(PORT, HOST, () => {
  console.log(`FrogComposband Web Edition running at http://${HOST}:${PORT}`);
});
