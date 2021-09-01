/*
 * GraphRegion represents a region of nodes.
 *  - head:         The head of the region.
 *  - graph:        The region graph.
 *  - successors:   A set of successors of nodes in the graph. These successors do not belong to the current
 *                  region.
 *  - graph_with_successors:    The region graph that includes successor nodes.
 */
const { update_node_data } = require("./graph_utils");

class GraphRegion {

	constructor(head, graph, successors, graph_with_successors, cyclic) {
		this.head = head;
		this.graph = graph;
		this.successors = successors === undefined ? [] : successors;
		// successors inside graph_with_successors should be treated as read-only. when deep-copying GraphRegion objects,
		// successors inside graph_with_successors are *not* deep copied. therefore, you should never modify any
		// successor node in graph_with_successors. to avoid potential programming errors, just treat
		// graph_with_successors as read-only.
		this.graph_with_successors = graph_with_successors;
		this.cyclic = cyclic;
		this.statements = [];
	}

	replace_region(identifier, new_region) {
		if (!this.graph.node.has(identifier)) {
			throw new Error(`Trying to replace region ${identifier} in region starting on ${this.head}, but this graph does not have supplied node. Graph nodes: ${this.graph.nodes()}`);
		}

		update_node_data(this.graph, identifier, new_region)
		if (this.graph_with_successors !== undefined) {
			update_node_data(this.graph_with_successors, identifier, new_region)
		}
	}
}

module.exports.GraphRegion = GraphRegion;
