/**
 * Shared headless-Chromium session for the exporters. Chromium shapes Devanagari with HarfBuzz and embeds
 * the page's web fonts in PDFs, so text comes out correctly shaped, selectable and searchable.
 */
import fs from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

let browser: Promise<Browser> | null = null;

/** Playwright's bundled Chromium (installed with `npx playwright install chromium`), else the installed Chrome. */
function launch(): Promise<Browser> {
  const bundled = chromium.executablePath();
  return fs.existsSync(bundled) ? chromium.launch() : chromium.launch({ channel: "chrome" });
}

export async function getBrowser(): Promise<Browser> {
  if (!browser) browser = launch().catch((e) => { browser = null; throw e; });
  const b = await browser;
  if (!b.isConnected()) { browser = null; return getBrowser(); }
  return b;
}

/** Documents waiting to be rendered, by one-time token (the render view fetches them over HTTP). */
export const pending = new Map<string, unknown>();

/**
 * Open the render view for `doc` and wait until fonts and images are ready. `scale` is the device scale
 * factor; `zoom` magnifies the pages inside the view (PNG export). The caller closes the page's context.
 */
export async function openRender(origin: string, doc: unknown, opts: { bleed: boolean; scale: number; zoom?: number }): Promise<Page> {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pending.set(token, doc);
  const ctx = await (await getBrowser()).newContext({ deviceScaleFactor: opts.scale, viewport: { width: 1200, height: 1600 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${origin}/?render=${token}&bleed=${opts.bleed ? 1 : 0}&scale=${opts.zoom ?? 1}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as unknown as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 30000 });
    const err = await page.$("#render-error");
    if (err) throw new Error(await err.innerText());
    return page;
  } catch (e) {
    await ctx.close();
    throw e;
  } finally {
    pending.delete(token);
  }
}
