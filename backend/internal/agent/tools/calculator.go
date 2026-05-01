package tools

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/firebase/genkit/go/ai"
)

const CalculatorDescription = "Perform mathematical calculations. Supports basic arithmetic (+, -, *, /), powers (^), and common math functions (sqrt, abs, sin, cos, tan, log, ln). Input: {\"expression\": \"math expression\"}. Example: {\"expression\": \"2 + 3 * 4\"} or {\"expression\": \"sqrt(144)\"}"

func CalculatorFn(ctx *ai.ToolContext, input map[string]any) (map[string]any, error) {
	expr, _ := input["expression"].(string)
	if expr == "" {
		return map[string]any{"error": "expression is required"}, nil
	}

	result, err := evaluateExpression(expr)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}

	return map[string]any{
		"expression": expr,
		"result":     result,
	}, nil
}

func evaluateExpression(expr string) (float64, error) {
	expr = strings.TrimSpace(expr)
	expr = strings.ReplaceAll(expr, " ", "")

	if strings.HasPrefix(expr, "sqrt(") && strings.HasSuffix(expr, ")") {
		inner := expr[5 : len(expr)-1]
		val, err := evaluateExpression(inner)
		if err != nil {
			return 0, err
		}
		return math.Sqrt(val), nil
	}
	if strings.HasPrefix(expr, "abs(") && strings.HasSuffix(expr, ")") {
		inner := expr[4 : len(expr)-1]
		val, err := evaluateExpression(inner)
		if err != nil {
			return 0, err
		}
		return math.Abs(val), nil
	}
	if strings.HasPrefix(expr, "sin(") && strings.HasSuffix(expr, ")") {
		inner := expr[4 : len(expr)-1]
		val, err := evaluateExpression(inner)
		if err != nil {
			return 0, err
		}
		return math.Sin(val), nil
	}
	if strings.HasPrefix(expr, "cos(") && strings.HasSuffix(expr, ")") {
		inner := expr[4 : len(expr)-1]
		val, err := evaluateExpression(inner)
		if err != nil {
			return 0, err
		}
		return math.Cos(val), nil
	}
	if strings.HasPrefix(expr, "tan(") && strings.HasSuffix(expr, ")") {
		inner := expr[4 : len(expr)-1]
		val, err := evaluateExpression(inner)
		if err != nil {
			return 0, err
		}
		return math.Tan(val), nil
	}
	if strings.HasPrefix(expr, "log(") && strings.HasSuffix(expr, ")") {
		inner := expr[4 : len(expr)-1]
		val, err := evaluateExpression(inner)
		if err != nil {
			return 0, err
		}
		return math.Log10(val), nil
	}
	if strings.HasPrefix(expr, "ln(") && strings.HasSuffix(expr, ")") {
		inner := expr[3 : len(expr)-1]
		val, err := evaluateExpression(inner)
		if err != nil {
			return 0, err
		}
		return math.Log(val), nil
	}

	if idx := findOperator(expr, '+'); idx > 0 {
		left, err := evaluateExpression(expr[:idx])
		if err != nil {
			return 0, err
		}
		right, err := evaluateExpression(expr[idx+1:])
		if err != nil {
			return 0, err
		}
		return left + right, nil
	}
	if idx := findOperator(expr, '-'); idx > 0 {
		left, err := evaluateExpression(expr[:idx])
		if err != nil {
			return 0, err
		}
		right, err := evaluateExpression(expr[idx+1:])
		if err != nil {
			return 0, err
		}
		return left - right, nil
	}
	if idx := findOperator(expr, '*'); idx > 0 {
		left, err := evaluateExpression(expr[:idx])
		if err != nil {
			return 0, err
		}
		right, err := evaluateExpression(expr[idx+1:])
		if err != nil {
			return 0, err
		}
		return left * right, nil
	}
	if idx := findOperator(expr, '/'); idx > 0 {
		left, err := evaluateExpression(expr[:idx])
		if err != nil {
			return 0, err
		}
		right, err := evaluateExpression(expr[idx+1:])
		if err != nil {
			return 0, err
		}
		if right == 0 {
			return 0, fmt.Errorf("division by zero")
		}
		return left / right, nil
	}
	if idx := findOperator(expr, '^'); idx > 0 {
		left, err := evaluateExpression(expr[:idx])
		if err != nil {
			return 0, err
		}
		right, err := evaluateExpression(expr[idx+1:])
		if err != nil {
			return 0, err
		}
		return math.Pow(left, right), nil
	}

	val, err := strconv.ParseFloat(expr, 64)
	if err != nil {
		return 0, fmt.Errorf("cannot evaluate expression: %s", expr)
	}
	return val, nil
}

func findOperator(expr string, op byte) int {
	depth := 0
	for i := len(expr) - 1; i >= 0; i-- {
		if expr[i] == ')' {
			depth++
		} else if expr[i] == '(' {
			depth--
		}
		if depth == 0 && expr[i] == op {
			return i
		}
	}
	return -1
}
