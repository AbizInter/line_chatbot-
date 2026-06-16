import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

const SOURCE_ROOT =
  '../text ตอบแชท/ปฏิทิน_2026/ตั้งโต๊ะ';
const OUT_DIR = path.resolve('public/calendars');

const DESIGNS = [
  {
    slug: 'global-festival',
    folder: '2026_14แผ่น_ชุด Global Festival++',
    file: 'AW_Global-Festival-2026_Page_01.jpg',
  },
  {
    slug: 'minimal-dark',
    folder: '2026_14แผ่น_ชุด Minimal DARK++',
    file: 'AW-MinimalDARK-Optical-illusions_Page_01.jpg',
  },
  {
    slug: 'mu-te-lu',
    folder: '2026_14แผ่น_ชุด Mu Te Lu++',
    file: 'AW_Mu-Te-Lu-2026_Page_01.jpg',
  },
  {
    slug: 'phra-racha-nai-duang-jai',
    folder: '2026_14แผ่น_ชุด พระราชาในดวงใจ++',
    file: 'aw_Calendar_ในหลวง_Page_01.jpg',
  },
  {
    slug: 'tang-toe-jin-yer',
    folder: '2026_8แผ่น_ชุด ตั้งโต๊ะจีนเยอะ++',
    file: '2026-ตั้งโต๊ะ8แผ่น_จีนเยอะ-6x8_Page_01.jpg',
  },
  {
    slug: 'two-tone',
    folder: '2026_ตั้งโต๊ะ 8 แผ่น_ชุด TwoTone++',
    file: '2026_ตั้งโต๊ะ-8-แผ่นl_2Tones_Page_01.jpg',
  },
  {
    slug: 'raeng-banda-jai',
    folder: '2026_ตั้งโต๊ะ 8 แผ่น_แรงบันดาลใจ++',
    file: '2026_ตั้งโต๊ะ-8-แผ่นl_แรงบันดาลใจ_new_Page_01.jpg',
  },
  {
    slug: 'cat-meaw',
    folder: 'ปฏิทิน-14-แผ่น-แนวตั้ง_Cat-Meaw',
    file: 'Preview_Cat-Meaw-1.png',
  },
  {
    slug: 'planner-post-it',
    folder: 'ปฏิทิน_Planner_Post-it',
    file: 'Preview_Planner_Post-it.png',
  },
  {
    slug: 'capybara',
    folder: 'ปฏิทิน_คาบีบาร่า',
    file: 'AW-ตั้งโต๊ะ 6x8_16p-คาบีบาร่า_Page_01.jpg',
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const { slug, folder, file } of DESIGNS) {
  const srcPath = path.resolve(SOURCE_ROOT, folder, file);
  const destPath = path.join(OUT_DIR, `${slug}.jpg`);

  await sharp(srcPath)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(destPath);

  const { size } = fs.statSync(destPath);
  console.log(`${slug}.jpg  ${(size / 1024).toFixed(0)} KB`);
}
