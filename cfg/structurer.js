const globals = require('../helpers/globals');

const { IfStatement, BlockStatement, Block, ContinueStatement, BreakStatement, WhileStatement, LiteralBooleanExpression } = require('shift-ast');
const { generate_random_identifier, dfs_postorder_nodes, get_edge_data, node_type, edge_type } = require('./graph_utils');

class IterativeStructurer {
	constructor(region) {
		this.region = region;
	}

	structure() {
		let stack = [[undefined, this.region]]; // Every entry of the stack will be an array of 2 items: region_id and region
		let parent_map = new Map();

		while (stack.length > 0) {
			let [current_region_id, current_region] = stack[stack.length - 1]; // Peek topmost region in the stack

			let has_subregion = false;
			for (let node of dfs_postorder_nodes(current_region.graph, current_region.head)) {
				let substack = [];
				let node_data = current_region.graph.node.get(node);
				if (node_data.type == node_type.region) {
					if (node_data.region.cyclic) {
						substack.unshift([node, node_data.region]);
					} else {
						substack.push([node, node_data.region]);
					}
					parent_map.set(node, current_region);
					has_subregion = true;
				}

				stack = [...stack, ...substack];
			}

			if (!has_subregion) {
				// Found only atomic nodes in current_region
				stack.pop();

				let parent_region = parent_map.get(current_region_id);
				let structured = new Structurer(current_region, parent_map).analyze();
				if (parent_region === undefined) {
					// This is the top-level region. we are done!
					return structured.statements;
				}

				// Replace this region with the resulting node in its parent region... if it's not an orphan
				parent_region.replace_region(current_region_id, structured);
			}

		}
	}
}

class Structurer {
	constructor(region, parent_map = undefined) {
		this.region = region;
		this.parent_map = parent_map;
	}

	// Returns a new node (node_type == normal) with the structured statements from the region.
	// Basically, new node's `statements` property is the AST of the given region
	analyze() {
		let statements = [];

		// It is possible for regions themselve to have statements (i.e. artificial variables declarations)
		// and they must be placed before every other statement belonging to nodes part of the region
		statements.push(...this.region.statements);

		if (this.region.cyclic) {
			let test_condition = this._analyze_cyclic() // Returns test condition but modifies region's graph in place as well

			let while_proto = new WhileStatement({
				test: null,
				body: new BlockStatement({
					block: new Block({
						statements: this.code_structurer(this.region.head),
					})
				})
			});

			if (test_condition != null) {
				// We have the rigth test condition for the loop
				while_proto.test = test_condition
			} else {
				// We don't have or cannot find the rigth test condition, so default to "true"
				while_proto.test = new LiteralBooleanExpression({value: true})
			}

			statements = [while_proto];
		} else {
			statements = this.code_structurer(this.region.head);
		}

		return {type: node_type.normal, statements: statements};
	}

	// Given a state, fetches current state's statements, then navigates to its successors building required structures around them (if-then/if-then-else)
	code_structurer(node) {

		let _g;
		if (this.region.cyclic || this.region.graph_with_successors === undefined) { // Second condition might come true with an outermost cyclic region, which can't have successors
			_g = this.region.graph;
		} else {
			_g = this.region.graph_with_successors;
		}

		let statements = [];
		let stack = [node]; // This "stack" will hold at most one node

		while (stack.length > 0) {
			let curr_node = stack.pop();

			// Keep track of the number of nodes passed to this function
			globals.STRUCTURED_NODES_COUNT++;

			statements.push(...this._helper_get_statements(curr_node));

			switch (_g.outDegree(curr_node)) {
				case 0:
					// No further nodes to analyze
					break;
				case 1:

					if (this.region.graph.outDegree(curr_node) == 0) {
						// We were switching over graph_with_successors, but we're actually leaving region's graph
						break;
					}

					let [_, dst] = _g.outEdges(curr_node)[0];
					stack.push(dst);

					break;
				case 2:
					let if_structure = this._analyze_if(curr_node);

					let if_proto = new IfStatement({
						test: if_structure.test,
						consequent: null,
						alternate: null,
					});

					// Recursively create new structurers in case of if statements

					if (if_structure.consequent !== null) {
						if_proto.consequent = new BlockStatement({
							block: new Block({
								statements: this.code_structurer(if_structure.consequent)
							}),
						});
					} else {
						throw new Error(`Branching consequent condition was ${if_structure.consequent} on node ${node}. Should be non-null.`)
					}

					if (if_structure.alternate !== null) {
						// Insert alternative in if statement, this is a if-then-else branch
						if_proto.alternate = new BlockStatement({
							block: new Block({
								statements: this.code_structurer(if_structure.alternate)
							}),
						});
					} else {
						// Do nothing, this is a if-then branch
					}

					statements.push(if_proto);

					// No need to push new nodes on stack since all exits have been recursively analized above

					break;
				default:
					throw new Error(`Found node ${node} with out degree greater than 2, how did this happen?`)
				}
			}

			return statements;
	}

