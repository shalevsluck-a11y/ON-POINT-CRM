#!/usr/bin/env node
// Generates assets/icon-192.png and assets/icon-512.png from assets/icon.svg
// Run: node scripts/generate-icons.js
// Requires: npm install canvas (or sharp)

const path = require('path');
const fs   = require('fs');

const sizes = [192, 512];
const svgPath = path.resolve(__dirname, '../assets/icon.svg');

// Try sharp first (lighter), fall back to canvas
let generate;

try {
  const sharp = require('sharp');
  generate = async (size) => {
    const outPath = path.resolve(__dirname, `../assets/icon-${size}.png`);
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Generated ${outPath}`);
  };
} catch (_e) {
  try {
    const { createCanvas, loadImage } = require('canvas');
    const { Canvg } = require('canvg');

    generate = async (size) => {
      const outPath = path.resolve(__dirname, `../assets/icon-${size}.png`);
      const canvas  = createCanvas(size, size);
      const ctx     = canvas.getContext('2d');
      const svgText = fs.readFileSync(svgPath, 'utf8');
      const v = await Canvg.fromString(ctx, svgText, { enableRedraw: false });
      await v.render();
      const buf = canvas.toBuffer('image/png');
      fs.writeFileSync(outPath, buf);
      console.log(`Generated ${outPath}`);
    };
  } catch (_e2) {
    console.error('Error: install either "sharp" or "canvas" + "canvg"');
    console.error('  npm install sharp');
    process.exit(1);
  }
}

(async () => {
  for (const size of sizes) {
    await generate(size);
  }
  console.log('Icons generated successfully.');
})();
