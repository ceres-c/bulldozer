const access_reducer = require('../reducers/access-reducer')
const { updateexpr_eval, compexpr_eval } = require('../helpers/expr-eval');
const { Script, ExpressionStatement, AssignmentExpression, AssignmentTargetIdentifier, LiteralStringExpression, VariableDeclarationStatement, VariableDeclaration, VariableDeclarator, BindingIdentifier, IdentifierExpression } = require('shift-ast');
const codegen = require("../helpers/codegen");
const globals = require('../helpers/globals')


let string_decoding_while_statements = 4; // Number of statements used to descramble in while loops
// e.g.
// while (Qn < En.length) {
// 	uo = 698 ^ En.charCodeAt(Qn);
// 	Ne += String.fromCharCode(uo);
// 	Qn++;
// 	continue;
// }

// Generate an assignment statement, given the binding and an expression
function generate_assignment_stat(binding, expression, decl) {
	if (decl === undefined) {
		return new ExpressionStatement({
			expression: new AssignmentExpression({
				binding: new AssignmentTargetIdentifier({
					name: binding,
				}),
				expression: expression
			})
		});
	} else {
		return new VariableDeclarationStatement({
			declaration: new VariableDeclaration({
				kind: decl,
				declarators: [
					new VariableDeclarator({
						binding: new BindingIdentifier({
							name: binding,
						}),
						init: expression,
					})
				]
			})
		});
	}
}

// Removes the latest (most recent) assignment to binding in statements
function remove_assignment_stat(binding, statements) {
	// Filter out the "let a = xxx"
	let assignments_to_binding;
	assignments_to_binding = statements.filter(stat =>
		stat.type == 'VariableDeclarationStatement' &&
		stat.declaration.type == 'VariableDeclaration' &&
		stat.declaration.declarators.length == 1 &&
		stat.declaration.declarators[0].type == 'VariableDeclarator' &&
		stat.declaration.declarators[0].binding.name == binding
	);
	statements = statements.filter(stat => stat !== assignments_to_binding[assignments_to_binding.length - 1]);

	// Filter out the "a = xxx"
	assignments_to_binding = statements.filter(stat =>
		stat.type == 'ExpressionStatement' &&
		stat.expression.type == 'AssignmentExpression' &&
		stat.expression.binding.name == binding
	);
	statements = statements.filter(stat => stat !== assignments_to_binding[assignments_to_binding.length - 1]);

	return statements;
}

// TODO delete if unused
function generate_fake_info(statements) {
	statements.push (
		generate_assignment_stat("FAKE_INFO_VARIABLE", new LiteralStringExpression(
			{value: "Dumping all the variables used in the below loop"}
		) )
	);
}

// TODO move all these functions to a single class to have `variables` as a class attribute

// Check if a loop looks like one of those used to decoded strings
function is_loop_string_decoder(variables, s) {
	// Matches loops with test conditions such as `co < To.length`
	return s.test != undefined &&
		s.test.type == 'BinaryExpression' &&
		s.test.right.type == 'StaticMemberExpression' &&
		s.test.right.object.type == 'IdentifierExpression' &&
		s.test.right.property == 'length' &&
		variables.has(s.test.right.object.name); // Otherwise, it's not a literal
}

