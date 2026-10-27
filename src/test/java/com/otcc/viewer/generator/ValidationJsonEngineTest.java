package com.otcc.viewer.generator;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import com.otcc.viewer.model.BatchIndex;
import com.otcc.viewer.model.BatchMeta;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.CmpSide;
import com.otcc.viewer.model.CtxDetail;
import com.otcc.viewer.model.CtxKeyDef;
import com.otcc.viewer.model.DescriptionEx;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.FieldDef;
import com.otcc.viewer.model.ItemLog;
import com.otcc.viewer.model.ItemSummary;
import com.otcc.viewer.model.ManifestItem;
import com.otcc.viewer.model.Message;
import com.otcc.viewer.model.PlatformIgnore;
import com.otcc.viewer.model.SkippedItem;
import com.otcc.viewer.model.Source;
import com.otcc.viewer.model.UncomparedEntry;
import com.otcc.viewer.model.ValidationConfig;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Test engine: generates every JSON file the viewer needs, writes them under
 * {@code generated/}, then fully validates them (JSON Schema, structure, round-trip,
 * single- and multi-file modes).
 */
class ValidationJsonEngineTest {

    static final Path OUT_DIR = Path.of("generated");
    static final Path SCHEMA_PATH = Path.of("exapp", "viewer_frontend", "src", "public", "config.schema.json");
    /**
     * 顶层键顺序（docs/DATA_SCHEMA.md §1）：声明表读在数据前，{@code skippedItems} 紧随声明表之后。
     */
    static final List<String> ROOT_KEY_ORDER = List.of(
            "mode", "reportEnv", "creationType",
            "reportChannelDefs", "sourceChannelDefs", "usedCtxKeyDefs",
            "skippedItems", "items");

    static ValidationDataset dataset;
    /** File dataset after hydrating the top-level registries (semantic assertions use this one). */
    static ValidationDataset hydrated;
    static ValidationConfig config;
    static Map<String, PlatformIgnore> ignore;
    static BatchIndex batchIndex;
    static BatchMeta batchMeta;

    static JsonNode dataJson;
    static JsonNode configJson;
    static JsonNode ignoreJson;
    static JsonNode indexJson;
    static JsonNode metaJson;

    static final List<String> GENERATED_FILES = new ArrayList<>();

    @TempDir
    Path tmpDir;

    @BeforeAll
    static void setUp() throws Exception {
        ValidationJsonGenerator.writeAll(OUT_DIR);
        GENERATED_FILES.addAll(List.of(
                "report-validation-data.json",
                "config.json",
                "ignore-config-by-platform.json",
                "batches-index.json",
                "batches/2026-08-16/batch-20260816-0400/batch-meta.json",
                "batches/2026-08-16/batch-20260816-0400/report-validation-data.json"));

        dataJson = readTree("report-validation-data.json");
        configJson = readTree("config.json");
        ignoreJson = readTree("ignore-config-by-platform.json");
        indexJson = readTree("batches-index.json");
        metaJson = readTree("batches/2026-08-16/batch-20260816-0400/batch-meta.json");

        dataset = ValidationJsonGenerator.MAPPER.treeToValue(dataJson, ValidationDataset.class);
        // 语义断言用「hydrate 后」的副本（与查看器一致：定义在登记表里，item 只有 id 引用）。
        // dataset 本身保持文件原样，供 serializationRoundTripsWithoutLoss 做逐字节等价比较。
        hydrated = ValidationJsonGenerator.MAPPER.treeToValue(dataJson, ValidationDataset.class);
        hydrateRegistries(hydrated);
        config = ValidationJsonGenerator.MAPPER.treeToValue(configJson, ValidationConfig.class);
        ignore = ValidationJsonGenerator.MAPPER.convertValue(ignoreJson, new TypeReference<>() {});
        batchIndex = ValidationJsonGenerator.MAPPER.treeToValue(indexJson, BatchIndex.class);
        batchMeta = ValidationJsonGenerator.MAPPER.treeToValue(metaJson, BatchMeta.class);
    }

    /**
     * Mirrors {@code hydrateDataset()} in {@code public/core.js}: fills the definitions from the three
     * dataset-level declaration tables ({@code reportChannelDefs} / {@code sourceChannelDefs} /
     * {@code usedCtxKeyDefs}) back into every item, so the semantic assertions below can run on the same
     * shape the viewer renders.
     */
    private static void hydrateRegistries(ValidationDataset ds) {
        Map<Integer, Channel> chReg = new HashMap<>();
        for (Channel c : ds.getReportChannelDefs() == null ? List.<Channel>of() : ds.getReportChannelDefs()) {
            chReg.put(c.getId(), c);
        }
        Map<Integer, Source> srcReg = new HashMap<>();
        for (Source s : ds.getSourceChannelDefs() == null ? List.<Source>of() : ds.getSourceChannelDefs()) {
            srcReg.put(s.getId(), s);
        }
        Map<String, CtxKeyDef> ctxReg = ds.getUsedCtxKeyDefs() == null ? Map.of() : ds.getUsedCtxKeyDefs();
        for (ValidationItem item : ds.getItems()) {
            if (item.getCtxDtls() != null) {
                for (Map.Entry<String, CtxDetail> e : item.getCtxDtls().entrySet()) {
                    CtxKeyDef kdef = ctxReg.get(e.getKey());
                    if (kdef == null) {
                        throw new IllegalStateException("item ctxDtls 的 ctxKey 未在 usedCtxKeyDefs 声明：" + e.getKey());
                    }
                }
            }
            for (Channel ch : item.getChannels() == null ? List.<Channel>of() : item.getChannels()) {
                Channel def = chReg.get(ch.getId());
                if (def != null) {
                    ch.setName(def.getName());
                    ch.setDesc(def.getDesc());
                    ch.setFormat(def.getFormat());
                    // 查看器同样把 fieldDefs 注入 item 渠道，让字段查找逻辑无需感知登记表。
                    ch.setFieldDefs(def.getFieldDefs());
                }
                for (Source s : ch.getSources() == null ? List.<Source>of() : ch.getSources()) {
                    Source sdef = srcReg.get(s.getId());
                    if (sdef != null) {
                        s.setName(sdef.getName());
                        s.setFormat(sdef.getFormat());
                    }
                }
            }
        }
    }

