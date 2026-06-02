import { spawn } from "node:child_process";
import assert from "node:assert";

const chrome = spawn("/usr/bin/chromium", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9222",
  process.env.UI_TARGET_URL || "http://127.0.0.1:4321/contact/"
], {
  stdio: "ignore"
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9222/json/list");
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // wait for Chromium
    }
    await delay(250);
  }
  throw new Error("Chromium target was not ready");
}

async function main() {
  try {
    const target = await getTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });

    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

    const send = (method, params = {}) => {
      id += 1;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve) => pending.set(id, resolve));
    };

    await send("Runtime.enable");
    await delay(1000);
    const result = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (async () => {
          const form = document.querySelector("[data-donation-form]");
          if (!form) return { ok: false, error: "form missing" };
          form.querySelector("select[name='amount']").value = "5.00";
          form.querySelector("input[name='displayName']").value = "UI smoke";
          form.querySelector("input[name='sourceNoticeAccepted']").checked = true;
          form.requestSubmit();
          const result = document.querySelector("[data-donation-result]");
          for (let i = 0; i < 60; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            if (result && result.textContent.includes("dt_")) {
              return { ok: true, text: result.textContent };
            }
          }
          return { ok: false, error: result ? result.textContent : "result missing" };
        })()
      `
    });

    const value = result.result?.result?.value;
    assert.equal(value?.ok, true, value?.error || "UI smoke failed");
    assert.match(value.text, /dt_\d{8}_[a-f0-9]{10}/);
    assert.match(value.text, /USDT/);
    console.log(JSON.stringify(value, null, 2));
    await send("Browser.close");
  } finally {
    chrome.kill("SIGTERM");
  }
}

await main();
