const { Script } = require('shift-ast');
const { reduce } = require('shift-reducer');
const jsnx = require('jsnetworkx');

const { AssignmentsCollector } = require('../reducers/assignments-reducer');
const { StateMachineParser } = require('../parsers/state_machine_parser');
const { BlocksCollector } = require('../reducers/blocks_collector');

const { RegionIdentifier } = require('./region_identifier');
const { IterativeStructurer } = require('./structurer');

const codegen = require('../helpers/codegen');
const cleanup = require('../helpers/cleanup');
const globals = require('../helpers/globals');

// The two below classes are kept here to document node/edge structure. This data will be put in the optAttrDict objects of jsnetworkx nodes
// class Node {
// 	constructor({
// 		type = node_type.normal,
// 		statements = []
// 	} = {}) {
// 		this.type = type;
// 		this.statements = statements; // Undefined when type==region (region's statements are placed in the GraphRegion object)
//		this.region = region object; // Defined only when type==region
// 	}
// }
// class Edge {
// 	constructor({
// 		type = edge_type.normal,
// 		expression = [], // Optional edge conditional expression
//		original: true, // Optional boolean: true if expression appeared in collina, false if this was generated negating collina branch
// 	} = {}) {
// 		this.type = type;
// 		this.expression = expression
// 	}
// }

let chunks;
let next_state_identifier;
let stop_condition;

function decompile(ast, state_machine_data) {
	next_state_identifier = state_machine_data.next_state_identifier;
	stop_condition = state_machine_data.stop_condition;

	let cfg = new jsnx.DiGraph();

	globals.debug && console.log("[*] Parsing AST");
	chunks = new StateMachineParser(ast, state_machine_data.bitwise_identifiers, state_machine_data.next_state_eval); // Defining file wide var

	globals.debug && console.log("[*] Generating CFG from AST");
	_traverse_code(cfg, state_machine_data.init_state);
	_merge_ends(cfg) // In case the generated CFG has multiple exits, merge them to avoid feeding RegionIdentifier with a broken graph

	globals.debug && console.log("[*] Starting region analysis");
	let ri = new RegionIdentifier(cfg, state_machine_data.init_state).analyze();

	globals.debug && console.log("[*] Structuring");
	let statements = new IterativeStructurer(ri).structure();

	return statements;
}

// Recursively analyze <next_state_identifier> assignments to generate the control flow graph depth first
// G is the destination CFG where nodes will be added
function _traverse_code(G, state) {

	// Strip out <next_state_identifier> assignments because that information has to be stored on the edges
	function remove_state_assignment(statements) {
		// TODO switch to a reducer to remove any kind of nested assignment
		return statements.filter(s => s?.expression?.binding?.name != next_state_identifier);
	}

	let current_statements = chunks.get(state);

	// Check if any block contains assignments to next_state
	// _analyze_blocks(current_statements); // TODO decomment once implemented

	let node_attrs = {};
	// Save statements in node data without next_state assignments
	node_attrs.statements = remove_state_assignment(current_statements); // TODO use a reducer to remove assignments recursively
	if (node_attrs.statements.length == 0) {
		node_attrs.type = node_type.empty;
	} else {
		node_attrs.type = node_type.normal;
	}

	G.addNode(state, {...node_attrs});

	try {
		edges = _edges(current_statements);
	} catch (e) {
		e.message = e.message + ` on state ${state}`;
		throw e;
	}

	for (let [next_state, data] of edges) {
		G.addEdge(state, next_state, data);
		if (!visited(G, next_state)) {
			_traverse_code(G, next_state);
		}
	}

	return;
}

// Modify in place graph G to merge possible multiple endnodes in a single dummy.
// If there is a single endnode, no changes are made
function _merge_ends(G) {
	let endnodes = G.nodes().filter(n => G.outDegree(n) == 0);
	if (endnodes.length == 0) {
		// Sanity check: there should be at least one end node
		throw new Error(`[!] No end node found in graph while merging ends!`);
	} else if (endnodes.length > 1) {
		// If this graph has multiple end nodes: create a single end node
		let dummy_endnode = globals.DUMMY_NODE_ID // Could be a value in every native data type, I've picked a number due to jsnx internal implementation which divides numbers from strings, but my restore from json function supports numbers only
		for (let node of endnodes) {
			G.addEdge(node, dummy_endnode);
		}
	} // Otherwise, do nothing

	return
}

