const http = require("node:http");
const { checkPrices } = require("./src/price-service");

const PORT = Number(process.env.PORT || 8787);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url !== "/check-prices") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const payload = await readJson(req);
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      sendJson(res, 400, { error: "items_required" });
      return;
    }

    const results = await checkPrices(payload.items);
    sendJson(res, 200, { results });
  } catch (error) {
    const message = error && error.message === "invalid_json" ? "invalid_json" : "price_check_failed";
    sendJson(res, message === "invalid_json" ? 400 : 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Price service listening on http://localhost:${PORT}`);
});
