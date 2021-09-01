const { MonoidalReducer } = require("shift-reducer");
const { MapMonad } = require("./monads");

// Returns a ListMonad object whose `value` field contains all the BlockStatements or FunctionBodies in a given script
class SwitchReducer extends MonoidalReducer {
	constructor() {
		super(MapMonad);
	}

	reduceSwitchCase(node, state) {

		// It's unsafe to simply check whether a given switch has subswitches with this reducer itself, since there are
		// switch cases with complex snippets, which might contain switches themselves. This is the safest, albeit verbose, way
		function has_subswitch(node) {
			return (
				(
					node.consequent.length == 2 && node.consequent[1].type === 'BreakStatement' ||
					node.consequent.length == 1 // Last case has no closing "break"
				) &&
				node.consequent[0].type === 'ExpressionStatement' &&
				node.consequent[0].expression.type === 'UnaryExpression' && node.consequent[0].expression.operator === '!' &&
				node.consequent[0].expression.operand.type === 'CallExpression' &&
				node.consequent[0].expression.operand.callee.type === 'FunctionExpression' &&
				node.consequent[0].expression.operand.callee.isAsync === false &&
				node.consequent[0].expression.operand.callee.isGenerator === false &&
				node.consequent[0].expression.operand.callee.name === null &&
				node.consequent[0].expression.operand.callee.body.statements.length === 1 &&
				node.consequent[0].expression.operand.callee.body.statements[0].type === 'SwitchStatement'
			);
		}

		if (node.test.type !== 'LiteralNumericExpression') {
			throw new Error(`Reducing switch-case with non-numeric cases: found a ${node.test.type} test condition.`)
		}

		if (node.consequent.lenght == 0) {
			return new MapMonad({map: new Map( [ [node.test.value, undefined ] ] )}); // TODO IS THIS REQUIRED?
		} else if (has_subswitch(node)) {
			// Current case has additional switch cases nested below
			return new MapMonad({map: new Map( [ [node.test.value, super.reduceSwitchCase(node, state) ] ] )}); // TODO shouldn't this be a call to "reduce(new SwitchReducer, node)" with final cast to map via MapMonad.toMap?
		} else {
			// No cases, return the statements themselve
			return new MapMonad({map: new Map( [ [node.test.value, node.consequent ] ] )});
		}
	}

}

module.exports.SwitchReducer = SwitchReducer;
