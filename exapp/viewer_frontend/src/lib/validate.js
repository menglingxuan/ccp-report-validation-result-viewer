// 轻量数据校验器（零依赖）：校验数据文件顶层结构与关键字段，返回错误列表。
// 用于服务启动时 / 扫描时提前发现坏数据，避免前端渲染崩溃。
//
//   import { validateDataset } from './lib/validate.js';
//   const { ok, errors } = validateDataset(json);
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function validateDataset(json) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: ['数据文件顶层必须是对象'] };
  }
  if (!Array.isArray(json.items)) {
    errors.push('缺少 items 数组');
    return { ok: false, errors };
  }
  if (json.mode !== undefined && json.mode !== 'single' && json.mode !== 'multi') {
    errors.push('mode 只能是 "single" 或 "multi"，当前为：' + json.mode);
  }
  if (json.reportEnv !== undefined && typeof json.reportEnv !== 'string') {
    errors.push('reportEnv 必须是字符串');
  }

  const mode = json.mode === 'multi' ? 'multi' : 'single';
  json.items.forEach(function (item, i) {
    const label = 'items[' + i + ']';
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(label + ' 必须是对象');
      return;
    }
    if (typeof item.tradeId !== 'string' || !item.tradeId) {
      errors.push(label + ' 缺少 tradeId');
    }
    if (mode === 'multi') {
      if (typeof item.file !== 'string' || !item.file) {
        errors.push(label + '（多文件模式）缺少 file 字段');
      }
      if (item.summary !== undefined && (typeof item.summary !== 'object' || item.summary === null)) {
        errors.push(label + '（多文件模式）summary 必须是对象');
      }
      return;
    }
    // 单文件模式
    if (!Array.isArray(item.channels)) {
      errors.push(label + ' 缺少 channels 数组');
      return;
    }
    const ctxIds = {};
    if (item.ctxDefs !== undefined && (typeof item.ctxDefs !== 'object' || item.ctxDefs === null)) {
      errors.push(label + ' ctxDefs 必须是对象');
    } else if (item.ctxDefs) {
      Object.keys(item.ctxDefs).forEach(function (key) {
        const def = item.ctxDefs[key];
        if (!def || typeof def !== 'object') { errors.push(label + ' ctxDefs.' + key + ' 必须是对象'); return; }
        if (typeof def.id !== 'number' || !Number.isInteger(def.id) || def.id <= 0) {
          errors.push(label + ' ctxDefs.' + key + ' 缺少正整数 id');
        } else if (ctxIds[def.id]) {
          errors.push(label + ' ctxDefs.' + key + ' 的 id 重复：' + def.id);
        } else {
          ctxIds[def.id] = true;
        }
        const sp = def.scopes;
        const valid = (n) => n === 1 || n === 2 || n === 3;
        const okSp = (Array.isArray(sp) && sp.length > 0 && sp.every(valid)) || valid(sp);
        if (!okSp) errors.push(label + ' ctxDefs.' + key + ' 的 scopes 必须是 1/2/3 或由它们组成的数组');
        if (def.type !== undefined && def.type !== 'builtin' && def.type !== 'user') {
          errors.push(label + ' ctxDefs.' + key + ' 的 type 只能是 "builtin" 或 "user"');
        }
      });
    }
    if (item.enabledChannels !== undefined && !Array.isArray(item.enabledChannels)) {
      errors.push(label + ' enabledChannels 必须是数组');
    }
    ['warnings', 'errors', 'uncompared', 'logs'].forEach(function (k) {
      if (item[k] !== undefined && !Array.isArray(item[k])) errors.push(label + ' ' + k + ' 必须是数组');
    });
    item.channels.forEach(function (ch, ci) {
      const clabel = label + '.channels[' + ci + ']';
      if (!ch || typeof ch !== 'object') {
        errors.push(clabel + ' 必须是对象');
        return;
      }
      if (typeof ch.name !== 'string' || !ch.name) errors.push(clabel + ' 缺少 name');
      // 字段注册表为 report channel 级别。
      if (ch.fields !== undefined && !Array.isArray(ch.fields)) {
        errors.push(clabel + ' fields 必须是数组');
      } else if (Array.isArray(ch.fields)) {
        ch.fields.forEach(function (d, di) {
          if (!d || typeof d !== 'object') { errors.push(clabel + '.fields[' + di + '] 必须是对象'); return; }
          if (typeof d.id !== 'string' || !/^\d+$/.test(d.id)) errors.push(clabel + '.fields[' + di + '] 缺少数字字符串 id');
          if (typeof d.name !== 'string') errors.push(clabel + '.fields[' + di + '] 缺少 name');
          if (typeof d.userTag !== 'string') errors.push(clabel + '.fields[' + di + '] 缺少 userTag');
          if (typeof d.type !== 'string') errors.push(clabel + '.fields[' + di + '] 缺少 type');
        });
      }
      if (!Array.isArray(ch.sources)) errors.push(clabel + ' 缺少 sources 数组');
      if (Array.isArray(ch.sources)) {
        ch.sources.forEach(function (s, si) {
          const slabel = clabel + '.sources[' + si + ']';
          if (!s || typeof s !== 'object') { errors.push(slabel + ' 必须是对象'); return; }
          if (!Array.isArray(s.fields)) { errors.push(slabel + ' 缺少 fields 数组'); return; }
          s.fields.forEach(function (f, fi) {
            const flabel = slabel + '.fields[' + fi + ']';
            if (!f || typeof f !== 'object') { errors.push(flabel + ' 必须是对象'); return; }
            if (typeof f.id !== 'string' || !/^\d+$/.test(f.id)) errors.push(flabel + ' 缺少数字字符串 id');
            // cvtLeft / cvtRight / vdt 为可选配置，允许为 null。
            ['cvtLeft', 'cvtRight', 'vdt'].forEach(function (rk) {
              if (f[rk] !== undefined && f[rk] !== null && (typeof f[rk] !== 'object' || Array.isArray(f[rk]))) {
                errors.push(flabel + ' ' + rk + ' 必须为对象或 null');
              }
            });
            // 校验所有 ctx 引用（id）均在 ctxDefs 中有定义。
            ['cmpLeft', 'cmpRight', 'cvtLeft', 'cvtRight', 'vdt'].forEach(function (rk) {
              const r = f[rk];
              if (!r || typeof r !== 'object') return;
              (Array.isArray(r.ctxs) ? r.ctxs : []).forEach(function (cid) {
                if (typeof cid !== 'number' || !ctxIds[cid]) errors.push(flabel + ' ' + rk + '.ctxs 引用了未定义的 ctx id：' + cid);
              });
            });
          });
        });
      }
    });
  });

  return { ok: errors.length === 0, errors };
}

export function validateFile(filePath) {
  try {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { file: filePath, ...validateDataset(json) };
  } catch (e) {
    return { file: filePath, ok: false, errors: ['解析失败：' + e.message] };
  }
}

export function main() {
  const argv = process.argv.slice(2);
  const files = argv.length ? argv : ['public/report-validation-data.json', 'public/report-validation-data-default.json', 'public/report-validation-data-init.json'];
  let fail = 0;
  files.forEach(function (f) {
    const r = validateFile(f);
    if (r.ok) console.log('OK  ' + f);
    else {
      fail++;
      console.log('FAIL ' + f);
      r.errors.forEach(function (e) { console.log('   - ' + e); });
    }
  });
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
