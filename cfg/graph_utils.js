/*
 * Utility methods to extract informations from the control flow graph.
 * Most of this code is *heavily* inspired by angr's python implementation
 */

const jsnx = require('jsnetworkx');

// enums used almost everywhere for comparison
node_type = Object.freeze({
	normal: 0,
	empty: 3,
	region: 4
});
edge_type = Object.freeze({
	normal: 0,
	conditional: 1,
});

// Recursive depth-first search for "backwards" edges.
// Returns a generator of ordered pairs of two nodes [source, target] for any found backwards edge
function* dfs_back_edges(graph, start_node) {
	let visited = new Set();
	let finished = new Set();

	function* _dfs_back_edges_core(node) {
		visited.add(node);
		for (let [child_state, _] of graph.get(node)) { // Discard edge properties
			if (!finished.has(child_state)) {
				if (visited.has(child_state)) {
					yield [node, child_state];
				} else {
					for (let e of _dfs_back_edges_core(child_state)) {
						yield e;
					}
				}
			}
		}
		finished.add(node)
	}

	for (let e of _dfs_back_edges_core(start_node)) {
		yield e;
	}
}

// Used internally to generate node in pre, post, inorder.
// Taken from networkx implementation
function* _dfs_labeled_edges(G, source=undefined, depth_limit=undefined) {
	let visited = new Set();

	let nodes;
	if (source === undefined) {
		// Edges for all components
		nodes = G.nodes();
	} else {
		// Edges for components with source
		nodes = [source];
	}

	if (depth_limit === undefined) {
		depth_limit = G.node.size;
	}

	for (let start of nodes) {
		if (visited.has(start)) {
			continue;
		}
		yield [start, start, "forward"];
		visited.add(start);
		let stack = [ [start, depth_limit, G.successorsIter(start)] ];
		while (stack.length > 0) {
			let [parent, depth_now, iter] = stack[stack.length - 1]; // Peek topmost generator
			let children = iter.next();

			if (!children.done) {
				let child = children.value;
				if (visited.has(child)) {
					yield [parent, child, "nontree"];
				} else {
					yield [parent, child, "forward"];
					visited.add(child);
					if (depth_now > 1) {
						stack.push( [child, depth_now - 1, G.successorsIter(child) ] )
					}
				}
			} else {
				stack.pop();
				if (stack.length > 0) {
					yield [stack[stack.length - 1][0], parent, "reverse"]
				}
			}
		}
		yield [start, start, "reverse"]
	}
}

// Generate nodes in a depth-first-search post-ordering starting at source.
// Returns a generator of nodes in a depth-first-search post-ordering
function* dfs_postorder_nodes(G, source=undefined, depth_limit=undefined) {
    //edges = dfs_labeled_edges(G, source, depth_limit);
    //return (v for u, v, d in edges if d == "reverse")
	for (let [_, v, d] of _dfs_labeled_edges(G, source, depth_limit)) {
		if (d == "reverse") {
			yield v;
		}
	}
}

// Generate a slice of the graph from the head node to the given frontier. Mostly a wrapper around subgraph_between_nodes to handle self loops
//  - graph: The graph to work on.
//  - node: The starting node in the graph (number state identifier)
//  - frontier: A list of frontier nodes (numbers)
//  - include_frontier: Whether the frontier nodes are included in the slice or not (boolean)
// Returns a subgraph
function slice_graph(graph, node, frontier, include_frontier=false) {
	let subgraph = subgraph_between_nodes(graph, node, frontier, include_frontier);
	if (subgraph.node.length == 0) {
		// HACK: FIXME: for infinite loop nodes, this would return an empty set, so we include the loop body itself
		// Make sure this makes sense (EDG thinks it does)
		if (graph.has(node).has(node)) {
			subgraph.addEdge(node, node)
		}
	}
	return subgraph
}

// For a directed graph, return a subgraph that includes all nodes going from a source node to a list of target nodes (frontier).
//  - graph: The graph to work on
//  - source: The starting node in the graph (number state identifier)
//  - _frontier: A list of frontier nodes (numbers)
//  - include_frontier: Whether the frontier nodes are included in the slice or not (boolean)
// Returns a subgraph
function subgraph_between_nodes(_graph, source, _frontier, include_frontier=false) {
	let graph = new jsnx.DiGraph(_graph) // Make a local copy
	for (let pred of graph.predecessors(source)) {
		// Make sure we cannot go from any other node to the source node
		graph.removeEdge(pred, source);
	}

	let g0 = new jsnx.DiGraph();

	if (!graph.node.has(source) || _frontier.some(n => !graph.node.has(n))) {
		throw new Error("Source node or frontier nodes are not in the source graph.");
	}

	// BFS on graph and add new nodes to g0
	let queue = [ source ];
	let traversed = new Set();

	let frontier = new Set(_frontier);

	while (queue.length > 0) {
		let node = queue.shift();
		traversed.add(node);

		for ([_, succ, data] of graph.outEdgesIter(node, true)) { // data=true
			g0.addEdge(node, succ, data)
			if (traversed.has(succ) || frontier.has(succ)) {
				continue;
			}

			for (let frontier_node of frontier) {
				if (jsnx.hasPath(graph, {source: succ, target: frontier_node}) && !queue.includes(succ)) {
					// Irreducible cycles peroduced infinite queues, quick fix:	  ^^^^^^^^^^^^^^^^^^^^^
					queue.push(succ);
					break;
				}
			}
		}
	}

	let to_remove;
	do {
		to_remove = g0.nodes()
					.filter(n => !frontier.has(n))
					.filter(n => n != source)
					.filter(n => g0.outDegree(n) == 0 || g0.inDegree(n) == 0)
		g0.removeNodesFrom(to_remove)
	} while (to_remove.length > 0)

	if (!include_frontier) {
		// remove the frontier nodes
		g0.removeNodesFrom(frontier)
	}

	return g0
}

