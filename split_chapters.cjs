const fs = require('fs');
const path = require('path');

const text = fs.readFileSync(path.join(__dirname, 'aaaa', '贞心淫骨.txt'), 'utf-8');
const lines = text.split('\n');

// Chapter start line numbers (from grep output)
const chapterStarts = [
  { num: 1, line: 0 },       // 第一章  line 1
  { num: 2, line: 244 },     // 第二章  line 245
  { num: 3, line: 432 },     // 第三章  line 433
  { num: 4, line: 667 },     // 第四章  line 668
  { num: 5, line: 875 },     // 第五章  line 876
  { num: 6, line: 1083 },    // 第六章  line 1084
  { num: 7, line: 1333 },    // 第七章  line 1334
  { num: 9, line: 1824 },    // 第九章  line 1825
  { num: 10, line: 2125 },   // 第十章  line 2126
  { num: 11, line: 2439 },   // 第十一章 line 2440
  { num: 12, line: 2748 },   // 第十二章 line 2749
  { num: 13, line: 3080 },   // 第十三章 line 3081
  { num: 14, line: 3414 },   // 第十四章 line 3415
  { num: 15, line: 3634 },   // 第十五章 line 3635
  { num: 16, line: 3907 },   // 第十六章 line 3908
  { num: 17, line: 4251 },   // 第十七章 line 4252
  { num: 18, line: 4566 },   // 第十八章 line 4567
  { num: 19, line: 4842 },   // 第十九章 line 4843
  { num: 20, line: 5115 },   // 第二十章 line 5116
  { num: 21, line: 5363 },   // 第二十一章 line 5364
  { num: 22, line: 5627 },   // 第二十二章 line 5628
  { num: 23, line: 5915 },   // 第二十三章 line 5916
  { num: 24, line: 6183 },   // 第二十四章 line 6184
  { num: 25, line: 6528 },   // 第二十五章 line 6529
  { num: 26, line: 7099 },   // 第二十六章 line 7100
  { num: 27, line: 7463 },   // 第二十七章 line 7464
  { num: 28, line: 8016 },   // 第二十八章 line 8017
  { num: 29, line: 8560 },   // 第二十九章 line 8561
  { num: 30, line: 8967 },   // 第三十章 line 8968
  { num: 31, line: 9312 },   // 第三十一章 line 9313
  { num: 32, line: 9707 },   // 第三十二章 line 9708
  { num: 33, line: 10121 },  // 第三十三章 line 10122
  { num: 34, line: 10491 },  // 第三十四章 line 10492
  { num: 35, line: 10808 },  // 第三十五章 line 10809
  { num: 36, line: 11151 },  // 第三十六章 line 11152
  { num: 37, line: 11511 },  // 第三十七章 line 11512
  { num: 38, line: 11883 },  // 第三十八章 line 11884
  { num: 39, line: 12251 },  // 第三十九章 line 12252
  { num: 40, line: 12579 },  // 第四十章 line 12580
  { num: 43, line: 13538 },  // 第四十三章 line 13539
  { num: 44, line: 13902 },  // 第四十四章 line 13903
  { num: 45, line: 14269 },  // 第四十五章 line 14270
  { num: 46, line: 14600 },  // 第四十六章 line 14601
  { num: 47, line: 14992 },  // 第四十七章 line 14993
  { num: 48, line: 15405 },  // 第四十八章 line 15406
  { num: 49, line: 15755 },  // 第四十九章 line 15756
  { num: 50, line: 16143 },  // 第五十章 line 16144
  { num: 51, line: 16589 },  // 第五十一章 line 16590
  { num: 52, line: 17009 },  // 第五十二章 line 17010
  { num: 58, line: 17417 },  // 第五十八章 line 17418 (note: 53-57 missing)
  { num: 54, line: 17817 },  // 第五十四章 line 17818
  { num: 55, line: 18273 },  // 第五十五章 line 18274
  { num: 56, line: 18637 },  // 第五十六章 line 18638
  { num: 57, line: 19058 },  // 第五十七章 line 19059
  { num: 58_2, line: 19440 }, // 第五十八章(2) line 19441
  { num: 59, line: 19916 },  // 第五十九章 line 19917
  { num: 60, line: 20330 },  // 第六十章 line 20331
  { num: 61, line: 20702 },  // 第六十一章 line 20703
  { num: 62, line: 21115 },  // 第六十二章 line 21116
  { num: 63, line: 21406 },  // 第六十三章 line 21407
  { num: 64, line: 21584 },  // 第六十四章 line 21585
  { num: 65, line: 22063 },  // 第六十五章 line 22064
  { num: 66, line: 22503 },  // 第六十六章 line 22504
  { num: 67, line: 22908 },  // 第六十七章 line 22909
  { num: 68, line: 23357 },  // 第六十八章 line 23358
  { num: 69, line: 23740 },  // 第六十九章 line 23741
  { num: 70, line: 24103 },  // 第七十章 line 24104
  { num: 71, line: 24545 },  // 第七十一章 line 24546
  // Part 2 - secondary novel
  { num: 'p2_1', line: 24886 },  // 第一章凤啼初试月笼沙 line 24887
  { num: 'p2_2', line: 25158 },  // 第二章镜花水月演红楼 line 25159
  { num: 'p2_3', line: 25578 },  // 第三章霓裳羽衣试云雨 line 25579
  { num: 'p2_4', line: 26221 },  // 第四章 line 26222
  { num: 'p2_5', line: 26725 },  // 第五章 line 26726
  { num: 'p2_6', line: 26959 },  // 第六章 镜花水月锁重楼 line 26960
];

const outputDir = path.join(__dirname, 'chapters');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

for (let i = 0; i < chapterStarts.length; i++) {
  const current = chapterStarts[i];
  const next = chapterStarts[i + 1];
  const start = current.line;
  const end = next ? next.line - 1 : lines.length - 1;
  
  const chapterContent = lines.slice(start, end + 1).join('\n');
  const filename = `chapter_${String(current.num).padStart(3, '0')}.txt`;
  fs.writeFileSync(path.join(outputDir, filename), chapterContent, 'utf-8');
  console.log(`Written: ${filename} (lines ${start + 1}-${end + 1})`);
}

console.log('Done! Total chapters:', chapterStarts.length);
