// 「任务说明」扩展内容（batch-meta.json 的 descriptionEx）纯函数测试：
// 类型归一化 / Markdown 表格解析（对齐、转义、不齐列）/ 表格搜索 / 列排序 / 分页。
// 渲染层（app.js 的 DESC_EX_RENDERERS）由浏览器验证；本文件保证解析与交互语义可回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDescriptionEx, parseMarkdownTable, inlineMarkdown, filterTableRows, sortTableRows, paginateRows,
  descExToolsVisible, pageItems, fitColWidths, DESC_EX_MAX_CHARS, escapeHtml,
} from '../public/core.js';

const SAMPLE = [
  '| 序号 | 检查项 | 责任方 | 耗时 |',
  '| ---: | --- | :---: | ---: |',
  '| 1 | 数据接入 | 数据平台 | 30 |',
  '| 2 | 字段映射 | 业务分析 | 45 |',
  '| 3 | 转换规则 | 开发 | 60 |',
  '| 4 | 未比较项 | 业务分析 | 15 |',
  '| 5 | 报表汇总 | 数据平台 | 10 |',
  '| 6 | 边界值 | 开发 | 30 |',
  '',
].join('\n');

test('normalizeDescriptionEx：非对象/空内容 -> null；contentType 缺省为 text 且大小写不敏感', () => {
  assert.equal(normalizeDescriptionEx(null), null);
  assert.equal(normalizeDescriptionEx([]), null);
  assert.equal(normalizeDescriptionEx({ plainContent: '   ' }), null);
  assert.equal(normalizeDescriptionEx({ contentType: 'markDownTable' }), null, '缺 plainContent 视为无内容');

  assert.deepEqual(normalizeDescriptionEx({ contentType: 'markDownTable', plainContent: '| a |' }),
    { contentType: 'markdowntable', plainContent: '| a |', truncated: false }, 'contentType 归一化为小写');
  assert.deepEqual(normalizeDescriptionEx({ plainContent: 'x' }),
    { contentType: 'text', plainContent: 'x', truncated: false }, '缺 contentType 按 text 回退');
});

test('normalizeDescriptionEx：超长内容截断并标记', () => {
  const long = 'x'.repeat(DESC_EX_MAX_CHARS + 10);
  const ex = normalizeDescriptionEx({ plainContent: long });
  assert.equal(ex.plainContent.length, DESC_EX_MAX_CHARS);
  assert.equal(ex.truncated, true);
});

test('escapeHtml / inlineMarkdown：转义 + 最小内联格式（不允许 HTML 直通）', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(inlineMarkdown('`code`'), '<code>code</code>');
  assert.equal(inlineMarkdown('**粗体**'), '<strong>粗体</strong>');
  assert.equal(inlineMarkdown('*斜体*'), '<em>斜体</em>');
  assert.equal(inlineMarkdown('<b>x</b> & `a<b>`'), '&lt;b&gt;x&lt;/b&gt; &amp; <code>a&lt;b&gt;</code>', 'HTML 必须被转义');
});

test('parseMarkdownTable：表头/单元格（分隔行仅用于识别表格，不参与对齐）', () => {
  const tb = parseMarkdownTable(SAMPLE);
  assert.deepEqual(tb.issues, []);
  assert.deepEqual(tb.header.map((h) => h.text), ['序号', '检查项', '责任方', '耗时']);
  assert.equal(tb.align, undefined, '不再输出对齐信息（渲染统一左对齐）');
  assert.equal(tb.rows.length, 6);
  assert.deepEqual(tb.rows[0].map((c) => c.text), ['1', '数据接入', '数据平台', '30']);

  // 带对齐标记的分隔行仍然只是「表格标识」，不影响解析结果
  const withMark = parseMarkdownTable(['| a | b |', '| :---: | ---: |', '| 1 | 2 |'].join('\n'));
  assert.deepEqual(withMark.header.map((h) => h.text), ['a', 'b']);
  assert.deepEqual(withMark.rows[0].map((c) => c.text), ['1', '2']);
});

test('parseMarkdownTable：`\\|` 转义与空单元格', () => {
  const tb = parseMarkdownTable(['| a | b |', '| --- | --- |', '| a \\| b |  |'].join('\n'));
  assert.equal(tb.rows.length, 1);
  assert.equal(tb.rows[0][0].text, 'a | b', '转义竖线应作为普通文本');
  assert.equal(tb.rows[0][1].text, '');
});

test('parseMarkdownTable：列数不齐与缺分隔符的行（记录 issues 但不报错）', () => {
  const tb = parseMarkdownTable(['| a | b |', '| --- | --- |', '| 1 |', '没有分隔符', '| 2 | 3 | 4 |'].join('\n'));
  assert.equal(tb.rows.length, 2, '含分隔符的行都保留，缺分隔符的行被忽略');
  assert.deepEqual(tb.rows[0].map((c) => c.text), ['1', ''], '缺列补空');
  assert.deepEqual(tb.rows[1].map((c) => c.text), ['2', '3'], '多列按表头截断');
  assert.deepEqual(tb.issues, [{ kind: 'ragged', count: 2 }, { kind: 'skipped', count: 1 }]);
});

test('parseMarkdownTable：无法识别为表格时返回 noheader', () => {
  const tb = parseMarkdownTable('纯文本，没有表格');
  assert.deepEqual(tb.header, []);
  assert.deepEqual(tb.issues, [{ kind: 'noheader', count: 0 }]);
});

