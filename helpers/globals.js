// This file exports all the global constants needed in multiple files

module.exports = {
    debug: false,
    DUMMY_NODE_ID: 0xBAAAAAAD, // Could be a value in every native data type, I've picked a number due to jsnx internal implementation which divides numbers from strings, but my restore from json function supports numbers only
    // INTERNAL VARIABLES
    STRUCTURED_NODES_COUNT: 0, // TODO do not assign in structurer
    ABNORMAL_LOOP_ENTRIES: [],
};
