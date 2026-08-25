package com.otcc.tmp;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExpressionEvaluatorTest {
    private final Map<String, String> fields = Map.of(
            "Trade Id", "TRD-1001", "Amount", "-1.23", "Quantity", "2",
            "Name", "  AlphaBeta  ", "Empty", "", "Blank", " \t ", "Code", "IRS",
            "Csv", "alpha,beta,gamma");

    @Test
    void compilesOnceAndReusesTheExpression() {
        ExpressionEvaluator.CompiledExpression expression = ExpressionEvaluator.compile(
                "[Quantity] >= 2 and [Code] = 'IRS'");
        assertEquals("[Quantity] >= 2 and [Code] = 'IRS'", expression.getSource());
        assertTrue(expression.evaluate(fields));
        assertFalse(expression.evaluate(Map.of("Quantity", "1", "Code", "IRS")));
    }

    @Test
    void treatsIntegerAndDecimalStringsAsNumbersForComparisons() {
        assertTrue(ExpressionEvaluator.evaluate("[Quantity] = 2.0", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Amount] between -2 and -1.0", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Amount] < -1.2", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Code] > 'AAA'", fields));
        assertFalse(ExpressionEvaluator.evaluate("[Code] > 'ZZZ'", fields));
    }

    @Test
    void supportsStringsAndIntegersInInValues() {
        assertTrue(ExpressionEvaluator.evaluate("[Code] in {'CDS', \"IRS\"}", fields));
        assertFalse(ExpressionEvaluator.evaluate("[Code] in {'CDS'}", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Quantity] in {-2, 2, 3}", fields));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.compile("[Quantity] in {2.0}"));
    }

    @Test
    void evaluatesExtendedStringFunctionsAndStrictBooleanPredicates() {
        assertTrue(ExpressionEvaluator.evaluate("[Name].trim().upper() = 'ALPHABETA'", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Name].lower().contains('alphabeta')", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Name].startsWith('  Alpha') and [Name].endsWith('  ')", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Name].trim().length() = 9", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Name].trim().matches('Alpha[A-Z][a-z]+')", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Name].trim().substring(2, 5) = 'pha'", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Name].trim().substring(5) = 'Beta'", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Csv].aslist(',').get(1) = 'beta'", fields));
        assertTrue(ExpressionEvaluator.evaluate("[Empty].isEmpty() and [Blank].isBlank()", fields));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.evaluate("[Name].trim()", fields));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.compile("[Csv].aslist(',') = 'beta'"));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.evaluate("[Csv].aslist(',').get(3) = 'x'", fields));
    }

    @Test
    void collectsEvaluationStepsAndErrors() {
        ExpressionEvaluator.CompiledExpression expression = ExpressionEvaluator.compile(
                "[Name].trim().contains('Alpha') and [Quantity] = 2");
        ExpressionEvaluationInfo info = new ExpressionEvaluationInfo();
        assertTrue(expression.evaluate(fields, info));
        assertEquals(Boolean.TRUE, info.getResult());
        assertNull(info.getError());
        assertTrue(info.getSteps().stream().anyMatch(step -> step.contains("trim")));
        assertTrue(info.getSteps().stream().anyMatch(step -> step.contains("AND")));

        ExpressionEvaluationInfo failureInfo = new ExpressionEvaluationInfo();
        assertThrows(IllegalArgumentException.class,
                () -> expression.evaluate(Map.of("Name", "Alpha"), failureInfo));
        assertNull(failureInfo.getResult());
        assertNotNull(failureInfo.getError());
    }

    @Test
    void rejectsMissingFieldsAndComplexityLimitViolations() {
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.evaluate("[Missing] = 'x'", fields));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.compile("[Name].trim().lower().upper().trim().lower().upper() = 'x'"));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.compile("[Code] in {'1','2','3','4','5','6','7','8','9'}"));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.compile("(((((([Code] = 'IRS'))))))"));
        assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.compile("[Code] = '" + "x".repeat(250) + "'"));
    }

    @Test
    void rejectsLegacyComparisonBangAndProvidesPositionedSyntaxErrors() {
        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class,
                () -> ExpressionEvaluator.compile("[Code] ! 'IRS'"));
        assertTrue(exception.getMessage().contains("character"));
    }
}