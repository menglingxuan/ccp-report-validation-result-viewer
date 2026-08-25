package com.otcc.tmp;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** Parses and compiles safe field-based boolean expressions. */
public final class ExpressionEvaluator {
    public static final int MAX_EXPRESSION_LENGTH = 256;
    public static final int MAX_PARENTHESES_DEPTH = 5;
    public static final int MAX_IN_VALUES = 8;
    public static final int MAX_FUNCTION_CHAIN_LENGTH = 5;

    private ExpressionEvaluator() { }

    /** Compiles once, then evaluates repeatedly through {@link CompiledExpression}. */
    public static CompiledExpression compile(String expression) {
        Objects.requireNonNull(expression, "expression must not be null");
        if (expression.length() > MAX_EXPRESSION_LENGTH) {
            throw new IllegalArgumentException("Expression exceeds the maximum length of " + MAX_EXPRESSION_LENGTH + " characters");
        }
        return new CompiledExpression(expression, new Parser(expression).parse());
    }

    /** Convenience method for one-off evaluation. Field values must be strings. */
    public static boolean evaluate(String expression, Map<String, String> fields) {
        return compile(expression).evaluate(fields);
    }

    public static final class CompiledExpression {
        private final String source;
        private final BooleanExpression root;

        private CompiledExpression(String source, BooleanExpression root) {
            this.source = source;
            this.root = root;
        }

        public String getSource() { return source; }

        public boolean evaluate(Map<String, String> fields) { return evaluate(fields, null); }

        public boolean evaluate(Map<String, String> fields, ExpressionEvaluationInfo info) {
            Objects.requireNonNull(fields, "fields must not be null");
            if (info != null) info.reset();
            try {
                boolean result = root.evaluate(fields, info);
                if (info != null) info.complete(result);
                return result;
            } catch (RuntimeException exception) {
                if (info != null) info.fail(exception.getMessage());
                throw exception;
            }
        }
    }

    private interface BooleanExpression { boolean evaluate(Map<String, String> fields, ExpressionEvaluationInfo info); }
    private interface ValueExpression { String evaluate(Map<String, String> fields, ExpressionEvaluationInfo info); }

    private record FieldValue(String name, List<StringFunction> functions) implements ValueExpression {
        public String evaluate(Map<String, String> fields, ExpressionEvaluationInfo info) {
            if (!fields.containsKey(name)) throw new IllegalArgumentException("Unknown field [" + name + "]");
            String value = fields.get(name);
            if (value == null) throw new IllegalArgumentException("Field [" + name + "] must contain a non-null string");
            trace(info, "[" + name + "] = " + quote(value));
            for (StringFunction function : functions) value = function.apply(value, info);
            return value;
        }
    }

    private record StringFunction(String name, List<String> arguments, Pattern pattern) {
        String apply(String value, ExpressionEvaluationInfo info) {
            String result = switch (name) {
                case "upper" -> value.toUpperCase(Locale.ROOT);
                case "lower" -> value.toLowerCase(Locale.ROOT);
                case "trim" -> value.trim();
                case "substring" -> substring(value);
                case "aslistGet" -> listGet(value);
                case "contains" -> Boolean.toString(value.contains(arguments.getFirst()));
                case "startsWith" -> Boolean.toString(value.startsWith(arguments.getFirst()));
                case "endsWith" -> Boolean.toString(value.endsWith(arguments.getFirst()));
                case "isEmpty" -> Boolean.toString(value.isEmpty());
                case "isBlank" -> Boolean.toString(value.isBlank());
                case "length" -> Integer.toString(value.length());
                case "matches" -> Boolean.toString(pattern.matcher(value).matches());
                default -> throw new IllegalStateException("Unsupported string function: " + name);
            };
            trace(info, name + "(" + arguments + ") -> " + quote(result));
            return result;
        }

        private String substring(String value) {
            int begin = Integer.parseInt(arguments.getFirst());
            return arguments.size() == 1 ? value.substring(begin)
                    : value.substring(begin, Integer.parseInt(arguments.get(1)));
        }

