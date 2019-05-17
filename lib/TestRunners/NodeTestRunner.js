const { existsSync } = require('fs');
const path = require('path');
const Mocha = require('mocha');
const ScriptBundler = require('../Bundlers/ScriptBundler');
const TestRunner = require('./TestRunner');
// require('source-map-support/register');

class NodeTestRunner extends TestRunner {
    async run(files) {
        await super.run(files);

        const bundler = new ScriptBundler();
        const inputCode = files.map((file) => `import '${file.path}';`).join('\n');
        const testFile = this.testDir.file('__specs__.js');

        this.emit(NodeTestRunner.START_EVENT);

        this.emit(NodeTestRunner.PREPARE_START_EVENT);
        await bundler.setup({
            code: inputCode,
            input: testFile,
            root: this.options.root,
            output: this.testDir,
            bundle: true,
            format: 'cjs',
            targets: this.options.targets,
            map: 'inline',
            assertions: true,
            lint: false,
            analyze: false,
            polyfill: false,
            typings: false,
            progress: false,
            coverage: this.options.coverage,
            jsx: {
                module: this.options['jsx.module'],
                pragma: this.options['jsx.pragma'],
                pragmaFrag: this.options['jsx.pragmaFrag'],
            },
        });

        const { watchFiles } = await bundler.build();
        await bundler.write();
        this.emit(NodeTestRunner.PREPARE_END_EVENT);

        this.addResources(...watchFiles.filter((filePath) => existsSync(filePath)));

        const mocha = new Mocha(this.options);

        delete require.cache[testFile.path];
        mocha.addFile(testFile.path);

        this.result = await new Promise((resolve) => {
            mocha.run((failures) => {
                if (this.options.coverage && global.__coverage__) {
                    this.reportCoverage(global.__coverage__, `${process.title.split(path.sep).pop()}-${process.version}`);
                }
                resolve({
                    exitCode: failures ? 1 : 0,
                    coverage: this.coverageMap.toJSON(),
                    failed: failures.length,
                });
            });
        });

        this.emit(NodeTestRunner.END_EVENT, this.result);

        return this.result;
    }
}

module.exports = NodeTestRunner;