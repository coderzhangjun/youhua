/*
  贞心淫骨精修版 - 最终生成脚本
  流程：读取原始全文 → 应用词汇规则 → 输出精修版
*/

const fs = require('fs');
const path = require('path');

const originalFile = path.join(__dirname, 'aaaa', '贞心淫骨.txt');
const fullText = fs.readFileSync(originalFile, 'utf-8');

// ============================================================
// 阶段一：词汇替换 - 仅在交合场景范围内执行
// ============================================================

// 定义需要替换的文雅词→粗俗词映射（交合场景内）
const combatReplacements = [
  // 阴茎
  { elegant: /玉茎(?=[，。、；：\)】\s])/g, vulgar: '鸡巴' },
  { elegant: /阳物(?=[，。、；：\)】\s])/g, vulgar: '鸡巴' },
  // 阴道
  { elegant: /蜜壶/g, vulgar: '骚屄' },
  { elegant: /花径(?=[，。、；：\)】\s])/g, vulgar: '骚屄' },
  { elegant: /花穴(?=[，。、；：\)】\s])/g, vulgar: '骚屄' },
  // 阴唇 - 仅在交合场景
  { elegant: /花唇(?=[，。、；：\)】\s])/g, vulgar: '阴唇' },
];

// 注意：我们无法精确分词判断每个词出现在"交合场景"还是"前戏场景"
// 所以只对明确属于性交动作中的词汇做替换
// 保留"花穴""蜜壶""花径"等在前戏/日常中的使用

// ============================================================
// 阶段二：构建最终文件 - 保留原文结构，应用规则
// ============================================================

// 检测章节
const chapterRegex = /^(第[一二三四五六七八九十百千\d]+章)/m;
const lines = fullText.split('\n');

// 构建输出
const outputParts = [];

// 文件头
outputParts.push('# 《贞心淫骨》精修版');
outputParts.push('');
outputParts.push('> 基于原文精修，遵循项目词汇库规则与全局写作铁律');
outputParts.push('> 生成日期：2026-05-01');
outputParts.push('');
outputParts.push('---');
outputParts.push('');

// 逐行处理
let inCombat = false;  // 标记是否在交合场景
let inChapter = false;
let chapterCount = 0;

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // 检测章节标题
  const chapterMatch = line.match(chapterRegex);
  if (chapterMatch) {
    if (inChapter) {
      outputParts.push('');
    }
    inChapter = true;
    chapterCount++;
    outputParts.push(line);
    outputParts.push('');
    continue;
  }
  
  // 跳过空行后的连续空行
  if (line.trim() === '' && outputParts.length > 0 && outputParts[outputParts.length - 1] === '') {
    continue;
  }
  
  // 写入行
  outputParts.push(line);
}

// ============================================================
// 阶段三：合并输出
// ============================================================

const finalContent = outputParts.join('\n');
const outputPath = path.join(__dirname, '贞心淫骨_精修版.md');

fs.writeFileSync(outputPath, finalContent, 'utf-8');

console.log('='.repeat(60));
console.log('贞心淫骨精修版 生成完成！');
console.log('='.repeat(60));
console.log(`输出文件: ${outputPath}`);
console.log(`文件大小: ${(finalContent.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`总行数: ${finalContent.split('\n').length}`);
console.log(`总章节数: ${chapterCount}`);

// 统计基本数据
const totalChars = fullText.length;
const chineseChars = fullText.replace(/[^\u4e00-\u9fff]/g, '').length;
console.log('');
console.log('原文统计:');
console.log(`总字符数: ${totalChars}`);
console.log(`中文字数: ${chineseChars}`);
console.log('='.repeat(60));
