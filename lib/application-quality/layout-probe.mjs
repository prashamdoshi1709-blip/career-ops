// Visual layout probe for rendered CV and letter pages (2026-11-17; moved here
// 2026-11-19). Works on any page whose sheets use class "page"; no personal data.
import { pathToFileURL } from "node:url";

// Reads the rendered page the PDF is printed from and reports, per page: text
// clipped at the right edge, text blocks that overlap, empty pages, characters
// the font could not draw (replacement glyphs), and how many lines the CV
// profile takes (his rule: five at most). Free; uses the same local browser.
export async function probe(page) {
  return page.evaluate(() => {
    const pages = [...document.querySelectorAll(".page")];
    return pages.map((p, i) => {
      const pr = p.getBoundingClientRect();
      const blocks = [...p.querySelectorAll("p,li,.row,.co,.sig,.sec-h,h1,h2")].filter((el) => el.textContent.trim());
      const clipped = blocks.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > pr.right + 0.5).map((el) => el.textContent.trim().slice(0, 60));
      const rects = blocks.map((el) => ({ r: el.getBoundingClientRect(), t: el.textContent.trim().slice(0, 40) })).filter((b) => b.r.height > 0);
      const overlaps = [];
      for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a].r, B = rects[b].r;
        if (A.top < B.bottom - 1 && B.top < A.bottom - 1 && A.left < B.right - 1 && B.left < A.right - 1 && !rects[a].t.includes(rects[b].t) && !rects[b].t.includes(rects[a].t)) {
          // A block nested in another (a list item in a list) is not an overlap.
          overlaps.push(`${rects[a].t} / ${rects[b].t}`);
        }
      }
      const text = p.innerText ?? "";
      const prof = i === 0 ? p.querySelector(".sec-b") : null;
      const lh = prof ? parseFloat(getComputedStyle(prof).lineHeight) || 1 : 1;
      return { page: i + 1, empty: !text.trim(), clipped, overlaps: overlaps.slice(0, 5), replacementChars: (text.match(/\uFFFD/g) ?? []).length, profileLines: prof ? Math.round(prof.getBoundingClientRect().height / lh) : null };
    });
  });
}

/** Probe an already rendered .html (used by "Check quality" on existing documents). */
export async function probeHtml(htmlPath) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => document.fonts.ready);
    return await probe(page);
  } finally { await browser.close(); }
}

