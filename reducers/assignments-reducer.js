const { MonoidalReducer } = require("shift-reducer");
const { ListMonad } = require("./monads");

// Returns a ListMonad object whose `value` field contains all the assignments to a given target variable
class AssignmentsCollector extends MonoidalReducer {
	constructor(target_var) {
		if (target_var === undefined) {
			throw new Error("The target var can't be undefined")
		}
		super(ListMonad);
		this.target_var = target_var;
	}

	reduceVariableDeclarator(node, state) {
		if (node.binding.name === this.target_var) {
			return new ListMonad({values: [node.init]}).concat(super.reduceVariableDeclarator(node, state));
		} else {
			return super.reduceVariableDeclarator(node, state)
		}
	}

	reduceAssignmentExpression(node, state) {
		if (node.binding.name === this.target_var) {
			return new ListMonad({values: [node.expression]}).concat(super.reduceAssignmentExpression(node, state));
		} else {
			return super.reduceAssignmentExpression(node, state)
		}
	}

}

module.exports.AssignmentsCollector = AssignmentsCollector;
