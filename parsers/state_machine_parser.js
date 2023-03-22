const { ExpressionStatement, Script } = require('shift-ast');
const { reduce } = require('shift-reducer');
const unminify = require('unminify');

const { SwitchReducer } = require('../reducers/switch-reducer')
const { MapMonad } = require('../reducers/monads');

const globals = require('../helpers/globals')
const { binexpr_eval} = require('../helpers/expr-eval')

class StateMachineParser {
	// ast: The abstract syntax tree of a function (not function body, the function itself)
	// bitwise_identifiers: an array of identifiers (strings) on which the nested switching is performed upon
	// next_state_eval: the string used to evaluate how the state mashine switches. Generated by preprocessor.switch_structure_analyzer
	constructor(ast, bitwise_identifiers, next_state_eval) {
		// Parse the ast into nested Maps
		this.source_map = MapMonad.toMap( reduce(new SwitchReducer, ast) );
		this.bitwise_identifiers = bitwise_identifiers;
		this.eval = next_state_eval;
	}

	// Virtually traverses switch-cases and conditionals to return the statement(s) that would be executed in collina
	get(state) {

		// Extract code from functions, if required.
		// Every case "block" might be of 2 kinds:
		//	- list with two elements: first element is a CallExpression, second is a BreakStatement
		//		=> return function body, discard break
		//	- list with multiple elements
		//		=> return the list as is (removing BreakStatements, which are relevant only to the obfuscated code)
		function extract_code(stat_list) {
			if (
				(
					stat_list.length == 2 && stat_list[1].type === 'BreakStatement' ||
					stat_list.length == 1 // Last case has no closing "break"
				) &&
				stat_list[0].type === 'ExpressionStatement' &&
				stat_list[0].expression.type === 'UnaryExpression' && stat_list[0].expression.operator === '!' &&
				stat_list[0].expression.operand.type === 'CallExpression' &&
				stat_list[0].expression.operand.callee.type === 'FunctionExpression'
			) {
				return stat_list[0].expression.operand.callee.body.statements;
			} else {
				return stat_list.filter(statement => statement.type != "BreakStatement");
			}
		}

		let eval_result = eval(this.eval.replace(globals.DUMMY_NODE_ID, state));
		globals.VERBOSE && console.log("state:", state, "switches", eval_result);

		let map = this.source_map;
		let case_body, statements;

		let i = 0;
		let switch_val = 31 & state;
		let switch_identifier = this.bitwise_identifiers[i];
		while (map instanceof Map) {
			map = map.get(switch_val);

			if (map === undefined) {
				throw new Error(`Couldn't locate required state ${state}`);
			}

			i += 2;
			switch_val = eval_result[i];
			switch_identifier = this.bitwise_identifiers[i];
		}

		case_body = extract_code(map);

		if ( case_body.length === 1 && (case_body[0].type == "IfStatement" || case_body[0].type == "ExpressionStatement") ) {
			let executed = _execute_conditionals(case_body[0], switch_identifier, switch_val);
			if (executed === undefined) {
				throw new Error(`Got undefined when executing conditionals on state ${state} with switches ${eval_result}`);
			} else if (Array.isArray(executed)) {
				statements = executed;
			} else {
				statements = [
					new ExpressionStatement({
						expression: executed,
					})
				]; // Wrap in an array
			}
		} else {
			statements = case_body;
		}

		let stub_script = new Script ({ // unminifyTree accepts a script object
			type: 'Script',
			directives: [],
			statements: statements,
		});
		let unminified = unminify.unminifyTree(stub_script);

		if (unminified.statements === undefined) {
			throw new Error("Unminified tree statements are undefined");
		} else if (!Array.isArray(unminified.statements)) {
			throw new Error("Unminified tree statements are not an array");
		}

		return unminified.statements;
	}

}

