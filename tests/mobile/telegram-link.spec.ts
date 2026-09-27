import { test, expect } from "./fixtures";

const account = { state: "ACTIVE", role: "FRIEND", displayName: "Test system", emailVerified: true, usedBytes: 0, quotaBytes: 100 };

test("Telegram callback asks for confirmation before connecting and preserves keyboard access", async ({ page }, info) => {
  const calls: string[] = [];
  const browserErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: account } }));
  await page.route("**/api/v1/account/telegram**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(`${request.method()} ${url.pathname}${url.search}`);
    if (request.method() === "GET") return route.fulfill({ json: {
      state: "awaiting_confirmation",
      pending: { confirmationId: "opaque-fixture-handle", displayName: "Test Robin", username: "test_robin", expiresAt: "2026-09-26T20:00:00Z" },
    } });
    if (url.pathname.endsWith("/recheck")) return route.fulfill({ json: { state: "connected", connection: { displayName: "Test Robin", username: "test_robin", connectedAt: "2026-09-26T19:00:00Z", revision: 1 }, botAccess: "granted" } });
    expect(request.postDataJSON()).toEqual({ confirmationId: "opaque-fixture-handle" });
    return route.fulfill({ json: { state: "bot_access_required", connection: { displayName: "Test Robin", username: "test_robin", connectedAt: "2026-09-26T19:00:00Z", revision: 1 }, botAccess: "missing", botStartUrl: "https://t.me/bunch_fixture_bot" } });
  });
  await page.goto("/account?telegram_confirmation=opaque-fixture-handle");
  await expect(page.getByText("Review this Telegram account:", { exact: false })).toBeVisible();
  await expect(page.getByText("Telegram account connected to this Bunch account.")).toHaveCount(0);
  await expect(page).not.toHaveURL(/telegram_confirmation/);
  expect(calls).toContain("GET /api/v1/account/telegram?confirmation=opaque-fixture-handle");
  const confirm = page.getByRole("button", { name: "Confirm Telegram account" });
  await confirm.focus();
  await confirm.scrollIntoViewIfNeeded();
  await page.getByText("Confirm only if this is the account", { exact: false }).evaluate(element => element.scrollIntoView({ block: "center" }));
  const focusable = await page.locator(":focus").evaluate(element => getComputedStyle(element).outlineStyle);
  expect(focusable).not.toBe("none");
  const clearance = await page.evaluate(() => {
    const instruction = [...document.querySelectorAll("p")].find(element => element.textContent?.includes("Confirm only if this is the account"));
    const button = [...document.querySelectorAll("button")].find(element => element.textContent?.includes("Confirm Telegram account"));
    const dock = document.querySelector(".switch-dock");
    const bounds = (element: Element | null) => element?.getBoundingClientRect().toJSON() ?? null;
    return { instruction: bounds(instruction ?? null), button: bounds(button ?? null), dock: bounds(dock) };
  });
  expect(clearance.instruction).not.toBeNull();
  expect(clearance.button).not.toBeNull();
  expect(clearance.dock).not.toBeNull();
  expect(clearance.instruction!.top).toBeGreaterThanOrEqual(0);
  expect(clearance.instruction!.bottom).toBeLessThan(clearance.dock!.top);
  expect(clearance.button!.top).toBeGreaterThanOrEqual(0);
  expect(clearance.button!.bottom).toBeLessThan(clearance.dock!.top);
  await page.screenshot({ path: info.outputPath("telegram-confirmation.png"), fullPage: false });
  await confirm.click();
  await expect(page.getByText("Connected Telegram account:")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Allow the Bunch sticker bot to create your packs" })).toBeVisible();
  await page.getByRole("button", { name: "Recheck bot access" }).click();
  await expect(page.getByText("Bot access confirmed.")).toBeVisible();
  expect(calls).toContain("POST /api/v1/account/telegram/recheck");
  expect(browserErrors.filter(message => /hydration|did not match|server rendered/i.test(message))).toEqual([]);
});

