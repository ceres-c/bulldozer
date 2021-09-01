#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { parseScript } = require('shift-parser');
const { program } = require('commander');

const { decompile } = require('./cfg/graph');
const { get_eligible_functions, switch_structure_analyzer, replace_loop } = require('./parsers/preprocessor');
const codegen = require('./helpers/codegen');
const globals = require('./helpers/globals');
const { literals_descrambler } = require('./transforms/literals_descrambler');

let splash =
`
                          ▐██████
                          ███████████████▄      █▀     ▄
                          █▐██  ▒▌ ██▌ ▐█ ▌     █▌    ▀█▌
                          █▐██  ▒▌ ██▌ ▐█ ▌ ▒█▌ █▌    ▌▐█
                        ▄▄███████████▌ ▐██▌▌███▌██▌▌▌██▌██▄
                      ▄██████████████▌ ▐██████████████████▌
      ▄               ████████████████▄▄████▒      █████▌▀█
    ▄██▌▄▄▄▄▄        ██████▀▀▀▀██████████████▒     ██████ ██           ▄
   ████     ▀▀▀███▌▄▄▒██▀▄██████▄▄▀▀█████████▄     ██████ ▐█▌         ██▄
 ▄████▌         ▐▌▀▀▀▀▒▄███▒██▒▀▒████▄▄▀▀██████▌▄  ██████▄ ▐█       █████▄
▄█████▌     ▄▄▄▄█▌▄▄▄▄██▀▐██▀▀██    ▀█████▌▄▄▒▀▀▀▒███████▌  ▀▌    ████████
██████████████▄▐▀▀▒▄██▀   ██████         ▀▀▀████████▄▄▄▒▀█▄▄▄██ ▐█████████▌
▀████▀▀▀▀███████▀▄██▒      ▒▒▒                   ▀██████▄▒▒███▄███████████
 ████▄         ▀█████████████████████████████████▌█████████▄▄██████████████▌
 ▀████          ▐███▀▀███▀▀███▀▀███▀▀███▀▀███▀▀█████████████▄▒██████████████▄
   ▀██▄          ▀██▄▄███▄▄███▄▄███▄▄███▄▄███▄▄████▀             ▀▀▀██████████▄
       ▀           ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀                    ▀▀▀▒██▒▀
                              Welcome to bulldozer!
`

program
	.option('-d, --debug', 'enable debugging output (quite chatty)', false)
	.requiredOption('-s, --source <collina.js>', 'collina.js source file to read');
program.parse(process.argv);
const options = program.opts();
globals.debug = options.debug;

console.log(splash)

if (!fs.existsSync(options.source)) {
	console.log("[!] Couldn't find specified file!");
	process.exit(1)
}
console.log(`[*] Reading source file: ${options.source}`);
const collina_src = fs.readFileSync(options.source, "utf-8");

let tree, statements;
tree = parseScript(collina_src);

console.log("[*] Searching eligible functions");
let functions_list = get_eligible_functions(tree);

for (let fun of functions_list) {
	console.log(`[*] Analyzing function ${fun.name.name}`);

	let state_machine_data = switch_structure_analyzer(fun);

	statements = decompile(fun, state_machine_data);
	console.log(`[#] There were ${globals.ABNORMAL_LOOP_ENTRIES.length} abnormal loop entries in total:`, globals.ABNORMAL_LOOP_ENTRIES); // TODO add "(they were replaced with ifs)" once done

	globals.ABNORMAL_LOOP_ENTRIES = [] // Reset global

	replace_loop(fun, literals_descrambler(statements)); // Replace obfuscated code with new code
}

console.log("[*] Generating and writing code to file");

let filename;
let i = 1;
filename = options.source.split('.').slice(0, -1).join('.') + "_unflattened.js";
while (fs.existsSync(filename)) {
	// Avoid file collisions
	filename = options.source.split('.').slice(0, -1).join('.') + "_unflattened.js" + i.toString();
	i++;
}
fs.writeFileSync(filename, codegen(tree));
console.log("[*] Done, saved to", filename);
