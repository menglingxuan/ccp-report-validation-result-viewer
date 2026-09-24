# ccp-report-validation-result-viewer

基于 **Spring Boot + Spring Batch** 的样例数据生成工具。项目已从原来的 Web 应用改造为
批处理应用：默认通过一个 Spring Batch Job 生成不同级别的 JSON 样例数据，并使用
[picocli](https://picocli.info/) 解析 Linux 风格命令行选项来启动与控制任务。

## 环境要求

- JDK 21
- Gradle（推荐使用项目自带的 wrapper）或 Maven

## 构建

Gradle（开发调试推荐）：

```bash
./gradlew build          # Linux / macOS
gradlew.bat build        # Windows
```

Maven（与 Gradle 配置保持同步）：

```bash
./mvnw package
```

## 快速开始

默认直接运行默认 Job（prod profile，`minimal` 级别）：

```bash
gradle bootRun
```

指定 `basic` 级别：

```bash
gradle bootRun --args="--level basic"
```

## 命令行选项（picocli）

根命令选项：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-j, --job <name>` | 要运行的 Job：`sampleDataJob` / `helloWorldJob` / `styleDataJob` / `validationJsonJob` | `sampleDataJob` |
| `-l, --level <level>` | 样例数据级别：`minimal` / `basic`（`sampleDataJob` 使用） | `minimal` |
| `-o, --output-dir <dir>` | 输出目录 | `generated` |
| `-m, --mode <single\|multi>` | 数据输出模式（`validationJsonJob` 使用：单文件 / 清单 + 每 item 一个文件；`multi` 的清单保留 `mode` / `reportEnv` / `creationType` / `skippedItems` 顶层字段，仅把 `items` 换成带 `file` + `summary` 的轻量条目） | `single` |
| `-r, --run` / `--no-run` | 是否启动 Job（`--no-run` 仅校验参数） | 启动 |
| `-h, --help` | 显示帮助 | - |
| `-V, --version` | 显示版本 | - |

子命令：

| 子命令 | 说明 |
|--------|------|
| `generate` | 按风格（style）生成样例数据，支持报告日期过滤 |

示例：

```bash
gradle bootRun --args="--job=helloWorldJob"
gradle bootRun --args="--level basic"
gradle bootRun --args="--level basic --output-dir out"
gradle bootRun --args="--no-run"
gradle bootRun --args="--help"
```

也可以直接运行打包产物：

```bash
java -jar build/libs/ccp-report-validation-result-viewer-0.0.1-SNAPSHOT.jar --level basic
```

## generate 子命令

按风格生成数据，输出文件名统一带有风格标识（如 `*-basic.json`）：

```bash
gradle bootRun --args="generate --style basic"
gradle bootRun --args="generate --style minimal --report-date 2026-08-20"
gradle bootRun --args="generate --style minimal --date-from 2026-08-18 --date-to 2026-08-19"
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-s, --style <style>` | 风格：`minimal` / `basic` | `minimal` |
| `-o, --output-dir <dir>` | 输出目录 | `generated` |
| `--report-date <date>` | 只生成该报告日期（与 `--all-dates` 互斥） | - |
| `--all-dates` | 使用默认报告日期（与 `--report-date` 互斥） | - |
| `--date-from <date>` | 日期范围起点（必须与 `--date-to` 一起使用） | - |
| `--date-to <date>` | 日期范围终点（必须与 `--date-from` 一起使用） | - |

文件命名规则：

- 未指定日期：`report-validation-data-<style>.json`（basic 另生成 `batch-meta-<style>.json`）
- 指定日期 / 日期范围：`report-validation-data-<style>-<date>.json`（basic 同时生成 `batch-meta-<style>-<date>.json`）

### 互斥与组合参数

`generate` 子命令通过 picocli `@ArgGroup` 定义了两类参数：

- **互斥参数**（`exclusive = true`）：`--report-date` 与 `--all-dates` 只能二选一。
- **组合参数**（`exclusive = false` + `required = true`）：`--date-from` 与 `--date-to` 必须同时出现。
- **日期选择与日期范围互斥**：`--report-date` / `--all-dates` 不能与 `--date-from` / `--date-to` 同时使用（命令层额外校验）。

```bash
# 错误：互斥参数不能同时指定
gradle bootRun --args="generate --report-date 2026-08-20 --all-dates"

# 错误：组合参数必须成对出现
gradle bootRun --args="generate --date-from 2026-08-18"

# 错误：日期选择与日期范围不能同时使用
gradle bootRun --args="generate --report-date 2026-08-20 --date-from 2026-08-18 --date-to 2026-08-19"
```

## Job 说明

项目包含四个 Job，可通过 `--job=<name>` 选择：

| Job | 说明 | 关键参数 |
|-----|------|----------|
| `sampleDataJob` | 默认 Job，按级别生成样例数据（原有功能） | `level`、`outputDir` |
| `helloWorldJob` | Hello World 示例 Job | - |
| `styleDataJob` | 按风格生成数据，支持报告日期（供 `generate` 子命令调用） | `style`、`reportDate`、`outputDir` |
| `validationJsonJob` | 生成查看器所需的**全部** JSON（数据集 / 配置 / 忽略配置 / 批次索引 + 一个批次目录） | `mode`（`single` / `multi`）、`outputDir` |

`sampleDataJob` 生成文件：

- `minimal`：`report-validation-data-minimal.json`
- `basic`：`report-validation-data-basic.json`、`batch-meta-basic.json`

`validationJsonJob` 在输出目录生成（`-m multi` 时数据集拆为清单 + 每 item 一个文件；主数据、默认模板数据与批次数据文件均为清单）：

- `report-validation-data.json`、`report-validation-data-default.json`、`config.json`、`ignore-config-by-platform.json`、`batches-index.json`
- `batches/2026-08-16/batch-20260816-0400/report-validation-data.json` 与 `.../batch-meta.json`

相关代码：

- `src/main/java/com/otcc/viewer/batch/SampleDataBatchConfiguration.java` — Job / Step 定义
- `src/main/java/com/otcc/viewer/batch/SampleDataTasklet.java` — `sampleDataJob` 数据生成逻辑
- `src/main/java/com/otcc/viewer/batch/StyleDataTasklet.java` — `styleDataJob` 数据生成逻辑
- `src/main/java/com/otcc/viewer/batch/HelloWorldTasklet.java` — Hello World 任务
- `src/main/java/com/otcc/viewer/batch/BatchJobResolver.java` — 按名称解析 Job
- `src/main/java/com/otcc/viewer/generator/SampleDataGenerator.java` — 风格生成策略接口
- `src/main/java/com/otcc/viewer/generator/SampleDataGeneratorRegistry.java` — 风格生成器注册表
- `src/main/java/com/otcc/viewer/cli/SampleDataCommand.java` — 根命令
- `src/main/java/com/otcc/viewer/cli/GenerateCommand.java` — `generate` 子命令
- `src/main/java/com/otcc/viewer/cli/SampleDataCommandLineRunner.java` — 启动入口 runner

## Spring Profiles

项目支持三个 profile，默认 `prod`：

| Profile | 说明 |
|---------|------|
| `dev` | 开发环境，控制台输出完整详细日志 |
| `test` | 测试环境，与 `dev` 日志行为一致 |
| `prod` | 生产环境（默认），控制台仅输出面向用户的友好日志 |

切换 profile（`--spring.profiles.active=xxx` 为 Spring Boot 自身属性，已与 picocli 共存）：

```bash
gradle bootRun --args="--spring.profiles.active=prod --level basic"
```

对应配置文件：

- `src/main/resources/application.properties`
- `src/main/resources/application-dev.properties`
- `src/main/resources/application-test.properties`
- `src/main/resources/application-prod.properties`

## 日志配置

日志配置位于 `src/main/resources/logback-spring.xml`：

- 默认日志级别：`INFO`
- 输出目标：控制台 + 文件
- 日志文件统一存放于 `logs/cli/`：
  - `ccp-report.log`
  - `ccp-report.yyyy-MM-dd.log`（按天滚动，保留 30 天）

Profile 差异：

| Profile | 控制台 | 文件 |
|---------|--------|------|
| `dev` / `test` | 完整堆栈式详细日志 | 完整详细日志 |
| `prod` | 面向用户的友好日志（仅应用消息 + 框架 WARN 及以上） | 完整详细日志 |

> 提示：若终端中文显示乱码，请将终端编码切换为 UTF-8（Windows 可执行 `chcp 65001`）。

## 项目结构

```
src/main/java/com/otcc/viewer/
├── batch/          # Spring Batch Job / Step / Tasklet / JobResolver
├── cli/            # picocli 根命令、generate 子命令与 runner
├── generator/      # 风格生成策略接口、注册表与实现
└── model/          # 数据模型
src/main/resources/
├── application*.properties   # 应用与 profile 配置
└── logback-spring.xml        # 日志配置
```

生成产物默认输出到仓库根的 `generated/`（`-o/--output-dir` 可改）：

```
generated/
├── report-validation-data.json / -default.json / -minimal.json / -basic.json
├── config.json                    # 查看器统一配置
├── ignore-config-by-platform.json  # 忽略配置（默认为空 {}）
├── batches-index.json             # 批次索引
└── batches/<date>/<batch>/        # 批次目录（batch-meta.json + 数据文件）
```

> `generated/` 已在 `.gitignore` 中忽略；需要作为查看器样例数据时，把上述文件拷贝到 `exapp/viewer_frontend/src/public/`。
