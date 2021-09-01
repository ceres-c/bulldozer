/*
 * This file is a quasi-copy of angr's region analyzer
 */
const globals = require('../helpers/globals');
const jsnx = require('jsnetworkx');
const {
	dfs_back_edges,
	slice_graph,
	dfs_postorder_nodes,
	immediate_dominators,
	dominates,
	dominance_frontiers,
	get_edge_data,
	get_node_data,
	generate_random_identifier,
	update_node_data,
	node_type,
	edge_type,
} = require('./graph_utils');
const { GraphRegion } = require('./graph_region');
const { IdentifierExpression, ExpressionStatement, AssignmentExpression, AssignmentTargetIdentifier, LiteralBooleanExpression, UnaryExpression, VariableDeclarationStatement, VariableDeclaration, VariableDeclarator, BindingIdentifier } = require('shift-ast');

class RegionIdentifier {
	constructor(graph, start_node) {
		this.graph = new jsnx.DiGraph(graph) // Make a local copy
		this.graph_start_state = start_node;
		this.loop_headers = new Set();
		for (let [_, dst] of dfs_back_edges(graph, this.graph_start_state)) {
			// Backedges are pointing from the loop's bottom node to the loop header, thus their target node is the loop's heaeder
			this.loop_headers.add(dst)
		}
	}

	analyze() {
		return this._make_regions(this.graph);
	}

	_make_regions(graph) {
		let structured_loop_headers = new Set();
		let new_regions = [];

		globals.debug && console.log("Creating regions");
		// Find all loops
		let restart;
		let ignore_nested = false;
		while (structured_loop_headers.size < this.loop_headers.size){
			do {
				restart = false;
				// Start from loops

				for (let loop_header of this.loop_headers) {
					if (structured_loop_headers.has(loop_header)) {
						continue;
					}
					let [region_identifier, region] = this._make_cyclic_region(graph, loop_header, ignore_nested);
					if (region !== undefined && region_identifier !== undefined ) {
						if (region.graph.node.has(this.graph_start_state)) {
							console.log("Bubbling head"); // TODO remove
							// Head has been embedded in region, update this.graph_start_state with region's identifier
							this.graph_start_state = region_identifier;
						}
						if (ignore_nested) {
							ignore_nested = false; // Ignore only one nested loop, then try again all the other loops
							region.graph.nodes()
								.filter(n => this.loop_headers.has(n)) // Consider structured all the loop nodes included in this region
								.forEach(n => structured_loop_headers.add(n))
						} else {
							structured_loop_headers.add(loop_header);
						}
						globals.debug && console.log("Created cyclic region");
						new_regions.push(region); // Push this new region in a local list
						restart = true;
					}
				}
			} while (restart)

			// Now we want to analyze the first the abnormal loop
			ignore_nested = true;
		}

		globals.debug && console.log("Created", structured_loop_headers.size, "cyclic regions.");
		globals.debug && console.log("No more loops left. Start structuring acyclic regions.");

		let [_, first_node_data] = graph.node.entries().next().value; // Avoid generating the whole nodes list using an iterator
		// 							    iterator's value field ^
		if (graph.node.size > 1 || first_node_data.type != node_type.region) {
			// Push the whole graph as well
			new_regions.push(new GraphRegion(this.graph_start_state, graph, undefined, undefined, false));
		}

		// No more loops left. Structure acyclic regions.
		for (let region of new_regions) {
			let failed_region_attempts = new Set();
			let found_acyclic, new_head;

			do {
				[found_acyclic, new_head] = this._make_acyclic_region(
					// TODO reorganize parameters to match GraphRegion definition
					region.head, region.graph, region.graph_with_successors, region.successors, failed_region_attempts, region.cyclic
				);

				if (found_acyclic) {

					region.head = new_head;

					if (region.cyclic) { // TODO move to make_acyclic
						// In cyclic regions, _make_acyclic_region modifies graph_with_successors only. We need to update graph as well
						region.graph = new jsnx.DiGraph(region.graph_with_successors);
						for (let succ of region.successors) {
							update_node_data(region.graph_with_successors, succ, {}); // Preserve general structure of successors without data
							region.graph.removeNode(succ);
						}
					}
				}

			} while (found_acyclic)
		}

		// Return outermost region (that is the last one created)
		return new_regions[new_regions.length - 1];
	}

