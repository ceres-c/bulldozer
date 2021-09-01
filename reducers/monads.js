// Hold reads/writes/assignments
class VariableAccesses {
	constructor(
		{
			reads = new Set, // An array can be passed here as well
			writes = new Map,
			assignments = new Map,
		} = {},
	) {
		this.reads = reads;
		this.writes = writes;
		this.assignments = assignments;
	}

	static empty () {
		return EMPTY_VariableAccesses;
	}

	concat(b) {
		if (this === b) {
			return this;
		}
		return new VariableAccesses({
			reads: new Set([...this.reads, ...b.reads]),
			writes: new Map([...this.writes, ...b.writes]),
			assignments: new Map([...this.assignments, ...b.assignments]),
		});
	}

	add_accesses({
		reads = new Set, // An array can be passed here as well
		writes = new Map,
		assignments = new Map,
	}) {
		return new VariableAccesses({
			reads: new Set([...this.reads, ...reads]),
			writes: new Map([...this.writes, ...writes]),
			assignments: new Map([...this.assignments, ...assignments]),
		});
	}

	// Remove a single access
	remove_access({
		read,
		write,
		assignment
	}) {
		return new VariableAccesses({
			reads: new Set([...this.reads].filter(x => x != read)),
			writes: new Map([...this.writes].filter(x => x[0] != write)),
			assignments: new Map([...this.assignments].filter(x => x[0] != assignment)),
		});
	}
}
EMPTY_VariableAccesses = new VariableAccesses({});

// Holds a boolean // TODO remove, if unused
class BooleanMonad {
	constructor(x = false) {
		this.result = x;
	}

	static empty () {
		return EMPTY_BooleanMonad;
	}

	concat(b) {
		if (this === b) {
			return this;
		}
		return new BooleanMonad(this.result || b.result);
	}
}
EMPTY_BooleanMonad = new BooleanMonad({});

// Hold a list of items
class ListMonad {
	constructor(
		{
			values = [],
		} = {},
	) {
		this.values = values;
	}

	static empty () {
		return EMPTY_ListMonad;
	}

	concat(b) {
		if (this === b) {
			return this;
		}
		return new ListMonad({
			values: [...this.values, ...b.values],
		});
	}
}
EMPTY_ListMonad = new ListMonad();

// Hold a Map object
class MapMonad {
	constructor(
		{
			map = new Map(),
		} = {},
	) {
		this.map = map;
	}

	static empty () {
		return EMPTY_MapMonad;
	}

	concat(b) {
		if (this === b) {
			return this;
		}
		return new MapMonad({
			map: new Map([...this.map, ...b.map]),
		});
	}

	// Convert a MapMonad with nested MapMonads to a JS Map object
	static toMap(map_monad) {
		// Naive recursive approach
		let ret_map = new Map();
		for (let [key, val] of map_monad.map) {
			if (val instanceof MapMonad) {
				ret_map.set(key, MapMonad.toMap(val));
			} else {
				ret_map.set(key, val);
			}
		}
		return ret_map;
	}
}
EMPTY_MapMonad = new MapMonad();

module.exports.VariableAccesses = VariableAccesses;
module.exports.BooleanMonad = BooleanMonad;
module.exports.ListMonad = ListMonad;
module.exports.MapMonad = MapMonad;