test("Telegram connect uses a full-page authorization redirect and disconnected accounts can be removed", async ({ page }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: account } }));
  let state = "disconnected";
  await page.route("**/api/v1/account/telegram**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") return route.fulfill({ json: state === "connected" ? { state, connection: { displayName: "Test Robin", username: "test_robin", connectedAt: "2026-09-26T19:00:00Z", revision: 1 }, botAccess: "granted" } : { state } });
    if (url.pathname.endsWith("/start")) {
      expect(request.postDataJSON()).toEqual({ intent: "opaque-intent-fixture" });
      return route.fulfill({ json: { authorizationUrl: `${url.origin}/mock-telegram-consent`, expiresAt: "2026-09-26T20:00:00Z" } });
    }
    if (request.method() === "DELETE") { state = "disconnected"; return route.fulfill({ json: { state } }); }
    return route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "Request could not be completed." } } });
  });
  await page.goto("/account?telegram_intent=opaque-intent-fixture");
  await expect(page.getByRole("heading", { name: "Telegram account" })).toBeVisible();
  const dock = page.locator(".switch-dock");
  await expect(dock).toHaveAttribute("data-flow", "fixed");
  const normalSpacing = await page.locator(".telegram-link-controls").evaluate(element => ({ panel: Number.parseFloat(getComputedStyle(element).paddingLeft), root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize), button: getComputedStyle(element.querySelector(".button")!).paddingLeft }));
  expect(normalSpacing.panel).toBe(normalSpacing.root * 1.25);
  expect(normalSpacing.button).toBe("16px");
  await expect(page).not.toHaveURL(/telegram_intent/);
  await page.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(page).toHaveURL(/\/mock-telegram-consent$/);

  state = "connected";
  await page.goto("/account");
  await page.getByRole("button", { name: "Telegram account" }).click();
  await page.getByRole("button", { name: "Disconnect Telegram" }).click();
  await expect(page.getByText("Telegram disconnected from this Bunch account.")).toBeVisible();
  await expect(page.getByText("No Telegram account is connected.")).toBeVisible();
});

test("Telegram callback errors stay on the account page and expose a recoverable retry", async ({ page }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: account } }));
  await page.route("**/api/v1/account/telegram**", route => {
    const url = new URL(route.request().url());
    return url.searchParams.has("confirmation")
      ? route.fulfill({ status: 410, json: { error: { code: "confirmation_expired", message: "This Telegram confirmation has expired. Start again." } } })
      : route.fulfill({ json: { state: "disconnected" } });
  });
  await page.goto("/account?telegram_confirmation=expired-fixture");
  await expect(page.locator(".telegram-error")).toContainText("expired");
  await expect(page).not.toHaveURL(/telegram_confirmation/);
  await page.getByRole("button", { name: "Connect Telegram" }).waitFor({ state: "visible" });
});

test("unavailable fallback status offers a status retry without claiming disconnected", async ({ page }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: account } }));
  let allowStatus = false;
  await page.route("**/api/v1/account/telegram**", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("confirmation")) return route.fulfill({ status: 410, json: { error: { code: "confirmation_expired", message: "This Telegram confirmation has expired. Start again." } } });
    return allowStatus
      ? route.fulfill({ json: { state: "disconnected" } })
      : route.fulfill({ status: 503, json: { error: { code: "temporarily_unavailable", message: "Telegram status is temporarily unavailable." } } });
  });
  await page.goto("/account?telegram_confirmation=expired-status-fixture");
  await expect(page.getByText("The current Telegram connection status is unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Telegram" })).toHaveCount(0);
  allowStatus = true;
  await page.getByRole("button", { name: "Retry Telegram status" }).click();
  await expect(page.getByText("No Telegram account is connected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Telegram" })).toBeVisible();
});

test("disabled Telegram setup reports status instead of navigating to an empty URL", async ({ page }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: account } }));
  await page.route("**/api/v1/account/telegram", route => route.fulfill({ json: { state: "disconnected" } }));
  await page.route("**/api/v1/account/telegram/start", route => route.fulfill({ json: { state: "disabled" } }));
  await page.goto("/account");
  await page.getByRole("button", { name: "Telegram account" }).click();
  await page.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Telegram account linking is temporarily unavailable." })).toBeVisible();
  await expect(page).not.toHaveURL(/telegram_intent/);
});