        private String listGet(String value) {
            String[] parts = value.split(Pattern.quote(arguments.getFirst()), -1);
            int index = Integer.parseInt(arguments.get(1));
            if (index < 0 || index >= parts.length) {
                throw new IllegalArgumentException("aslist(...).get(" + index
                        + ") is outside the list bounds 0.." + (parts.length - 1));
            }
            return parts[index];
        }
    }

    private record BooleanValue(ValueExpression value) implements BooleanExpression {
        public boolean evaluate(Map<String, String> fields, ExpressionEvaluationInfo info) {
            String result = value.evaluate(fields, info);
            if (!"true".equals(result) && !"false".equals(result)) throw new IllegalArgumentException("Standalone field expression must evaluate to a boolean, but was " + quote(result));
            return Boolean.parseBoolean(result);
        }
    }

    private record Comparison(ValueExpression left, Operator operator, String first, String second, List<String> values) implements BooleanExpression {
        public boolean evaluate(Map<String, String> fields, ExpressionEvaluationInfo info) {
            String actual = left.evaluate(fields, info);
            boolean result = switch (operator) {
                case EQUAL -> equal(actual, first); case NOT_EQUAL -> !equal(actual, first);
                case GREATER_THAN -> compare(actual, first) > 0; case LESS_THAN -> compare(actual, first) < 0;
                case GREATER_THAN_OR_EQUAL -> compare(actual, first) >= 0; case LESS_THAN_OR_EQUAL -> compare(actual, first) <= 0;
                case BETWEEN -> compare(actual, first) >= 0 && compare(actual, second) <= 0;
                case IN -> values.contains(actual);
            };
            trace(info, operator + "(" + quote(actual) + ") -> " + result);
            return result;
        }
    }
    private record Binary(BooleanExpression left, BooleanExpression right, boolean and) implements BooleanExpression {
        public boolean evaluate(Map<String, String> fields, ExpressionEvaluationInfo info) {
            boolean leftResult = left.evaluate(fields, info);
            if (and && !leftResult) { trace(info, "AND short-circuit -> false"); return false; }
            if (!and && leftResult) { trace(info, "OR short-circuit -> true"); return true; }
            boolean result = right.evaluate(fields, info);
            trace(info, (and ? "AND" : "OR") + " -> " + result);
            return result;
        }
    }
    private record Not(BooleanExpression expression) implements BooleanExpression {
        public boolean evaluate(Map<String, String> fields, ExpressionEvaluationInfo info) { boolean result = !expression.evaluate(fields, info); trace(info, "NOT -> " + result); return result; }
    }
    private enum Operator { EQUAL, NOT_EQUAL, GREATER_THAN, LESS_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN_OR_EQUAL, BETWEEN, IN }

    private static boolean equal(String left, String right) { return numbers(left, right) ? decimal(left).compareTo(decimal(right)) == 0 : left.equals(right); }
    private static int compare(String left, String right) { return numbers(left, right) ? decimal(left).compareTo(decimal(right)) : left.compareTo(right); }
    private static boolean numbers(String left, String right) { return isNumber(left) && isNumber(right); }
    private static boolean isNumber(String value) { try { decimal(value); return true; } catch (NumberFormatException ignored) { return false; } }
    private static BigDecimal decimal(String value) { return new BigDecimal(value); }
    private static String quote(String value) { return "'" + value + "'"; }
    private static void trace(ExpressionEvaluationInfo info, String message) { if (info != null) info.addStep(message); }
    private static String positioned(String source, String message, int position) {
        int safePosition = Math.max(0, Math.min(position, source.length()));
        return message + " at character " + (safePosition + 1) + System.lineSeparator()
                + source + System.lineSeparator() + " ".repeat(safePosition) + "^";
    }

    private static final class Parser {
        private final String source;
        private final Lexer lexer;
        private Token current;

        Parser(String input) {
            source = input;
            lexer = new Lexer(input);
            current = lexer.next();
        }