	// Returns a node's statements
	_helper_get_statements(node) {
		let node_data = this.region.graph.node.get(node);
		switch (node_data.type) {
			case node_type.normal:
				// An actual node with statements
				return node_data.statements;
			case node_type.empty:
				return [];
			default:
				if (node == globals.DUMMY_NODE_ID) {
					// Dummy node must be ignored as it will have no actual data
					return [];
				}
				throw new Error(`Unexpected node type ${node_data.type} for node ${node}`)
		}
	}

	// Detect the kind of branch we're dealing with.
	// Will return an object with 3 keys:
	//	- test: The test condition (ast expression) required to follow "consequent" branch
	//	- consequent: The destination node if test is true
	//	- alternate: The destination node if test is false or null if there is no alternate (if-then, without else)
	_analyze_if(node) {
		if (this.region.graph_with_successors.outDegree(node) != 2) {
			throw new Error(`Called _analyze_if on node ${node} but it does not have 2 successors`);
		}

		let destinations = this.region.graph_with_successors.successors(node); // Pick out destinations only

		// Are all the branches leaving this region? This shouldn't be possible since regions are single-entry, single-exit
		if (destinations.every(dst => this.region.successors.includes(dst))) {
			throw new Error(`All node ${node}'s branches are leaving current region ending in ${destinations.toString()}. This shouldn't *really* happen`)
		}

		// Is only one branch staying in the region?
		let included_destinations = destinations.filter(dst => this.region.graph.node.has(dst)); // Find all the destinations whithin this region
		if (included_destinations.length == 1) {
			// This is a well structured if-then: one part of it points to a subregion/node of this region (if branch), other destination is outside of this region (else branch).

			// Get the test condition (which is the condition on the edge staying inside the region)
			let edge_data = get_edge_data(this.region.graph_with_successors, node, included_destinations[0]);
			// TODO check if edge_data is non-conditional, maybe
			let test_expression = edge_data.expression;

			let dest_true = included_destinations[0];

			return {test: test_expression, consequent: dest_true, alternate: null};
		}

		// Both the branches are staying in the region. We have found a if-then-else branch.

		// Retrieve original test expression from collina and its relative branch
		let dest_true, original_expr;
		// throw new Error("Must check if both expression are true (generate if-elseif)") // TODO decomment both this and code in _refine_loop_successors to implement this
		for (let [_, dst, edge_data] of this.region.graph_with_successors.outEdges(node, true)) {
			if (edge_data.type == edge_type.conditional && edge_data.original) {
				dest_true = dst;
				original_expr = edge_data.expression;
				break;
			}
		}
		if (original_expr === undefined) {
			throw new Error(`Could not recover original branch condition for node ${node}`)
		}

		let dest_false = destinations.find(d => d != dest_true)

		// Given this is an if-then-else, any successor of the true or false branches is a valid stop condition as the control flow will merge back
		return {test: original_expr, consequent: dest_true, alternate: dest_false};
	}

