package com.otcc.viewer.cli;

import com.otcc.viewer.batch.BatchJobResolver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.batch.core.BatchStatus;
import org.springframework.batch.core.Job;
import org.springframework.batch.core.JobExecution;
import org.springframework.batch.core.JobParameters;
import org.springframework.batch.core.JobParametersBuilder;
import org.springframework.batch.core.JobParametersIncrementer;
import org.springframework.batch.core.launch.JobLauncher;
import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import java.util.concurrent.Callable;

/**
 * Root picocli command: launches a Spring Batch job selected via {@code --job}.
 * Linux-style options ({@code --level}, {@code --output-dir}, {@code --no-run}).
 */
@Component
@Command(name = "ccp-report", mixinStandardHelpOptions = true, version = "ccp-report 0.1.0", description = "Generate CCP report validation sample data through Spring Batch jobs.")
@Slf4j
@RequiredArgsConstructor
public class SampleDataCommand implements Callable<Integer> {
    private final JobLauncher jobLauncher;
    private final BatchJobResolver jobResolver;
    @Option(names = {"-j", "--job"}, defaultValue = "sampleDataJob", description = "Job to run: sampleDataJob | styleDataJob | validationJsonJob | helloWorldJob (default: ${DEFAULT-VALUE}).")
    private String jobName;
    @Option(names = {"-l", "--level"}, defaultValue = "minimal", description = "Sample data level: ${COMPLETION-CANDIDATES} (default: ${DEFAULT-VALUE}).")
    private SampleLevel level;
    @Option(names = {"-o", "--output-dir"}, defaultValue = "generated", description = "Output directory for the generated JSON files (default: ${DEFAULT-VALUE}).")
    private String outputDir;
    @Option(names = {"-m", "--mode"}, defaultValue = "single", description = "Data output mode for validationJsonJob: single | multi (default: ${DEFAULT-VALUE}).")
    private String mode;
    @Option(names = {"-r", "--run"}, negatable = true, fallbackValue = "true", defaultValue = "true", description = "Launch the batch job. Use --no-run to only parse/validate options (default: ${DEFAULT-VALUE}).")
    private boolean run;

    @Override
    public Integer call() throws Exception {
        if (!run) {
            log.info("已跳过任务执行（--no-run），未启动批处理任务。");
            return 0;
        }
        Job job = jobResolver.resolve(jobName);
        log.info("启动批处理任务: job={}, level={}, mode={}, outputDir={}", jobName, level, mode, outputDir);
        JobParameters parameters = new JobParametersBuilder()
                .addString("level", level.name())
                .addString("mode", mode)
                .addString("outputDir", outputDir)
                .toJobParameters();
        JobParametersIncrementer incrementer = job.getJobParametersIncrementer();
        if (incrementer != null) {
            parameters = incrementer.getNext(parameters);
        }
        JobExecution execution = jobLauncher.run(job, parameters);
        if (execution.getStatus() == BatchStatus.COMPLETED) {
            log.info("批处理任务执行完成，状态: {}", execution.getStatus());
            return 0;
        }
        log.error("批处理任务执行失败，状态: {}，退出码: {}", execution.getStatus(), execution.getExitStatus().getExitCode());
        return 1;
    }
}
