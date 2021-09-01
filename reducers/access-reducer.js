const reduce = require("shift-reducer");
const { VariableAccesses, MapMonad } = require("./monads");

class AccessReducer extends reduce.MonoidalReducer {
	constructor() {
		super(VariableAccesses);
	}

	// Useless types:
	//	- BindingIdentifier: Class names/functions parameters

	// TODO
	// reduceAssignmentTargetPropertyProperty
	// reduceAssignmentTargetPropertyIdentifier
	// reduceAssignmentTargetWithDefault

	static analyze(statement) {
		const reduced = reduce.default(new this, statement);
		return reduced;
	}

	reduceVariableDeclarator(node, {binding, init}) {
		const s = super.reduceVariableDeclarator(node, {binding, init});
		return s.add_accesses({assignments: new Map( [[node.binding.name, node.init]] )})
	}

	reduceAssignmentExpression(node, {binding, expression}) { // Anything to the left of a "="
		if (node.binding.type == "ArrayAssignmentTarget") {
			// e.g. [a, b] = [1, 2];
			var ret_map = new Map();
			let bindings = node.binding.elements;
			let expressions = node.expression.elements;
			for (let i = 0; i < bindings.length; i++) {
				// Note we want to iterate over the bindings, since code such as
				// [a, b] = [1, 2, 3];
				// will discard the last element of the array
				ret_map.set(bindings[i].name, expressions[i]);
			}
			const s = super.reduceArrayExpression(node.expression, {elements: [expression]});
			return s.add_accesses({assignments: ret_map})
		} else if (node.binding.type == 'ComputedMemberAssignmentTarget') {
			// e.g. Ei[67] = r;
			return super.reduceAssignmentExpression(node, {binding, expression});
		} else if (node.binding.type == 'StaticMemberAssignmentTarget') {
			// e.g. Qe.type = xo;
			const s = super.reduceAssignmentExpression(node, {binding, expression});
			// Mark the binding object (Qe) as written, altought this actually was an assignment to one of its attributes
			return s.add_accesses({writes: new Map( [[node.binding.object.name, node.expression]] ) });
		} else {
			const s = super.reduceAssignmentExpression(node, {binding, expression});
			return s.add_accesses({assignments: new Map( [[node.binding.name, node.expression]] ) });
		}
	}

	// CompoundAssignments are considered only writes, not reads
	reduceCompoundAssignmentExpression(node, {binding, expression}) {
		return super.reduceCompoundAssignmentExpression(node, {binding, expression})
					.add_accesses({writes: new Map( [[node.binding.name, node]] )})
	}

	reduceUpdateExpression(node, operand) {
		return super.reduceUpdateExpression(node, operand)
					.add_accesses({writes: new Map( [[node.operand.name, node]] )})
	}

	reduceIdentifierExpression(node) {
		return super.reduceIdentifierExpression(node)
					.add_accesses({reads: [node.name]});
	}

	reduceCallExpression(node, _ref) {
		var callee = _ref.callee,
			_arguments = _ref.arguments;
		return super.reduceCallExpression(node, { callee, arguments: _arguments }).remove_access({read: node.callee.name})
		// Remove the callee function itself
	}

	reduceComputedMemberAssignmentTarget(node, {object, expression}) {
		// e.g. ko[15] = 2
		return super.reduceComputedMemberAssignmentTarget(node, {object, expression}).remove_access({read: node.object.name})
		// Remove array's identifier from reads
	}

	// TODO need to implement this properly and probably fix the expr_statement accordingly
	// reduceUpdateExpression(node, {operand}) {
	// 	return super.reduceUpdateExpression(node, {operand}).add_accesses({
	// 		writes: new Map( [[node.operand.name, node]] ),
	// 		reads: [node.operand.name]
	// 	});
	// }

}

module.exports.analyze = function(statement) {
	return AccessReducer.analyze(statement)
}