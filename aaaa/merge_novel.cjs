// merge_novel.cjs
// 使用：node merge_novel.cjs
// 会将当前目录 final/ 下的所有 .txt 文件合并为 merged_novel.txt

const fs = require('fs');
const path = require('path');

const FINAL_DIR = path.join(__dirname, 'final');
const OUTPUT = path.join(__dirname, 'merged_novel.txt');
const PROJECT_NAME = '《贞心淫骨》'; // 项目名称

if (!fs.existsSync(FINAL_DIR)) {
  console.error('❌ 找不到 final/ 目录，请先运行 Task B 生成章节文件');
  process.exit(1);
}

const files = fs.readdirSync(FINAL_DIR)
  .filter(f => f.endsWith('.txt'))
  .sort((a, b) => {
    // 主线章节排在前面，番外篇(ext)排在后面
    const isExtA = a.includes('ext');
    const isExtB = b.includes('ext');
    if (isExtA !== isExtB) return isExtA ? 1 : -1;
    const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
    const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
    return numA - numB;
  });

if (files.length === 0) {
  console.error('❌ final/ 目录下没有 .txt 文件');
  process.exit(1);
}

let merged = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${PROJECT_NAME} · 重制版
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

for (const file of files) {
  const filepath = path.join(FINAL_DIR, file);
  let content = fs.readFileSync(filepath, 'utf-8');

  // 清理装饰线
  content = content.replace(/[━═]{10,}/g, '─'.repeat(30));
  content = content.replace(/\n{4,}/g, '\n\n\n');
  content = content.trim();

  merged += content + `\n\n${'─'.repeat(30)}\n\n`;
}

fs.writeFileSync(OUTPUT, merged, 'utf-8');

const sizeKB = (Buffer.byteLength(merged, 'utf-8') / 1024).toFixed(1);
console.log(`✅ 合并完成！`);
console.log(`   输出: ${OUTPUT}`);
console.log(`   章节: ${files.length} 章`);
console.log(`   大小: ${sizeKB} KB`);
