package com.otcc.viewer.batch;

import org.springframework.batch.core.Job;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Resolves Spring Batch jobs by name. All {@link Job} beans are discovered
 * automatically, so registering a new job only requires defining a new
 * {@code Job} bean.
 */
@Component
public class BatchJobResolver {

    private final Map<String, Job> jobsByName;

    public BatchJobResolver(List<Job> jobs) {
        this.jobsByName = jobs.stream()
                .collect(Collectors.toMap(Job::getName, Function.identity(), (a, b) -> a));
    }

    /** Resolves a job by name, throwing a descriptive error when unknown. */
    public Job resolve(String name) {
        Job job = jobsByName.get(name);
        if (job == null) {
            throw new IllegalArgumentException(
                    "Unknown job: '" + name + "'. Available jobs: " + jobsByName.keySet());
        }
        return job;
    }
}