// Return an array of zero or more tuples representing edges (with data) that must be followed.
// [ target, edge_data ] - NOTE: no edge source
function _edges(statements) {
	let stub_script = new Script ({ // shift-reduce requires a script object
		type: 'Script',
		directives: [],
		statements: statements,
	});

	let next_state_assignments = reduce(new AssignmentsCollector(next_state_identifier), stub_script).values;
	if (next_state_assignments.length > 1) {
		// Collina states were considered to be basic blocks as there was a single assignment (possibly conditional) per state,
		// if this code path is reached something changed and that probably made this whole piece of code useless
		throw new Error(`Unsupported multiple assignments to ${next_state_identifier} in snippet:\n${codegen(stub_script)}`)
	} else if (next_state_assignments.length == 0) {
		// We've reached a terminal node, no need to analyze additional nodes
		return [ ];
	}

	// If we're here, we have a single assignment to <next_state_identifier>
	let next_state_assign = next_state_assignments[0];

	if (JSON.stringify(next_state_assign) === JSON.stringify(stop_condition)) { // Ugly, I know
		// Found stop condition, no edges
		return [ ];
	}

	switch (next_state_assign.type) {
		case 'LiteralNumericExpression':
			// Add a single non conditional edge, continue searching
			let next_state = next_state_assign.value;

			return [ [next_state, {type: edge_type.normal, expression: []}] ]

			break;
		case 'ConditionalExpression':
			// Generate two appropriate conditional edges and start searching in both directions

			let expression_data = find_test_expression(statements) // TODO FIXME this is buggy: it does not take successive writes in consideration

			if (expression_data.test === null) {
				// The test expression actually had only one branch (e.g. test condition was a LiteralBoolean).
				// Note: The single following state will always be returned as a consequent

				return [ [expression_data.consequent, {type: edge_type.normal, expression: []}] ]

			} else {
				let consequent_edge_attrs = {
					type: edge_type.conditional,
					expression: expression_data.test,
					original: true,
				};
				let alternate_edge_attrs = {
					type: edge_type.conditional,
					expression: cleanup.negate(expression_data.test),
					original: false,
				};

				return [
					[expression_data.consequent, consequent_edge_attrs],
					[expression_data.alternate, alternate_edge_attrs]
				]
			}
			break;
		default:
			throw new Error(`Unsupported assignments type ${next_state_assign.type} to ${next_state_identifier} in snippet:\n${codegen(stub_script)}`)
	}
}

// Analyze a list of blocks to check whether any of them contains assignments to another state, in that case,
// start a fresh analysis (generate a new cfg, identify regions, structure result) and append statements in the block
function _analyze_blocks(statements) {
	let stub_script = new Script ({ // shift-reduce requires a script object
		type: 'Script',
		directives: [],
		statements: statements,
	});

	// Check if there are block-like statement in the current snippet
	let blocks = reduce(new BlocksCollector, stub_script).values;
	if (blocks.length == 0) {
		return
	}
	// There are blocks

	while (blocks.length > 0) {
		let block = blocks.pop(); // Start from the end of the list to ensure block has no nested blocks
		if (!_block_has_subtree(block)) {
			continue;
		}

		// Generate a new cfg which will be populated with the states following this block
		let edges, block_subG = new jsnx.DiGraph(); // New temporary graph

		try {
			edges = _edges([block]); // _edges normally accepts a list of statements, thus we wrap the block in an array
		} catch (e) {
			e.message = e.message + ' when analyzing block';
			throw e;
		}

		for (let [next_state, data] of edges) {
			// Connect the (possibly multiple) destinations to the same dummy to start analysis from there

			block_subG.addEdge(globals.DUMMY_NODE_ID, next_state, data);
			if (!visited(block_subG, next_state)) {
				_traverse_code(block_subG, next_state);
			}
		}

		globals.debug && console.log("[*] Starting region analysis from block");
		let ri = new RegionIdentifier(block_subG).analyze();

		globals.debug && console.log("[*] Structuring block statements");
		let block_statements = new IterativeStructurer(ri).structure();

		// TODO remove TEMPPPPPP
		let stubba_script = new Script ({ // shift-reduce requires a script object
			type: 'Script',
			directives: [],
			statements: block_statements,
		});
		console.log(codegen(stubba_script))
		// TODO remove TEMPPPPPP
		throw new Error("Must replace old block with new block with statements")

		// TODO replace block's statements with OLD! + new statements
	}
}


// Returns whether a state is populated in the CFG
function visited(G, state) {
	// G.node.get(state) returns an empty object when the <state> node has simply been added as an edge's target and not populated yet.
	return G.node.has(state) && Object.keys(G.node.get(state)).length > 0;
}

// Checks whether a block has any assignment to next_state, thus has its own subtree
function _block_has_subtree(block) {
	let block_script = new Script ({ // shift-reduce requires a script object
		type: 'Script',
		directives: [],
		statements: [block],
	});

	return reduce(new AssignmentsCollector(next_state_identifier), block_script).values.length > 0;
}

