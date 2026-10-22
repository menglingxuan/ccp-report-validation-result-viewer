package com.otcc.viewer.batch;

import org.springframework.batch.core.Job;
import org.springframework.batch.core.Step;
import org.springframework.batch.core.job.builder.JobBuilder;
import org.springframework.batch.core.launch.support.RunIdIncrementer;
import org.springframework.batch.core.repository.JobRepository;
import org.springframework.batch.core.step.builder.StepBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Spring Batch configuration: registers the sample-data generation job, the
 * style-based generation job and the full-dataset generation job.
 *
 * <p>Jobs do not run automatically on startup ({@code spring.batch.job.enabled=false});
 * they are launched explicitly by the picocli command-line runner.</p>
 */
@Configuration
public class SampleDataBatchConfiguration {

    /* ------------------------------------------------------------------ */
    /*  Legacy sample-data job (level: minimal | basic)                   */
    /* ------------------------------------------------------------------ */

    @Bean
    public Job sampleDataJob(JobRepository jobRepository, Step sampleDataStep) {
        return new JobBuilder("sampleDataJob", jobRepository)
                .incrementer(new RunIdIncrementer())
                .start(sampleDataStep)
                .build();
    }

    @Bean
    public Step sampleDataStep(JobRepository jobRepository,
                               PlatformTransactionManager transactionManager,
                               SampleDataTasklet sampleDataTasklet) {
        return new StepBuilder("sampleDataStep", jobRepository)
                .tasklet(sampleDataTasklet, transactionManager)
                .build();
    }

    /* ------------------------------------------------------------------ */
    /*  Style-based generation job                                        */
    /* ------------------------------------------------------------------ */

    @Bean
    public Job styleDataJob(JobRepository jobRepository, Step styleDataStep) {
        return new JobBuilder("styleDataJob", jobRepository)
                .incrementer(new RunIdIncrementer())
                .start(styleDataStep)
                .build();
    }

    @Bean
    public Step styleDataStep(JobRepository jobRepository,
                              PlatformTransactionManager transactionManager,
                              StyleDataTasklet styleDataTasklet) {
        return new StepBuilder("styleDataStep", jobRepository)
                .tasklet(styleDataTasklet, transactionManager)
                .build();
    }

    /* ------------------------------------------------------------------ */
    /*  Full dataset generation job (single | multi data mode)            */
    /* ------------------------------------------------------------------ */

    @Bean
    public Job validationJsonJob(JobRepository jobRepository, Step validationJsonStep) {
        return new JobBuilder("validationJsonJob", jobRepository)
                .incrementer(new RunIdIncrementer())
                .start(validationJsonStep)
                .build();
    }

    @Bean
    public Step validationJsonStep(JobRepository jobRepository,
                                   PlatformTransactionManager transactionManager,
                                   ValidationJsonTasklet validationJsonTasklet) {
        return new StepBuilder("validationJsonStep", jobRepository)
                .tasklet(validationJsonTasklet, transactionManager)
                .build();
    }
}