test('filterTableRows：表头字段搜索（按列 AND，大小写不敏感）；全空返回原数组', () => {
  const tb = parseMarkdownTable(SAMPLE);
  assert.equal(filterTableRows(tb.rows, []).length, 6, '无筛选条件时返回原数组');
  assert.equal(filterTableRows(tb.rows, ['', '', '', '']).length, 6, '全为空串等同于无筛选');
  assert.deepEqual(filterTableRows(tb.rows, ['', '', '数据平台']).map((r) => r[0].text), ['1', '5'], '单列筛选');
  assert.deepEqual(filterTableRows(tb.rows, ['', '字段映射']).map((r) => r[0].text), ['2'], '另一列筛选');
  assert.deepEqual(filterTableRows(tb.rows, ['', '', '业务分析', '4']).map((r) => r[0].text), ['2'], '多列 AND（责任方 + 耗时包含 4）');
  assert.deepEqual(filterTableRows(tb.rows, ['', '开发', '业务分析']).length, 0, '多列互斥时无匹配');
  assert.equal(filterTableRows(tb.rows, ['不存在的关键字']).length, 0);
});

test('sortTableRows：数字列按数值、文本列按本地化比较；空值恒排在后；col<0 保持原序', () => {
  const tb = parseMarkdownTable(SAMPLE);
  assert.deepEqual(sortTableRows(tb.rows, 3, 1).map((r) => r[3].text), ['10', '15', '30', '30', '45', '60'], '数值升序（非字典序）');
  assert.deepEqual(sortTableRows(tb.rows, 3, -1).map((r) => r[3].text), ['60', '45', '30', '30', '15', '10']);
  assert.deepEqual(sortTableRows(tb.rows, -1, 1).map((r) => r[0].text), ['1', '2', '3', '4', '5', '6'], 'col<0 = 原序');

  const withEmpty = parseMarkdownTable(['| a |', '| --- |', '| 2 |', '|  |', '| 1 |'].join('\n'));
  assert.deepEqual(sortTableRows(withEmpty.rows, 0, 1).map((r) => r[0].text), ['1', '2', ''], '空值排在最后');
});

test('descExToolsVisible：总页数 ≤ 3 时不展示排序/筛选图标', () => {
  assert.equal(descExToolsVisible(0, 5), false, '空表不展示工具');
  assert.equal(descExToolsVisible(5, 5), false, '1 页');
  assert.equal(descExToolsVisible(10, 5), false, '2 页');
  assert.equal(descExToolsVisible(15, 5), false, '3 页（阈值内）');
  assert.equal(descExToolsVisible(16, 5), true, '4 页 -> 展示工具');
  assert.equal(descExToolsVisible(18, 5), true, '4 页（样例数据）');
  assert.equal(descExToolsVisible(12, 5, 2), true, '阈值可配：>2 页即展示');
  assert.equal(descExToolsVisible(12, 0), true, '非法页大小按 1 行/页处理');
});

test('fitColWidths：按最大内容宽度定宽，首/末列内边距更宽，并限制在 [min, max]', () => {
  const w = fitColWidths([40, 80, 200], { padFirst: 24, padMid: 20, padLast: 24, min: 56, max: 360 });
  assert.deepEqual(w, [64, 100, 224], '内容宽度 + 内边距');
  assert.deepEqual(fitColWidths([10, 10], { padFirst: 0, padMid: 0, padLast: 0, min: 56, max: 360 }), [56, 56], '小于下限时取下限');
  assert.deepEqual(fitColWidths([900], { padFirst: 0, padLast: 0, min: 56, max: 360 }), [360], '超过上限时取上限');
  assert.deepEqual(fitColWidths([], {}), [], '空表返回空数组');
  assert.deepEqual(fitColWidths([undefined, NaN]), [56, 56], '非法宽度按 0 处理后取下限');
});

test('pageItems：竖向页码序列（页码少时全列，多时窗口化，null 为省略号）', () => {
  assert.deepEqual(pageItems(1, 4), [1, 2, 3, 4], '≤7 页时全部列出');
  assert.deepEqual(pageItems(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageItems(1, 20), [1, 2, 3, 4, null, 20], '首页：窗口靠前');
  assert.deepEqual(pageItems(10, 20), [1, null, 9, 10, 11, null, 20], '中间页：两侧省略');
  assert.deepEqual(pageItems(20, 20), [1, null, 17, 18, 19, 20], '末页：窗口靠后');
  assert.deepEqual(pageItems(99, 20), [1, null, 17, 18, 19, 20], '越界页码收敛到末页');
  assert.deepEqual(pageItems(2, 3, 3), [1, 2, 3], '阈值可配');
  assert.ok(pageItems(10, 20).length <= 7, '窗口化后项数不超过阈值');
});

test('paginateRows：页码收敛到合法范围', () => {
  const rows = parseMarkdownTable(SAMPLE).rows;
  const p1 = paginateRows(rows, 1, 5);
  assert.deepEqual([p1.page, p1.pages, p1.slice.length], [1, 2, 5]);
  const p2 = paginateRows(rows, 2, 5);
  assert.deepEqual([p2.page, p2.pages, p2.slice.length], [2, 2, 1]);
  assert.equal(paginateRows(rows, 99, 5).page, 2, '越界页码收敛到最后一页');
  assert.equal(paginateRows(rows, 0, 5).page, 1, '非法页码收敛到第一页');
  const tiny = paginateRows(rows, 1, 0);
  assert.deepEqual([tiny.slice.length, tiny.pages], [1, rows.length], '非法页大小回退为 1 行/页');
});