// Returns the immediate dominators of all nodes of a directed graph.
// Parameters
//  - graph: The DiGraph to work on
//  - start: A start node to compute dominance
// Returns: a Map keyed by nodes, containing the immediate dominators of each node reachable from start
// Note: Except for start, the immediate dominators are the parents of their corresponding nodes in the dominator tree.
// Implementation blatantly copied from networkx
function immediate_dominators(graph, start) {

	// Like python's enumerate, but returning the iterable's value first, then its index. e.g. tuples like [value, index]
	function* _enumerate_swapped(iterable) {
		let i = 0;
		for (const x of iterable) {
			yield [x, i];
			i++;
		}
	}

	if (!graph.node.has(start)) {
		throw new Error("start is not in graph when trying to compute immediate dominators");
	}

	let idom = new Map([[start, start]])
	let order = [...dfs_postorder_nodes(graph, start)]; // Spread the iterator over post ordered nodes (below we'll need a list)
	let dfn = new Map(_enumerate_swapped(order));

	order.pop();
	order.reverse();

	const intersect_reducer = (u, v) => {
		while (u != v) {
			while (dfn.get(u) < dfn.get(v)) {
				u = idom.get(u)
			}
			while (dfn.get(u) > dfn.get(v)) {
				v = idom.get(v)
			}
		}
		return u;
	};

	let changed = true;
	while (changed){
		changed = false;
		for (let u of order) {
			let new_idom = [...graph.predecessors(u)].filter(v => idom.has(v));
			new_idom = new_idom.reduce(intersect_reducer);
			if (!idom.has(u) || idom.get(u) != new_idom) {
				idom.set(u, new_idom);
				changed = true;
			}
		}
	}
	
	return idom
}

// Checkes wether a dominator_node dominates another node
function dominates(idom, dominator_node, node) {
	let n = node;
	while (n !== undefined) {
		if (n == dominator_node) {
			return true;
		}
		if (idom.has(n) && n != idom.get(n)) {
			n = idom.get(n);
		} else {
			n = undefined;
		}
	}
	return false;
}

// Returns the dominance frontiers of all nodes of a directed graph
// Returns a Map containing the dominance frontiers of each node reachable from start as lists
function dominance_frontiers(graph, start) {
	let idom = immediate_dominators(graph, start);

	let df = new Map();
	idom.forEach(function(_, key, _) {
		df.set(key, new Set());
	});

	for (let [u, _] of idom) {
		if (graph.pred.get(u).size > 1) {
			for (let [v, _] of graph.pred.get(u)) {
				if (idom.has(v)) {
					while (v != idom.get(u)) {
						df.get(v).add(u);
						v = idom.get(v);
					}
				}
			}
		}
	}

	return df
}

// Returns the attribute object associated with edge (u, v)
function get_edge_data(graph, u, v) {
	// Find the edge where the second element of array [src, target, data] matches target, return data only
	let edge = graph.outEdges(u, true).find(e => e[1] == v);
	return edge !== undefined ? edge[2] : undefined; // Return data only
}

// Updates data for a specified node in graph
function update_node_data(graph, node, new_data) {
	let in_edges = graph.inEdges(node, true);
	let out_edges = graph.outEdges(node, true);

	graph.removeNode(node)
	graph.addNode(node, new_data)

	for (let [src, _, data] of in_edges) {
		graph.addEdge(src, node, data);
	}

	for (let [_, dst, data] of out_edges) {
		graph.addEdge(node, dst, data);
	}
}

function generate_random_identifier(graph) {
	let region_identifier;
	do {
		// Generate a (big) pseudo random number to avoid interfering with other graph nodes
		region_identifier = 100000 + graph.node.size + Math.floor(Math.random() * 10000);
	} while (graph.node.has(region_identifier))
	return region_identifier;
}

module.exports.dfs_back_edges = function (graph, start_node) {
	return dfs_back_edges(graph, start_node);
};
module.exports.slice_graph = function(graph, node, frontier, include_frontier=false) {
	return slice_graph(graph, node, frontier, include_frontier);
}
module.exports.immediate_dominators = function(graph, start) {
	return immediate_dominators(graph, start);
}
module.exports.dominates = function(idom, dominator_node, node) {
	return dominates(idom, dominator_node, node);
}
module.exports.dfs_postorder_nodes = function(graph, start_node) {
	return dfs_postorder_nodes(graph, start_node);
}
module.exports.dominance_frontiers = function(graph, start_node) {
	return dominance_frontiers(graph, start_node);
}
module.exports.get_edge_data = function(graph, u, v) {
	return get_edge_data(graph, u, v);
}
module.exports.get_node_data = function(graph, u) {
	return graph.node.get(u);
}
module.exports.update_node_data = function(graph, node, new_data) {
	update_node_data(graph, node, new_data);
}
module.exports.generate_random_identifier = function(graph) {
	return generate_random_identifier(graph);
}
module.exports.node_type = node_type;
module.exports.edge_type = edge_type;
