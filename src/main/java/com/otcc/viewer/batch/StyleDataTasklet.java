package com.otcc.viewer.batch;

import com.otcc.viewer.generator.SampleDataGenerator;
import com.otcc.viewer.generator.SampleDataGeneratorRegistry;
import com.otcc.viewer.generator.SampleStyle;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.batch.core.StepContribution;
import org.springframework.batch.core.scope.context.ChunkContext;
import org.springframework.batch.core.step.tasklet.Tasklet;
import org.springframework.batch.repeat.RepeatStatus;
import org.springframework.stereotype.Component;
import java.nio.file.Path;

/**
 * Style-based generation tasklet: selects a {@link SampleDataGenerator} by the
 * {@code style} job parameter and generates style-suffixed files
 * (for example {@code report-validation-data-basic.json}).
 *
 * <p>Optional job parameter {@code reportDate} restricts the generated content
 * to that report date.</p>
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class StyleDataTasklet implements Tasklet {
    public static final String STYLE_PARAM = "style";
    public static final String REPORT_DATE_PARAM = "reportDate";
    public static final String OUTPUT_DIR_PARAM = "outputDir";
    private static final String DEFAULT_STYLE = "minimal";
    private static final String DEFAULT_OUTPUT_DIR = "generated";
    private final SampleDataGeneratorRegistry registry;

    @Override
    public RepeatStatus execute(StepContribution contribution, ChunkContext chunkContext) throws Exception {
        String styleName = chunkContext.getStepContext().getStepExecution().getJobParameters().getString(STYLE_PARAM, DEFAULT_STYLE);
        String reportDate = chunkContext.getStepContext().getStepExecution().getJobParameters().getString(REPORT_DATE_PARAM);
        String outputDir = chunkContext.getStepContext().getStepExecution().getJobParameters().getString(OUTPUT_DIR_PARAM, DEFAULT_OUTPUT_DIR);
        SampleStyle style = SampleStyle.valueOf(styleName.toLowerCase());
        SampleDataGenerator generator = registry.get(style);
        Path outDir = Path.of(outputDir);
        log.info("开始生成 {} 风格样例数据，报告日期: {}，输出目录: {}", style, reportDate == null ? "默认" : reportDate, outDir.toAbsolutePath());
        generator.generate(outDir, reportDate);
        log.info("{} 风格样例数据生成完成: {}", style, outDir.toAbsolutePath());
        return RepeatStatus.FINISHED;
    }
}
