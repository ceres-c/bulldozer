const { MonoidalReducer } = require("shift-reducer");
const { ListMonad } = require("./monads");

// Returns a ListMonad object whose `value` field contains all the "block-like" parts
// of a given script (e.g. BlockStatement and FunctionBody)
class BlocksCollector extends MonoidalReducer {
	constructor() {
		super(ListMonad);
	}

	reduceBlock(node, state) {
		return new ListMonad({values: [node]}).concat(super.reduceBlock(node, state));
	}

	reduceFunctionBody(node, state) {
		return new ListMonad({values: [node]}).concat(super.reduceFunctionBody(node, state))
	}

}

module.exports.BlocksCollector = BlocksCollector;
