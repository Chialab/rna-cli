/**
 * Register command to CLI.
 *
 * @param {Command} program Command.
 * @returns {void}
 */
module.exports = (program) => {
    program
        .command('install')
        .description('Sync project dependencies after a project update or a git pull.')
        .action(async (app) => {
            const Project = require('../../lib/Project');
            const cwd = process.cwd();
            const project = new Project(cwd);

            // Run `yarn install`.
            await project.packageManager.install();
            app.logger.success('dependencies successfully updated');
        });
};
