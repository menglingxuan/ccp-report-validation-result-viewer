package com.otcc.viewer.batch;

import com.otcc.viewer.generator.DataMode;
import com.otcc.viewer.generator.ValidationJsonGenerator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.batch.core.StepContribution;
import org.springframework.batch.core.scope.context.ChunkContext;
import org.springframework.batch.core.step.tasklet.Tasklet;
import org.springframework.batch.repeat.RepeatStatus;
import org.springframework.stereotype.Component;

import java.nio.file.Path;

/**
 * Generates the complete viewer data set (data / config / ignore / batch index /
 * batch metadata) using {@link ValidationJsonGenerator}, selecting the output data
 * mode ({@code single} or {@code multi}) via the {@code mode} job parameter.
 */
@Component
@Slf4j
public class ValidationJsonTasklet implements Tasklet {
    /**
     * Job parameter name selecting the data output mode ({@code single} or {@code multi}).
     */
    public static final String MODE_PARAM = "mode";
    /**
     * Job parameter name for the output directory.
     */
    public static final String OUTPUT_DIR_PARAM = "outputDir";
    /**
     * Default output directory for the generated JSON files.
     */
    public static final String DEFAULT_OUTPUT_DIR = "generated";

    @Override
    public RepeatStatus execute(StepContribution contribution, ChunkContext chunkContext) throws Exception {
        String modeName = chunkContext.getStepContext().getStepExecution().getJobParameters().getString(MODE_PARAM, "single");
        String outputDir = chunkContext.getStepContext().getStepExecution().getJobParameters().getString(OUTPUT_DIR_PARAM, DEFAULT_OUTPUT_DIR);
        DataMode mode = DataMode.parse(modeName);
        Path outDir = Path.of(outputDir);
        log.info("开始生成完整样例数据，数据模式: {}，输出目录: {}", mode, outDir.toAbsolutePath());
        ValidationJsonGenerator.writeAll(outDir, mode);
        log.info("完整样例数据生成完成: {}", outDir.toAbsolutePath());
        return RepeatStatus.FINISHED;
    }
}