	_make_cyclic_region(graph, loop_header, ignore_nested) {
		globals.debug && console.log("Found cyclic region starting on state:", loop_header);

		let initial_loop_nodes = this._find_initial_loop_nodes(graph, loop_header);

		// Make sure there are no other loops contained in the current loop
		let has_nested_loops = [...initial_loop_nodes].find(
						n => this.loop_headers.has(n) && n != loop_header
						// One of the nodes of this loop is a known backedge and it's not the header of this loop
		);
		if (has_nested_loops && !ignore_nested) {
			globals.debug && console.log("Aborting, found nested loop. Will try again later");
			return [undefined, undefined];
		} else if (ignore_nested) {
			globals.debug && console.log("Found nested loop, most likely abnormal. Forcing generation");
		}

		globals.debug && console.log("\tInitial loop nodes:", initial_loop_nodes);

		// Search for normal entries...
		let normal_entries = new Set(graph.predecessors(loop_header).filter(n => !initial_loop_nodes.has(n)));
		globals.debug && console.log("\tNormal loop entries:", normal_entries);

		// ... and abnormal entries
		let abnormal_entries = new Set();
		for (let n of initial_loop_nodes) {
			if (n == loop_header) {
				continue;
			}
			for (let pred of graph.predecessorsIter(n)) {
				if (!initial_loop_nodes.has(pred)) {
					abnormal_entries.add(pred)
				}
			}
		}
		globals.debug && console.log("\tAbnormal loop entries:", abnormal_entries);

		let initial_exit_nodes = new Set();
		for (let n of initial_loop_nodes) {
			graph.successors(n).filter(n => !initial_loop_nodes.has(n)).forEach(n => initial_exit_nodes.add(n));
		}
		globals.debug && console.log("\tLoop initial exit nodes:", initial_exit_nodes);

		// Refine exits (move some wrongly identified exit nodes inside the loop)
		let [refined_loop_nodes, refined_exit_nodes] = this._refine_loop(graph, loop_header, initial_loop_nodes, initial_exit_nodes);
		globals.debug && console.log("\tRefined loop nodes:", refined_loop_nodes);
		globals.debug && console.log("\tRefined exit nodes:", refined_exit_nodes);

		let normal_exit_node, abnormal_exit_nodes;
		if (refined_exit_nodes.size > 1) {
			let node_post_order = [...dfs_postorder_nodes(graph, loop_header)];
			let sorter = (a, b) => node_post_order.indexOf(a) - node_post_order.indexOf(b);
			let sorted_exit_nodes = [...refined_exit_nodes].sort(sorter); // Cast exit nodes to array and sort them
			normal_exit_node = sorted_exit_nodes.shift();
			abnormal_exit_nodes = new Set(sorted_exit_nodes); // Already shifted out first element
		} else {
			normal_exit_node = refined_exit_nodes.size > 0 ? refined_exit_nodes.values().next().value : undefined;
			abnormal_exit_nodes = new Set();
		}

		let new_region_identifier = generate_random_identifier(graph);
		let region = this._abstract_cyclic_region(graph, refined_loop_nodes, loop_header, normal_entries, abnormal_entries,
												  normal_exit_node, abnormal_exit_nodes, new_region_identifier)

		if (region.successors.length > 1) {
			// Multi-successor region. refinement is required
			globals.debug && console.log(`Cyclic region starting on ${region.head} has multiple successors, they'll be replaced to a cascade of if-else exits`);
			this._refine_loop_successors(region, new_region_identifier, graph)
		}

		return [new_region_identifier, region];
	}

	// Find nodes related to a loop, given a graph and a backedge (edge is a list with two elements: [source, target])
	// Returns a set of node identifiers
	_find_initial_loop_nodes(graph, loop_header) {
		let latching_nodes = [];
		for (let [src, dst] of dfs_back_edges(graph, this.graph_start_state)) {
			// Filter backedges looping back into this specific loop_header
			if (dst == loop_header) {latching_nodes.push(src);}
		}

		let loop_subgraph = slice_graph(graph, loop_header, latching_nodes, true); // Include frontier
		return new Set(loop_subgraph.nodes());
	}

