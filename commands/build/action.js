const fs = require('fs-extra');
const path = require('path');
const colors = require('colors/safe');
const Proteins = require('@chialab/proteins');
const paths = require('../../lib/paths.js');
const Entry = require('../../lib/entry.js');
const bundle = require('./bundlers/rollup.js');
const sass = require('./bundlers/sass.js');
const watcher = require('../../lib/watcher.js');
const ext = require('../../lib/extensions.js');
const browserslist = require('../../lib/browserslist.js');

/**
 * Command action to build sources.
 *
 * @param {CLI} app CLI instance.
 * @param {Object} options Options.
 * @param {Profiler} profiler The command profiler instance.
 * @returns {Promise}
 *
 * @namespace options
 * @property {Boolean} production Should bundle files for production.
 * @property {Boolean} map Should include sourcemaps.
 * @property {Boolean} lint Should lint files before bundle.
 * @property {Boolean} lint-styles Should lint SASS files.
 * @property {Boolean} lint-js Should lint JavaScript files.
 * @property {Boolean} watch Should watch files.
 * @property {Boolean} cache Use cache if available.
 */
module.exports = (app, options = {}, profiler) => {
    options = Proteins.clone(options);
    if (!options.arguments.length && !paths.cwd) {
        // Unable to detect project root.
        app.log(colors.red('no project found.'));
        return global.Promise.reject();
    }
    let lintTask = global.Promise.resolve();
    if (options.lint !== false) {
        lintTask = app.exec('lint', {
            arguments: typeof options.lint === 'string' ? [options.lint] : options.arguments,
            styles: options['lint-styles'] !== false,
            js: options['lint-js'] !== false,
            warnings: false,
        });
    }
    return lintTask.then((lintErrors) => {
        if (lintErrors && lintErrors.length) {
            return global.Promise.reject();
        }
        let entries = Entry.resolve(options.arguments);
        let promise = global.Promise.resolve();

        let bundleManifests = [];

        // Process entries.
        entries.forEach((entry) => {
            if (entry.file) {
                promise = promise.then(() => {
                    let opts = Proteins.clone(options);
                    opts.input = entry.file.path;
                    if (opts.output) {
                        if (entry.length > 1) {
                            opts.output = path.resolve(path.dirname(entry.file.path), opts.output);
                        }
                    }
                    if (ext.isStyleFile(entry.file.path)) {
                        // Style file
                        return sass(app, opts, profiler)
                            .then((manifest) => {
                                // collect the generated BundleManifest
                                bundleManifests.push(manifest);
                                return global.Promise.resolve(manifest);
                            });
                    }
                    // Javascript file
                    return bundle(app, opts, profiler)
                        .then((manifest) => {
                            // collect the generated BundleManifest
                            bundleManifests.push(manifest);
                            return global.Promise.resolve(manifest);
                        });
                });
            } else {
                promise = promise.then(() => {
                    let json = entry.package.json;

                    // if package has not main field and options output is missing
                    // the cli cannot detect where to build the files.
                    if (!json.main && !options.output) {
                        app.log(colors.red(`Missing 'output' property for ${entry.package.name} module.`));
                        return global.Promise.reject();
                    }
                    let packageBundlePromise = global.Promise.resolve();

                    // build `modules` > `main`.js
                    // clone options in order to use for js bundler.
                    let jsOptions = Proteins.clone(options);
                    if (json.module && ext.isJSFile(json.module)) {
                        // if module field is a javascript file, use it as source file.
                        jsOptions.input = path.join(entry.package.path, json.module);
                        // if the output option is missing, use the main field.
                        let stat = fs.existsSync(json.main) && fs.statSync(json.main);
                        let distPath = stat && stat.isDirectory() ?
                            path.join(entry.package.path, json.main, path.basename(jsOptions.input)) :
                            path.join(entry.package.path, json.main);
                        jsOptions.output = jsOptions.output || distPath;
                    } else if (jsOptions.output && ext.isJSFile(json.main)) {
                        // if output option is different from the main field
                        // we can use the main file as source if it is javascript.
                        jsOptions.input = path.join(entry.package.path, json.main);
                    }
                    if (jsOptions.input) {
                        jsOptions.browserslist = browserslist(json);
                        // a javascript source has been detected.
                        packageBundlePromise = packageBundlePromise.then(() =>
                            bundle(app, jsOptions, profiler)
                                .then((manifest) => {
                                    bundleManifests.push(manifest);
                                    return global.Promise.resolve(manifest);
                                })
                        );
                    }

                    // build `style` > `main`.css
                    // clone options in order to use for sass bundler.
                    let styleOptions = Proteins.clone(options);
                    if (json.style && ext.isStyleFile(json.style)) {
                        // if style field is a style file, use it as source file.
                        styleOptions.input = path.join(entry.package.path, json.style);
                        // if the output option is missing, use the main field.
                        let stat = fs.existsSync(json.main) && fs.statSync(json.main);
                        let distPath = stat && stat.isDirectory() ?
                            path.join(entry.package.path, json.main, path.basename(jsOptions.input)) :
                            path.join(entry.package.path, json.main);
                        styleOptions.output = styleOptions.output || distPath;
                        // ensure output style file.
                        if (!ext.isStyleFile(styleOptions.output)) {
                            styleOptions.output = path.join(
                                path.dirname(styleOptions.output),
                                `${path.basename(styleOptions.output, path.extname(styleOptions.output))}.css`
                            );
                        }
                    } else if (styleOptions.output && ext.isStyleFile(json.main)) {
                        // if output option is different from the main field
                        // we can use the main file as source if it is a style.
                        styleOptions.input = path.join(entry.package.path, json.main);
                    }
                    if (styleOptions.input) {
                        styleOptions.browserslist = browserslist(json);
                        // a style source has been detected.
                        packageBundlePromise = packageBundlePromise.then(() =>
                            sass(app, styleOptions, profiler)
                                .then((manifest) => {
                                    // collect the generated BundleManifest
                                    bundleManifests.push(manifest);
                                    return global.Promise.resolve(manifest);
                                })
                        );
                    }

                    return packageBundlePromise;
                });
            }
        });

        return promise
            .then(() => {
                // once bundles are generated, check for watch option.
                if (options.watch) {
                    // collect bundles dependencies.
                    let files = {};
                    // iterate BundleManifest instances.
                    bundleManifests.forEach((bundleManifest) => {
                        // iterate bundle dependencies.
                        bundleManifest.files.forEach((f) => {
                            // collect file manifest dependents.
                            files[f] = files[f] || [];
                            files[f].push(bundleManifest);
                        });
                    });
                    // start the watch task
                    watcher(app, Object.keys(files), (event, fp) => {
                        // find out manifests with changed file dependency.
                        let bundles = files[fp];
                        // setup a rebuild Promises chain.
                        let rebuildPromise = global.Promise.resolve();
                        bundles.forEach((bundle) => {
                            let shouldLint = (ext.isStyleFile(fp) && (options['lint-styles'] !== false && options.lint !== false)) ||
                                (ext.isJSFile(fp) && (options['lint-js'] !== false && options.lint !== false));
                            // exec build again using cache.
                            rebuildPromise = rebuildPromise.then(() => app.exec('build', Object.assign(options, {
                                arguments: [bundle.input],
                                output: bundle.output,
                                lint: shouldLint && fp,
                                cache: true,
                                watch: false,
                            }))).catch((err) => {
                                if (err) {
                                    app.log(err);
                                }
                            });
                        });
                    });
                }
                // resolve build task with the list of generated manifests.
                return global.Promise.resolve(bundleManifests);
            });
    });
};
