// 引入 Node.js 自带的文件读写工具。
const fs = require('node:fs');

// 将 CSV 中的一行拆成单元格，并正确处理带引号的逗号和双引号。
function parseCsvLine(line) {
  const cells = []; // 保存拆分后的单元格。
  let cell = ''; // 保存当前正在读取的单元格。
  let quoted = false; // 标记当前位置是否在双引号字段中。

  // 从左到右逐个读取字符。
  for (let i = 0; i < line.length; i++) {
    const char = line[i]; // 当前字符。

    if (char === '"') { // 双引号可能是字段边界，也可能是字段内容。
      if (quoted && line[i + 1] === '"') { // 两个连续引号代表内容里的一个引号。
        cell += '"'; // 将一个引号加入当前单元格。
        i++; // 跳过已经处理过的第二个引号。
      } else {
        quoted = !quoted; // 切换“引号内/引号外”状态。
      }
    } else if (char === ',' && !quoted) { // 引号外的逗号表示单元格结束。
      cells.push(cell); // 保存当前单元格。
      cell = ''; // 清空暂存区，开始下一个单元格。
    } else {
      cell += char; // 普通字符加入当前单元格。
    }
  }

  cells.push(cell); // 保存最后一个单元格。
  return cells; // 把所有单元格交给调用者。
}

// 将内容转成合法的 CSV 单元格，避免逗号或引号破坏输出格式。
function csvEscape(value) {
  const text = String(value); // 统一转换成文本。
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// 找出表头中第一个匹配候选名称的列；找不到时返回 -1。
function findColumn(headers, names) {
  return headers.findIndex(header => names.includes(header));
}

// 第一个命令行参数是输入文件，第二个可选参数是输出文件。
const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'sales-summary.csv';

// 没有输入文件时显示正确用法并退出。
if (!inputPath) {
  console.error('用法: node sales-summary.js 订单.csv [汇总.csv]');
  process.exit(1);
}

// 读取文件；如果文件不存在或无法读取，就显示清楚的错误并退出。
let fileText;
try {
  fileText = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
} catch (error) {
  console.error(`无法读取文件“${inputPath}”：${error.message}`);
  process.exit(1);
}

// 按换行符拆分文件，并去掉空白行。
const lines = fileText.split(/\r?\n/).filter(line => line.trim());
if (lines.length < 2) { // 至少需要表头和一条订单记录。
  console.error('订单文件需要包含表头和至少一行订单数据。');
  process.exit(1);
}

// 解析表头、去掉空格并统一小写，减少大小写造成的匹配问题。
const headers = parseCsvLine(lines[0]).map(header => header.trim().toLowerCase());
// 同时接受常见英文列名和中文列名。
const productIndex = findColumn(headers, ['product', '商品', '商品名称', '产品', '产品名称']);
const quantityIndex = findColumn(headers, ['quantity', 'qty', '数量', '购买数量']);
const priceIndex = findColumn(headers, ['price', 'unit price', '单价', '商品单价']);

// 缺少任何必需列时提示可识别的列名。
if ([productIndex, quantityIndex, priceIndex].includes(-1)) {
  console.error('找不到必需列。请提供商品/商品名称、数量、单价（或 product、quantity、price）。');
  process.exit(1);
}

const totals = new Map(); // 按商品名保存累计销量和销售额。
let skippedRows = 0; // 统计无效订单行的数量。

// 从第二行开始处理订单，因为第一行是表头。
for (let row = 1; row < lines.length; row++) {
  const cells = parseCsvLine(lines[row]); // 将订单行拆成单元格。
  const product = (cells[productIndex] || '').trim(); // 读取商品名。
  const quantityText = (cells[quantityIndex] || '').trim(); // 读取数量文本。
  const priceText = (cells[priceIndex] || '').trim(); // 读取单价文本。
  const quantity = Number(quantityText); // 将数量转换成数字。
  const price = Number(priceText); // 将单价转换成数字。

  // 验证必需字段、数字格式和非负数规则。
  if (!product || !quantityText || !priceText || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0) {
    console.warn(`跳过第 ${row + 1} 行：商品名、数量或单价为空/无效。`);
    skippedRows++; // 无效行计数加一。
    continue; // 忽略这一行，继续检查下一行。
  }

  // 查找这个商品已有的汇总；第一次遇到时初始化为零。
  const current = totals.get(product) || { quantity: 0, revenueCents: 0 };
  current.quantity += quantity; // 累加销量。
  // 先把每笔金额四舍五入到分，再用整数分相加，减少小数精度误差。
  current.revenueCents += Math.round(quantity * price * 100);
  totals.set(product, current); // 保存更新后的汇总。
}

// 生成结果文件：第一行是中文表头，其余行是每个商品的汇总。
const outputRows = [
  ['商品名称', '总销量', '销售额'],
  ...[...totals.entries()].map(([product, total]) => [
    product,
    total.quantity,
    (total.revenueCents / 100).toFixed(2), // 将整数分转换回金额，并保留两位小数。
  ]),
];

// 转义每个单元格，用逗号连接列，再用换行符连接所有行。
const output = outputRows
  .map(row => row.map(csvEscape).join(','))
  .join('\r\n') + '\r\n';

// 写入汇总文件；若写入失败，也显示错误信息。
try {
  fs.writeFileSync(outputPath, output, 'utf8');
} catch (error) {
  console.error(`无法写入文件“${outputPath}”：${error.message}`);
  process.exit(1);
}

// 显示处理结果，以及有多少行因数据问题被跳过。
console.log(`汇总完成：${totals.size} 个商品 → ${outputPath}`);
if (skippedRows > 0) {
  console.log(`有 ${skippedRows} 行无效数据未计入汇总。`);
}