// Recursively solve nested ifs/ternaries
// Limitations: every condition must be checked against the same static value (switch_identifier)
function _execute_conditionals(expr, switch_identifier, switch_value) {
	// TODO rewrite this as a reducer

	// Given a list of statements, if the list is composed of only one BlockStatement, return the body, else return the same list
	function _extract_block(expr) {
		if (
			expr.type === 'BlockStatement' &&
			expr.block.type === 'Block' &&
			expr.block.statements.length > 0
		) {
			return expr.block.statements;
		} else {
			return expr;
		}
	}

	// Returns either literal's value or switch_value value if that's the identifier
	// Limitations: can't return any identifier value other than switch_identifier
	function get_operand(operand, switch_identifier, switch_value) {
		if (operand === undefined) {
			return undefined;
		} else if (operand.type == 'IdentifierExpression') {
			if (operand.name == switch_identifier) {
				return switch_value;
			} else {
				// Possibly testing against an identifier, return undefined and the caller will handle this
				return undefined;
			}
		} else if (operand.type == 'LiteralNumericExpression') {
			return operand.value;
		} else if (operand.type == 'StaticMemberExpression') {
			// e.g. next_state = Qn < En.length ? 6885 : 19936;
			return undefined; // Can't assume anything about an object's property
		} else {
			globals.VERBOSE && console.log(`WARNING: unsupported operand type ${operand.type}`)
			return undefined;
		}
	}

	// Evaluates binary expression
	// Returns undefined when either
	//  - it's impossible to statically evaluate an expression: e.g.
	//		`V < st.length ? 16769 : 25923;` (we have no prior knowledge about V or st.lenght)
	//  - the expression tests again an unknown operator (which *should* never happen)
	function check_binary_expression(expr, switch_identifier, switch_value) {
		let left = get_operand(expr.left, switch_identifier, switch_value)
		let right = get_operand(expr.right, switch_identifier, switch_value)
		let operator = expr.operator

		if (left === undefined || right === undefined) {
			return undefined;
		} else if (operator in binexpr_eval === false) {
			console.log(`ERROR: unsupported operator ${operator} in ternary`)
			return undefined;
		} else {
			return binexpr_eval[operator](left, right)
		}
	}

	expr = _extract_block(expr);

	if (expr.type == "ExpressionStatement") {
		let value = _execute_conditionals(expr.expression, switch_identifier, switch_value);
		if (value === undefined) {
			return expr;
		} else {
			return value;
		}
	} else if (expr.type == "IfStatement" || expr.type == "ConditionalExpression") { // If or ternary operator
		let value = check_binary_expression(expr.test, switch_identifier, switch_value);
		if (value === undefined) {
			return expr;
		} else if (value === true) {
			return _execute_conditionals(expr.consequent, switch_identifier, switch_value);
		} else if (value === false) {
			return _execute_conditionals(expr.alternate, switch_identifier, switch_value);
		}
	} else if (expr.type == "AssignmentExpression" && expr.expression.type == 'ConditionalExpression') {
		// e.g. next_state = 24 > inner_switch ? U ? 16454 : 24802 : Qo ? 13314 : 5221;
		// In this case we should override the assignment with the appropriate part of the composed conditional
		let copy_expr = {...expr} // This object will be modified, make a local copy
		let cond_expr = expr.expression;
		let value = check_binary_expression(cond_expr.test, switch_identifier, switch_value);
		if (value === undefined) {
			return expr;
		} else if (value === true) {
			copy_expr.expression = _execute_conditionals(cond_expr.consequent, switch_identifier, switch_value);
		} else if (value === false) {
			copy_expr.expression = _execute_conditionals(cond_expr.alternate, switch_identifier, switch_value);
		}
		return copy_expr;
	} else if (expr.type == "BinaryExpression" && expr.operator == "&&") {
		// e.g. inner_switch > 0 && (To++, next_state = 16128);
		// In this case we should check the left operand (a binary) and return the right operator if left can be statically determined to be true
		let left_value = check_binary_expression(expr.left, switch_identifier, switch_value);
		if (left_value === true) {
			return expr.right;
		} else {
			return expr
		}
	} else { // Actual expression (might be an array of statements as well)
		return expr
	}
}

module.exports.StateMachineParser = StateMachineParser;