        BooleanExpression parse() {
            BooleanExpression result = or(0);
            expect(TokenType.EOF, "Unexpected token after expression");
            return result;
        }

        BooleanExpression or(int depth) {
            BooleanExpression result = and(depth);
            while (match(TokenType.OR)) result = new Binary(result, and(depth), false);
            return result;
        }

        BooleanExpression and(int depth) {
            BooleanExpression result = unary(depth);
            while (match(TokenType.AND)) result = new Binary(result, unary(depth), true);
            return result;
        }

        BooleanExpression unary(int depth) {
            if (match(TokenType.NOT) || match(TokenType.BANG)) return new Not(unary(depth));
            if (match(TokenType.LEFT_PAREN)) {
                if (depth == MAX_PARENTHESES_DEPTH) throw error("Maximum parentheses nesting depth is " + MAX_PARENTHESES_DEPTH);
                BooleanExpression result = or(depth + 1);
                expect(TokenType.RIGHT_PAREN, "Expected ')' to close grouped expression");
                return result;
            }
            return comparison();
        }

        BooleanExpression comparison() {
            Token field = expect(TokenType.FIELD, "Expected a field reference such as [Field Name]");
            List<StringFunction> functions = new ArrayList<>();
            while (match(TokenType.DOT)) {
                if (functions.size() == MAX_FUNCTION_CHAIN_LENGTH) throw error("Maximum function chain length is " + MAX_FUNCTION_CHAIN_LENGTH);
                functions.add(function());
            }
            FieldValue left = new FieldValue(field.text, List.copyOf(functions));
            if (current.type == TokenType.AND || current.type == TokenType.OR || current.type == TokenType.RIGHT_PAREN || current.type == TokenType.EOF) return new BooleanValue(left);
            Operator operator = operator();
            if (operator == Operator.BETWEEN) {
                String lower = value(false);
                expect(TokenType.AND, "Expected 'and' between bounds");
                return new Comparison(left, operator, lower, value(false), List.of());
            }
            if (operator == Operator.IN) return new Comparison(left, operator, null, null, values());
            return new Comparison(left, operator, value(false), null, List.of());
        }

        StringFunction function() {
            Token token = expect(TokenType.IDENTIFIER, "Expected function name after '.'");
            String normalized = token.text.toLowerCase(Locale.ROOT);
            expect(TokenType.LEFT_PAREN, "Expected '(' after function name");

            List<String> arguments = switch (normalized) {
                case "upper", "lower", "trim", "isempty", "isblank", "length" -> {
                    expect(TokenType.RIGHT_PAREN, token.text + "() accepts no arguments");
                    yield List.of();
                }
                case "contains", "startswith", "endswith", "matches" -> {
                    String result = value(true);
                    expect(TokenType.RIGHT_PAREN, "Expected ')' after " + token.text + "() argument");
                    yield List.of(result);
                }
                case "substring" -> substringArguments(token);
                case "aslist" -> asListGetArguments();
                default -> throw error("Unsupported string function '" + token.text + "'");
            };

            Pattern pattern = null;
            if (normalized.equals("matches")) try { pattern = Pattern.compile(arguments.getFirst()); } catch (PatternSyntaxException ex) { throw error("Invalid matches() regular expression: " + ex.getDescription()); }

            String name = switch (normalized) {
                case "isempty" -> "isEmpty";
                case "isblank" -> "isBlank";
                case "startswith" -> "startsWith";
                case "endswith" -> "endsWith";
                case "aslist" -> "aslistGet";
                default -> normalized;
            };
            return new StringFunction(name, arguments, pattern);
        }

