// Pixel comparison of a Figma render and a Storybook screenshot.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { ensureDir } from './util.js';

/**
 * Both images are flattened on white and brought to the same pixel density.
 * Size difference is reported separately (in CSS px) so a 2px-taller button
 * isn't hidden inside a percentage.
 */
export async function compareImages(figmaFile, codeFile, diffFile, { figmaScale = 2, codeScale = 2, threshold = 0.12 } = {}) {
  const fMeta = await sharp(figmaFile).metadata();
  const cMeta = await sharp(codeFile).metadata();
  const fCss = { w: fMeta.width / figmaScale, h: fMeta.height / figmaScale };
  const cCss = { w: cMeta.width / codeScale, h: cMeta.height / codeScale };

  // Normalise to the Figma pixel grid
  const W = fMeta.width; const H = fMeta.height;
  const flat = { background: { r: 255, g: 255, b: 255 } };
  const fBuf = await sharp(figmaFile).flatten(flat).ensureAlpha().raw().toBuffer();
  const aspectGap = Math.abs(fCss.w / fCss.h - cCss.w / cCss.h) / (fCss.w / fCss.h);
  let cBuf;
  if (aspectGap <= 0.2) {
    cBuf = await sharp(codeFile).flatten(flat).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
  } else {
    // Very different shape: scale to Figma density and anchor top-left so the diff shows the overflow
    const scaled = await sharp(codeFile).flatten(flat).resize(Math.max(1, Math.round(cMeta.width * figmaScale / codeScale)), Math.max(1, Math.round(cMeta.height * figmaScale / codeScale))).png().toBuffer();
    cBuf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([{ input: await sharp(scaled).extract({ left: 0, top: 0, width: Math.min(W, Math.round(cMeta.width * figmaScale / codeScale)), height: Math.min(H, Math.round(cMeta.height * figmaScale / codeScale)) }).png().toBuffer(), left: 0, top: 0 }])
      .raw().toBuffer();
  }
  const diff = new PNG({ width: W, height: H });
  const mismatched = pixelmatch(fBuf, cBuf, diff.data, W, H, { threshold, includeAA: false, alpha: 0.2, diffColor: [220, 38, 38], diffColorAlt: [37, 99, 235] });
  ensureDir(path.dirname(diffFile));
  fs.writeFileSync(diffFile, PNG.sync.write(diff));

  return {
    mismatch: mismatched / (W * H),
    figmaSize: { w: round(fCss.w), h: round(fCss.h) },
    codeSize: { w: round(cCss.w), h: round(cCss.h) },
    sizeDelta: { w: round(cCss.w - fCss.w), h: round(cCss.h - fCss.h) },
    reshaped: aspectGap > 0.2,
  };
}

const round = (n) => Math.round(n * 10) / 10;
