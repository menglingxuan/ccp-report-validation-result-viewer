package com.otcc.viewer.model;

/**
 * 契约版本号（Java 侧唯一权威定义，须与 {@code public/core.js} 中的同名常量保持一致）。
 *
 * <p>这里有两个<b>互不相干</b>的版本号，不要混用：</p>
 * <ul>
 *   <li>{@link #FORMAT_VERSION} → 写进 {@code batch-meta.json} 的 {@code formatVersion}，
 *       表示<b>数据契约</b>版本；查看器只能加载 {@link #SUPPORTED_FORMAT_VERSIONS} 内的批次。</li>
 *   <li>{@link #CONFIG_VERSION} → 写进 {@code config.json} 的 {@code configVersion}，
 *       只表达<b>配置文件结构</b>的演进，与批次能否加载无关。</li>
 * </ul>
 *
 * <p>版本沿革：v2 = 声明表 + id 引用（{@code reportChannelDefs} / {@code sourceChannelDefs} /
 * {@code usedCtxKeyDefs}）；v3 = 删除兼容层（不再接受 {@code srcType} / {@code item.fields} /
 * {@code scopes} 等旧形态），契约本身未变，因此 v2 数据仍可读。</p>
 */
public final class ContractVersion {

    /** 数据契约版本（{@code batch-meta.json#formatVersion}）。 */
    public static final int FORMAT_VERSION = 3;

    /** 配置结构版本（{@code config.json#configVersion}）。 */
    public static final int CONFIG_VERSION = 3;

    /** 查看器可读的数据契约版本白名单（与 {@code core.js} 的 {@code SUPPORTED_FORMAT_VERSIONS} 一致）。 */
    public static final int[] SUPPORTED_FORMAT_VERSIONS = {2, 3};

    private ContractVersion() {
    }
}
