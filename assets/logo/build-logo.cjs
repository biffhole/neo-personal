const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const output = __dirname;
const turn = Math.PI * 2;
const growth = Math.log(2.8) / turn;
const stroke = 44;
const point = distance => {
  const radius = 390 * Math.exp(-growth * distance);
  const angle = -0.5 - distance;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
};
const samples = Array.from({ length: 721 }, (_, index) => point(index * 17.2 / 720));
const bounds = {
  left: Math.min(...samples.map(sample => sample.x)),
  right: Math.max(...samples.map(sample => sample.x)),
  top: Math.min(...samples.map(sample => sample.y)),
  bottom: Math.max(...samples.map(sample => sample.y))
};
const scale = 760 / Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top);
const center = {
  x: 512 - (bounds.left + bounds.right) * scale / 2,
  y: 512 - (bounds.top + bounds.bottom) * scale / 2
};
const coordinate = sample => `${(center.x + sample.x * scale).toFixed(3)} ${(center.y + sample.y * scale).toFixed(3)}`;
const spiral = samples.map((sample, index) => `${index ? 'L' : 'M'} ${coordinate(sample)}`).join(' ');
const chambers = Array.from({ length: 8 }, (_, index) => {
  const distance = 1.04 + index * 0.69;
  const outside = point(distance);
  const inside = point(distance + turn);
  const bend = point(distance + 0.76);
  const control = { x: bend.x * 0.75, y: bend.y * 0.75 };
  return `M ${coordinate(outside)} Q ${coordinate(control)} ${coordinate(inside)}`;
}).join(' ');
const mark = `<g fill="none" stroke="#000000" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${spiral}"/><path d="${chambers}"/></g>`;
const document = background => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>NEO Enhanced — Nautilus</title>${background}${mark}</svg>\n`;

async function rasterize(filename, size, background) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  const image = await loadImage(Buffer.from(document(background)));
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const color = pixels.data[offset] >= 128 ? 255 : 0;
    const alpha = pixels.data[offset + 3] >= 128 ? 255 : 0;
    pixels.data[offset] = alpha ? color : 0;
    pixels.data[offset + 1] = alpha ? color : 0;
    pixels.data[offset + 2] = alpha ? color : 0;
    pixels.data[offset + 3] = alpha;
  }
  context.putImageData(pixels, 0, 0);
  fs.writeFileSync(path.join(output, filename), canvas.toBuffer('image/png'));
}

async function build() {
  const white = '<rect width="1024" height="1024" fill="#FFFFFF"/>';
  const rounded = '<rect x="24" y="24" width="976" height="976" rx="219.6" fill="#FFFFFF"/>';
  fs.writeFileSync(path.join(output, 'logo.svg'), document(white));
  await rasterize('logo.png', 1024, white);
  await rasterize('icon.png', 1024, rounded);
  await rasterize('logo-mark.png', 512, '');
  await rasterize('preview-32.png', 32, white);
  await rasterize('preview-16.png', 16, white);
}

build().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
