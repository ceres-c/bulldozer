const { VariableDeclarationStatement, VariableDeclaration, VariableDeclarator, LiteralStringExpression, ExpressionStatement, ArrayExpression, IdentifierExpression, Script, BindingIdentifier, LiteralNumericExpression } = require('shift-ast');
const query = require('shift-query');
const codegen = require('../helpers/codegen');
const globals = require('../helpers/globals');

// Returns all the FunctionDeclaration objects for functions we need
function get_eligible_functions(ast) {
	let function_query = query(ast, 'FunctionDeclaration:has(ForStatement SwitchStatement)');
	if (function_query.length == 0) {
		throw new Error('Could not locate any state machine function')
	}
	return function_query;
}

// Analyze a function body to identify the variables and values used to execute the state machine
// Arguments:
//	- ast: the ast of the function to analyze (must start with a FunctionDeclaration node)
// Return an object with 3 properties:
//	- next_state_identifier: the name (string) of the variable used to address the next state
//	- init_state: the value (number) to which next_state_identifier is initialized
//	- stop_condition: the value (ast object) next_state_identifier is checked against every loop iteration to stop execution
//	- bitwise_identifiers: an array of variable names (strings), one for every switch variable. Same size as next_state_eval's result
//	- next_state_eval: a string representing the code which is executed at the beginning of every state machine iteration 
//					   which yields the bitwise logic required by internal switches. Evaluating it will result in an array
//					   suitable for searching the code related to a state.
//	NOTE: Must discard every odd positioned number in bitwise_identifiers and next_state_eval's result arrays as they're only used internally.
//		  e.g. [4, 531, 19, 16, 16] -> take [4, 19, 16]
function switch_structure_analyzer(ast) {
	let ret = {
		next_state_identifier: undefined,
		init_state: undefined,
		stop_condition: undefined,
		bitwise_identifiers: undefined,
		next_state_eval: '',
	}

	let name = ast.name.name;

	let prefix_1 = `FunctionDeclaration[name.name="${name}"] > FunctionBody > TryCatchStatement > Block`; // Outer functions have try-catch blocks
	let prefix_2 = `FunctionDeclaration[name.name="${name}"] > FunctionBody`; // Nested functions might not have try-catch
	let prefix, init_state_query;

	// Prefix detection and next state variable identifier
	let init_state_query_prefix_1 = query(ast, `${prefix_1} > ForStatement > VariableDeclaration > VariableDeclarator`);
	let init_state_query_prefix_2 = query(ast, `${prefix_2} > ForStatement > VariableDeclaration > VariableDeclarator`);
	if (init_state_query_prefix_1.length == 1 && init_state_query_prefix_2.length == 0) {
		prefix = prefix_1;
		init_state_query = init_state_query_prefix_1;
	} else if (init_state_query_prefix_1.length == 0 && init_state_query_prefix_2.length == 1) {
		prefix = prefix_2;
		init_state_query = init_state_query_prefix_2;
	} else {
		throw new Error(`While searching for init state, query 1 returned ${init_state_query_prefix_1.length} results and query 2 returned ${init_state_query_prefix_2.length} results`);
	}

	let next_state_identifier = init_state_query[0]?.binding?.name;
	if (next_state_identifier === undefined) {
		throw new Error("Variable declarator has no binding");
	}
	ret.next_state_identifier = next_state_identifier

	// Init state
	let init_state = init_state_query[0]?.init?.value;
	if (init_state === undefined) {
		throw new Error("Variable declarator has no init value");
	}
	ret.init_state = init_state;

	// Stop condition
	let for_loops = query(ast, `${prefix} > ForStatement`);
	if (for_loops.length != 1) {
		throw new Error(`Found ${for_loops.length} in function ${name} instead of exactly 1`);
	}
	let for_loop_test = for_loops[0].test;
	if (for_loop_test === undefined) {
		// TODO Maybe set some safe default instead of throwing?
		throw new Error("For loop has no test condition");
	}
	ret.stop_condition = for_loop_test.left; // HACK assuming stop is on the left side, but there are no guarantees about this

	// Switches bitwise identifiers
	let declar_stat = query(ast, `${prefix} > ForStatement > BlockStatement > Block > VariableDeclarationStatement`);
	let declarators = query(ast, `${prefix} > ForStatement > BlockStatement > Block > VariableDeclarationStatement[declaration] > [declarators]`);
	if (declar_stat.length == 0) {
		throw new Error(`Could not find switch variables declaration statement.`);
	}
	ret.bitwise_identifiers = declarators[0].declarators.map( d => d.binding.name );

	// Eval string (e.g. 'var bs = 3131746989;var ks = 31 & bs, is = bs >> 5, os = 31 & is, ts = is >> 5, ns = 31 & ts;\n[ks, is, os, ts, ns];')
	eval_statements = [
		new VariableDeclarationStatement({
			declaration: new VariableDeclaration({
				kind: "var",
				declarators: [
					new VariableDeclarator({
						binding: new BindingIdentifier({
							name: next_state_identifier,
						}),
						init: new LiteralNumericExpression({
							value: globals.DUMMY_NODE_ID, // Will be replaced with the actual next_state value, placeholder to avoid collisions
						})
					})
				]
			})
		}),
		declar_stat[0], // Assume first declaration is the one we need
		new ExpressionStatement({
			expression: new ArrayExpression({
				elements: declarators[0].declarators.map( d => // Assume first group of declarators is the one we need
					new IdentifierExpression({
						name: d.binding.name,
					})
				)
			})
		})
	]

	let stub_script = new Script({
		directives: [],
		statements: eval_statements,
	})

	ret.next_state_eval = codegen(stub_script).replace('\n', '').trim();

	return ret;

}

// Replaces IN PLACE a state machine loop with the unflattened statements
// Arguments:
//	- ast: the ast of the function to manipulate (must start with a FunctionDeclaration node)
//	- new_statements: a list of statements that will replace the loop
function replace_loop(ast, new_statements) {
	let name = ast.name.name;
	let for_statement;

	let for_query_1 = query(ast, `FunctionDeclaration[name.name="${name}"] > FunctionBody > TryCatchStatement > Block > ForStatement`); // Outer functions have try-catch blocks
	let for_query_2 = query(ast, `FunctionDeclaration[name.name="${name}"] > FunctionBody > ForStatement`); // Nested functions might not have try-catch
	if (for_query_1.length == 1 && for_query_2.length == 0) {
		for_statement = for_query_1[0];
	} else if (for_query_1.length == 0 && for_query_2.length == 1) {
		for_statement = for_query_2[0];
	} else {
		throw new Error(`While replacing for loop with statements, query 1 returned ${for_query_1.length} results and query 2 returned ${for_query_2.length} results`);
	}

	let i = ast.body.statements.indexOf(for_statement);
	ast.body.statements.splice(i, 1, ...new_statements);
}

module.exports.get_eligible_functions = function(ast) {
	return get_eligible_functions(ast);
}
module.exports.switch_structure_analyzer = function(ast) {
	return switch_structure_analyzer(ast);
}
module.exports.replace_loop = function(ast, new_statements) {
	return replace_loop(ast, new_statements);
}
