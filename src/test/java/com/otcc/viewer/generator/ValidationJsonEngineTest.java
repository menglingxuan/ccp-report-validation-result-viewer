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
import com.otcc.viewer.model.CtxDef;
import com.otcc.viewer.model.DescriptionEx;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.FieldDef;
import com.otcc.viewer.model.ItemLog;
import com.otcc.viewer.model.ItemSummary;
import com.otcc.viewer.model.ManifestItem;
import com.otcc.viewer.model.Message;
import com.otcc.viewer.model.PlatformIgnore;
import com.otcc.viewer.model.SkippedItem;
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

    static ValidationDataset dataset;
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
                "report-validation-data-default.json",
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
        config = ValidationJsonGenerator.MAPPER.treeToValue(configJson, ValidationConfig.class);
        ignore = ValidationJsonGenerator.MAPPER.convertValue(ignoreJson, new TypeReference<>() {});
        batchIndex = ValidationJsonGenerator.MAPPER.treeToValue(indexJson, BatchIndex.class);
        batchMeta = ValidationJsonGenerator.MAPPER.treeToValue(metaJson, BatchMeta.class);
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
        c.check("single".equals(dataset.getMode()), "dataset.mode must be 'single'");
        c.check(dataset.getItems() != null && !dataset.getItems().isEmpty(), "items must be non-empty");
        c.check(nonBlank(dataset.getReportEnv()), "reportEnv non-blank");

        for (int i = 0; i < dataset.getItems().size(); i++) {
            ValidationItem item = dataset.getItems().get(i);
            String it = "items[" + i + "]";
            c.check(nonBlank(item.getTradeId()), it + ".tradeId non-blank");
            c.check(nonBlank(item.getReportDate()), it + ".reportDate non-blank");
            c.check(nonBlank(item.getGeneratedAt()), it + ".generatedAt non-blank");
            c.check(nonBlank(item.getPlatform()), it + ".platform non-blank");
            c.check(nonBlank(item.getProduct()), it + ".product non-blank");
            c.check(nonBlank(item.getProductCategory()), it + ".productCategory non-blank");
            c.check(item.getPlatformTradeId() != null, it + ".platformTradeId present");
            c.check(item.getPlatformDealId() != null, it + ".platformDealId present");

            // per-item ctxDefs
            validateCtxDefs(c, item, it);

            // channels（字段注册表在 report channel 级别）
            c.check(item.getChannels() != null && !item.getChannels().isEmpty(), it + ".channels non-empty");
            Set<String> channelNames = new HashSet<>();
            if (item.getChannels() != null) {
                for (Channel ch : item.getChannels()) {
                    channelNames.add(ch.getName());
                    String chLabel = it + ".channels[" + ch.getName() + "]";
                    Set<String> fieldIds = validateRegistry(c, ch, chLabel);
                    validateChannel(c, ch, chLabel, fieldIds);
                }
            }
            c.check(item.getEnabledChannels() != null && !item.getEnabledChannels().isEmpty(), it + ".enabledChannels non-empty");
            if (item.getEnabledChannels() != null) {
                for (String en : item.getEnabledChannels()) {
                    c.check(channelNames.contains(en), it + ".enabledChannels references existing channel: " + en);
                }
            }

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
                    c.check("item".equals(l.getScope()) || "channel".equals(l.getScope()), it + ".logs.scope in {item,channel}");
                    c.check(nonBlank(l.getText()), it + ".logs.text non-blank");
                }
            }
        }
        if (dataset.getSkippedItems() != null) {
            for (SkippedItem s : dataset.getSkippedItems()) {
                c.check(nonBlank(s.getItemId()), "skippedItems.itemId non-blank");
                c.check(nonBlank(s.getReason()), "skippedItems.reason non-blank");
                c.check(s.getChannel() == null || Set.of("HKTR", "JSFA", "CFTC").contains(s.getChannel()),
                        "skippedItems.channel valid or null: " + s.getChannel());
                c.check(s.getSource() == null || Set.of("来源渠道 A", "来源渠道 B").contains(s.getSource()),
                        "skippedItems.source valid or null: " + s.getSource());
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
        // columns.default 的列名必须与查看器（app.js DEFAULT_COLUMNS）及 config.schema.json 公布的列名一致，
        // 否则生成的 config.json 会被查看器静默忽略。
        Check c = new Check();
        Set<String> expected = new LinkedHashSet<>(List.of(
                "channel", "source", "field", "userTag", "eoEl", "aoEl", "eoCvtEl", "aoCvtEl", "vdtEl",
                "type", "ctxs", "eoUnconverted", "eo", "aoUnconverted", "ao", "result", "remarks"));
        Map<String, Boolean> got = config.getColumns() == null ? null : config.getColumns().getDefaults();
        c.check(got != null && got.keySet().equals(expected), "columns.default 列名不一致，实际：" + (got == null ? "null" : got.keySet()));
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
            c.check(itemJson.has("ctxDefs") && itemJson.has("channels")
                            && itemJson.path("channels").size() > 0
                            && itemJson.path("channels").get(0).has("fields"),
                    "item file has ctxDefs/channels and channel.fields");

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

        for (String name : List.of("report-validation-data.json", "report-validation-data-default.json")) {
            Path f = multiOut.resolve(name);
            c.check(Files.isRegularFile(f), "multi 根目录应写入 " + name + "（默认模板数据在多文件模式下也是清单）");
            if (Files.isRegularFile(f)) {
                JsonNode j = ValidationJsonGenerator.MAPPER.readTree(f.toFile());
                c.check("multi".equals(j.path("mode").asText()), name + ".mode == multi");
                c.check(j.path("items").size() == dataset.getItems().size(), name + ".items count matches");
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

    private static Set<String> validateRegistry(Check c, Channel ch, String label) {
        Set<String> ids = new HashSet<>();
        c.check(ch.getFields() != null && !ch.getFields().isEmpty(), label + ".fields non-empty");
        if (ch.getFields() != null) {
            for (FieldDef fd : ch.getFields()) {
                c.check(nonBlank(fd.getId()), label + ".fields.id non-blank");
                c.check(nonBlank(fd.getName()), label + ".fields.name non-blank");
                c.check(nonBlank(fd.getUserTag()), label + ".fields.userTag non-blank");
                c.check(nonBlank(fd.getType()), label + ".fields.type non-blank");
                c.check(ids.add(fd.getId()), label + ".fields.id unique: " + fd.getId());
            }
        }
        return ids;
    }

    private static void validateCtxDefs(Check c, ValidationItem item, String it) {
        c.check(item.getCtxDefs() != null && !item.getCtxDefs().isEmpty(), it + ".ctxDefs non-empty");
        if (item.getCtxDefs() != null) {
            Set<Integer> ids = new HashSet<>();
            for (Map.Entry<String, CtxDef> e : item.getCtxDefs().entrySet()) {
                CtxDef def = e.getValue();
                c.check(nonBlank(e.getKey()), it + ".ctxDef key non-blank");
                c.check(def.getId() != null && def.getId() > 0, it + ".ctxDef[" + e.getKey() + "].id positive");
                if (def.getId() != null) {
                    c.check(ids.add(def.getId()), it + ".ctxDef[" + e.getKey() + "].id unique: " + def.getId());
                }
                c.check(def.getScopes() != null && !def.getScopes().isEmpty(), it + ".ctxDef[" + e.getKey() + "].scopes non-empty");
                if (def.getScopes() != null) {
                    for (Integer t : def.getScopes()) {
                        c.check(t != null && t >= 1 && t <= 3, it + ".ctxDef[" + e.getKey() + "].scopes in {1,2,3}");
                    }
                }
                c.check("builtin".equals(def.getType()) || "user".equals(def.getType()),
                        it + ".ctxDef[" + e.getKey() + "].type in {builtin,user}");
                c.check(nonBlank(def.getDef()), it + ".ctxDef[" + e.getKey() + "].def non-blank");
                c.check(nonBlank(def.getHits()), it + ".ctxDef[" + e.getKey() + "].hits non-blank");
            }
        }
    }

    private static void validateChannel(Check c, Channel ch, String label, Set<String> fieldIds) {
        c.check(nonBlank(ch.getName()), label + ".name non-blank");
        c.check(nonBlank(ch.getDesc()), label + ".desc non-blank");
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
                c.check(nonBlank(src.getName()), label + ".source.name non-blank");
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
        c.check(fieldIds.contains(f.getId()), label + ".field.id references item.fields: " + f.getId());
        c.check(f.getCmpLeft() != null && f.getCmpLeft().getCtxs() != null && !f.getCmpLeft().getCtxs().isEmpty(),
                label + ".field.cmpLeft.ctxs non-empty");
        c.check("PASSED".equals(f.getResult()) || "FAILED".equals(f.getResult()), label + ".field.result in {PASSED,FAILED}");

        CmpSide left = f.getCmpLeft();
        CmpSide right = f.getCmpRight();
        c.check(left != null, label + ".field.cmpLeft present");
        c.check(right != null, label + ".field.cmpRight present");
        if (left != null) {
            c.check(left.getValue() != null, label + ".field.cmpLeft.value present (may be empty for text fields)");
            c.check(nonBlank(left.getCtx()), label + ".field.cmpLeft.ctx non-blank (raw ctx expression)");
            c.check(left.getSrcType() != null && (left.getSrcType() == 1 || left.getSrcType() == 2),
                    label + ".field.cmpLeft.srcType in {1,2}");
        }
        if (right != null) {
            c.check(right.getValue() != null, label + ".field.cmpRight.value present (may be empty for text fields)");
            c.check(nonBlank(right.getCtx()), label + ".field.cmpRight.ctx non-blank (raw ctx expression)");
            c.check(right.getSrcType() != null && (right.getSrcType() == 1 || right.getSrcType() == 2),
                    label + ".field.cmpRight.srcType in {1,2}");
            if (csv) {
                c.check(right.getSrcType() == 2, label + ".field.cmpRight.srcType == 2 for csv");
            } else {
                c.check(right.getSrcType() == 1, label + ".field.cmpRight.srcType == 1 for xml");
            }
        }

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
