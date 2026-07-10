// Convert resources/icon.svg into resources/icon.icns by rendering an .iconset
// and invoking macOS `iconutil`.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const resources = join(root, 'resources');
const svgPath = join(resources, 'icon.svg');
const iconsetDir = join(resources, 'icon.iconset');
const icnsPath = join(resources, 'icon.icns');
const pngPath = join(resources, 'icon.png');

if (!existsSync(svgPath)) {
  console.error('icon.svg not found at', svgPath);
  process.exit(1);
}

const svg = readFileSync(svgPath);

const sizes = [
  { size: 16, name: 'icon_16x16.png' },
  { size: 32, name: 'icon_16x16@2x.png' },
  { size: 32, name: 'icon_32x32.png' },
  { size: 64, name: 'icon_32x32@2x.png' },
  { size: 128, name: 'icon_128x128.png' },
  { size: 256, name: 'icon_128x128@2x.png' },
  { size: 256, name: 'icon_256x256.png' },
  { size: 512, name: 'icon_256x256@2x.png' },
  { size: 512, name: 'icon_512x512.png' },
  { size: 1024, name: 'icon_512x512@2x.png' },
];

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });

await Promise.all(
  sizes.map(async ({ size, name }) => {
    const buf = await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toBuffer();
    writeFileSync(join(iconsetDir, name), buf);
  })
);

// Also write a top-level 1024 PNG for fallback usage.
const big = await sharp(svg, { density: 384 }).resize(1024, 1024).png().toBuffer();
writeFileSync(pngPath, big);

try {
  execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, {
    stdio: 'inherit',
  });
} catch (err) {
  console.error('iconutil failed:', err);
  process.exit(1);
}

rmSync(iconsetDir, { recursive: true, force: true });
console.log('Wrote', icnsPath);
console.log('Wrote', pngPath);