test("Telegram controls fit narrow viewports with enlarged text and explain publication consent", async ({ page }, info) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: account } }));
  await page.route("**/api/v1/account/telegram", route => route.fulfill({ json: { state: "disconnected" } }));
  await page.goto("/account");
  await page.getByRole("button", { name: "Telegram account" }).click();
  await page.evaluate(() => { document.documentElement.dataset.highContrast = "on"; });
  const enlargedText = await page.addStyleTag({ content: "html { font-size: 400% !important; }" });
  const dock = page.locator(".switch-dock");
  if (info.project.name !== "desktop") await expect(dock).toHaveAttribute("data-flow", "document");
  await expect(page.getByText("Connecting does not approve or publish a pack.")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  const button = await page.getByRole("button", { name: "Connect Telegram" }).boundingBox();
  expect(button?.height).toBeGreaterThanOrEqual(56);
  const dockStyle = await dock.evaluate(element => ({ position: getComputedStyle(element).position, actionFontSize: getComputedStyle(element.querySelector(".switch-dock-action")!).fontSize }));
  expect(dockStyle.position).toBe(info.project.name === "desktop" ? "fixed" : "relative");
  expect(Number.parseFloat(dockStyle.actionFontSize)).toBeGreaterThanOrEqual(48);
  const dockLabelLines = await dock.getByRole("button", { name: /^Switch\./ }).evaluate(element => {
    const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())!;
    const range = document.createRange(); range.selectNodeContents(text);
    return range.getClientRects().length;
  });
  expect(dockLabelLines).toBeLessThanOrEqual(1);
  const dockAction = dock.getByRole("button", { name: /^Switch\./ });
  await dockAction.focus();
  await dockAction.evaluate(element => element.scrollIntoView({ block: "center" }));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(dockAction).toBeFocused();
  const dockActionBounds = await dockAction.boundingBox();
  expect((dockActionBounds?.y ?? 0) + (dockActionBounds?.height ?? 0)).toBeGreaterThan(0);
  expect(dockActionBounds?.y).toBeLessThan(info.project.name === "desktop" ? 1000 : 740);
  await page.screenshot({ path: info.outputPath("telegram-400-percent-dock-control.png"), fullPage: false });
  const connect = page.getByRole("button", { name: "Connect Telegram" });
  await connect.focus();
  await connect.evaluate(element => element.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(50);
  const positions = await page.evaluate(() => {
    const dockRect = document.querySelector(".switch-dock")!.getBoundingClientRect();
    const buttonRect = [...document.querySelectorAll("button")].find(element => element.textContent?.includes("Connect Telegram"))!.getBoundingClientRect();
    return { dockBottom: dockRect.bottom, dockTop: dockRect.top, buttonTop: buttonRect.top, buttonBottom: buttonRect.bottom, buttonWidth: buttonRect.width, viewportHeight: window.innerHeight, scrollY: window.scrollY, docHeight: document.documentElement.scrollHeight };
  });
  expect(positions.buttonBottom).toBeGreaterThan(0);
  expect(positions.buttonTop).toBeLessThan(positions.viewportHeight);
  expect(positions.buttonWidth).toBeGreaterThanOrEqual(56);
  expect(positions.dockBottom <= positions.buttonTop || positions.buttonBottom <= positions.dockTop).toBe(true);
  const connectLabelLines = await connect.evaluate(element => {
    const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())!;
    const range = document.createRange(); range.selectNodeContents(text);
    return range.getClientRects().length;
  });
  expect(connectLabelLines).toBeLessThanOrEqual(2);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(connect).toBeFocused();
  const focusStyle = await connect.evaluate(element => getComputedStyle(element).outlineStyle);
  expect(focusStyle).not.toBe("none");
  await page.screenshot({ path: info.outputPath("telegram-400-percent-controls.png"), fullPage: false });
  await enlargedText.evaluate(element => element.remove());
  if (info.project.name !== "desktop") await expect(dock).toHaveAttribute("data-flow", "fixed");
});
