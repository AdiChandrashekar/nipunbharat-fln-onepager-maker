// Dev helper: screenshot every page of a bare render URL. Usage: node scripts/shoot.mjs <outdir> <name>=<query> ...
import { chromium } from "playwright";
import fs from "node:fs";
const [outdir, ...specs] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1.5, viewport: { width: 1400, height: 1000 } });
for (const spec of specs) {
  const [name, query] = spec.split(/=(.*)/s);
  await page.goto(`http://localhost:5178/?${query}`);
  await page.waitForSelector(".bare .page");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const readout = await page.$eval(".bare", (e) => e.dataset.readout);
  const pages = await page.$$(".bare .page");
  for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: `${outdir}/${name}-p${i + 1}.png` });
  console.log(`${name}: ${readout}`);
}
await browser.close();
