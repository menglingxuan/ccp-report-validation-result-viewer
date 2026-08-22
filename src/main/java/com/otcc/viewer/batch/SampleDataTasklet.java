package com.otcc.viewer.batch;

import com.otcc.viewer.generator.BasicBatchMetaGenerator;
import com.otcc.viewer.generator.BasicDataGenerator;
import com.otcc.viewer.generator.MinimalDataGenerator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.batch.core.StepContribution;
import org.springframework.batch.core.scope.context.ChunkContext;
import org.springframework.batch.core.step.tasklet.Tasklet;
import org.springframework.batch.repeat.RepeatStatus;
import org.springframework.stereotype.Component;

import java.nio.file.Path;

/**
 * Generates a JSON sample dataset whose detail level is selected by the
 * {@code level} job parameter ({@code minimal} or {@code basic}).
 */
@Slf4j
@Component
public class SampleDataTasklet implements Tasklet {

    /** Job parameter name that selects the sample data level. */
    public static final String LEVEL_PARAM = "level";

    /** Job parameter name for the output directory. */
    public static final String OUTPUT_DIR_PARAM = "outputDir";

    /** Default output directory for the generated JSON files. */
    public static final String DEFAULT_OUTPUT_DIR = "generated";

    @Override
    public RepeatStatus execute(StepContribution contribution, ChunkContext chunkContext) throws Exception {
        String level = chunkContext.getStepContext().getStepExecution()
                .getJobParameters().getString(LEVEL_PARAM, "minimal");
        String outputDir = chunkContext.getStepContext().getStepExecution()
                .getJobParameters().getString(OUTPUT_DIR_PARAM, DEFAULT_OUTPUT_DIR);

        Path outDir = Path.of(outputDir);
        log.info("开始生成 {} 级别样例数据，输出目录: {}", level, outDir.toAbsolutePath());
        switch (level) {
            case "minimal" -> {
                MinimalDataGenerator.writeTo(outDir);
                log.info("已生成 minimal 样例数据文件: {}", outDir.resolve(MinimalDataGenerator.FILE_NAME));
            }
            case "basic" -> {
                BasicDataGenerator.writeTo(outDir);
                BasicBatchMetaGenerator.writeTo(outDir);
                log.info("已生成 basic 样例数据文件: {}", outDir.resolve(BasicDataGenerator.FILE_NAME));
                log.info("已生成 basic 批处理元数据文件: {}", outDir.resolve(BasicBatchMetaGenerator.FILE_NAME));
            }
            default -> throw new IllegalArgumentException(
                    "Unsupported sample level: '" + level + "'. Expected 'minimal' or 'basic'.");
        }
        log.info("样例数据生成完成。");
        return RepeatStatus.FINISHED;
    }
}
