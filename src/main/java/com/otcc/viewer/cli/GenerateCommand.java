package com.otcc.viewer.cli;

import com.otcc.viewer.batch.BatchJobResolver;
import com.otcc.viewer.generator.SampleStyle;
import lombok.extern.slf4j.Slf4j;
import org.springframework.batch.core.BatchStatus;
import org.springframework.batch.core.Job;
import org.springframework.batch.core.JobExecution;
import org.springframework.batch.core.JobParameters;
import org.springframework.batch.core.JobParametersBuilder;
import org.springframework.batch.core.JobParametersIncrementer;
import org.springframework.batch.core.launch.JobLauncher;
import org.springframework.stereotype.Component;
import picocli.CommandLine.ArgGroup;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Callable;

/**
 * {@code generate} subcommand: style-based data generation with date filtering.
 *
 * <p>Demonstrates two kinds of picocli argument groups:
 * <ul>
 *   <li>{@code DateSelection} — mutually exclusive ({@code --report-date} vs {@code --all-dates});</li>
 *   <li>{@code DateRange} — co-occurring ({@code --date-from} and {@code --date-to} must be used together).</li>
 * </ul></p>
 */
@Slf4j
@Component
@Command(name = "generate",
        mixinStandardHelpOptions = true,
        version = "ccp-report generate 0.1.0",
        description = "Generate sample data by style, optionally restricted to a report date or date range.")
public class GenerateCommand implements Callable<Integer> {

    private static final String STYLE_JOB = "styleDataJob";

    private final JobLauncher jobLauncher;
    private final BatchJobResolver jobResolver;

    @Option(names = {"-s", "--style"}, defaultValue = "minimal",
            description = "Sample style: ${COMPLETION-CANDIDATES} (default: ${DEFAULT-VALUE}).")
    private SampleStyle style;

    @Option(names = {"-o", "--output-dir"}, defaultValue = "generated",
            description = "Output directory for the generated JSON files (default: ${DEFAULT-VALUE}).")
    private String outputDir;

    @ArgGroup(exclusive = true, multiplicity = "0..1",
            heading = "%nDate selection (mutually exclusive):%n")
    private DateSelection dateSelection;

    @ArgGroup(exclusive = false, multiplicity = "0..1",
            heading = "%nDate range (options must be used together):%n")
    private DateRange dateRange;

    static class DateSelection {
        @Option(names = "--report-date",
                description = "Generate only this report date (yyyy-MM-dd).")
        String reportDate;

        @Option(names = "--all-dates",
                description = "Generate the default report date (no date filter).")
        boolean allDates;
    }

    static class DateRange {
        @Option(names = "--date-from", required = true,
                description = "Start date of the range, inclusive (yyyy-MM-dd).")
        String from;

        @Option(names = "--date-to", required = true,
                description = "End date of the range, inclusive (yyyy-MM-dd).")
        String to;
    }

    public GenerateCommand(JobLauncher jobLauncher, BatchJobResolver jobResolver) {
        this.jobLauncher = jobLauncher;
        this.jobResolver = jobResolver;
    }

    @Override
    public Integer call() throws Exception {
        Job job = jobResolver.resolve(STYLE_JOB);
        for (String date : resolveDates()) {
            launch(job, date);
        }
        return 0;
    }

    private List<String> resolveDates() {
        if (dateRange != null && dateSelection != null) {
            throw new IllegalArgumentException(
                    "--report-date/--all-dates cannot be combined with --date-from/--date-to.");
        }
        if (dateRange != null) {
            return rangeDates(dateRange.from, dateRange.to);
        }
        if (dateSelection != null && dateSelection.reportDate != null) {
            return List.of(dateSelection.reportDate);
        }
        // --all-dates or no date option: single run with the generator's default date.
        return Collections.singletonList(null);
    }

    private List<String> rangeDates(String from, String to) {
        try {
            LocalDate start = LocalDate.parse(from);
            LocalDate end = LocalDate.parse(to);
            if (end.isBefore(start)) {
                throw new IllegalArgumentException("--date-to must not be before --date-from: " + from + " .. " + to);
            }
            List<String> dates = new ArrayList<>();
            for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
                dates.add(d.toString());
            }
            return dates;
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("Invalid date (expected yyyy-MM-dd): " + e.getParsedString(), e);
        }
    }

    private void launch(Job job, String reportDate) throws Exception {
        JobParametersBuilder builder = new JobParametersBuilder()
                .addString("style", style.name())
                .addString("outputDir", outputDir);
        if (reportDate != null) {
            builder.addString("reportDate", reportDate);
        }
        JobParameters parameters = builder.toJobParameters();

        JobParametersIncrementer incrementer = job.getJobParametersIncrementer();
        if (incrementer != null) {
            parameters = incrementer.getNext(parameters);
        }

        log.info("启动 {} 任务: style={}, reportDate={}, outputDir={}",
                STYLE_JOB, style, reportDate == null ? "默认" : reportDate, outputDir);

        JobExecution execution = jobLauncher.run(job, parameters);
        if (execution.getStatus() != BatchStatus.COMPLETED) {
            throw new IllegalStateException("Job " + STYLE_JOB + " failed with status " + execution.getStatus());
        }
    }
}