        Operator operator() {
            Token token = current;
            advance();
            return switch (token.type) {
                case EQUAL -> Operator.EQUAL;
                case NOT_EQUAL -> Operator.NOT_EQUAL;
                case GREATER_THAN -> Operator.GREATER_THAN;
                case LESS_THAN -> Operator.LESS_THAN;
                case GREATER_THAN_OR_EQUAL -> Operator.GREATER_THAN_OR_EQUAL;
                case LESS_THAN_OR_EQUAL -> Operator.LESS_THAN_OR_EQUAL;
                case BETWEEN -> Operator.BETWEEN;
                case IN -> Operator.IN;
                default -> throw error("Expected comparison operator, found '" + token.text + "'");
            };
        }

        List<String> values() {
            expect(TokenType.LEFT_BRACE, "Expected '{' after 'in'");
            List<String> result = new ArrayList<>();
            if (!match(TokenType.RIGHT_BRACE)) {
                do {
                    if (result.size() == MAX_IN_VALUES) throw error("Maximum 'in' list size is " + MAX_IN_VALUES);
                    result.add(inValue());
                } while (match(TokenType.COMMA));
                expect(TokenType.RIGHT_BRACE, "Expected '}' to close 'in' values");
            }
            return List.copyOf(result);
        }

        List<String> substringArguments(Token function) {
            String begin = integerValue(function.text + "() requires an integer start index");
            if (match(TokenType.RIGHT_PAREN)) return List.of(begin);
            expect(TokenType.COMMA, "Expected ',' or ')' after substring() start index");
            String end = integerValue("substring() requires an integer end index");
            expect(TokenType.RIGHT_PAREN, "Expected ')' after substring() end index");
            return List.of(begin, end);
        }

        List<String> asListGetArguments() {
            String separator = value(true);
            expect(TokenType.RIGHT_PAREN, "Expected ')' after aslist() separator");
            expect(TokenType.DOT, "aslist() must be followed by .get(index)");
            Token get = expect(TokenType.IDENTIFIER, "Expected get(index) after aslist()");
            if (!"get".equalsIgnoreCase(get.text)) throw error("aslist() must be followed by .get(index)", get.position);
            expect(TokenType.LEFT_PAREN, "Expected '(' after get");
            String index = integerValue("get() requires a non-negative integer index");
            if (index.startsWith("-")) throw error("get() requires a non-negative integer index");
            expect(TokenType.RIGHT_PAREN, "Expected ')' after get() index");
            return List.of(separator, index);
        }

        String inValue() {
            Token token = current;
            advance();
            if (token.type == TokenType.STRING) return token.text;
            if (token.type == TokenType.NUMBER && token.text.matches("-?\\d+")) return token.text;
            throw error("Expected a quoted string or integer value in 'in'", token.position);
        }

        String integerValue(String message) {
            Token token = expect(TokenType.NUMBER, message);
            if (!token.text.matches("-?\\d+")) throw error(message, token.position);
            return token.text;
        }

        String value(boolean stringOnly) {
            Token token = current;
            advance();
            if (token.type == TokenType.STRING) return token.text;
            if (!stringOnly && (token.type == TokenType.NUMBER || token.type == TokenType.IDENTIFIER)) return token.text;
            throw error(stringOnly ? "Expected a quoted string value" : "Expected a string or number value, found '" + token.text + "'", token.position);
        }

        boolean match(TokenType type) {
            if (current.type != type) return false;
            advance();
            return true;
        }

        Token expect(TokenType type, String message) {
            if (current.type != type) throw error(message + ", found '" + current.text + "'", current.position);
            Token result = current;
            advance();
            return result;
        }

        void advance() { current = lexer.next(); }

        IllegalArgumentException error(String message) { return error(message, current.position); }
        IllegalArgumentException error(String message, int position) { return new IllegalArgumentException(positioned(source, message, position)); }
    }

    private static final class Lexer {
        private final String input;
        private int index;

        Lexer(String input) { this.input = input; }

