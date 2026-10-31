/**
 * Browser tests: the real server, a real Chromium. Run with `npm run test:e2e`
 * (first time on a machine: `npx playwright install chromium`).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { startServer } from "../helpers.js";

let srv;
let browser;
const problems = [];

before(async () => {
  srv = await startServer();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await srv?.close();
});

async function open(urlPath, { width = 1280, scheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: srv.base });
  const page = await context.newPage();
  page.on("console", (m) => {
    // A not-found page legitimately loads with 404s (the document and the API lookup).
    if (/Failed to load resource: .* 404/.test(m.text())) return;
    if (m.type() === "error" || /Content Security Policy|TrustedHTML/i.test(m.text())) problems.push(`${urlPath}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${urlPath}: ${e.message}`));
  await page.goto(srv.base + urlPath);
  return { page, context };
}

test("the dashboard lists all 103 apps with the featured guides first", async () => {
  const { page, context } = await open("/");
  await page.waitForSelector(".card");
  assert.equal(await page.locator(".card").count(), 103);
  assert.equal(await page.locator("#featured-title").innerText(), "In-depth guides");
  assert.equal(await page.locator(".featured .card h3").first().innerText(), "Slack");
  assert.equal(await page.locator("h1").innerText(), "De-risk your OAuth integrations before writing code");
  await context.close();
});

test("search and filters narrow the cards; Enter opens the top result", async () => {
  const { page, context } = await open("/");
  await page.waitForSelector(".card");
  await page.locator('[data-filter="difficulty"][data-value="Complex"]').click();
  await page.locator('[data-filter="approval"][data-value="required"]').click();
  const count = await page.locator(".card").count();
  assert.ok(count > 0 && count < 103);
  assert.match(await page.locator("#results-count").innerText(), new RegExp(`^${count} of 103 apps$`));
  await page.locator('.filters [data-action="clear-filters"]').click();
  await page.fill("#q", "gmail");
  await page.waitForFunction(() => document.querySelectorAll(".card").length === 1);
  await page.press("#q", "Enter");
  await page.waitForURL("**/guides/google-workspace");
  assert.equal(await page.locator(".guide-title").innerText(), "Google Workspace");
  await context.close();
});

test("Enter searches what's in the box, even before the debounced results catch up", async () => {
  const { page, context } = await open("/");
  await page.waitForSelector(".card");
  // Type and submit in the same tick, so the 60 ms debounce can't have run yet.
  await page.evaluate(() => {
    const q = document.querySelector("#q");
    q.value = "stripe";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    q.form.requestSubmit();
  });
  await page.waitForURL("**/guides/stripe");
  await context.close();
});

test("cards flip to details and back, with only the visible face reachable", async () => {
  const { page, context } = await open("/");
  await page.waitForSelector(".card");
  const card = page.locator(".featured .flip").first();
  const front = card.locator(".card-front");
  const back = card.locator(".card-back");
  assert.equal(await back.evaluate((el) => el.inert), true, "the back starts inert");

  await front.locator("[data-flip]").click();
  assert.equal(await card.getAttribute("data-flipped"), "true");
  assert.equal(await front.evaluate((el) => el.inert), true);
  assert.equal(await back.evaluate((el) => el.inert), false);
  assert.ok(await back.locator("[data-flip]").evaluate((el) => el === document.activeElement), "focus moves to the back");
  assert.match(await back.innerText(), /human[\s\S]*agent[\s\S]*Open guide/);

  await page.keyboard.press("Escape");
  assert.equal(await card.getAttribute("data-flipped"), "false");
  assert.ok(await front.locator("[data-flip]").evaluate((el) => el === document.activeElement), "focus returns to the front");

  // The back's link opens the guide.
  await front.locator("[data-flip]").click();
  await back.locator("a.back-open").click();
  await page.waitForURL("**/guides/slack");
  await context.close();
});

test("Back returns to the library where you left it; a direct visit goes to all apps", async () => {
  const { page, context } = await open("/");
  await page.waitForSelector(".card");
  const target = page.locator('.card-link[href="/guides/hubspot"]');
  await target.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  assert.ok(before > 300, "the card is down the page");
  await target.click();
  await page.waitForURL("**/guides/hubspot");
  const backLink = page.locator(".guide-back a");
  assert.equal((await backLink.innerText()).trim(), "Back to library");
  await backLink.click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForSelector(".card");
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - before) < 4, "scroll position restored");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), "/guides/hubspot", "focus on the card you opened");

  // Arriving from a link elsewhere there is no in-app page behind, so Back goes to the parent view.
  await page.goto(`${srv.base}/guides/slack`);
  await page.waitForSelector(".guide-title");
  const direct = page.locator(".guide-back a");
  assert.equal((await direct.innerText()).trim(), "All apps");
  await direct.click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForSelector(".card");
  await context.close();
});