    @AfterAll
    static void report() {
        System.out.println("=== ValidationJsonEngineTest ===");
        System.out.println("Generated files under: " + OUT_DIR.toAbsolutePath());
        for (String f : GENERATED_FILES) {
            System.out.println("  - " + f);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Tests                                                             */
    /* ------------------------------------------------------------------ */

    @Test
    void datasetRegistriesAreHoisted() {
        // 归一化形态：渠道（含字段定义）/ 来源渠道 / ctxKey 的定义只在顶层三张登记表里写一次，
        // item 里只留 id 引用（与查看器 hydrateDataset 的契约一致）。
        Check c = new Check();
        JsonNode root = dataJson;

        // 旧的根键已改名（不再并存，避免同一份数据两套写法）。
        c.check(!root.has("channels") && !root.has("sources"),
                "根级别的 channels / sources 已改名为 reportChannelDefs / sourceChannelDefs");
        c.check(!root.has("ctxKeyDefs"), "根级别的 ctxKeyDefs 已改名为 usedCtxKeyDefs");
        // 顶层键顺序固定（DATA_SCHEMA.md §1）：…声明表 → usedCtxKeyDefs → skippedItems → items。
        List<String> rootKeys = new ArrayList<>();
        root.fieldNames().forEachRemaining(rootKeys::add);
        c.check(ROOT_KEY_ORDER.equals(rootKeys), "单文件数据顶层键顺序：" + rootKeys);

        JsonNode chDefs = root.path("reportChannelDefs");
        c.check(chDefs.isArray() && chDefs.size() >= 3, "顶层 reportChannelDefs 登记表应存在：" + chDefs);
        Set<Integer> chIds = new HashSet<>();
        Map<Integer, Set<String>> fieldIdsByChannel = new HashMap<>();
        Set<String> allFieldIds = new HashSet<>();
        for (JsonNode ch : chDefs) {
            int id = ch.path("id").asInt();
            chIds.add(id);
            c.check(id > 0, "reportChannelDefs[].id 正整数：" + ch);
            c.check(nonBlank(ch.path("name").asText()), "reportChannelDefs[].name 非空：" + ch);
            c.check("xml".equals(ch.path("format").asText()) || "csv".equals(ch.path("format").asText()),
                    "reportChannelDefs[].format ∈ {xml,csv}：" + ch);
            JsonNode fds = ch.path("fieldDefs");
            c.check(fds.isArray() && !fds.isEmpty(), "reportChannelDefs[].fieldDefs 非空：" + ch.path("name"));
            Set<String> ids = new HashSet<>();
            for (JsonNode fd : fds) {
                c.check(nonBlank(fd.path("id").asText()), "fieldDefs[].id 非空：" + fd);
                c.check(nonBlank(fd.path("name").asText()), "fieldDefs[].name 非空：" + fd);
                c.check(nonBlank(fd.path("userTag").asText()), "fieldDefs[].userTag 非空：" + fd);
                c.check(nonBlank(fd.path("type").asText()), "fieldDefs[].type 非空：" + fd);
                c.check(ids.add(fd.path("id").asText()), "同一渠道内 fieldDefs[].id 唯一：" + fd.path("id"));
                // 不同报告渠道的字段即便同名，id 也必须不同（否则 item 里的 id 引用会有歧义）。
                c.check(allFieldIds.add(fd.path("id").asText()),
                        "fieldDefs[].id 必须数据集内唯一：" + fd.path("id") + "（" + fd.path("name") + "）");
            }
            fieldIdsByChannel.put(id, ids);
        }

        JsonNode srcDefs = root.path("sourceChannelDefs");
        c.check(srcDefs.isArray() && srcDefs.size() >= 2, "顶层 sourceChannelDefs 登记表应存在：" + srcDefs);
        Set<Integer> srcIds = new HashSet<>();
        for (JsonNode s : srcDefs) {
            int id = s.path("id").asInt();
            srcIds.add(id);
            c.check(id > 0, "sourceChannelDefs[].id 正整数：" + s);
            c.check(nonBlank(s.path("name").asText()), "sourceChannelDefs[].name 非空：" + s);
            c.check("csv".equals(s.path("format").asText()) || "xml".equals(s.path("format").asText()),
                    "sourceChannelDefs[].format ∈ {csv,xml}：" + s);
            c.check(!s.has("fields"), "sourceChannelDefs[] 不应带 fields：" + s);
        }

        JsonNode ctxDefs = root.path("usedCtxKeyDefs");
        c.check(ctxDefs.isObject() && !ctxDefs.isEmpty(), "顶层 usedCtxKeyDefs 登记表应存在：" + ctxDefs);
        Set<Integer> ctxIds = new HashSet<>();
        ctxDefs.fields().forEachRemaining(e -> {
            JsonNode d = e.getValue();
            c.check(nonBlank(e.getKey()), "usedCtxKeyDefs 的 key 非空");
            c.check(d.path("id").asInt() > 0, "usedCtxKeyDefs[].id 正整数：" + d);
            c.check(ctxIds.add(d.path("id").asInt()), "usedCtxKeyDefs[].id 唯一：" + d.path("id"));
            c.check("builtin".equals(d.path("type").asText()) || "user".equals(d.path("type").asText()),
                    "usedCtxKeyDefs[].type ∈ {builtin,user}：" + d);
            c.check(nonBlank(d.path("def").asText()), "usedCtxKeyDefs[].def 非空：" + d);
            JsonNode rules = d.path("rules");
            c.check(rules.isArray() && !rules.isEmpty(), "usedCtxKeyDefs[].rules 非空（规则名数组）：" + d);
            for (JsonNode r : rules) {
                c.check(Set.of("fmd", "cvt", "vdt").contains(r.asText()),
                        "usedCtxKeyDefs[].rules ∈ {fmd,cvt,vdt}：" + r + "（旧的 1/2/3 数字已废弃）");
            }
            c.check(!d.has("scopes"), "usedCtxKeyDefs[] 里不应出现旧的 scopes：" + d);
            c.check(!d.has("hits"), "hits 是 item 级信息，不应写在 usedCtxKeyDefs 里：" + d);
        });

        // item 里不得重复写定义，且引用必须落在登记表里。
        for (JsonNode item : root.path("items")) {
            String it = item.path("tradeId").asText();
            for (JsonNode ctx : item.path("ctxDtls")) {
                c.check(ctx.has("hits"), it + " 的 ctxDtls 只保留 hits：" + ctx);
                c.check(!ctx.has("id") && !ctx.has("type") && !ctx.has("def") && !ctx.has("scopes") && !ctx.has("rules"),
                        it + " 的 ctxDtls 不应写 id/type/def/rules：" + ctx);
            }
            for (JsonNode ch : item.path("channels")) {
                c.check(!ch.has("name") && !ch.has("desc") && !ch.has("format"),
                        it + " 的 item 渠道不应重复写 name/desc/format：" + ch);
                c.check(!ch.has("fieldDefs"), it + " 的 item 渠道不应重复写 fieldDefs：" + ch);
                c.check(!ch.has("fields"),
                        it + " 的 item 渠道不应再有 fields（字段定义已迁到 reportChannelDefs[].fieldDefs）：" + ch);
                int chId = ch.path("id").asInt();
                c.check(chIds.contains(chId), it + " 渠道引用必须已登记：" + chId);
                Set<String> declared = fieldIdsByChannel.getOrDefault(chId, Set.of());
                for (JsonNode s : ch.path("sources")) {
                    c.check(!s.has("name") && !s.has("format"),
                            it + " 的 item 来源渠道不应重复写 name/format：" + s);
                    c.check(srcIds.contains(s.path("id").asInt()),
                            it + " 来源渠道引用必须已登记：" + s.path("id"));
                    c.check(s.has("fields"), it + " 的 item 来源渠道必须保留 fields：" + s.path("id"));
                    for (JsonNode f : s.path("fields")) {
                        c.check(declared.contains(f.path("id").asText()),
                                it + " 字段 id 必须在其父渠道的 fieldDefs 里声明：" + f.path("id"));
                        c.check(!f.has("srcType"), it + " 字段不应再写 srcType（已改名 valueSrcFmt）：" + f.path("id"));
                        for (String side : List.of("cmpLeft", "cmpRight")) {
                            String v = f.path(side).path("valueSrcFmt").asText();
                            c.check("csv".equals(v) || "xml".equals(v),
                                    it + " " + side + ".valueSrcFmt ∈ {csv,xml}：" + v);
                        }
                    }
                }
            }
        }
        c.done();
    }

    @Test
    void allExpectedFilesAreGenerated() {
        Check c = new Check();
        for (String f : GENERATED_FILES) {
            c.check(Files.isRegularFile(OUT_DIR.resolve(f)), "missing generated file: " + f);
        }
        c.done();
    }

    @Test
    void dataJsonStructureIsValid() {
        Check c = new Check();
        c.check("single".equals(hydrated.getMode()), "dataset.mode must be 'single'");
        c.check(hydrated.getItems() != null && !hydrated.getItems().isEmpty(), "items must be non-empty");
        c.check(nonBlank(hydrated.getReportEnv()), "reportEnv non-blank");

        for (int i = 0; i < hydrated.getItems().size(); i++) {
            ValidationItem item = hydrated.getItems().get(i);
            String it = "items[" + i + "]";
            c.check(nonBlank(item.getTradeId()), it + ".tradeId non-blank");
            c.check(nonBlank(item.getReportDate()), it + ".reportDate non-blank");
            c.check(nonBlank(item.getGeneratedAt()), it + ".generatedAt non-blank");
            c.check(nonBlank(item.getPlatform()), it + ".platform non-blank");
            c.check(nonBlank(item.getProduct()), it + ".product non-blank");
            c.check(nonBlank(item.getProductCategory()), it + ".productCategory non-blank");
            c.check(item.getPlatformOriTradeId() != null, it + ".platformOriTradeId present");
            c.check(item.getPlatformOriTradeDealId() != null, it + ".platformOriTradeDealId present");

            // per-item ctxDtls（{ hits }，id / 定义在顶层 usedCtxKeyDefs）
            validateCtxDefs(c, item, it, hydrated);

            // channels（字段定义在 reportChannelDefs[].fieldDefs，由 hydrateRegistries 注入回来）
            c.check(item.getChannels() != null && !item.getChannels().isEmpty(), it + ".channels non-empty");
            Map<Integer, Channel> chById = new HashMap<>();
            if (item.getChannels() != null) {
                for (Channel ch : item.getChannels()) {
                    String chLabel = it + ".channels[id=" + ch.getId() + "]";
                    c.check(ch.getId() != null && ch.getId() > 0, chLabel + ".id positive");
                    c.check(chById.put(ch.getId(), ch) == null, chLabel + ".id unique within item");
                    Channel def = hydrated.getReportChannelDefs().stream()
                            .filter(d -> d.getId().equals(ch.getId())).findFirst().orElse(null);
                    c.check(def != null, chLabel + " 必须在 reportChannelDefs 里声明");
                    c.check(ch.getEnabled() == null || Boolean.FALSE.equals(ch.getEnabled()),
                            chLabel + ".enabled is absent (enabled) or false; never an explicit true: " + ch.getEnabled());
                    Set<String> fieldIds = def == null ? Set.of() : validateRegistry(c, def, chLabel + " 声明");
                    validateChannel(c, ch, chLabel, fieldIds);
                }
            }
            // 启用口径：channels[].enabled（缺省 = 启用），不再是 item.enabledChannels 名单。
            c.check(item.getChannels() != null && item.getChannels().stream()
                            .anyMatch(ch -> ch.getEnabled() == null || ch.getEnabled()),
                    it + " has at least one enabled channel");

            // item-level messages / uncompared / logs
            validateMessages(c, item.getWarnings(), it + ".warnings");
            validateMessages(c, item.getErrors(), it + ".errors");
            if (item.getUncompared() != null) {
                for (UncomparedEntry u : item.getUncompared()) {
                    c.check(u.getType() != null && (u.getType() == 1 || u.getType() == 2),
                            it + ".uncompared.type in {1,2}: " + u.getType());
                    c.check(u.getChannel() == null || Set.of("HKTR", "JSFA", "CFTC").contains(u.getChannel()),
                            it + ".uncompared.channel valid or null: " + u.getChannel());
                    c.check(u.getSource() == null || Set.of("来源渠道 A", "来源渠道 B").contains(u.getSource()),
                            it + ".uncompared.source valid or null: " + u.getSource());
                    c.check(u.getSource() == null || u.getChannel() != null,
                            it + ".uncompared.source requires non-null channel");
                    c.check(nonBlank(u.getValue()), it + ".uncompared.value non-blank");
                    c.check(nonBlank(u.getNote()), it + ".uncompared.note non-blank");
                }
            }
            c.check(item.getLogs() != null && !item.getLogs().isEmpty(), it + ".logs non-empty");
            if (item.getLogs() != null) {
                for (ItemLog l : item.getLogs()) {
                    boolean fieldScoped = "field".equals(l.getScope());
                    c.check("item".equals(l.getScope()) || "channel".equals(l.getScope()) || fieldScoped,
                            it + ".logs.scope in {item,channel,field}");
                    c.check(nonBlank(l.getText()), it + ".logs.text non-blank");
                    // 日志行**只写 id**（渠道 / 来源名称由查看器加载时按 id 从顶层登记表解析）。
                    c.check(fieldScoped == nonBlank(l.getField()),
                            it + ".logs.field only for scope=field: scope=" + l.getScope() + " field=" + l.getField());
                    // 日志行只写 id（渠道 / 来源名称由查看器加载时按 id 从声明表补回）。
                    c.check(l.getChannelId() != null || "item".equals(l.getScope()),
                            it + ".logs 非 item 级日志必须有 channelId：" + l.getScope());
                    // id 必须能解析到本 item 里真实存在的渠道 / 来源，否则查看器会丢锚点。
                    boolean channelScoped = l.getChannelId() != null;
                    c.check(("item".equals(l.getScope())) == !channelScoped,
                            it + ".logs item 级日志无 channelId，其余 scope 必须有：" + l.getChannelId());
                    if (fieldScoped) {
                        c.check(l.getSourceId() != null, it + ".logs(field) 需要 sourceId：" + l.getChannelId());
                    }
                    if (channelScoped) {
                        Channel ch = chById.get(l.getChannelId());
                        c.check(ch != null, it + ".logs.channelId 能解析到本 item 的渠道：" + l.getChannelId());
                        if (ch != null && l.getSourceId() != null) {
                            c.check(ch.getSources().stream().anyMatch(s -> s.getId().equals(l.getSourceId())),
                                    it + ".logs.sourceId 能解析到该渠道下的来源渠道：" + l.getSourceId());
                        }
                    }
                }
            }
        }
        if (dataset.getSkippedItems() != null) {
            // skippedItems 仍保留 id（被跳过的 item 不在数据集里，锚点只能靠 id），
            // 但 id 必须落在顶层登记表声明的范围内。
            Set<Integer> declaredChIds = new HashSet<>();
            dataset.getReportChannelDefs().forEach(d -> declaredChIds.add(d.getId()));
            Set<Integer> declaredSrcIds = new HashSet<>();
            dataset.getSourceChannelDefs().forEach(d -> declaredSrcIds.add(d.getId()));
            for (SkippedItem s : dataset.getSkippedItems()) {
                c.check(nonBlank(s.getItemId()), "skippedItems.itemId non-blank");
                c.check(nonBlank(s.getReason()), "skippedItems.reason non-blank");
                c.check(s.getChannel() == null || Set.of("HKTR", "JSFA", "CFTC").contains(s.getChannel()),
                        "skippedItems.channel valid or null: " + s.getChannel());
                c.check(s.getSource() == null || Set.of("来源渠道 A", "来源渠道 B").contains(s.getSource()),
                        "skippedItems.source valid or null: " + s.getSource());
                c.check(s.getChannel() == null || s.getChannelId() != null,
                        "skippedItems.channelId present with channel: " + s.getChannel());
                c.check(s.getChannelId() == null || declaredChIds.contains(s.getChannelId()),
                        "skippedItems.channelId 必须已在 reportChannelDefs 里声明：" + s.getChannelId());
                c.check(s.getSourceId() == null || s.getChannelId() != null,
                        "skippedItems.sourceId requires channelId");
                c.check(s.getSourceId() == null || declaredSrcIds.contains(s.getSourceId()),
                        "skippedItems.sourceId 必须已在 sourceChannelDefs 里声明：" + s.getSourceId());
            }
        }
        c.done();
    }

    @Test
    void configConformsToJsonSchema() {
        Check c = new Check();
        c.check(Files.isRegularFile(SCHEMA_PATH), "schema file not found: " + SCHEMA_PATH);
        try {
            JsonNode schemaNode = ValidationJsonGenerator.MAPPER.readTree(Files.readString(SCHEMA_PATH));
            JsonSchemaFactory factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7);
            JsonSchema schema = factory.getSchema(schemaNode);
            Set<ValidationMessage> errors = schema.validate(configJson);
            for (ValidationMessage m : errors) {
                c.fail("config schema violation: " + m.getInstanceLocation() + " -> " + m.getMessage());
            }
        } catch (Exception e) {
            c.fail("schema validation threw: " + e.getMessage());
        }
        c.done();
    }

    @Test
    void serializationRoundTripsWithoutLoss() {
        Check c = new Check();
        try {
            assertTreeRoundTrip(c, "dataset", dataJson, dataset);
            assertTreeRoundTrip(c, "config", configJson, config);
            assertTreeRoundTrip(c, "ignore", ignoreJson, ignore);
            assertTreeRoundTrip(c, "batchIndex", indexJson, batchIndex);
            assertTreeRoundTrip(c, "batchMeta", metaJson, batchMeta);
        } catch (Exception e) {
            c.fail("round-trip threw: " + e.getMessage());
        }
        c.done();
    }

    @Test
    void ignoreConfigDefaultsToEmpty() {
        // 默认忽略配置必须为空（不忽略任何条目）；运行期由查看器 POST /api/ignore 回写真实忽略项。
        Check c = new Check();
        c.check(ignoreJson.isObject(), "ignore-config-by-platform.json 顶层应为对象");
        c.check(ignoreJson.isEmpty(), "默认忽略配置应为空对象：" + ignoreJson);
        c.check(ignore.isEmpty(), "默认忽略配置不应包含任何平台分组");
        c.done();
    }

    @Test
    void descriptionExIsOptionalAndRoundTrips() throws Exception {
        // descriptionEx 为「任务说明」扩展内容（只读）：写入 batch-meta.json，不进批次索引；
        // 查看器按索引的 metaUrl 懒加载，因此这里只校验 meta 与 config 的契约。
        Check c = new Check();
        DescriptionEx ex = batchMeta.getDescriptionEx();
        c.check(ex != null, "batchMeta.descriptionEx present（默认生成器会带一份 markDownTable 示例）");
        if (ex != null) {
            c.check("markDownTable".equals(ex.getContentType()), "descriptionEx.contentType == markDownTable");
            String content = ex.getPlainContent() == null ? "" : ex.getPlainContent();
            c.check(content.startsWith("|"), "descriptionEx.plainContent 为 Markdown 表格（以 | 开头）");
            c.check(content.split("\n").length >= 6, "示例表格行数应超过一页（默认 5 行/页）：" + content.split("\n").length);
            c.check(content.contains("\\|"), "示例表格应包含 `\\|` 转义演示");
            String firstLine = content.split("\n")[0];
            // Java 的 split 会丢弃末尾空段，故直接数 `|` 个数：3 列表头 = 4 个分隔符。
            long pipes = firstLine.chars().filter(ch -> ch == '|').count();
            c.check(pipes == 4, "示例表格为 3 列（首行 4 个 | 分隔符）：" + firstLine);
            // 索引不得携带扩展内容正文（避免索引膨胀）：内容只能从 batch-meta.json 读到。
            c.check(!indexJson.toString().contains("数据接入完整性"), "索引中不得出现 descriptionEx 正文");
            // 往返无损：meta 树 <-> 对象 由 serializationRoundTripsWithoutLoss 统一覆盖，这里补充字段级校验。
            JsonNode exJson = metaJson.path("descriptionEx");
            c.check(exJson.isObject() && exJson.path("contentType").asText().equals(ex.getContentType()),
                    "batch-meta.json 中的 descriptionEx 与模型一致");
        }
        c.check(config.getFeatures() != null && Boolean.TRUE.equals(config.getFeatures().getDescriptionEx()),
                "config.features.descriptionEx 默认 true（所有配置文件均启用）");
        c.check(config.getLimits() != null && Integer.valueOf(5).equals(config.getLimits().getDescExPageSize()),
                "config.limits.descExPageSize 默认 5");
        c.check(config.getLimits() != null && Integer.valueOf(10).equals(config.getLimits().getIgnoreMgrPageSize()),
                "config.limits.ignoreMgrPageSize 默认 10");
        c.done();
    }

    @Test
    void configColumnsMatchViewerColumnNames() {
        // columns.default 的列名**与顺序**必须与查看器（app.js DEFAULT_COLUMNS）及 config.schema.json 公布的一致，
        // 否则生成的 config.json 会被查看器静默忽略（未知列名），或顺序与「主列表 / 列选择」不符。
        Check c = new Check();
        List<String> expected = List.of(
                "channel", "source", "field", "userTag", "type", "ctxs",
                "eoEl", "aoEl", "eoCvtEl", "aoCvtEl", "vdtEl",
                "eoUnconverted", "eo", "aoUnconverted", "ao", "result", "remarks");
        Map<String, Boolean> got = config.getColumns() == null ? null : config.getColumns().getDefaults();
        c.check(got != null, "columns.default 缺失");
        if (got != null) {
            c.check(got.keySet().equals(new LinkedHashSet<>(expected)),
                    "columns.default 列名不一致，实际：" + got.keySet());
            c.check(new ArrayList<>(got.keySet()).equals(expected),
                    "columns.default 列顺序不一致，实际：" + got.keySet());
        }
        c.done();
    }

    @Test
    void batchFilesAreConsistent() {
        Check c = new Check();
        c.check(batchIndex.getCount() != null && batchIndex.getCount() == 1, "batchIndex.count == 1");
        c.check(batchIndex.getBatches() != null && batchIndex.getBatches().size() == 1, "batchIndex.batches.size == 1");

        if (batchIndex.getBatches() != null && !batchIndex.getBatches().isEmpty()) {
            var entry = batchIndex.getBatches().get(0);
            c.check(nonBlank(entry.getBatchId()), "batch entry batchId non-blank");
            c.check(nonBlank(entry.getDataUrl()), "batch entry dataUrl non-blank");
            c.check(nonBlank(entry.getIgnoreUrl()), "batch entry ignoreUrl non-blank");
            // 索引不写 cwd / dataMode（查看器从不读取，与 lib/scanner.js 保持一致），防止回归。
            JsonNode entryJson = indexJson.path("batches").get(0);
            c.check(entryJson != null && !entryJson.has("dataMode") && !entryJson.has("cwd"),
                    "batch entry 不应包含 dataMode / cwd：" + entryJson);
            c.check(entry.getSummary() != null && entry.getSummary().containsKey("items"), "batch entry summary.items present");

            Path dataFile = OUT_DIR.resolve(entry.getDataUrl());
            c.check(Files.isRegularFile(dataFile), "batch dataUrl resolves to a file: " + entry.getDataUrl());
        }

        Object metaItems = batchMeta.getSummary() != null ? batchMeta.getSummary().get("items") : null;
        c.check(metaItems != null && Integer.valueOf(String.valueOf(metaItems)) == dataset.getItems().size(),
                "batchMeta.summary.items == dataset.items.size()");
        c.check(batchMeta.getSummary() != null && batchMeta.getSummary().containsKey("channels"), "batchMeta.summary.channels present");
        c.check("single".equals(batchMeta.getDataMode()), "batchMeta.dataMode == single");
        c.done();
    }

    @Test
    void multiModeSplitsIntoManifestAndItemFiles() throws Exception {
        Check c = new Check();
        List<ManifestItem> manifestItems = ValidationJsonGenerator.splitToFiles(dataset, tmpDir);

        Path manifestFile = tmpDir.resolve("report-validation-data.json");
        c.check(Files.isRegularFile(manifestFile), "manifest file written");

        JsonNode manifest = ValidationJsonGenerator.MAPPER.readTree(manifestFile.toFile());
        c.check("multi".equals(manifest.path("mode").asText()), "manifest.mode == 'multi'");
        c.check(manifest.path("items").size() == dataset.getItems().size(), "manifest.items count matches");
        c.check(manifestItems.size() == dataset.getItems().size(), "splitToFiles returned one entry per item");
        // 清单必须保留单文件模式的所有顶层字段（DATA_SCHEMA.md §2）：三张登记表也在清单里。
        c.check(manifest.path("reportChannelDefs").isArray() && manifest.path("reportChannelDefs").size() >= 3,
                "manifest.reportChannelDefs 声明表存在");
        c.check(manifest.path("sourceChannelDefs").isArray() && manifest.path("sourceChannelDefs").size() >= 2,
                "manifest.sourceChannelDefs 声明表存在");
        c.check(manifest.path("usedCtxKeyDefs").isObject() && !manifest.path("usedCtxKeyDefs").isEmpty(),
                "manifest.usedCtxKeyDefs 声明表存在");
        // 键顺序固定（docs/DATA_SCHEMA.md §1）：声明表 → usedCtxKeyDefs → skippedItems → items。
        List<String> manifestKeys = new ArrayList<>();
        manifest.fieldNames().forEachRemaining(manifestKeys::add);
        c.check(ROOT_KEY_ORDER.equals(manifestKeys), "manifest 顶层键顺序：" + manifestKeys);
        c.check(manifest.path("reportEnv").asText().equals(dataset.getReportEnv()), "manifest.reportEnv matches");
        c.check(manifest.path("creationType").asText().equals(dataset.getCreationType()),
                "manifest.creationType == dataset.creationType");
        c.check(manifest.path("skippedItems").isArray(), "manifest.skippedItems is an array");
        c.check(manifest.path("skippedItems").size() == dataset.getSkippedItems().size(),
                "manifest.skippedItems size matches dataset");
        if (manifest.path("skippedItems").size() > 0) {
            c.check(manifest.path("skippedItems").get(0).path("itemId").asText()
                            .equals(dataset.getSkippedItems().get(0).getItemId()),
                    "manifest.skippedItems[0].itemId matches");
        }

        for (int i = 0; i < manifestItems.size(); i++) {
            ManifestItem mi = manifestItems.get(i);
            ValidationItem it = dataset.getItems().get(i);
            c.check(it.getTradeId().equals(mi.getTradeId()), "manifest[" + i + "].tradeId matches");
            c.check(nonBlank(mi.getFile()), "manifest[" + i + "].file non-blank");
            c.check(mi.getFile().equals("data/items/" + it.getTradeId() + ".json"), "manifest[" + i + "].file path");

            Path itemFile = tmpDir.resolve(mi.getFile());
            c.check(Files.isRegularFile(itemFile), "item file exists: " + mi.getFile());

            JsonNode itemJson = ValidationJsonGenerator.MAPPER.readTree(itemFile.toFile());
            c.check(it.getTradeId().equals(itemJson.path("tradeId").asText()), "item file tradeId matches");
            // item 文件里只有 id 引用：字段定义在清单的 reportChannelDefs[].fieldDefs 里。
            c.check(itemJson.has("ctxDtls") && itemJson.has("channels")
                            && itemJson.path("channels").size() > 0,
                    "item file has ctxDtls/channels");
            JsonNode firstCh = itemJson.path("channels").get(0);
            c.check(!firstCh.has("fieldDefs") && !firstCh.has("fields") && !firstCh.has("name"),
                    "item 文件里的渠道只有 id 引用：" + firstCh);
            c.check(firstCh.path("sources").size() > 0 && firstCh.path("sources").get(0).has("fields"),
                    "item 文件里的来源渠道保留 fields（比对结果）：" + firstCh.path("sources"));

            ItemSummary s = mi.getSummary();
            c.check(s != null, "manifest[" + i + "].summary present");
            if (s != null) {
                c.check(s.getTotal() >= 0 && s.getPassed() >= 0 && s.getFailed() >= 0, "manifest[" + i + "].summary counts non-negative");
                c.check(s.getPassed() + s.getFailed() == s.getTotal(), "manifest[" + i + "].summary passed+failed == total");
            }
        }

        // writeAll(multi) 端到端：根目录主清单 + 默认模板清单 + item 文件，批次目录清单 + item 文件。
        Path multiOut = tmpDir.resolve("multi-out");
        ValidationJsonGenerator.writeAll(multiOut, DataMode.multi);

        for (String name : List.of("report-validation-data.json")) {
            Path f = multiOut.resolve(name);
            c.check(Files.isRegularFile(f), "multi 根目录应写入 " + name);
            if (Files.isRegularFile(f)) {
                JsonNode j = ValidationJsonGenerator.MAPPER.readTree(f.toFile());
                c.check("multi".equals(j.path("mode").asText()), name + ".mode == multi");
                c.check(j.path("items").size() == dataset.getItems().size(), name + ".items count matches");
                c.check(j.path("creationType").asText().equals(dataset.getCreationType()),
                        name + ".creationType 与单文件模式一致");
                c.check(j.path("skippedItems").size() == dataset.getSkippedItems().size(),
                        name + ".skippedItems 与单文件模式一致");
                JsonNode first = j.path("items").get(0);
                c.check(Files.isRegularFile(multiOut.resolve(first.path("file").asText())),
                        name + " 引用的 item 文件存在：" + first.path("file").asText());
            }
        }

        Path multiBatchDir = multiOut.resolve("batches/2026-08-16/batch-20260816-0400");
        Path multiBatchManifest = multiBatchDir.resolve("report-validation-data.json");
        c.check(Files.isRegularFile(multiBatchManifest), "multi 批次目录应写入清单");
        if (Files.isRegularFile(multiBatchManifest)) {
            JsonNode j = ValidationJsonGenerator.MAPPER.readTree(multiBatchManifest.toFile());
            c.check("multi".equals(j.path("mode").asText()), "批次清单.mode == multi");
            c.check(j.path("creationType").asText().equals(dataset.getCreationType()), "批次清单.creationType 与数据集一致");
            c.check(j.path("skippedItems").size() == dataset.getSkippedItems().size(), "批次清单.skippedItems 与数据集一致");
            String file = j.path("items").get(0).path("file").asText();
            c.check(file.startsWith("data/items/"), "批次清单 item.file 为相对批节目录的路径：" + file);
            c.check(Files.isRegularFile(multiBatchDir.resolve(file)), "批次 item 文件存在：" + file);
        }

        JsonNode multiIndex = ValidationJsonGenerator.MAPPER.readTree(multiOut.resolve("batches-index.json").toFile());
        JsonNode multiEntry = multiIndex.path("batches").get(0);
        c.check(multiEntry.path("dataUrl").asText().endsWith("batch-20260816-0400/report-validation-data.json"),
                "索引 dataUrl 指向批次清单");
        c.check(!multiEntry.has("dataMode") && !multiEntry.has("cwd"), "多文件索引同样不写 dataMode / cwd");
        JsonNode multiMeta = ValidationJsonGenerator.MAPPER.readTree(multiBatchDir.resolve("batch-meta.json").toFile());
        c.check("multi".equals(multiMeta.path("dataMode").asText()), "batch-meta.json 保留 dataMode == multi（元数据，非索引）");
        c.done();
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                           */
    /* ------------------------------------------------------------------ */

    private static JsonNode readTree(String rel) throws Exception {
        return ValidationJsonGenerator.MAPPER.readTree(OUT_DIR.resolve(rel).toFile());
    }

    /** 字段定义登记表（{@code reportChannelDefs[].fieldDefs}）：返回该渠道里声明的字段 id 集合。 */
    private static Set<String> validateRegistry(Check c, Channel def, String label) {
        Set<String> ids = new HashSet<>();
        c.check(def.getFieldDefs() != null && !def.getFieldDefs().isEmpty(), label + ".fieldDefs non-empty");
        if (def.getFieldDefs() != null) {
            for (FieldDef fd : def.getFieldDefs()) {
                c.check(nonBlank(fd.getId()), label + ".fieldDefs.id non-blank");
                c.check(nonBlank(fd.getName()), label + ".fieldDefs.name non-blank");
                c.check(nonBlank(fd.getUserTag()), label + ".fieldDefs.userTag non-blank");
                c.check(nonBlank(fd.getType()), label + ".fieldDefs.type non-blank");
                c.check(ids.add(fd.getId()), label + ".fieldDefs.id unique: " + fd.getId());
            }
        }
        return ids;
    }

    /**
     * {@code item.ctxDtls[<ctxKey>] = { hits }}：id 与定义全在 {@code usedCtxKeyDefs} 里，
     * item 只保留命中摘要（ctxKey 本身就是引用）。
     */
    private static void validateCtxDefs(Check c, ValidationItem item, String it, ValidationDataset ds) {
        c.check(item.getCtxDtls() != null && !item.getCtxDtls().isEmpty(), it + ".ctxDtls non-empty");
        if (item.getCtxDtls() == null) {
            return;
        }
        Map<String, CtxKeyDef> defs = ds.getUsedCtxKeyDefs() == null ? Map.of() : ds.getUsedCtxKeyDefs();
        for (Map.Entry<String, CtxDetail> e : item.getCtxDtls().entrySet()) {
            CtxDetail def = e.getValue();
            String label = it + ".ctxDtls[" + e.getKey() + "]";
            c.check(nonBlank(e.getKey()), it + ".ctxDtls key non-blank");
            c.check(defs.get(e.getKey()) != null, label + " 的 ctxKey 必须在 usedCtxKeyDefs 里声明");
            c.check(nonBlank(def.getHits()), label + ".hits non-blank");
        }
    }

    private static void validateChannel(Check c, Channel ch, String label, Set<String> fieldIds) {
        // 这些定义由查看器 hydrate 从 reportChannelDefs 补回（item 文件里不重复写）。
        c.check(nonBlank(ch.getName()), label + ".name non-blank（由登记表 hydrate 补回）");
        c.check(nonBlank(ch.getDesc()), label + ".desc non-blank（由登记表 hydrate 补回）");
        c.check("xml".equals(ch.getFormat()) || "csv".equals(ch.getFormat()), label + ".format in {xml,csv}");
        boolean csv = "csv".equals(ch.getFormat());

        c.check(ch.getFiles() != null, label + ".files present");
        if (ch.getFiles() != null) {
            c.check(ch.getFiles().getEo() != null && !ch.getFiles().getEo().isEmpty(), label + ".files.eo non-empty");
            c.check(ch.getFiles().getAo() != null && !ch.getFiles().getAo().isEmpty(), label + ".files.ao non-empty");
            c.check(ch.getFiles().getExcel() != null, label + ".files.excel present");
            if (ch.getFiles().getExcel() != null) {
                c.check(nonBlank(ch.getFiles().getExcel().getFile()), label + ".files.excel.file non-blank");
                c.check(nonBlank(ch.getFiles().getExcel().getSheet()), label + ".files.excel.sheet non-blank");
            }
        }

        c.check(ch.getSources() != null && !ch.getSources().isEmpty(), label + ".sources non-empty");
        if (ch.getSources() != null) {
            for (var src : ch.getSources()) {
                c.check(nonBlank(src.getName()), label + ".source.name non-blank（由登记表 hydrate 补回）");
                c.check(src.getFields() != null && !src.getFields().isEmpty(), label + ".source.fields non-empty");
                if (src.getFields() != null) {
                    for (Field f : src.getFields()) {
                        validateField(c, f, label, csv, fieldIds);
                    }
                }
            }
        }
    }

    private static void validateField(Check c, Field f, String label, boolean csv, Set<String> fieldIds) {
        c.check(nonBlank(f.getId()), label + ".field.id non-blank");
        c.check(fieldIds.contains(f.getId()), label + ".field.id references the channel fieldDefs: " + f.getId());
        c.check(f.getCmpLeft() != null && f.getCmpLeft().getMetaCtxs() != null && !f.getCmpLeft().getMetaCtxs().isEmpty(),
                label + ".field.cmpLeft.metaCtxs non-empty");
        c.check("PASSED".equals(f.getResult()) || "FAILED".equals(f.getResult()), label + ".field.result in {PASSED,FAILED}");

        CmpSide left = f.getCmpLeft();
        CmpSide right = f.getCmpRight();
        c.check(left != null, label + ".field.cmpLeft present");
        c.check(right != null, label + ".field.cmpRight present");
        if (left != null) {
            c.check(left.getValue() != null, label + ".field.cmpLeft.value present (may be empty for text fields)");
            c.check(nonBlank(left.getCtxRaw()), label + ".field.cmpLeft.ctxRaw non-blank (raw ctx expression)");
            // 期望值（EO）来自映射表，永远是 csv；实际值（AO）来自被比较的报文，格式随渠道。
            c.check("csv".equals(left.getValueSrcFmt()), label + ".field.cmpLeft.valueSrcFmt == csv: " + left.getValueSrcFmt());
        }
        if (right != null) {
            c.check(right.getValue() != null, label + ".field.cmpRight.value present (may be empty for text fields)");
            c.check(nonBlank(right.getCtxRaw()), label + ".field.cmpRight.ctxRaw non-blank (raw ctx expression)");
            c.check((csv ? "csv" : "xml").equals(right.getValueSrcFmt()),
                    label + ".field.cmpRight.valueSrcFmt 与渠道 format 一致：" + right.getValueSrcFmt());
        }

        // prints 保留待用（查看器详情页改为从 item.logs 读取该字段的关联日志行）；
        // 字段级日志行只在 item.logs 里存一份，字段对象本身不写 logs。
        c.check(f.getPrints() != null && !f.getPrints().isEmpty(), label + ".field.prints non-empty");
    }

    private static void validateMessages(Check c, List<Message> msgs, String label) {
        c.check(msgs != null, label + " present");
        if (msgs == null) {
            return;
        }
        for (Message m : msgs) {
            c.check("field".equals(m.getScope()) || "channel".equals(m.getScope()), label + ".scope in {field,channel}");
            c.check(nonBlank(m.getChannel()), label + ".channel non-blank");
            c.check(nonBlank(m.getType()), label + ".type non-blank");
            c.check(nonBlank(m.getLevel()), label + ".level non-blank");
            c.check(nonBlank(m.getText()), label + ".text non-blank");
            c.check(m.getField() != null, label + ".field present (may be empty)");
            // 名称与 id 双写已移除：warnings / errors 只写名称（人工读的内容，名字更有可读性）。
            c.check(!m.getChannel().isEmpty() && !m.getChannel().matches("\\d+"),
                    label + ".channel 为渠道名称而非 id：" + m.getChannel());
        }
    }

    private static void assertTreeRoundTrip(Check c, String name, JsonNode original, Object model) {
        try {
            JsonNode reSerialized = ValidationJsonGenerator.MAPPER.valueToTree(model);
            if (!original.equals(reSerialized)) {
                c.fail(name + " round-trip mismatch: original != re-serialized");
            }
        } catch (Exception e) {
            c.fail(name + " round-trip threw: " + e.getMessage());
        }
    }

    private static boolean nonBlank(String s) {
        return s != null && !s.isBlank();
    }

    /** Accumulating assertion helper so one test reports all failures. */
    static final class Check {
        private final List<String> failures = new ArrayList<>();

        void check(boolean cond, String message) {
            if (!cond) {
                failures.add(message);
            }
        }

        void fail(String message) {
            failures.add(message);
        }

        void done() {
            if (!failures.isEmpty()) {
                throw new AssertionError("validation failures (" + failures.size() + "):\n  - "
                        + String.join("\n  - ", failures));
            }
        }
    }
}
