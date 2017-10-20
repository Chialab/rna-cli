const fs = require('fs');
const path = require('path');
const Linter = require('eslint').CLIEngine;
const SassLinter = require('sass-lint');
const paths = require('../../lib/paths.js');
const optionsUtils = require('../../lib/options.js');

function getConfig(app) {
    let localConf = path.join(paths.cwd, '.eslintrc.yml');
    if (fs.existsSync(localConf)) {
        app.log(`Config file: ${localConf}`.grey);
        return localConf;
    }
    return path.join(paths.cli, 'configs/lint/eslintrc.yml');
}

function eslintTask(app, sourceFiles, options) {
    if (options.js !== false) {
        let configFile = getConfig(app);
        let jsFiles = sourceFiles
            .filter((src) => fs.existsSync(src))
            .filter((src) => !fs.statSync(src).isFile() || src.match(/\.jsx?$/i))
            .map((src) => {
                if (fs.statSync(src).isFile()) {
                    return src;
                }
                return path.join(src, 'src/**/*.{js,jsx}');
            });
        let task = app.log('Running ESLint...', true);
        return new global.Promise((resolve) => {
            setTimeout(() => {
                const linter = new Linter({
                    configFile,
                    cwd: paths.cwd,
                });
                const report = linter.executeOnFiles(jsFiles);
                task();
                if (report.errorCount || report.warningCount) {
                    const formatter = linter.getFormatter();
                    app.log(formatter(report.results));
                    return resolve(
                        (options.warning !== false || report.errorCount) ? report : undefined
                    );
                }
                app.log('Everything is fine with ESLint.'.green);
                resolve();
            }, 1000);
        });
    }
    return global.Promise.resolve();
}

function sasslintTask(app, sourceFiles, options) {
    if (options.styles !== false) {
        let task = app.log('Running SassLint...', true);
        return new global.Promise((resolve) => {
            setTimeout(() => {
                let sassFiles = sourceFiles
                    .filter((src) => fs.existsSync(src))
                    .filter((src) => !fs.statSync(src).isFile() || src.match(/\.(css|sass|scss)$/i))
                    .map((src) => {
                        if (fs.statSync(src).isFile()) {
                            return src;
                        }
                        return path.join(src, 'src/**/*.{scss,sass,css}');
                    });
                let count = 0;
                let reports = [];
                sassFiles.forEach((src) => {
                    let report = SassLinter.lintFiles(src, {});
                    report.forEach((r) => {
                        count += r.errorCount + r.warningCount;
                    });
                    reports.push(...report);
                });
                task();
                if (count) {
                    SassLinter.outputResults(reports);
                    return resolve(reports);
                }
                app.log('Everything is fine with SassLint.'.green);
                resolve();
            }, 1000);
        });
    }
    return global.Promise.resolve();
}

module.exports = (program) => {
    program
        .command('lint')
        .description('Lint your source files.')
        .help(`For javascript linting, it uses \`eslint\` (https://eslint.org).
A default configuration is also provided in the config path of this module.
Anyway, the developer can use a custom configuration if the \`.eslintrc.yml\` file exists in the root of the project.
It supports \`.eslintignore\` too.

For style linting, it uses \`sass-lint\` (https://github.com/sasstools/sass-lint).
A default configuration is also provided in the config path of this module.
Anyway, the developer can use a custom configuration if the \`sass-lint.yml\` file exists in the root of the project.`)
        .option('[file1] [file2] [package1] [package2] [package3]', 'The packages or the files to lint.')
        .option('--no-js', 'Do not exec javascript linting.')
        .option('--no-styles', 'Do not exec style linting.')
        .option('--no-warnings', 'Do not check for warnings.')
        .action((app, options) => {
            if (!paths.cwd) {
                app.log('No project found.'.red);
                return global.Promise.reject();
            }
            let filter = optionsUtils.handleArguments(options);
            let toLint = filter.files.concat(Object.values(filter.packages).map((pkg) => pkg.path));
            return eslintTask(app, toLint, options)
                .then((eslintRes) => {
                    let res = eslintRes ? [eslintRes] : [];
                    return sasslintTask(app, toLint, options)
                        .then((sassRes) => {
                            if (sassRes) {
                                res.push(sassRes);
                            }
                            return global.Promise.resolve(res);
                        });
                });
        });
};