	_refine_loop(graph, head, initial_loop_nodes, initial_exit_nodes) {
		let refined_loop_nodes = new Set(initial_loop_nodes); // Local copies
		let refined_exit_nodes = new Set(initial_exit_nodes);

		let idom = immediate_dominators(graph, this.graph_start_state);

		let new_exit_nodes = new Set(refined_exit_nodes);
		while (refined_exit_nodes.size > 1 && new_exit_nodes.size > 0) {
			new_exit_nodes.clear();
			for (let n of refined_exit_nodes) {
				if ( graph.predecessors(n).every(pred => refined_loop_nodes.has(pred)) && dominates(idom, head, n) ) {
					// If every predecessor of n is part of the loop & n is dominated by head
					refined_loop_nodes.add(n); // Add to refined loop
					refined_exit_nodes.delete(n); // Remove from exits

					for (let u of graph.successors(n)) {
						if (!refined_loop_nodes.has(u)) {
							new_exit_nodes.add(u)
						}
					}
				}
			}

			new_exit_nodes.forEach(n => refined_exit_nodes.add(n)); // Add all the newly found exits to the refined list
		}

		refined_exit_nodes.forEach(n => refined_loop_nodes.delete(n)) // Remove all the new exits from the loop nodes

		return [refined_loop_nodes, refined_exit_nodes]
	}

	// Generate a cyclic region, add it to the graph, remove from the graph all the nodes now included in the new region.
	// Returns:
	//	- The same region that is added to the graph (as in reference to the same object)
	_abstract_cyclic_region(graph, loop_nodes, head, normal_entries, abnormal_entries, normal_exit_node, abnormal_exit_nodes, new_region_identifier) {
		if (abnormal_entries.size > 0) {
			// TODO Print something here
			// Multiple entries, generate entry chain
			[head, normal_entries] = this._refine_loop_entries(graph, loop_nodes, normal_entries, abnormal_entries); // Overwrite head with new value
			abnormal_entries = new Set();
		}

		let region = new GraphRegion(head, undefined, undefined, undefined, true);

		let subgraph = new jsnx.DiGraph();
		let region_outedges = [];

		let node_attrs = {};
		node_attrs.type = node_type.region;
		node_attrs.region = region;

		graph.addNode(new_region_identifier, node_attrs);



		for (let node of loop_nodes) {
			let node_optAttrs = graph.node.get(node);
			subgraph.addNode( node, node_optAttrs );
			let in_edges = graph.inEdgesIter(node, true); // Get data as well
			let out_edges = graph.outEdgesIter(node, true);

			for (let [src, dst, data] of in_edges) {
				if (normal_entries.has(src)) {
					graph.addEdge(src, new_region_identifier, data);
				} else if (abnormal_entries.has(src)) {
					throw new Error("Unhandled abnormal entry edge" + src + "->" + dst) // TODO remove once abnormal entries are be properly handled
					globals.ABNORMAL_LOOP_ENTRIES.push(["head", head, src, "->", dst])
					// Entering the cyclic region not through loop_header
					data.region_dst_node = dst; // TODO do something with this data, generate an entry if-tree alike exit
					graph.addEdge(src, new_region_identifier, data);
				} else if (loop_nodes.has(src)) {
					subgraph.addEdge(src, dst, data);
				} else if (src == new_region_identifier) {
					subgraph.addEdge(head, dst, data);
				} else {
					throw new Error(`Invalid edge ${src}->${dst} when adding in_edges to region`);
				}
			}

			for (let [src, dst, data] of out_edges) {
				if (loop_nodes.has(dst)) {
					subgraph.addEdge(src, dst, data);
				} else if (dst == new_region_identifier) {
					subgraph.addEdge(src, head, data);
				} else if (dst == normal_exit_node) {
					region_outedges.push([node, dst, data]);
					graph.addEdge(new_region_identifier, dst, data);
				} else if (abnormal_exit_nodes.has(dst)) {
					region_outedges.push([node, dst, data]);
					// data.region_src_node = src;
					graph.addEdge(new_region_identifier, dst, data);
				} else {
					throw new Error(`Invalid edge ${src}->${dst} when adding out_edges to region`);
				}
			}
		}

		let subgraph_with_exits = new jsnx.DiGraph(subgraph)
		for (let [src, dst, data] of region_outedges) {
			subgraph_with_exits.addEdge(src, dst, data);
		}
		region.graph = subgraph;
		region.graph_with_successors = subgraph_with_exits;
		if (normal_exit_node !== undefined) {
			region.successors = [normal_exit_node];
		} else {
			region.successors = [];
		}
		region.successors = [...region.successors, ...abnormal_exit_nodes];

		for (let node of loop_nodes) {
			graph.removeNode(node);
		}

		return region;
	}

