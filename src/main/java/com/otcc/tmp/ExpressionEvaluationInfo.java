package com.otcc.tmp;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Collects a chronological trace of one compiled-expression evaluation. */
public final class ExpressionEvaluationInfo {
    private final List<String> steps = new ArrayList<>();
    private Boolean result;
    private String error;

    void reset() {
        steps.clear();
        result = null;
        error = null;
    }

    void addStep(String step) {
        steps.add(step);
    }

    void complete(boolean value) {
        result = value;
    }

    void fail(String message) {
        error = message;
    }

    /** Ordered descriptions of values, function calls, comparisons, and logical operations performed. */
    public List<String> getSteps() {
        return Collections.unmodifiableList(steps);
    }

    /** Final evaluation result, or {@code null} when evaluation failed. */
    public Boolean getResult() {
        return result;
    }

    /** Error message when evaluation failed, otherwise {@code null}. */
    public String getError() {
        return error;
    }
}
