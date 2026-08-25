package com.otcc.viewer.cli;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import picocli.CommandLine;

/**
 * Runs the picocli {@link SampleDataCommand} with the application's
 * command-line arguments instead of relying on Gradle / Spring Batch
 * job-parameter conventions.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class SampleDataCommandLineRunner implements CommandLineRunner {
    private final SampleDataCommand command;
    private final GenerateCommand generateCommand;

    @Override
    public void run(String... args) {
        CommandLine commandLine = new CommandLine(command);
        commandLine.setCaseInsensitiveEnumValuesAllowed(true);
        // 允许 Spring Boot 自身的命令行属性（如 --spring.profiles.active=prod）与 picocli 共存
        commandLine.setUnmatchedArgumentsAllowed(true);
        // 子命令作为 Spring bean 注入，便于依赖 JobLauncher / JobResolver
        commandLine.addSubcommand(new CommandLine(generateCommand));
        int exitCode = commandLine.execute(args);
        if (exitCode != CommandLine.ExitCode.OK) {
            log.error("命令执行失败，退出码: {}", exitCode);
            System.exit(exitCode);
        }
    }
}