	/* Replaces all the out edges with one edge to a chain of branching nodes.
	 *
	 * Every edge leaving this region will be redirected to a new node, still
	 * inside the region (in region.graph), with a single statement:
	 *  LABEL_xxxx = true;
	 * Then all the nodes with label assignment are connected to the first node
	 * of a chain of branches outside the graph (first node of the chain will be in
	 * region.graph_with_successors). These branches are connected to the old
	 * successors basing on label's values.
	 * The region itself will have a statement: labels declaration and init to false
	 *
	 * Old situation:
	 * region.graph.nodes() = [241, 692, 53]
	 * region.graph_with_successors.nodes() = [241, 692, 53, 4296, 2056]
	 * region.successors = [4296, 2056]
	 * with 692 -> 4296
	 *      53  -> 2056
	 *
	 * After manipulation
	 * region.graph.nodes() = [241, 692, 53, 106543, 102594]
	 * region.graph_with_successors.nodes() = [241, 692, 53, 106543, 102594, 105426]
	 * region.successors = [105426]
	 * with 692    -> 106543
	 *      106543 -> 105426
	 *      53     -> 102594
	 *      102594 -> 105426
	 *
	 * 105426 has conditional edges with checks on LABEL_xxxx going to original successors
	 */
	_refine_loop_successors(region, region_identifier, graph) {
		if (region.successors.length < 2) {
			return;
		}

		// Save region successors, as they are
		let successors = [...region.successors]; // Local copy

		let _g = region.graph;
		let _gs = region.graph_with_successors;

		let exit_stack = [];

		for (let succ of successors) {
			// From every pred of every succ
			for (let pred of _gs.predecessorsIter(succ)) { // TODO rewrite with inEdgesIter and data
				let label = "LABEL_" + pred.toString() + succ.toString();

				// Fetch edge data from region.graph_with_successors, since succ are only there
				let edge_data = get_edge_data(_gs, pred, succ); // TODO use above edge data

				// Bring the successors inside the graph with a new node to assign the label to true
				let label_node_identifier = generate_random_identifier(_g);
				let label_node_data = {
					type: node_type.normal,
					statements: [
						new ExpressionStatement({
							expression: new AssignmentExpression({
								binding: new AssignmentTargetIdentifier({
									name: label,
								}),
								expression: new LiteralBooleanExpression({
									value: true
								})
							})
						})
					]
				};

				// Add to _g the new label node because we're setting the label there, add to _gs as well since it's a supergraph of _g
				_g.addNode(label_node_identifier, label_node_data);
				_gs.addNode(label_node_identifier, label_node_data);
				// Connect it to pred with old edge data because we need to mantain reaching conditions
				_g.addEdge(pred, label_node_identifier, edge_data);
				_gs.addEdge(pred, label_node_identifier, edge_data);
				// delete succ from _gs as it won't be directly accessible from the graph
				_gs.removeEdge(pred, succ);

				// Update the exit stack chain generating a fresh exit node
				let new_exit_node_identifier = generate_random_identifier(graph); // Must be unique in graph
				// Exit condition from exit node to succ checking the label
				let new_exit_edge_data = {
					type: edge_type.conditional,
					expression: [
						new IdentifierExpression({
							name: label
						})
					],
					original: true,
				};

				graph.addNode(new_exit_node_identifier, {type: node_type.empty, statements: []});
				graph.addEdge(new_exit_node_identifier, succ, new_exit_edge_data);

				if (exit_stack.length > 0) {
					// Connnect the previous exit node's alternative branch to the new topmost node
					let [previous_exit_identifier, previous_exit_label] = exit_stack[exit_stack.length - 1];

					let negated_edge_data = {
						type: edge_type.conditional,
						expression: [
							new UnaryExpression({
								operator: "!",
								operand: new IdentifierExpression({
									name: previous_exit_label
								})
							})
						],
						original: false,
					};
					graph.addEdge(previous_exit_identifier, new_exit_node_identifier, negated_edge_data);
				}

				// Add current exit and label to stack
				exit_stack.push([new_exit_node_identifier, label]);

				// Connect current label_node_identifier to the first exit node
				_gs.addEdge(label_node_identifier, exit_stack[0][0], {type: edge_type.normal, expression: []}); // No additional conditional expr

				// At this point pred is indirectly connected to succ like this:
				// pred -> label_node_identifier -> exit_identifier (possibly more than one exit, chained) -> succ
				// _g holds:	pred and label_node_identifier
				// _gs holds:	pred, label_node_identifier and exit_identifier[0]
				// graph holds:	all the (possibly) multiple exit_identifier
			}
			_gs.removeNode(succ) // Remove succ from _gs, all the edges have been changed already

		}

		// Delete last exit node and connect directly last succ to penultimate exit_node with appropriate edge condition
		// TODO decomment this maybe? Right now last condition will sit in the last else clause without an appropriate if switch
		// let [penultimate_exit_identifier, _] = exit_stack[exit_stack.length - 2];
		// let [last_exit_identifier, __] = exit_stack[exit_stack.length - 1];
		// let last_exit_successors = graph.successors(last_exit_identifier);
		// if (last_exit_successors.length == 0) {
		// 	// This shouldn't happen as we're generating the exit chains above
		// 	throw new Error(`Last node in exit chain has zero successors for loop starting in ${region.head}?`)
		// } else if (last_exit_successors.length > 1) {
		// 	// This shouldn't happen as we're generating the exit chains above
		// 	throw new Error(`Last node in exit chain has more than one successor for loop starting in ${region.head}?`)
		// }
		// let last_exit_succ = last_exit_successors[0]
		// graph.removeEdge(penultimate_exit_identifier, last_exit_identifier);
		// let last_edge_data = get_edge_data(graph, last_exit_identifier, last_exit_succ)
		// graph.addEdge(penultimate_exit_identifier, last_exit_succ, last_edge_data)

		// Retouch region and graph
		let [first_exit_node_identifier, ___] = exit_stack[0];
		region.successors = [first_exit_node_identifier];

		graph.addEdge(region_identifier, first_exit_node_identifier, {type: edge_type.normal, expression: []}); // No additional conditional expr
		for (let succ of successors) {
			graph.removeEdge(region_identifier, succ);
		}

		// Add labels declaration to region statements and initialize them to false
		region.statements.push(
			new VariableDeclarationStatement({
				declaration: new VariableDeclaration({
					kind: "let",
					declarators: exit_stack.map(([_, label]) => // Wrap all the labels in Declarators
						new VariableDeclarator({
							binding: new BindingIdentifier({
								name: label,
							}),
							init: new LiteralBooleanExpression({
								value: false
							}),
						})
					)
				})
			})
		);

	}

