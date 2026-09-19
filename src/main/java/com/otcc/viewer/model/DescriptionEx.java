package com.otcc.viewer.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code batch-meta.json} 的可选扩展内容 {@code descriptionEx}。
 *
 * <p>查看器在「任务说明」末尾按 {@code contentType} 渲染该内容（只读、懒加载，
 * 不写入 {@code batches-index.json}）。当前支持的内容类型：</p>
 *
 * <ul>
 *   <li>{@code markDownTable}：{@code plainContent} 为 Markdown 表格文本（GFM 子集：
 *       表头 + 分隔行 + 数据行，支持 {@code \|} 转义与 {@code :---:} 对齐），
 *       查看器渲染为带搜索 / 列排序 / 分页的 HTML 表格；</li>
 *   <li>其它值（或未声明）：按纯文本渲染（回退，不报错）。</li>
 * </ul>
 *
 * <p>新增内容类型时：查看器 {@code public/core.js} 加解析纯函数 +
 * {@code public/app.js} 的 {@code DESC_EX_RENDERERS} 登记渲染器；本模型无需改动。</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class DescriptionEx {
    /** 内容类型，如 {@code "markDownTable"}；大小写不敏感，缺省按纯文本渲染。 */
    private String contentType;
    /** 内容正文（Markdown 表格文本或纯文本）。 */
    private String plainContent;
}