        Token next() {
            skip();
            if (index >= input.length()) return new Token(TokenType.EOF, "<end>", index);
            int start = index;
            char c = input.charAt(index++);
            return switch (c) {
                case '[' -> field(start);
                case '\'', '"' -> string(start, c);
                case '(' -> token(TokenType.LEFT_PAREN, start);
                case ')' -> token(TokenType.RIGHT_PAREN, start);
                case '{' -> token(TokenType.LEFT_BRACE, start);
                case '}' -> token(TokenType.RIGHT_BRACE, start);
                case ',' -> token(TokenType.COMMA, start);
                case '.' -> token(TokenType.DOT, start);
                case '=' -> token(TokenType.EQUAL, start);
                case '!' -> two('=', TokenType.NOT_EQUAL, TokenType.BANG, start);
                case '>' -> two('=', TokenType.GREATER_THAN_OR_EQUAL, TokenType.GREATER_THAN, start);
                case '<' -> two('=', TokenType.LESS_THAN_OR_EQUAL, TokenType.LESS_THAN, start);
                default -> {
                    if (Character.isDigit(c) || c == '-' && index < input.length() && Character.isDigit(input.charAt(index))) yield number(start);
                    if (Character.isLetter(c) || c == '_') yield identifier(start);
                    throw error("Unexpected character '" + c + "'", start);
                }
            };
        }

        Token field(int start) {
            int content = index;
            while (index < input.length() && input.charAt(index) != ']') index++;
            if (index == input.length()) throw error("Unterminated field reference", start);
            String name = input.substring(content, index++).trim();
            if (name.isEmpty()) throw error("Field reference must not be empty", start);
            return new Token(TokenType.FIELD, name, start);
        }

        Token string(int start, char quote) {
            StringBuilder value = new StringBuilder();
            while (index < input.length()) {
                char c = input.charAt(index++);
                if (c == quote) return new Token(TokenType.STRING, value.toString(), start);
                if (c == '\\' && index < input.length()) {
                    char escaped = input.charAt(index++);
                    value.append(switch (escaped) {
                        case '\'', '"', '\\' -> escaped;
                        case 'n' -> '\n';
                        case 'r' -> '\r';
                        case 't' -> '\t';
                        default -> throw error("Unsupported escape sequence \\" + escaped, index - 2);
                    });
                } else value.append(c);
            }
            throw error("Unterminated string literal", start);
        }

        Token number(int start) {
            while (index < input.length() && (Character.isDigit(input.charAt(index)) || input.charAt(index) == '.')) index++;
            String value = input.substring(start, index);
            if (!isNumber(value)) throw error("Invalid number '" + value + "'", start);
            return new Token(TokenType.NUMBER, value, start);
        }

        Token identifier(int start) {
            while (index < input.length() && (Character.isLetterOrDigit(input.charAt(index)) || input.charAt(index) == '_' || input.charAt(index) == '-')) index++;
            String value = input.substring(start, index);
            return switch (value.toLowerCase(Locale.ROOT)) {
                case "and" -> new Token(TokenType.AND, value, start);
                case "or" -> new Token(TokenType.OR, value, start);
                case "not" -> new Token(TokenType.NOT, value, start);
                case "between" -> new Token(TokenType.BETWEEN, value, start);
                case "in" -> new Token(TokenType.IN, value, start);
                default -> new Token(TokenType.IDENTIFIER, value, start);
            };
        }

        Token token(TokenType type, int start) { return new Token(type, input.substring(start, index), start); }
        Token two(char expected, TokenType two, TokenType one, int start) { if (index < input.length() && input.charAt(index) == expected) { index++; return token(two, start); } return token(one, start); }
        void skip() { while (index < input.length() && Character.isWhitespace(input.charAt(index))) index++; }
        IllegalArgumentException error(String message, int position) { return new IllegalArgumentException(positioned(input, message, position)); }
    }
    private record Token(TokenType type, String text, int position) { }
    private enum TokenType { FIELD, STRING, NUMBER, IDENTIFIER, EQUAL, NOT_EQUAL, GREATER_THAN, LESS_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN_OR_EQUAL, BANG, BETWEEN, IN, AND, OR, NOT, LEFT_PAREN, RIGHT_PAREN, LEFT_BRACE, RIGHT_BRACE, COMMA, DOT, EOF }
}