	/* // TODO EXPLAIN THIS
	 * This function redefine loop_node in place
	 * Parameters:
	 *	- graph: The whole graph from which the region should be extracted
	 *	- loop_nodes: the set of nodes which should be put in the loop
	 *	- normal_entries: Set of normal entries
	 *	- abnormal_entries: Set of abnormal entries
	 */
	_refine_loop_entries(graph, loop_nodes, normal_entries, abnormal_entries) {
		let new_loop_nodes = new Set(); // Holds all the newly generated nodes which will be added to the loop later
		let new_loop_entries = new Set();
		let entry_stack = [];
		let first_entry = undefined; // All the entries must go to the first node in the entry chain

		// Treat all the entries indifferently
		let entries = new Set([...normal_entries, ...abnormal_entries]);

		for (let node of loop_nodes) {

			// TODO check if this if can replace the other one below
			// if (graph.predecessors(node).every( p => !entries.has(p)) ) {
			//	// All the predecessors are inside the loop => this node is not target of an entry
			// 	continue;
			// }

			if (graph.predecessors(node).some( p => entries.has(p)) ) {
				// This node is an entry point, need to change all its predecessors (whether they are inside and outside the loop)

				let label = "LABEL_" + node.toString();
				let label_node_data = {
					type: node_type.normal,
					statements: [
						new ExpressionStatement({
							expression: new AssignmentExpression({
								binding: new AssignmentTargetIdentifier({
									name: label,
								}),
								expression: new LiteralBooleanExpression({
									value: true
								})
							})
						})
					]
				};
				let new_entry_edge_data = {
					type: edge_type.conditional,
					expression: [
						new IdentifierExpression({
							name: label
						})
					],
					original: true,
				};

				// Update the entry stack chain generating a fresh dispatcher entry node
				let new_entry_node_identifier = generate_random_identifier(graph); // Must be unique in graph
				graph.addNode(new_entry_node_identifier, {type: node_type.empty, statements: []}); // Add it to the graph
				new_loop_nodes.add(new_entry_node_identifier); // Add it to the loop as well

				if (entry_stack.length == 0) {
					// If we haven't yet popuplated the stack, then the current entry_node_identifier will be the target of all entries
					first_entry = new_entry_node_identifier;
				}

				// Search for all the predecesors of the current node and connet them to the dispacher
				for (let [src, _, data] of graph.inEdgesIter(node, true)) { // true = Get data as well

					let label_node_identifier = generate_random_identifier(graph);

					// Add to graph the new label node because we're setting the label there
					graph.addNode(label_node_identifier, label_node_data);
					// Connect it to pred with old edge data because we need to mantain reaching conditions
					graph.addEdge(src, label_node_identifier, data);
					graph.addEdge(label_node_identifier, first_entry);
					// Delete the old edge to entry
					graph.removeEdge(src, node);

					if (loop_nodes.has(src)) {
						// Coming from inside the loop, not an entry but a local edge or a backedge. The label setter node must be part of the loop as well
						new_loop_nodes.add(label_node_identifier);
					} else {
						// The label setter node is one of the new entries
						new_loop_entries.add(label_node_identifier);
					}
				}

				// Connect the new dispatcher to the original entry node
				graph.addEdge(new_entry_node_identifier, node, new_entry_edge_data);

				if (entry_stack.length > 0) {
					// There are already other entry nodes,
					// connnect the previous entry node's alternative branch to this new dispatcher node
					let [previous_entry_identifier, previous_entry_label] = entry_stack[entry_stack.length - 1];

					let negated_edge_data = {
						type: edge_type.conditional,
						expression: [
							new UnaryExpression({
								operator: "!",
								operand: new IdentifierExpression({
									name: previous_entry_label
								})
							})
						],
						original: false,
					};
					graph.addEdge(previous_entry_identifier, new_entry_node_identifier, negated_edge_data);
				}

				// Add current entry and label to stack
				entry_stack.push([new_entry_node_identifier, label])
			}

		}

		[...new_loop_nodes].forEach(n => loop_nodes.add(n)); // Updating via foreach to retain loop_nodes object reference, not overwriting

		let [first_entry_identifier, _] = entry_stack[0];
		return [first_entry_identifier, new_loop_entries];
	}