	// Modify a cyclic region to:
	//	- remove backedges (end loop backedge or possible continues) from graph_with_successors.
	//	- remove jumps to external nodes (breaks)
	// These jumps are replaced with new nodes containing a single continue/brek statement, apart from main loop backedge which is simply removed
	// Returns the loop test condition, if it could be found, null otherwise. do-while loops are not supported and will return null.
	_analyze_cyclic() {
		// Add to graph "continue" nodes replacing backedges to loop head
		function _rewrite_jumps_to_continues(graph, graph_with_successors, loop_head) {
			let continue_node = {
				type: node_type.normal,
				statements: [
					new ContinueStatement({})
				],
			}

			for (let [src, _, data] of graph.inEdgesIter(loop_head, true)) {
				globals.verbose && console.log("Rewriting to continue", src, "->", loop_head);
				graph.removeEdge(src, loop_head); // Remove the edge
				graph_with_successors.removeEdge(src, loop_head); // Remove the edge

				let new_continue_identifier = generate_random_identifier(graph);
				graph.addNode(new_continue_identifier, continue_node);
				graph_with_successors.addNode(new_continue_identifier, continue_node);
				graph.addEdge(src, new_continue_identifier, data);
				graph_with_successors.addEdge(src, new_continue_identifier, data);
			}
		}

		// Add to graph "break" nodes basing on graph_with_successors.
		// Note: breaks will be inserted in graph, inside the region
		function _rewrite_jumps_to_breaks(graph, graph_with_successors, successors, loop_head) {
			let break_node = {
				type: node_type.normal,
				statements: [
					new BreakStatement({})
				],
			}

			for (let succ of successors) {
				for (let [src, _, data] of graph_with_successors.inEdgesIter(succ, true)) {
					if (src === loop_head) {
						// If head is leaving the loop, it has conditional edges (and we must ignore them),
						// otherwise head will have one single edge towards loop body and it won't be iterated over at all.
						continue;
					}

					globals.verbose && console.log("Rewriting to break", src, "->", succ);

					// Basing on graph_with_successors, add required nodes and edges to graph
					let new_break_identifier = generate_random_identifier(graph);
					graph.addNode(new_break_identifier, break_node);
					graph_with_successors.addNode(new_break_identifier, break_node);

					graph_with_successors.removeEdge(src, succ);

					graph.addEdge(src, new_break_identifier, data);
					graph_with_successors.addEdge(src, new_break_identifier, data);

					graph_with_successors.addEdge(new_break_identifier, succ);

				}
			}
		}

		// Find loop repetition condition
		function _find_condition(graph_with_successors, region_successors, loop_head) {
			let head_successors = graph_with_successors.successors(loop_head);
			if (head_successors.length == 0) {
				throw new Error(`Loop head ${loop_head} does not have successors?`)
			} else if (head_successors.length == 1) {
				// Head does not branch
				return null;
			} else if (head_successors.length > 2) {
				throw new Error(`Loop head ${loop_head} has too many successors ${head_successors.length}`)
			}

			// Find the edge staying in the graph
			let inside_successors = head_successors.filter(s => !region_successors.includes(s));
			if (inside_successors.length == 0) {
				throw new Error(`Loop head ${loop_head} has multiple successors leaving the region?`)
			} else if (inside_successors.length == 2) {
				// Both successors are staying inside this region => this is not a while condition but an if-then/if-then-else
				return null;
			}

			// We now have for sure one edge leaving the region and one staying inside the region. Use the one staying inside as condition
			let edge_data = get_edge_data(graph_with_successors, loop_head, inside_successors[0]);
			return edge_data.expression;
		}

		_rewrite_jumps_to_continues(this.region.graph, this.region.graph_with_successors, this.region.head);
		_rewrite_jumps_to_breaks(this.region.graph, this.region.graph_with_successors, this.region.successors, this.region.head);
		let test_condition = _find_condition(this.region.graph_with_successors, this.region.successors, this.region.head );

		return test_condition;
	}
}

module.exports.IterativeStructurer = IterativeStructurer;
