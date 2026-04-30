const fs = require('fs');
const path = require('path');

const finalDir = 'D:/self/xiangmu/youhua/final/';
const outputPath = 'D:/self/xiangmu/youhua/merged_novel.txt';

// Determine correct file order
// Need to map: chapter_X vs named files
const fileOrder = [
  'chapter_1_final.txt',
  'chapter_2_final.txt',
  'chapter_3_final.txt',
  'chapter_4_final.txt',
  'chapter_5_final.txt',
  'chapter_6_final.txt',
  'chapter_7_final.txt',
  'chapter_8_final.txt',
  'chapter_09_final.txt',
  'chapter_10_final.txt',
  'chapter_11_final.txt',
  'chapter_12a_final.txt',
  'chapter_12b_final.txt',
  'chapter_13_衙内.txt',
  'chapter_14_贪欲.txt',
  'chapter_15_谁主浮沉.txt',
  'chapter_16_狭路相逢.txt',
  'chapter_17_月恨明.txt',
  // Part 3
  'chapter_part3_03.txt',
  'chapter_part3_04.txt',
  'chapter_part3_05.txt',
  'chapter_part3_06.txt',
];

const header = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
娇妻的江湖 · 重制版
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

const chapterBreaks = [];

let merged = header;
let chapterNum = 1;

for (const filename of fileOrder) {
  const filepath = path.join(finalDir, filename);
  if (!fs.existsSync(filepath)) {
    console.warn('WARNING: File not found: ' + filename);
    continue;
  }
  
  let content = fs.readFileSync(filepath, 'utf-8');
  
  // Clean up decorative lines - replace excessive separators
  content = content.replace(/[━]{10,}/g, '─'.repeat(30));
  content = content.replace(/[═]{10,}/g, '─'.repeat(30));
  content = content.replace(/\n{3,}/g, '\n\n');  // normalize blank lines
  
  // Add chapter break marker
  const chapterBreak = `\n\n${'─'.repeat(30)}\n\n`;
  
  // Remove any leading/trailing whitespace
  content = content.trim();
  
  merged += content + chapterBreak;
  
  const fileSize = Buffer.byteLength(content, 'utf-8');
  chapterBreaks.push({ ch: chapterNum, file: filename, size: fileSize });
  chapterNum++;
}

// Write output
fs.writeFileSync(outputPath, merged, 'utf-8');

console.log('✅ 合并完成！');
console.log('输出文件: ' + outputPath);
console.log('总章节数: ' + (chapterNum - 1));
console.log('总大小: ' + (Buffer.byteLength(merged, 'utf-8') / 1024).toFixed(1) + ' KB');
console.log('');
console.log('章节列表:');
for (const cb of chapterBreaks) {
  console.log(`  第${cb.ch}章: ${cb.file} (${(cb.size / 1024).toFixed(1)} KB)`);
}
