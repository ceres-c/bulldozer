# Bulldozer
A deobfuscator/decompiler written in JavaScript for JavaScript "binaries", currently targeted at `collina.js` from AliExpress.

Reconstructing a flattened CFG, recovering control structures and deobfuscating literals via partial evaluation. In JavaScript.

## Usage
Install dependencies and you're ready to go
```console
npm install
./bulldozer.js -s collinas/collina_orig.js
```
The process will take some time (especially cyclic regions identification), and the result file will appear alongside the input with `_unflattened` appended. The resulting file can be used as a drop-in replacement for the original `collina.js` with chrome overrides.

### Debug mode
Passing the parameter `-d` debug mode is enabled. Beware, it is REALLY chatty

## How it works
See my bachelor [thesis](thesis.pdf) to have some insights on the concepts behind this work.

We tried to keep the code clean and documented, but neither of us had any previous experience with JavaScript, so it might not follow all the best practices everywhere. Also, we don't like coding, we're hackers.

## Contributors
* [ceres-c](https://ceres-c.it/)
* [MrMoDDoM](https://mrmoddom.github.io/)

## Thanks to
Shape Security Inc. for their wonderful [shift-ast](https://shift-ast.org/) suite and [unminify](https://github.com/shapesecurity/unminify).

The [angr](https://github.com/angr/angr) developers: the CFG analysis part of this project was heavily inspired by their decompiler component.

## License
```
Copyright 2021 @ceres-c and @MrMoDDoM.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```