test("an unmatched search offers the Live Generator", async () => {
  const { page, context } = await open("/");
  await page.fill("#q", "Calendly");
  await page.waitForSelector(".empty");
  const link = page.locator(".empty a.btn-primary");
  assert.match(await link.innerText(), /Generate a guide for Calendly/);
  assert.equal(await link.getAttribute("href"), "/generate?app=Calendly");
  // Following the link inside the app starts the run straight away.
  await link.click();
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
  assert.equal(await page.locator("#gen-result .guide-title").innerText(), "Calendly");
  await context.close();
});

test("a guide page: sections, human/agent filter, persistent checklist, Markdown copy", async () => {
  const { page, context } = await open("/guides/slack");
  await page.waitForSelector(".guide-title");
  const toc = await page.locator(".toc a").allInnerTexts();
  for (const s of ["Overview", "Prerequisites", "Console setup steps", "Scopes & permissions", "Approval & verification", "Blockers & gotchas", "Developer action items", "Evidence"]) {
    assert.ok(toc.includes(s), s);
  }
  await page.locator('[data-step-filter="human"]').click();
  assert.equal(await page.locator('.step[data-agent="true"]:visible').count(), 0);
  assert.ok((await page.locator('.step[data-agent="false"]:visible').count()) > 0);

  const first = page.locator(".step input").first();
  await first.check();
  await page.reload();
  await page.waitForSelector(".guide-title");
  assert.equal(await page.locator(".step input").first().isChecked(), true, "ticks survive a reload");

  await page.locator('[data-action="copy-md"]').click();
  await page.waitForSelector(".toast");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /^# Slack: OAuth setup guide/);
  assert.match(clip, /## Developer action items/);
  await context.close();
});

test("the Live Generator streams a run and renders a shareable guide", async () => {
  const { page, context } = await open("/generate");
  await page.fill("#gen-app", "Calendly");
  await page.locator('label:has(input[value="read"])').click();
  await page.locator("[data-submit]").click();
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
  assert.equal(await page.locator("#gen-result .guide-title").innerText(), "Calendly");
  assert.equal(await page.locator('.stage[data-status="done"], .stage[data-status="warn"], .stage[data-status="skipped"]').count(), 6);
  assert.ok((await page.locator("#run-log li").count()) > 6);
  assert.match(page.url(), /\/generate\?app=Calendly&intent=read$/);

  await page.locator('#gen-result [data-action="share"]').click();
  const share = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(share, /\/g\/[A-Za-z0-9_-]{12}\?app=Calendly&intent=read$/);
  await page.goto(share);
  await page.waitForSelector(".guide-title");
  assert.equal(await page.locator(".guide-title").innerText(), "Calendly");
  assert.match(await page.locator(".gen-banner").innerText(), /Generated draft/);
  await context.close();
});

test("a generated guide without a vendor family shows provider approval as Unconfirmed", async () => {
  const { page, context } = await open("/generate");
  await page.fill("#gen-app", "Zoom");
  await page.locator("[data-submit]").click();
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
  const fact = page.locator('#gen-result .keyfact:has(dt:text-is("Provider approval")) dd');
  assert.match(await fact.innerText(), /^Unconfirmed/);
  assert.equal(await fact.locator(".approval").getAttribute("data-required"), "unconfirmed");
  const guide = await page.locator("#gen-result article.guide").innerText();
  assert.match(guide, /Provider approval: Unconfirmed/);
  assert.doesNotMatch(guide, /no review by Zoom|isn't expected to review|Not required/);
  await context.close();
});

test("an expired share link names its app and regenerates the guide in one click", async () => {
  // The share store forgets guides on restart; the link still says what it was for.
  const { page, context } = await open("/g/AAAAAAAAAAAA?app=Zoom&intent=read");
  await page.waitForSelector("text=This shared guide isn't available");
  assert.match(await page.locator(".empty p").innerText(), /It was for “Zoom” \(read data\)/);
  const again = page.locator("a[data-regenerate]");
  assert.equal(await again.getAttribute("href"), "/generate?app=Zoom&intent=read");
  await again.click();
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
  assert.equal(await page.locator("#gen-result .guide-title").innerText(), "Zoom");

  // Without the app in the link, it falls back to opening the generator.
  await page.goto(`${srv.base}/g/AAAAAAAAAAAA`);
  await page.waitForSelector("text=This shared guide isn't available");
  assert.equal(await page.locator("a[data-regenerate]").count(), 0);
  await context.close();
});

test("a run whose stream is cut off says so instead of hanging", async () => {
  const { page, context } = await open("/generate");
  // A stream that starts, then closes before any guide or error arrives.
  const run = { type: "run", engine: { kind: "offline", label: "Offline research engine" }, stages: [{ id: "identify", label: "Identify the app" }, { id: "draft", label: "Draft the guide" }], input: "Cutoff" };
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `event: run\ndata: ${JSON.stringify(run)}\n\nevent: stage\ndata: ${JSON.stringify({ type: "stage", id: "identify", status: "running" })}\n\n`,
    }),
  );
  await page.fill("#gen-app", "Cutoff");
  await page.locator("[data-submit]").click();
  await page.waitForSelector("text=The run didn't finish");
  assert.equal(await page.locator('.stage[data-status="running"]').count(), 0, "no stage is left spinning");
  assert.equal(await page.locator("[data-submit]").isDisabled(), false, "the form is usable again");
  await context.close();
});