	// TODO reorganize parameters to match GraphRegion definition
	_make_acyclic_region(head, graph, secondary_graph, successors, failed_region_attempts, cyclic) {
		// pre-processing

		// We might need to create a copy of the original graph if
		// - there are in edges to the head node, or
		// - there are more than one end nodes
		let graph_copy;
		let _g;
		if (cyclic) {
			_g = secondary_graph;
		} else {
			_g = graph;
		}

		globals.debug && console.log("Analyzing acyclic region starting on", head);

		let head_inedges = _g.inEdges(head);
		let removed_backedges_sources = new Set();
		if (head_inedges.length > 0) {
			// We need a copy of the graph to remove edges coming into the head
			graph_copy = new jsnx.DiGraph(_g);
			// Remove any in-edge to the head node
			for (let [src, _] of head_inedges) {
				graph_copy.removeEdge(src, head);
				removed_backedges_sources.add(src)
			}
		} else {
			graph_copy = _g;
		}

		// Find all the endnodes, excluding those that were backedges. Backedge sources have a outdegree >= 1 but,
		// due to the above deletion of backedges, some might now have a outdegree = 0
		let endnodes = graph_copy.nodes().filter(n => graph_copy.outDegree(n) == 0 && !removed_backedges_sources.has(n));
		let endnode, dummy_endnode;
		if (endnodes.length == 0) {
			// Sanity check: there should be at least one end node
			console.log(`[!] No end node is found in a supposedly acyclic graph starting on node ${head}. Is it really acyclic?`);
			return [false, undefined];
		}

		if (endnodes.length > 1) {
			// We need a copy of both graphs!
			graph_copy = new jsnx.DiGraph(graph_copy);

			// If this graph has multiple end nodes: create a single end node
			dummy_endnode = globals.DUMMY_NODE_ID
			for (let node of endnodes) {
				if (_g.outDegree(node) != 0) {
					throw new Error(`While merging out edges, graph_copy and _g were inconsistent because ${node} had successors in _g and not in graph_copy`);
				}
				graph_copy.addEdge(node, dummy_endnode);
				_g.addEdge(node, dummy_endnode); // These new edges will be permanently added to the ORIGINAL graph. Mind that // TODO maybe create a copy
			}
			endnode = dummy_endnode;
		} else {
			endnode = endnodes[0];
		}

		// Compute dominator tree on original graph, with the backedges (if any)
		let doms = immediate_dominators(_g, head);

		// Compute post-dominator tree
		_g.reverse(false); // Reverse the graph in place
		let postdoms = immediate_dominators(_g, endnode);
		_g.reverse(false); // Reverse it back

		// Dominance frontiers
		let df = dominance_frontiers(_g, head);

		// Visit region's nodes depth first in post-order
		for (let node of dfs_postorder_nodes(_g, head)) {
			if (node == endnode) { // Comparison allowed, as dummy_endnode is a number
				// Skip the dummy endnode
				continue;
			}
			if (cyclic && node == head) {
				// TODO check if actually needed - is dsf_postorder looping back? If not can be deleted
				// TODO Maybe, since we're using graph_with_successors, below code might not find a suitable region
				continue;
			}

			if (_g.outDegree(node) == 0) {
				// The root element of the region hierarchy should always be a GraphRegion,
				// So we transform it into one, if necessary
				if (_g.inDegree(node) == 0 && _g.node.get(node).type != node_type.region) {
					let subgraph = new jsnx.DiGraph();
					subgraph.addNode(node);
					let region_identifier = generate_random_identifier(_g);
					this._abstract_acyclic_region(_g, new GraphRegion(node, subgraph, undefined, undefined, false), region_identifier, 
												  [], secondary_graph);
				}
				continue;
			}

			// Test if this node is an entry to a single-entry, single-successor region
			let postdom_node = postdoms.get(node)
			while (postdom_node !== undefined) {
				if (postdom_node == head || successors.includes(postdom_node)) { // TODO maybe move this to the bottom of the loop
					// Regions looping back into head or ending outside the loop must be ignored
					break;
				}

				// Use JSON.stringify as JS' builtin data structures do not support natively objects hashing
				if ( !failed_region_attempts.has( JSON.stringify([node, postdom_node]) ) ) {

					if (_check_region(graph_copy, node, postdom_node, doms, df)) {
						// It is indeed a s-e, s-s region

						// Find frontier and isolate the s-e, s-s region
						let frontier = new Set([ postdom_node ]);
						let region = _compute_region(graph_copy, node, frontier, false);
						// The newly computed region object might contain this region's head. In that case it'd be impossible to find this region's head in current graph_copy as soon as the new region will be inserted in this region's graph_copy, removing the head. New head of this region should be the new region.

						if (region !== undefined) {

							globals.debug && console.log("Node", node, "frontier", frontier);

							let region_identifier = generate_random_identifier(_g);
							if (cyclic) {
								// In case of cyclic regions, we're guaranteed to have only one endnode by make_cyclic_region
								// In case of cyclic regions _g = graph_with_successors
								this._abstract_acyclic_region(_g, region, region_identifier, frontier, endnode);
							} else {
								// In case of acyclic regions _g = graph
								this._abstract_acyclic_region(
									_g, region, region_identifier, frontier, endnode, secondary_graph
								);
							}

							let new_head = head;
							if (!_g.node.has(head)) {
								// Newly generated region contains old head, which means it has been deleted by _abstract_acyclic_region in order
								// to replace it with the region itself. We need to replace callee's head with the generated region's identifier.
								new_head = region_identifier;
							}

							return [true, new_head];

						}

					}

				}

				failed_region_attempts.add( JSON.stringify([node, postdom_node]) );

				if (!dominates(doms, node, postdom_node)) {
					break;
				}
				if (postdom_node == postdoms.get(postdom_node)) {
					break;
				}

				postdom_node = postdoms.get(postdom_node)
			}

		}

		return [false, undefined];
	}

