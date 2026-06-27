import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0e1f45"/>
      <stop offset="100%" stop-color="#020918"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cr" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="30%" stop-color="#bae6fd"/>
      <stop offset="100%" stop-color="#0369a1" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="p1" cx="30%" cy="28%" r="65%">
      <stop offset="0%" stop-color="#e0f2fe"/>
      <stop offset="100%" stop-color="#0369a1"/>
    </radialGradient>
    <radialGradient id="p2" cx="30%" cy="28%" r="65%">
      <stop offset="0%" stop-color="#bfdbfe"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </radialGradient>
    <radialGradient id="p3" cx="30%" cy="28%" r="65%">
      <stop offset="0%" stop-color="#a5f3fc"/>
      <stop offset="100%" stop-color="#0e7490"/>
    </radialGradient>
    <radialGradient id="sw" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#7dd3fc"/>
    </radialGradient>
  </defs>

  <!-- 背景 -->
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>

  <!-- 中心グロー -->
  <circle cx="256" cy="256" r="160" fill="url(#glow)"/>

  <!-- 星（大・輝き付き） -->
  <circle cx="420" cy="80" r="7" fill="#ffffff" opacity="0.9"/>
  <line x1="420" y1="66" x2="420" y2="94" stroke="white" stroke-width="1.5" opacity="0.45"/>
  <line x1="406" y1="80" x2="434" y2="80" stroke="white" stroke-width="1.5" opacity="0.45"/>

  <circle cx="98" cy="110" r="6" fill="#bae6fd" opacity="0.85"/>
  <line x1="98" y1="98" x2="98" y2="122" stroke="white" stroke-width="1.2" opacity="0.4"/>
  <line x1="86" y1="110" x2="110" y2="110" stroke="white" stroke-width="1.2" opacity="0.4"/>

  <circle cx="424" cy="416" r="6" fill="#ffffff" opacity="0.85"/>
  <line x1="424" y1="405" x2="424" y2="427" stroke="white" stroke-width="1.2" opacity="0.4"/>
  <line x1="413" y1="416" x2="435" y2="416" stroke="white" stroke-width="1.2" opacity="0.4"/>

  <circle cx="88" cy="400" r="5.5" fill="#7dd3fc" opacity="0.8"/>
  <line x1="88" y1="390" x2="88" y2="410" stroke="white" stroke-width="1" opacity="0.35"/>
  <line x1="78" y1="400" x2="98" y2="400" stroke="white" stroke-width="1" opacity="0.35"/>

  <circle cx="256" cy="46" r="5" fill="white" opacity="0.8"/>
  <line x1="256" y1="36" x2="256" y2="56" stroke="white" stroke-width="1" opacity="0.35"/>
  <line x1="246" y1="46" x2="266" y2="46" stroke="white" stroke-width="1" opacity="0.35"/>

  <!-- 小さい背景星 -->
  <circle cx="180" cy="62"  r="3" fill="white"  opacity="0.65"/>
  <circle cx="330" cy="52"  r="2.8" fill="#7dd3fc" opacity="0.7"/>
  <circle cx="460" cy="160" r="2.5" fill="white"  opacity="0.55"/>
  <circle cx="52"  cy="190" r="2.5" fill="#bae6fd" opacity="0.65"/>
  <circle cx="58"  cy="320" r="3"   fill="white"  opacity="0.6"/>
  <circle cx="454" cy="340" r="2.8" fill="white"  opacity="0.55"/>
  <circle cx="150" cy="462" r="2.5" fill="white"  opacity="0.6"/>
  <circle cx="370" cy="458" r="2.5" fill="#7dd3fc" opacity="0.65"/>
  <circle cx="466" cy="256" r="2.2" fill="white"  opacity="0.5"/>
  <circle cx="46"  cy="256" r="2.2" fill="#bae6fd" opacity="0.5"/>

  <!-- 軌道リング 3本×60° -->
  <ellipse cx="256" cy="256" rx="196" ry="66" fill="none" stroke="#38bdf8" stroke-width="2.2" opacity="0.5"/>
  <ellipse cx="256" cy="256" rx="196" ry="66" fill="none" stroke="#60a5fa" stroke-width="2.2" opacity="0.45" transform="rotate(60 256 256)"/>
  <ellipse cx="256" cy="256" rx="196" ry="66" fill="none" stroke="#7dd3fc" stroke-width="2.2" opacity="0.45" transform="rotate(-60 256 256)"/>

  <!-- 六角形（外） -->
  <polygon points="256,120 372,187 372,321 256,388 140,321 140,187" fill="none" stroke="#38bdf8" stroke-width="2.8" opacity="0.55"/>
  <!-- 六角形（内） -->
  <polygon points="256,158 314,191 314,323 256,356 198,323 198,191" fill="none" stroke="#7dd3fc" stroke-width="1.8" opacity="0.35"/>
  <!-- 対角線 -->
  <line x1="256" y1="120" x2="256" y2="388" stroke="#38bdf8" stroke-width="1.4" opacity="0.28"/>
  <line x1="140" y1="187" x2="372" y2="321" stroke="#38bdf8" stroke-width="1.4" opacity="0.28"/>
  <line x1="372" y1="187" x2="140" y2="321" stroke="#38bdf8" stroke-width="1.4" opacity="0.28"/>

  <!-- 頂点光点 -->
  <circle cx="256" cy="120" r="7"   fill="#7dd3fc" opacity="0.9"/>
  <circle cx="372" cy="187" r="6.5" fill="#7dd3fc" opacity="0.82"/>
  <circle cx="372" cy="321" r="6.5" fill="#7dd3fc" opacity="0.82"/>
  <circle cx="256" cy="388" r="7"   fill="#7dd3fc" opacity="0.9"/>
  <circle cx="140" cy="321" r="6.5" fill="#7dd3fc" opacity="0.82"/>
  <circle cx="140" cy="187" r="6.5" fill="#7dd3fc" opacity="0.82"/>

  <!-- コア -->
  <circle cx="256" cy="256" r="56" fill="url(#cr)" opacity="0.9"/>
  <circle cx="256" cy="256" r="24" fill="#ffffff" opacity="0.95"/>

  <!-- 惑星 3つ -->
  <circle cx="452" cy="256" r="22" fill="url(#p1)"/>
  <circle cx="162" cy="124" r="20" fill="url(#p2)"/>
  <circle cx="414" cy="376" r="20" fill="url(#p3)"/>
</svg>`;

const svgBuffer = Buffer.from(svg);

async function generate() {
  await sharp(svgBuffer).resize(512, 512).png().toFile(resolve(__dirname, '../public/icons/icon-512.png'));
  console.log('icon-512.png done');

  await sharp(svgBuffer).resize(192, 192).png().toFile(resolve(__dirname, '../public/icons/icon-192.png'));
  console.log('icon-192.png done');
}

generate().catch(console.error);