test("a generator link opened from outside waits for a click; a library app then returns instantly", async () => {
  const { page, context } = await open("/generate?app=notion.so");
  await page.waitForSelector("text=Ready to investigate notion.so");
  assert.equal(await page.inputValue("#gen-app"), "notion.so");
  assert.equal(await page.locator("#gen-result:not([hidden])").count(), 0, "nothing ran on page load");
  await page.locator("[data-submit]").click();
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 10000 });
  assert.match(await page.locator(".result-note").innerText(), /already in the research library/);
  await context.close();
});

test("the route to production draws approval gates from the data", async () => {
  const { page, context } = await open("/guides/salesforce");
  await page.waitForSelector(".journey li");
  assert.equal(await page.locator(".journey li.is-gate").count(), 0, "Salesforce needs no provider approval");
  assert.match(await page.locator(".journey li.is-optional").innerText(), /AgentExchange listing/);
  await page.goto(`${srv.base}/guides/slack`);
  await page.waitForSelector(".journey li");
  assert.match(await page.locator(".journey li.is-gate").innerText(), /Marketplace review/);
  await page.goto(`${srv.base}/guides/discord`);
  await page.waitForSelector(".keyfacts");
  assert.match(await page.locator(".keyfacts").innerText(), /100 servers/);
  await context.close();
});

test("not-found pages suggest a way forward", async () => {
  const { page, context } = await open("/guides/slak");
  await page.waitForSelector(".empty");
  assert.ok((await page.locator(".empty .chip").allInnerTexts()).includes("Slack"));
  await context.close();
});

test("keyboard: / jumps to search from any page; the theme choice persists", async () => {
  const { page, context } = await open("/method");
  await page.waitForSelector("#method-title");
  await page.keyboard.press("/");
  await page.waitForSelector("#q");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "q");
  await page.locator("#theme-toggle").click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
  await context.close();
});

test("icons stay text-sized on every view", async () => {
  // Regression: an icon in running text once had no size and filled the whole column.
  for (const p of ["/", "/guides/slack", "/generate", "/method"]) {
    const { page, context } = await open(p);
    await page.waitForSelector("h1");
    const widest = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("svg.icon")].map((s) => s.getBoundingClientRect().width)));
    assert.ok(widest <= 40, `${p}: an icon is ${widest}px wide`);
    await context.close();
  }
});