	// Remove from graph every node in region, replace all out/in edges to any node in region with references to the region itself
	// region_identifier is the node identifier that will be assigned to the region object when it'll be added to the graph
	_abstract_acyclic_region(graph, region, region_identifier, frontier, dummy_endnode=undefined, secondary_graph=undefined) {
		let in_edges = _region_in_edges(graph, region, true); // Get data as well
		let out_edges = _region_out_edges(graph, region, true);

		let region_nodes_set = new Set();
		for (let node_ of region.graph.nodes()) {
			region_nodes_set.add(node_);
			if (node_ !== dummy_endnode) {
				graph.removeNode(node_);
			}
		}

		let node_attrs = {};
		node_attrs.type = node_type.region;
		node_attrs.region = region;
		// node_attrs.statements = [];

		graph.addNode(region_identifier, node_attrs);
		// Generating the random identifier here broke everything because the subsequent call with secondary_graph
		// would assign to the same region another, different, identifier and that broke the graph.

		for (let [src, _, data] of in_edges) {
			if (!region_nodes_set.has(src)) {
				graph.addEdge(src, region_identifier, data);
			}
		}

		for (let [_, dst, data] of out_edges) {
			if (!region_nodes_set.has(dst)) {
				graph.addEdge(region_identifier, dst, data)
			}
		}

		if (frontier.size > 0) {
			for (let frontier_node of frontier) {
				if (frontier_node !== dummy_endnode) {
					graph.addEdge(region_identifier, frontier_node)
				}
			}
		}

		if (secondary_graph !== undefined) {
			this._abstract_acyclic_region(secondary_graph, region, region_identifier, new Set())
		}
	}

}

