/**
 * Register command to CLI.
 *
 * @param {Command} program Command.
 * @returns {void}
 */
module.exports = (program) => {
    program
        .command('manifest')
        .description('Generate webapp Manifest.')
        .readme(`${__dirname}/README.md`)
        .option('<path>', 'The webapp path.')
        .option('--output', 'Where to save the generated manifest.')
        .option('[--manifest]', 'An input manifest file.')
        .option('[--icon]', 'The path of the main icon to generate.')
        .option('[--index]', 'Path to the index.html to update.')
        .option('[--scope]', 'Force manifest scope.')
        .deprecate('3.0.0', 'Please checkout the new `rna build` features.')
        .action(async (app, options = {}) => {
            const Project = require('../../lib/Project');
            const HTMLBundler = require('../../lib/Bundlers/HTMLBundler');
            const WebManifestBundler = require('../../lib/Bundlers/WebManifestBundler');

            const cwd = process.cwd();
            const project = new Project(cwd);

            let root;
            if (options.arguments.length) {
                root = project.directory(options.arguments[0]);
            } else {
                root = project;
            }

            let manifestBundler = new WebManifestBundler(app, project);
            let manifestOptions = {};
            let htmlBundler;
            let htmlOptions = {
                styles: false,
                scripts: false,
                icon: false,
                serviceWorker: false,
            };

            if (options.manifest) {
                manifestOptions.input = project.file(options.manifest);
            }

            if (options.scope) {
                manifestOptions.scope = options.scope;
            }

            if (options.icon) {
                htmlOptions.icon = manifestOptions.icon = project.file(options.icon);
            }

            if (typeof options.index === 'string') {
                htmlBundler = new HTMLBundler(app, project);
                htmlOptions.input = project.file(options.index);
            }

            if (options.output) {
                let outputDir = project.directory(options.output);
                // use output flag if defined.
                if (manifestOptions.input) {
                    manifestOptions.output = outputDir.file(manifestOptions.input.basename);
                } else {
                    manifestOptions.output = outputDir.file('manifest.json');
                }
                if (htmlOptions.input) {
                    htmlOptions.output = outputDir.file(htmlOptions.input.basename);
                } else {
                    htmlOptions.output = outputDir.file('index.html');
                }
            } else {
                // default manifest path.
                manifestOptions.output = root.file('manifest.json');
                if (htmlBundler) {
                    htmlOptions.output = root.file('index.html');
                }
            }

            await manifestBundler.setup(manifestOptions);
            let res = await manifestBundler.build();

            if (htmlBundler) {
                htmlOptions.webmanifest = manifestOptions.output;
                await htmlBundler.setup(htmlOptions);
                await htmlBundler.build();
            }

            return res;
        });
};