// Actually decode the string in while loops
function decode_string_while_loop(variables, s) {
	if (s.body === undefined || s.body.block === undefined || s.body.block.statements.length != string_decoding_while_statements) {
		return false;
	}

	let eval_statements = [];
	let stats = s.body.block.statements;

	if (
		// Accounts for loops starting with variable declaration and assignment (e.g. var pe = "\u010A\u0106";)
		(stats[0].declaration?.declarators?.length != 1 || !stats[0].declaration?.declarators[0]?.init?.type?.includes('Expression')) &&
		// And for simple assignments to already declared variables
		stats[0].expression?.type != 'AssignmentExpression' ||
		stats[1].expression?.type != 'CompoundAssignmentExpression' ||
		stats[2].expression?.type != 'UpdateExpression' ||
		stats[3].type != 'ContinueStatement' ) {
		return false;
	}

	let counter_name = s.test.left.name;
	let counter_value = variables.get(counter_name).value;
	eval_statements.push(generate_assignment_stat(counter_name, {...counter_value})); // The counter variable // TODO probably we don't need to copy the value here

	let scrambled_string_name = s.test.right.object.name;
	let scrambled_string_value = variables.get(scrambled_string_name).value;
	eval_statements.push(generate_assignment_stat(scrambled_string_name, {...scrambled_string_value})); // The original scrambled string

	let string_accumulator_name = stats[1].expression.binding.name;
	let string_accumulator_value = variables.get(string_accumulator_name).value;
	eval_statements.push(generate_assignment_stat(string_accumulator_name, {...string_accumulator_value})); // The variable where the new string will be generated

	eval_statements.push(s);

	eval_statements.push(new ExpressionStatement({ // eval() will return the value of string_accumulator_name
			expression: new IdentifierExpression({
				name: string_accumulator_name
			})
		})
	);

	// Sanity check
	let generated_variables = {
		counter_name: counter_name,
		counter_value: counter_value,
		scrambled_string_name: scrambled_string_name,
		scrambled_string_value: scrambled_string_value,
		string_accumulator_name: string_accumulator_name,
		string_accumulator_value: string_accumulator_value
	};
	if (Object.entries(generated_variables).some(([key, val]) => val === undefined)) {
		// Can unpack `find` result since it is guaranteed to exist at least one value by above check
		let [undefined_elem, _] = Object.entries(generated_variables).find(([key, val]) => val === undefined);
		throw new Error(`Couldn't find ${undefined_elem} in loop statement used to decode string`)
	}

	var eval_script = new Script ({
		type: 'Script',
		directives: [],
		statements: eval_statements
	});

	let descrambled_string = eval(codegen(eval_script));

	variables.delete(counter_name);
	variables.delete(scrambled_string_name);
	variables.set(string_accumulator_name, {
		value: new LiteralStringExpression({
			value: descrambled_string
		}),
		printed: false,
		declared: variables.get(string_accumulator_name).declared
	});

	return true;
}

// Returns a list of assignment statements required before a piece of code which can't be analyzed by expr_statement (such as a loop)
// All the previously known variables read/written/assigned in the given piece of code have to be printed as they are before the code access or modifies them
function prepare_variables(variables, statement) {
	const stat_vars = access_reducer.analyze(statement);
	let ret_statements = [];

	// generate_fake_info(ret_statements); // TODO decomment when debugging

	for (let identifier of stat_vars.reads) {
		if (variables.has(identifier)) {
			let variable = variables.get(identifier);
			if (!variable.printed) {
				let generated_current_value = generate_assignment_stat(identifier, {...variable.value}, variable.declared); // Push copy of the object as it currently is
				variable.printed = true;
				variable.declared = undefined;
				ret_statements.push(generated_current_value);
			}
		}
	}

	for (let [identifier, _] of stat_vars.writes.entries()) {
		if (variables.has(identifier)) {
			let variable = variables.get(identifier);
			if (!variable.printed) {
				let generated_current_value = generate_assignment_stat(identifier, {...variable.value}, variable.declared); // Push copy of the object as it currently is
				variable.printed = true;
				variable.declared = undefined;
				ret_statements.push(generated_current_value);
			}
			variables.delete(identifier); // Remove from list as the value is now unknown
		}
	}

	for (let [identifier, _] of stat_vars.assignments.entries()) {
		if (variables.has(identifier)) {
			let variable = variables.get(identifier);
			if (!variable.printed) {
				let generated_current_value = generate_assignment_stat(identifier, {...variable.value}, variable.declared); // Push copy of the object as it currently is
				variable.printed = true;
				variable.declared = undefined;
				ret_statements.push(generated_current_value);
			}
			variables.delete(identifier); // Remove from list as the value is now unknown
		}
	}

	return ret_statements;
}