// Search among a state's statements for a branch condition
function find_test_expression(statements) {
	// Note: when this function is called the assignment is guaranteed to be conditional

	var stub_script = new Script ({ // shift-reduce requires a script object
		type: 'Script',
		directives: [],
		statements: statements,
	})

	// Search for the expression to which identifier_expr is assigned to.
	// e.g.
	//	`Ma = Se.length < 5;
	//	 li = Ma ? 4632 : 13364;`
	// This function will return the AST expression of `Se.length < 5`
	// WARNING THIS IS BUGGY!
	// Example code below would result in "co === Jo" being put in the if clause, but it'd be wrong since Jo is overwritten in the meantime
	// uo = co === Jo;
	// Jo = "string"
	// if (!uo) { console.log("This is wrong!"); }
	function find_indirect(identifier_expr) {
		// Accepting an expression as input instaed of a identifier name to always return an expression,
		// even if we were not able to find where the identifier is assigned
		let indirect_assignments = reduce(new AssignmentsCollector(identifier_expr.name), stub_script).values;

		if (indirect_assignments.length == 0) { // Identifier assignment was not in the same basic block :(
			return identifier_expr;
		} else {
			// This will most likely be the test condition itself. It might be another variable, but still better than identifier_expr
			return indirect_assignments[indirect_assignments.length-1]; // Use the most recent assignment to the indirect identifier
		}
	}

	let next_state_assign = reduce(new AssignmentsCollector(next_state_identifier), stub_script).values[0];

	switch(next_state_assign.test.type) {
		case 'BinaryExpression': // e.g. Ai == 19 ? 672 : 2327
		case 'ComputedMemberExpression': // Fallback for statements such as: Me[55] ? 23173 : 1093
		case 'StaticMemberExpression': // Fallback for statements such as: Ne.indexOf ? 14689 : 14784;
		// <next_state_identifier> is assigned via a direct check
			return {
				test: next_state_assign.test,
				consequent: next_state_assign.consequent.value,
				alternate: next_state_assign.alternate.value
			};
			break;
		case 'IdentifierExpression':
			// e.g.
			// D = ye.length > 7;
			// next_state = D ? 9925 : 7366;
			// It's necessary to look for "D" identifier assignment (it *should* be in the same basic block)
			// let indirect_test = find_indirect(next_state_assign.test); // TODO decomment this once find_indirect is fixed
			return {
				// test: indirect_test, // Fallback to the identifier // TODO decomment this once find_indirect is fixed
				test: next_state_assign.test, // TODO remove this once find_indirect is fixed
				consequent: next_state_assign.consequent.value,
				alternate: next_state_assign.alternate.value
			};
			break;
		case 'UnaryExpression':
			// TODO decomment this once find_indirect is fixed
			// if (next_state_assign.test.operand.type == 'IdentifierExpression') {
			// 	// Indirect check with unary over a variable. e.g. ~ge ? 6789 : 15684;
			// 	let indirect_test = find_indirect(next_state_assign.test.operand);
			// 	return {
			// 		test: indirect_test, // Fallback to the identifier
			// 		consequent: next_state_assign.consequent.value,
			// 		alternate: next_state_assign.alternate.value
			// 	};
			// } else {
			// 	return {
			// 		test: next_state_assign.test, // Fallback to the identifier
			// 		consequent: next_state_assign.consequent.value,
			// 		alternate: next_state_assign.alternate.value
			// 	};
			// }
			return {
				test: next_state_assign.test, // Fallback to the identifier
				consequent: next_state_assign.consequent.value,
				alternate: next_state_assign.alternate.value
			};
			break;
		case 'LiteralBooleanExpression':
			// li = true ? 12288 : 1024;
			// Switch on the boolean and add only the edge which can be followed.
			// Will always return the appropriate destination as *consequent.
			if (next_state_assign.test.value) {
				return {
					test: null,
					consequent: next_state_assign.consequent.value,
					alternate: null
				};
			} else {
				return {
					test: null,
					consequent: next_state_assign.alternate.value,
					alternate: null
				};
			}
			break;
		default:
			// ???
			throw new Error(`ERROR: Unexpected expression type while searching for branch test condition, got ${next_state_assign.test.type}`)
	}
}

// Reload a graph from a saved JSON.stringify output.
// NOTE This function is specific to this project with numbers as nodes identifiers, it will NOT work for any other node type
function fromJSON(obj) {
	var G = new jsnx.DiGraph();
	// Need to transform back the map key into a number
	G.addNodesFrom(Object.entries(obj.node._numberValues).map(e => [parseInt(e[0]), e[1]]));
	// Edges are stored in nested objects, need to transform both source and target to number
	for (e of Object.entries(obj.edge._numberValues)) {
		let source = parseInt(e[0]);
		for (let v of Object.entries(e[1]._numberValues)) {
			let target = parseInt(v[0]);
			let optionalDict = v[1];
			G.addEdge(source, target, optionalDict);
		}
	}
	return G;
}

module.exports.decompile = function(ast, state_machine_data) {
	return decompile(ast, state_machine_data)
}
module.exports.fromJSON = function(obj) {
	return fromJSON(obj);
}
