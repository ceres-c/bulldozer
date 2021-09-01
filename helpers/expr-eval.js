module.exports.binexpr_eval = {
    // ',' // The comma "operator" should not be handled here but at AST level
    '||': function (x, y) {return x || y},
    '&&': function (x, y) {return x && y},
    '|': function (x, y) {return x | y},
    '^': function (x, y) {return x ^ y},
    '&': function (x, y) {return x & y},

    '+': function (x, y) {return x + y},
    '-': function (x, y) {return x - y},

    '==': function (x, y) {return x == y},
    '!=': function (x, y) {return x != y},
    '===': function (x, y) {return x === y},
    '!==': function (x, y) {return x !== y},

    '*': function (x, y) {return x * y},
    '/': function (x, y) {return x / y},
    '%': function (x, y) {return x % y},

    '**': function (x, y) {return x ** y},

    '<': function (x, y) {return x < y},
    '<=': function (x, y) {return x <= y},
    '>': function (x, y) {return x > y},
    '>=': function (x, y) {return x >= y},
    'in': function (x, y) {return x in y},
    'instanceof': function (x, y) {return x instanceof y},

    '<<': function (x, y) {return x << y},
    '>>': function (x, y) {return x >> y},
    '>>>': function (x, y) {return x >>> y},
}

module.exports.compexpr_eval = {
    '+=': function (x, y) {return x + y},
    '-=': function (x, y) {return x - y},
    '*=': function (x, y) {return x * y},
    '/=': function (x, y) {return x / y},
    '%=': function (x, y) {return x % y},
    '**=': function (x, y) {return x ** y},
    '<<=': function (x, y) {return x << y},
    '>>=': function (x, y) {return x >> y},
    '>>>=': function (x, y) {return x >>> y},
    '&=': function (x, y) {return x & y},
    '^=': function (x, y) {return x ^ y},
    '|=': function (x, y) {return x | y},
    '&&=': function (x, y) {return x ? y : x},
    '||=': function (x, y) {return x ? x : y},
    '??=': function (x, y) {return (x === null || x === undefined) ? y : x},
}

module.exports.updateexpr_eval = {
    '++': function (x) {return x += 1},
    '--': function (x) {return x -= 1},
}