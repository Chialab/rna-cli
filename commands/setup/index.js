/**
 * Register command to CLI.
 *
 * @param {Command} program Command.
 * @returns {void}
 */
module.exports = (program) => {
    program
        .command('setup')
        .description('Setup a new project.')
        .option('[dir]', 'The project root to create.')
        .option('--no-git', 'Skip git setup.')
        .option('--no-npm', 'Skip package.json setup.')
        .option('--no-config', 'Skip editor config files.')
        .option('--no-linting', 'Skip lint config files.')
        .option('--no-license', 'Skip license files.')
        .option('--no-readme', 'Skip README generation.')
        .option('--force', 'Force project setup if already initialized.')
        .action((app, options = {}) => require('./action')(app, options));
};