// Returns a list (possibly empty) of useful statements
function expr_statement(variables, statement) {
	// Analyze one by one all the statements, get variables which are being read, assigned and written

	// A variable is being read
	//	It in our local map?
	//	YES:
	//		Has it been updated since it was printed last time?
	//			YES:
	//				Append new variable assignent statement to return list, mark variable as printed in map
	//				Append current statement to the return list
	//			NO:
	//				Do nothing with the variable
	//				Append current statement to the return list
	//	NO:
	//		Append current statement to the return list

	// A variable is being assigned
	//	Is the value being assigned to it a literal (only safe values to work on)?
	//	YES:
	//		Add to variables map, set it as not printed
	//	NO:
	//		Append current statement to the return list

	// A variable is being written (which means some kind of update, but not an assignment)
	//	It in our local map (which means it was assigned to a literal in the first place)?
	//	YES:
	//		Is the value being written to it a literal?
	//			YES:
	//				Update value in local map, set it as not printed
	//			NO:
	//				Append new variable assignent statement to return list with the old value from the map
	//				Delete the variable from the map
	//				Append current update statement to return list
	//	NO:
	//		Append current update statement to return list

	// Verifies if an assignment can be skipped and updateds variables accordingly (ignore "gnirts".split().reverse().join()-like calls)
	function reverse_variable_callexpression(variables, expression) {
		// Returns [identifier, "string_of_applied_methods"]
		function reduce_callexpr(expr) {
			if (expr.type == "CallExpression" && expr.callee.type == "StaticMemberExpression") {
				let [identifier, methods] = reduce_callexpr(expr.callee.object)
				return [identifier, methods + "." + expr.callee.property]
			} else {
				return [expr.name, ""]
			}
		}

		[identifier, methods] = reduce_callexpr(expression)
		if (variables.has(identifier) && methods == ".split.reverse.join") {
			variable = variables.get(identifier);
			variable.value.value = variable.value.value.split('').reverse().join('') // .value.value to access the expression object (in the map) and then the expression's actual value (in expression object)
			variable.printed = false;
			return true;
		}
		return false;
	}

	const stat_vars = access_reducer.analyze(statement);
	let ret_statements = [];

	let cached_declaration = new Map(); // Will temporarily store all previous declaration types (let/var/const) that would be removed from "variables" while adding assignments analyzing reads. This is required to handle reversed strings, which are at first printed reversed, then deleted and finally printed in the correct order. This process would destroy declaration type, but it can be presereved with this temp var.

	// This piece of code is similar to prepare_variables, but putting it here avoids calling the reducer twice
	for (let identifier of stat_vars.reads) {
		if (variables.has(identifier)) {
			let variable = variables.get(identifier);
			if (!variable.printed) {
				let generated_current_value = generate_assignment_stat(identifier, {...variable.value}, variable.declared); // Push copy of the object as it currently is
				variable.printed = true;
				cached_declaration.set(identifier, variable.declared);
				variable.declared = undefined;
				ret_statements.push(generated_current_value);
			}
		} else {
			globals.verbose && console.log(`WARNING: read variable ${identifier} before assignment`);
		}
	}

	for (let [identifier, new_value] of stat_vars.assignments) {
		if (new_value !== null && new_value.type.includes("Literal")) {
			// Overwrite all the assignments to literals

			let declared;
			if (variables.has(identifier)) {
				// Recover old declaration status before overwriting and propagate
				declared = variables.get(identifier).declared;
			} else {
				// Get declaration type from code
				declared = statement?.declaration?.kind; // If not a VariableDeclarationStatement, will default to undefined
			}

			variables.set(
				identifier, 
				{
					value: new_value,
					printed: false,
					declared: declared
				}
			)
		} else if (
			new_value !== null &&
			variables.has(identifier) &&
			new_value.type == "CallExpression" &&
			reverse_variable_callexpression(variables, new_value)
		) {
			// e.g. a = a.split().reverse().join()
			// Remove from ret_statements the assignment to this variable added in the above for loop while analyzing reads
			variables.get(identifier).declared = cached_declaration.get(identifier);
			ret_statements = remove_assignment_stat(identifier, ret_statements);
		} else {
			variables.delete(identifier); // Assigned to non literal value
			// At this point, we're LOSING information: the old value in variables map might be lost if it hasn't been printed yet
			// It is being overwritten in the original code, so it'd be lost as well. It's fine as long as we're correctly finding all the reads.
			ret_statements.push( generate_assignment_stat(identifier, new_value, statement?.declaration?.kind) )
		}
	}

	// Update value for all the writes
	for (let [identifier, update_expression] of stat_vars.writes) {
		if (!variables.has(identifier)) {
			// If this happens, some identifier is modified with a literal, but was not assigned to a literal before. e.g.
			// function call() {return 1;}
			// var a = call();
			// a += 1;

			// TODO generate artificially an entry in variables for this variable and set it as printed?
			ret_statements.push(statement)
			continue;
		}

		if (update_expression.type == "CompoundAssignmentExpression") {
			if (update_expression.expression.type.includes("Literal")) {
				let operator = update_expression.operator;
				if (operator in compexpr_eval === false) {
					console.log(`WARNING: unsupported operator ${operator} in CompoundAssignment:\n${update_expression}`);
					let old_value = variables.get(identifier);
					let generated_old_value = generate_assignment_stat(identifier, old_value.value, old_value.declared);
					variables.delete(identifier); // Delete the now superseeded node
					ret_statements.push(generated_old_value); // Push previous value
					ret_statements.push(statement); // Push new update
				} else {
					let variable = variables.get(identifier); // Get the current variable from the map: {value: ExpressionObject, printed: boolean}
					let var_expression = variable.value; // Extract the expression for convenience
					let update_value = update_expression.expression.value; // Get the value this variable has to be updated with
					var_expression.value = compexpr_eval[operator](var_expression.value, update_value); // Set the new value
					variable.printed = false; // Mark it as not printed, as it has been modified
				}
			} else {
				let old_value = variables.get(identifier);
				let generated_old_value = generate_assignment_stat(identifier, old_value.value, old_value.declared);
				variables.delete(identifier); // Delete the now superseeded node
				ret_statements.push(generated_old_value, statement); // Push old value and new update
			}
		} else if (update_expression.type == "UpdateExpression") {
			let variable = variables.get(identifier); // Get the current variable from the map: {value: ExpressionObject, printed: boolean}
			let var_expression = variable.value; // Extract the expression for convenience

			var_expression.value = updateexpr_eval[update_expression.operator](var_expression.value); // Set the new value
			variable.printed = false; // Mark it as not printed, as it has been modified
		} else {
			// This should never happen (TM) as the reducer shouldn't report different nodes
			console.log(`WARNING: unknown operation ${update_expression.type} on variable ${identifier}`)
			let old_value = variables.get(identifier)
			let generated_old_value = generate_assignment_stat(identifier, old_value.value, old_value.declared)
			variables.delete(identifier) // Delete the now superseeded node
			ret_statements.push(generated_old_value, statement) // Push old value and new update
		}
	}

	return ret_statements;
}