// Return a list of all the nodes entering the region. Note it will return region head as a destination
// [source_node, region_head, edge_data] (data is optional)
function _region_in_edges(graph, region, data=false) {
	return graph.inEdges(region.head, data);
}

// Return a list of all the edges leaving the region (possibly repeated if more nodes inside the region point to the same outer node)
// [region_object, destination_node, edge_data] (data is optional)
function _region_out_edges(graph, region, data=false) {
	let out_edges = [ ];
	for (let node of region.graph.nodes()) {
		let out_ = graph.outEdges(node, data)
		for (let [_, dst, data_] of out_) {
			if (region.graph.node.has(dst)) {
				continue
			}
			out_edges.push([region, dst, data_])
		}
	}
	return out_edges;
}

function _check_region(graph, start_node, end_node, doms, df) {
	let dfn;
	let frontier;

	// If the exit node is the header of a loop that contains the start node, the dominance frontier should only contain the exit node.
	if (!dominates(doms, start_node, end_node)) {
		dfn = df.get(start_node);
		frontier = dfn !== undefined ? dfn : new Set();
		for (let node of frontier) {
			if (node != start_node && node != end_node) {
				return false
			}
		}
	}

	// No edges should enter the region
	dfn = df.get(end_node);
	frontier = dfn !== undefined ? dfn : new Set();
	for (let node of frontier) {
		if (dominates(doms, start_node, node) && node != end_node) {
			return false;
		}
	}

	// No edges should leave the region
	dfn = df.get(start_node);
	frontier = dfn !== undefined ? dfn : new Set();
	for (let node of frontier) {
		if (node == start_node || node == end_node) {
			continue;
		}
		let end_dfn = df.get(end_node);
		let end_frontier = end_dfn !== undefined ? end_dfn : new Set();
		if (!end_frontier.has(node)) {
			return false;
		}
		for (let pred of graph.predecessorsIter(node)) {
			if (dominates(doms, start_node, pred) && !dominates(doms, end_node, pred)) {
				return false;
			}
		}
	}

	return true;
}

// frontier: set of frontier nodes
function _compute_region(graph, node, frontier, include_frontier=false) {
	let subgraph = new jsnx.DiGraph();
	let frontier_edges = [ ];
	let node_stack = [ node ];
	let traversed = new Set();

	while (node_stack.length > 0) {
		let node_ = node_stack.pop();
		if (frontier.has(node_)) {
			continue;
		}
		traversed.add(node_);
		subgraph.addNode(node_, get_node_data(graph, node_));

		for (let succ of graph.successorsIter(node_)) {
			let edge_data = get_edge_data(graph, node_, succ);

			if (frontier.has(node_) && traversed.has(succ)) {
				if (include_frontier) { // TODO probably this will have the same issue as make_cyclic with frontier, I might want to change it to something like:
					// If frontier nodes are included, do not keep traversing their successors
					// however, if it has an edge to an already traversed node, we should add that edge
					subgraph.addEdge(node_, succ, edge_data);
				} else {
					frontier_edges.push([node_, succ, edge_data]);
				}
				continue;
			}

			if (succ == globals.DUMMY_NODE_ID) {
				continue;
			}

			if (frontier.has(succ) && !include_frontier) {
				// skip all frontier nodes
				frontier_edges.push([node_, succ, edge_data]);
				// TODO probably this will have the same issue as make_cyclic with frontier, I might want to change this
				continue;
			}
			subgraph.addEdge(node_, succ, edge_data)
			if (!traversed.has(succ)) {
				node_stack.push(succ);
			}
		}
	}

	// We don't need the endnode here
	frontier = new Set([...frontier].filter(n => n != globals.DUMMY_NODE_ID))

	if (subgraph.node.size > 1) {
		let subgraph_with_frontier = new jsnx.DiGraph(subgraph);
		for (let [src, dst, edge_data] of frontier_edges) {
			if (dst != globals.DUMMY_NODE_ID) {
				subgraph_with_frontier.addEdge(src, dst, edge_data)
			}
		}

		// Convert frontier from a set to a list of nodes, they'll be region's successors
		return new GraphRegion(node, subgraph, [...frontier], subgraph_with_frontier, false);
	} else {
		return undefined;
	}
}

module.exports.RegionIdentifier = RegionIdentifier;