test("phone width: no sideways scrolling on the main views", async () => {
  for (const p of ["/", "/guides/microsoft-365", "/guides/slack", "/generate?app=Acme%20Billing", "/method"]) {
    const { page, context } = await open(p, { width: 360 });
    await page.waitForSelector("h1");
    if (p.startsWith("/generate")) {
      await page.locator("[data-submit]").click();
      await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
    }
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${p} overflows by ${overflow}px`);
    // Tables keep words whole and scroll in their frame instead of squeezing columns to a letter.
    const squeezed = await page.evaluate(() => [...document.querySelectorAll("td, th")].filter((c) => c.textContent.trim().length > 12 && c.getBoundingClientRect().width < 70).length);
    assert.equal(squeezed, 0, `${p} has ${squeezed} squeezed table cells`);
    await context.close();
  }
});

test("the single-file demo works from disk without a server", { skip: !fs.existsSync(path.join(import.meta.dirname, "..", "..", "dist", "oauth-field-guide-demo.html")) && "run npm run build first" }, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`demo: ${e.message}`));
  await page.goto(`file://${path.join(import.meta.dirname, "..", "..", "dist", "oauth-field-guide-demo.html")}#/generate?app=Calendly`);
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
  assert.equal(await page.locator("#gen-result .guide-title").innerText(), "Calendly");
  await context.close();
});

const FRAGMENT = path.join(import.meta.dirname, "..", "..", "dist", "artifact", "index.html");
test("the framed demo uses plain #names and hides what a frame can't do", { skip: !fs.existsSync(FRAGMENT) && "run npm run build first" }, async () => {
  // Wrap the fragment the way a page host does: its own head, the page in the body.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ofg-frame-")), "index.html");
  fs.writeFileSync(
    file,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>${fs.readFileSync(FRAGMENT, "utf8")}</body></html>`,
  );
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`framed: ${e.message}`));
  await page.goto(`file://${file}#guide-slack`);
  await page.waitForSelector(".guide-title");
  assert.equal(await page.locator(".guide-title").innerText(), "Slack", "a plain #name deep-links");
  assert.equal(await page.locator('[data-action="download"], [data-action="share"]').count(), 0);
  assert.equal(await page.locator('[data-action="copy-md"]').count(), 1);
  await page.locator('.topbar a[href="#/method"]').click();
  await page.waitForSelector("#method-title");
  assert.equal(new URL(page.url()).hash, "#method", "the host's address bar can keep the view");
  await page.goBack();
  await page.waitForSelector(".guide-title");
  assert.equal(new URL(page.url()).hash, "#guide-slack");

  // Each entry keeps its full route, so Back brings a run back although the bar says #generate.
  await page.locator('.topbar a[href="#/generate"]').click();
  await page.fill("#gen-app", "Calendly");
  await page.locator("[data-submit]").click();
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
  assert.equal(new URL(page.url()).hash, "#generate");
  await page.locator('.topbar a[href="#/method"]').click();
  await page.waitForSelector("#method-title");
  const entries = await page.evaluate(() => history.length);
  await page.locator('.topbar a[href="#/method"]').click();
  assert.equal(await page.evaluate(() => history.length), entries, "a link to the current view adds no entry");
  await page.goBack();
  await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
  assert.equal(await page.inputValue("#gen-app"), "Calendly");

  // The skip link moves focus without renaming the view.
  await page.focus(".skip-link");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "main");
  assert.equal(new URL(page.url()).hash, "#generate");
  await context.close();
});

test("axe finds no WCAG 2.2 A/AA violations on the main views, in both themes", async () => {
  const axePath = path.join(import.meta.dirname, "..", "..", "node_modules", "axe-core", "axe.min.js");
  const found = [];
  for (const scheme of ["light", "dark"]) {
    // bypassCSP only so the test can inject axe; the page itself still runs under its CSP rules.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true });
    const page = await context.newPage();
    for (const p of ["/", "/guides/slack", "/generate?app=Calendly", "/method"]) {
      await page.goto(srv.base + p);
      await page.waitForSelector("h1");
      if (p.startsWith("/generate")) {
        await page.locator("[data-submit]").click();
        await page.waitForSelector("#gen-result:not([hidden]) .guide-title", { timeout: 15000 });
      }
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
        return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target?.join(" ")}`);
      });
      for (const v of violations) found.push(`${scheme} ${p}: ${v}`);
    }
    await context.close();
  }
  assert.deepEqual(found, []);
});

test("the filters sit on one line on desktop and scroll inside their row on phones", async () => {
  {
    const { page, context } = await open("/", { width: 1280 });
    await page.waitForSelector(".filters-row");
    const tops = await page.evaluate(() => [...document.querySelectorAll(".filters-row > :not([hidden])")].map((el) => Math.round(el.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, `controls start on different lines: ${tops}`);
    assert.ok(await page.evaluate(() => { const r = document.querySelector(".filters-row"); return r.scrollWidth <= r.clientWidth; }), "no sideways scroll at 1280px");
    await context.close();
  }
  {
    const { page, context } = await open("/", { width: 390 });
    await page.waitForSelector(".filters-row");
    const { row, pageOverflow } = await page.evaluate(() => {
      const r = document.querySelector(".filters-row");
      return { row: r.scrollWidth > r.clientWidth, pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    assert.ok(row, "the row scrolls on a phone");
    assert.ok(pageOverflow <= 0, "the page itself doesn't");
    await context.close();
  }
});

test("no console errors, CSP violations or Trusted Types failures", () => {
  assert.deepEqual(problems, []);
});