function literals_descrambler(statements) {
	let stats_descrambled = [];
	let variables = new Map();

	for (let s of statements) {
		switch (s.type) {
			case 'ExpressionStatement':
				if (s.expression.type == "AssignmentExpression" && s.expression.binding.type == "ComputedMemberAssignmentTarget") {
					if (s.expression.expression.type == "FunctionExpression" ) {
						// X = function() {...}
						s.expression.expression.body.statements = literals_descrambler(s.expression.expression.body.statements);
						stats_descrambled.push(...prepare_variables(variables, s));
						stats_descrambled.push(s);
					} else {
						// Ei[70] = Qe + q;
						stats_descrambled.push(...prepare_variables(variables, s));
						stats_descrambled.push(s);
					}
				} else if ( s.expression.type == "AssignmentExpression" && s.expression.expression.type == "FunctionExpression" ) {
					// X = function() {...}
					s.expression.expression.body.statements = literals_descrambler(s.expression.expression.body.statements);
					stats_descrambled.push(...prepare_variables(variables, s));
					stats_descrambled.push(s);
				} else if (s.expression.type == "CallExpression" || s.expression.type == "UnaryExpression") {
					// call(a, b, c); OR delete a;
					stats_descrambled.push(...prepare_variables(variables, s));
					stats_descrambled.push(s);
				} else {
					stats_descrambled.push(...expr_statement(variables, s));
				}
				break;
			case 'VariableDeclarationStatement':
				stats_descrambled.push(...expr_statement(variables, s));
				break;
			case 'FunctionDeclaration':
				stats_descrambled.push(...prepare_variables(variables, s));
				s.body.statements = literals_descrambler(s.body.statements); // TODO check if body is a FunctionBody object
				stats_descrambled.push(s);
				break;
			case 'IfStatement':
				stats_descrambled.push(...prepare_variables(variables, s, true));
				if (s.consequent.block !== undefined) {
					s.consequent.block.statements = literals_descrambler(s.consequent.block.statements);
				} // If no block, the consequent will be another statement at the same hierarchical level

				if (s.alternate !== null && s.alternate.type == 'IfStatement') {
					// if/else-if
					stats_descrambled.push(...prepare_variables(variables, s.alternate));
					let alternate = literals_descrambler([s.alternate]); // Wrap the single assignment in a list
					if (alternate.length != 1) {
						// This shouldn't (TM) happen
						throw new Error("Got too many statements as a result of alternate analysis")
					}
					s.alternate = alternate[0]
				} else if (s.alternate !== null && s.alternate.block !== undefined) {
					// if/else
					s.alternate.block.statements = literals_descrambler(s.alternate.block.statements);
				}

				stats_descrambled.push(s);
				break;
			case 'ReturnStatement':
				stats_descrambled.push(s);
				break;
			case 'WhileStatement':
				// All the variables in loops shouldn't be touched as the body will be executed multiple times, yielding of course different results
				if (is_loop_string_decoder(variables, s)) {
					if (decode_string_while_loop(variables, s)) {
						// Do not push while loop
						break;
					}
					// Else, will fallback below
				};
				// Fallback
			case 'ForInStatement':
				// Fallback
			case 'ForStatement':
				stats_descrambled.push(...prepare_variables(variables, s));
				stats_descrambled.push(s);
				break;
			case 'BlockStatement':
				// HACK This is WRONG! `let` variables are block scoped, `var` variables are function scoped and we're not handling the difference
				// In this particular scenario it shouldn't (TM) be an issue, since collina variables are always function scoped
				s.block.statements = literals_descrambler(s.block.statements);
				stats_descrambled.push(s);
				break;
			case 'TryCatchStatement':
				stats_descrambled.push(...prepare_variables(variables, s));
				s.body.statements = literals_descrambler(s.body.statements);
				if (s.catchClause.body.statements.length > 0) {
					s.catchClause.body.statements = literals_descrambler(s.catchClause.body.statements);
				}
				stats_descrambled.push(s);
				break;
			default:
				console.log("WARNING: Unhandled statement:", s.type);
				stats_descrambled.push(...prepare_variables(variables, s));
				stats_descrambled.push(s);
				break;
		}
	}

	// Append any remaining variable to statements, most likely they will not be used in current block, but by next one (up one level)
	variables.forEach((data, identifier) => {
			if (!data.printed) {
				stats_descrambled.push(generate_assignment_stat(identifier, data.value, data.declared))
			}
		}
	);

	return stats_descrambled;
}

module.exports.literals_descrambler = function (statements) {
	return literals_descrambler(statements);
};
